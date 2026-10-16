/**
 * Jev 阅读管线测试（默认关闭的实验识别 + 语境释义）
 *
 * 契约要点：
 * - 只对入选 occurrence ID 请求语境释义，逐 occurrence 回填本地坐标
 * - 空候选/空入选不请求释义；离线通用义不代替语境义
 * - 识别失败抛 JevAssessmentError（调用方可在预算内回退一次）
 * - 释义失败、配置/词表/密钥在途变化、用户取消、总 deadline 均直接传播，不得包装为识别失败
 * - 子识别自身超时（3s）不得当作总取消
 * - 日志不得包含正文
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { UserProfile, UserSettings } from '@/shared/types';
import type { JevCandidate } from '@/background/jevRecognition';

vi.mock('@/background/jevRecognition', () => ({
  collectJevCandidates: vi.fn(),
  assessJevCandidates: vi.fn(),
  resetJevRecognition: vi.fn(),
  getJevRecognitionSignal: vi.fn(() => new AbortController().signal),
}));
vi.mock('@/background/jevCredentials', () => ({ getJevApiKey: vi.fn() }));
vi.mock('@/background/storage', () => ({
  StorageManager: { getSettings: vi.fn(), getUserProfile: vi.fn(), getApiKey: vi.fn() },
}));
vi.mock('@/background/translationApi', () => ({
  TranslationApiService: { callWithSystem: vi.fn() },
}));
vi.mock('@/background/translationRequest', () => ({
  TRANSPORT_DEFAULTS: { llmTimeoutMs: 60_000, localLlmTimeoutMs: 90_000 },
}));
vi.mock('@/shared/utils', async importOriginal => ({
  ...(await importOriginal<object>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { translateJevReading, JevAssessmentError, JevConfigChangedError } from '@/background/jevTranslation';
import { collectJevCandidates, assessJevCandidates, getJevRecognitionSignal } from '@/background/jevRecognition';
import { getJevApiKey } from '@/background/jevCredentials';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { TransportError } from '@/shared/utils/translationErrors';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import { logger } from '@/shared/utils';

const TEXT = 'The serendipitous encounter changed her perspective entirely.';
const SETTINGS = {
  ...DEFAULT_SETTINGS,
  vocabularyAssessmentProvider: 'jev',
  phraseTranslationEnabled: false,
  grammarTranslationEnabled: false,
} as UserSettings;
const PROFILE = {
  ...DEFAULT_USER_PROFILE,
  estimatedVocabulary: 3000,
  knownWords: [],
  unknownWords: [],
} as unknown as UserProfile;

const candidate = (over: Partial<JevCandidate> = {}): JevCandidate => ({
  id: 'j4',
  sentence: TEXT,
  target: 'serendipitous',
  start: 4,
  end: 17,
  occurrence: 0,
  position: [4, 17],
  forced: false,
  profileFingerprint: 'f'.repeat(64),
  ...over,
});

const glossJson = (entries: Array<[string, string]>) =>
  JSON.stringify({ words: entries.map(([id, translation]) => ({ id, translation })) });

const input = () => ({ text: TEXT, context: '', profile: PROFILE, settings: SETTINGS, apiKey: 'llm-key' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getJevRecognitionSignal).mockReturnValue(new AbortController().signal);
  vi.stubGlobal('chrome', { permissions: { contains: vi.fn(async () => true) } });
  vi.mocked(getJevApiKey).mockResolvedValue('jev-key');
  vi.mocked(StorageManager.getSettings).mockResolvedValue(SETTINGS);
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue(PROFILE);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-key');
  vi.mocked(collectJevCandidates).mockReturnValue([candidate()]);
  vi.mocked(assessJevCandidates).mockImplementation(async (cs, _key, options) => {
    options?.onRequest?.();
    return [...cs];
  });
  vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(glossJson([['j4', '意外幸运的']]));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Jev 阅读管线：候选与释义', () => {
  it('当前自定义配置贯穿密钥查找、权限与识别请求', async () => {
    const config = { provider: 'custom' as const, apiUrl: 'https://recognition.example/v2/systemone', model: 'custom-jev', threshold: 0.75 };
    const settings = { ...SETTINGS, jevConfig: config };
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
    await translateJevReading({ ...input(), settings });
    expect(getJevApiKey).toHaveBeenCalledWith(config);
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://recognition.example/*'] });
    expect(assessJevCandidates).toHaveBeenCalledWith(expect.any(Array), 'jev-key', expect.objectContaining({ config }));
  });

  it('配置切换为其他host时旧密钥不可用于识别或释义', async () => {
    const config = { provider: 'custom' as const, apiUrl: 'https://other.example/systemone', model: 'custom-jev', threshold: 0.75 };
    const settings = { ...SETTINGS, jevConfig: config };
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
    vi.mocked(getJevApiKey).mockImplementation(async current => current?.apiUrl === config.apiUrl ? null : 'old-host-key');
    await expect(translateJevReading({ ...input(), settings })).rejects.toMatchObject({ reason: 'missing-key' });
    expect(assessJevCandidates).not.toHaveBeenCalled();
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('权限检查时配置代际变化立即中止，不能发送正文', async () => {
    const generation = new AbortController();
    vi.mocked(getJevRecognitionSignal).mockReturnValue(generation.signal);
    vi.mocked(chrome.permissions.contains).mockImplementationOnce(async () => { generation.abort(); return true; });
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevConfigChangedError);
    expect(assessJevCandidates).not.toHaveBeenCalled();
  });
  it('空候选：不请求识别与释义，返回空词表 jev 结果', async () => {
    vi.mocked(collectJevCandidates).mockReturnValue([]);
    const { result, apiCallCount } = await translateJevReading(input());
    expect(result).toEqual({ words: [], sentences: [], vocabularyAssessment: { provider: 'jev' } });
    expect(apiCallCount).toBe(0);
    expect(assessJevCandidates).not.toHaveBeenCalled();
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('入选为空：不请求释义', async () => {
    vi.mocked(assessJevCandidates).mockImplementation(async (_cs, _key, options) => { options?.onRequest?.(); return []; });
    const { result, apiCallCount } = await translateJevReading(input());
    expect(result.words).toEqual([]);
    expect(result.vocabularyAssessment).toEqual({ provider: 'jev' });
    expect(apiCallCount).toBe(1);
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('成功：按 occurrence 回填全部有效释义与本地坐标，只请求入选目标', async () => {
    const other = candidate({ id: 'j19', target: 'encounter', start: 19, end: 27, occurrence: 0, position: [19, 27] });
    vi.mocked(collectJevCandidates).mockReturnValue([candidate(), other]);
    // 只入选 encounter
    vi.mocked(assessJevCandidates).mockImplementation(async (_cs, _key, options) => { options?.onRequest?.(); return [other]; });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(glossJson([['j19', '遭遇']]));

    const { result, apiCallCount } = await translateJevReading(input());
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
    const [, userPrompt] = vi.mocked(TranslationApiService.callWithSystem).mock.calls[0];
    // 只请求入选目标（原句段含全部文本，只看候选词段）
    const candidateSection = JSON.parse(userPrompt.split('候选词：\n')[1].split('\n上下文：')[0]) as Array<{ id: string; target: string }>;
    expect(candidateSection.map(item => item.target)).toEqual(['encounter']);
    expect(result.words).toEqual([
      { original: 'encounter', translation: '遭遇', position: [19, 27], difficulty: expect.any(Number), isPhrase: false },
    ]);
    expect(result.vocabularyAssessment).toEqual({ provider: 'jev' });
    expect(apiCallCount).toBe(2);
  });

  it('同词多 occurrence：按 ID 分别释义并逐处回填各自坐标', async () => {
    const text = 'serendipitous and serendipitous';
    const twice = [
      candidate({ id: 'j0', sentence: text, start: 0, end: 13, position: [0, 13] }),
      candidate({ id: 'j18', sentence: text, start: 18, end: 31, occurrence: 1, position: [18, 31] }),
    ];
    vi.mocked(collectJevCandidates).mockReturnValue(twice);
    vi.mocked(assessJevCandidates).mockResolvedValue(twice);
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(glossJson([['j18', '偶然的'], ['j0', '意外幸运的']]));
    const { result } = await translateJevReading({ ...input(), text });
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
    const [, userPrompt] = vi.mocked(TranslationApiService.callWithSystem).mock.calls[0];
    expect(userPrompt).toContain('j0');
    expect(userPrompt).toContain('j18');
    expect(result.words.map(word => [word.position, word.translation])).toEqual([
      [[0, 13], '意外幸运的'], [[18, 31], '偶然的'],
    ]);
  });

  it('缺失任一入选 ID 的释义：失败，不回退整段识别', async () => {
    const other = candidate({ id: 'j19', target: 'encounter', start: 19, end: 28, position: [19, 28] });
    vi.mocked(collectJevCandidates).mockReturnValue([candidate(), other]);
    vi.mocked(assessJevCandidates).mockResolvedValue([candidate(), other]);
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(glossJson([['j19', '遭遇']]));
    await expect(translateJevReading(input())).rejects.toThrow('模型未返回有效的语境释义');
  });

  it('释义全部无效：抛固定错误且不视为识别失败（不回退依据）', async () => {
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue('{"words":[]}');
    const error = await translateJevReading(input()).catch(value => value);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('模型未返回有效的语境释义，请重试');
    expect(error).not.toBeInstanceOf(JevAssessmentError);
  });

  it.each([
    [['j999', '不存在']],
    [['j4', '意外幸运的'], ['j4', '重复']],
    [['j4', '']],
  ] as Array<Array<[string, string]>>)('陌生、重复 ID 或空释义拒绝', async entries => {
    if (entries.length === 2) {
      const other = candidate({ id: 'j18', target: 'encounter', start: 18, end: 27, position: [18, 27] });
      vi.mocked(collectJevCandidates).mockReturnValue([candidate(), other]);
      vi.mocked(assessJevCandidates).mockResolvedValue([candidate(), other]);
    }
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(glossJson(entries));
    const error = await translateJevReading(input()).catch(value => value);
    expect(error).not.toBeInstanceOf(JevAssessmentError);
    expect(error.message).toBe('模型未返回有效的语境释义，请重试');
  });

  it('识别缓存/强制入选没有网络请求：只统计释义一次', async () => {
    vi.mocked(assessJevCandidates).mockResolvedValue([candidate()]);
    const outcome = await translateJevReading(input());
    expect(outcome.apiCallCount).toBe(1);
  });

  it('拆批识别实际发出三次：合计三次识别与一次释义', async () => {
    vi.mocked(assessJevCandidates).mockImplementation(async (cs, _key, options) => {
      options?.onRequest?.(); options?.onRequest?.(); options?.onRequest?.(); return [...cs];
    });
    expect((await translateJevReading(input())).apiCallCount).toBe(4);
  });
});

describe('Jev 阅读管线：失败分类', () => {
  it('复核等待凭据期间设置切换：再次读取发现变化，拒绝旧结果', async () => {
    let reads = 0;
    vi.mocked(getJevApiKey).mockImplementation(async () => {
      reads += 1;
      if (reads === 2) vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...SETTINGS, promptVersion: 'different' });
      return 'jev-key';
    });
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevConfigChangedError);
  });

  it('释义期间同值重存密钥导致代际失效：取消释义，不返回旧结果', async () => {
    const generation = new AbortController();
    vi.mocked(getJevRecognitionSignal).mockReturnValue(generation.signal);
    vi.mocked(TranslationApiService.callWithSystem).mockImplementation(async (...args) => {
      const signal = args[5]?.signal;
      expect(signal?.aborted).toBe(false);
      generation.abort();
      expect(signal?.aborted).toBe(true);
      return glossJson([['j4', '意外幸运的']]);
    });
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevConfigChangedError);
  });

  it('识别阶段密钥变化：配置错误，不可回退', async () => {
    vi.mocked(assessJevCandidates).mockImplementation(async () => {
      vi.mocked(getJevApiKey).mockResolvedValue('replacement-key');
      throw TransportError.unavailable('Jev 识别暂不可用');
    });
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevConfigChangedError);
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('核心代际取消：配置错误，不可回退', async () => {
    vi.mocked(assessJevCandidates).mockRejectedValue(TransportError.cancelled());
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevConfigChangedError);
  });

  it('最后复核尚未完成时，总截止仍然取消在途信号', async () => {
    let stage = 0;
    let observedSignal: AbortSignal | undefined;
    vi.mocked(TranslationApiService.callWithSystem).mockImplementation(async (...args) => {
      observedSignal = args[5]?.signal;
      stage = 1;
      return glossJson([['j4', '意外幸运的']]);
    });
    vi.mocked(getJevApiKey).mockImplementation(async () => {
      if (stage === 1) stage = 2;
      else if (stage === 2) {
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(observedSignal?.aborted).toBe(true);
      }
      return 'jev-key';
    });
    await expect(translateJevReading(input(), { timeoutMs: 30 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('释义阶段收到总预算 AbortSignal，截止即取消', async () => {
    vi.mocked(TranslationApiService.callWithSystem).mockImplementation(async (...args) => {
      const signal = args[5]?.signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return '';
    });
    await expect(translateJevReading(input(), { timeoutMs: 30 })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('精确匹配 TypeSafe origin 权限', async () => {
    await translateJevReading(input());
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://api.typesafe.ai/*'] });
  });

  it('识别不可用：包装为 JevAssessmentError（可回退）', async () => {
    vi.mocked(assessJevCandidates).mockRejectedValue(TransportError.unavailable('Jev 识别暂不可用'));
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevAssessmentError);
  });

  it('子识别自身 3s 超时：视为识别失败而非总取消', async () => {
    vi.mocked(assessJevCandidates).mockRejectedValue(TransportError.timeout(3000));
    const error = await translateJevReading(input(), { timeoutMs: 90_000 }).catch(value => value);
    expect(error).toBeInstanceOf(JevAssessmentError);
  });

  it('缺少 Jev 密钥：识别失败（可回退）', async () => {
    vi.mocked(getJevApiKey).mockResolvedValue(null);
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevAssessmentError);
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('无识别域名权限：识别失败且不发起识别请求', async () => {
    vi.mocked(chrome.permissions.contains).mockResolvedValue(false);
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevAssessmentError);
    expect(assessJevCandidates).not.toHaveBeenCalled();
  });

  it('入选存在但释义服务无密钥：固定失败，不发送释义请求', async () => {
    const value = { ...input(), apiKey: '' };
    vi.mocked(StorageManager.getApiKey).mockResolvedValue('');
    const error = await translateJevReading(value).catch(value => value);
    expect(error.message).toBe('请先配置翻译服务后重试');
    expect(error).not.toBeInstanceOf(JevAssessmentError);
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('释义调用失败：原样传播，不包装为识别失败', async () => {
    const glossError = TransportError.unavailable('翻译服务暂不可用');
    vi.mocked(TranslationApiService.callWithSystem).mockRejectedValue(glossError);
    const error = await translateJevReading(input()).catch(value => value);
    expect(error).toBe(glossError);
    expect(error).not.toBeInstanceOf(JevAssessmentError);
  });

  it('配置在途变化：抛 JevConfigChangedError，结果不返回', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...SETTINGS, apiProvider: 'anthropic' } as UserSettings);
    const error = await translateJevReading(input()).catch(value => value);
    expect(error).toBeInstanceOf(JevConfigChangedError);
  });

  it('词表在途变化：抛 JevConfigChangedError', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ ...PROFILE, updatedAt: PROFILE.updatedAt + 1 } as UserProfile);
    await expect(translateJevReading(input())).rejects.toBeInstanceOf(JevConfigChangedError);
  });

  it('用户取消：abort 原样传播', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(translateJevReading(input(), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('总预算耗尽：抛总超时而非识别失败', async () => {
    const error = await translateJevReading(input(), { timeoutMs: 0 }).catch(value => value);
    expect(error).toBeInstanceOf(TransportError);
    expect(error.kind).toBe('timeout');
    expect(error).not.toBeInstanceOf(JevAssessmentError);
  });

  it('识别请求收到密钥与剩余预算（不超过总预算）', async () => {
    await translateJevReading(input(), { timeoutMs: 60_000 });
    expect(assessJevCandidates).toHaveBeenCalledTimes(1);
    const [candidates, key, assessOptions] = vi.mocked(assessJevCandidates).mock.calls[0];
    expect(candidates).toHaveLength(1);
    expect(key).toBe('jev-key');
    expect(assessOptions?.timeoutMs).toBeGreaterThan(0);
    expect(assessOptions?.timeoutMs).toBeLessThanOrEqual(60_000);
  });
});

describe('Jev 阅读管线：日志卫生', () => {
  it('日志不包含正文', async () => {
    await translateJevReading(input());
    const logged = JSON.stringify(vi.mocked(logger.info).mock.calls);
    expect(logged).not.toContain(TEXT);
    expect(logged).not.toContain('serendipitous');
  });
});
