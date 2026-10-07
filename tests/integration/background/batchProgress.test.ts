import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BatchTranslationRequest, Message, UserSettings } from '@/shared/types';

vi.mock('@/background/storage', () => ({ StorageManager: {
  getSettings: vi.fn(), getApiKey: vi.fn(), getUserProfile: vi.fn(),
} }));
vi.mock('@/background/translationApi', () => ({ TranslationApiService: { callWithSystem: vi.fn() } }));
vi.mock('@/background/enhancedCache', () => ({ enhancedCache: {
  generateHash: vi.fn((text: string, mode: string) => `${mode}:${text}`),
  getBatch: vi.fn(), set: vi.fn(), getGeneration: vi.fn(() => 7),
} }));
vi.mock('@/background/pendingRequestQueue', () => ({ pendingRequestQueue: {
  add: vi.fn().mockResolvedValue(undefined), trackCleanup: vi.fn(),
} }));
vi.mock('@/shared/utils', async original => ({ ...(await original<object>()),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { BatchTranslationService } from '@/background/batchTranslation';
import { translateBatchWithJoin, clearInflightBatches, inflightBatchCount } from '@/background/inflightBatchDedup';
import { handleTranslationMessage } from '@/background/translationMessages';
import { TranslationApiService } from '@/background/translationApi';
import { StorageManager } from '@/background/storage';
import { enhancedCache } from '@/background/enhancedCache';
import { TransportError } from '@/shared/utils/translationErrors';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const profile = { examType: 'cet4', estimatedVocabulary: 4500, knownWords: [], unknownWords: [] };
const settings = { apiProvider: 'openai', translationMode: 'bilingual', grammarTranslationEnabled: true } as UserSettings;
const paragraph = (id: string, fullText: string) => ({ id, fullText, words: [], sentences: [], grammarPoints: [] });
const first = paragraph('PARA_0', '首段译文');
const second = paragraph('PARA_1', '尾段译文');
const fullResponse = (items = [first, second]) => JSON.stringify({ paragraphs: items });
const request = (prefix = 'p'): BatchTranslationRequest => ({
  paragraphs: [{ id: `${prefix}0`, text: 'First English paragraph.', elementPath: '#a' },
    { id: `${prefix}1`, text: 'Second English paragraph.', elementPath: '#b' }],
  mode: 'bilingual', pageUrl: 'https://example.org', userLevel: profile,
} as BatchTranslationRequest);
const api = vi.mocked(TranslationApiService.callWithSystem);
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function holdStream() {
  const tail = deferred<string>();
  api.mockImplementationOnce(async (_system, _prompt, _key, _settings, _retry, options) => {
    options?.onStreamStart?.();
    options?.onTextDelta?.(`{"paragraphs":[${JSON.stringify(first)},`);
    options?.signal?.addEventListener('abort', () => tail.reject(options.signal?.reason), { once: true });
    return tail.promise;
  });
  return tail;
}

beforeEach(() => {
  vi.clearAllMocks();
  api.mockReset();
  clearInflightBatches();
  vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('test-key');
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue(profile as never);
  vi.mocked(enhancedCache.getBatch).mockResolvedValue({ hits: new Map(), misses: [] });
  vi.mocked(enhancedCache.set).mockResolvedValue(undefined);
  vi.stubGlobal('chrome', { tabs: { sendMessage: vi.fn().mockResolvedValue(undefined) } });
});

describe('真实批次与在途逐段结果', () => {
  it('首段完成即推送，最终响应仍等待尾段与缓存写入', async () => {
    const tail = holdStream();
    const cacheWrite = deferred<void>();
    vi.mocked(enhancedCache.set).mockReturnValueOnce(cacheWrite.promise);
    const onParagraph = vi.fn();
    let settled = false;
    const pending = translateBatchWithJoin(request(), { onParagraph }).then(value => { settled = true; return value; });
    await vi.waitFor(() => expect(onParagraph).toHaveBeenCalledTimes(1));
    expect(onParagraph.mock.calls[0][0]).toMatchObject({ id: 'p0', result: { fullText: '首段译文' } });
    expect(settled).toBe(false);
    expect(enhancedCache.set).not.toHaveBeenCalled();
    tail.resolve(fullResponse());
    await vi.waitFor(() => expect(enhancedCache.set).toHaveBeenCalledTimes(1));
    expect(onParagraph).toHaveBeenCalledTimes(2);
    expect(settled).toBe(false);
    cacheWrite.resolve();
    const result = await pending;
    expect(result.results).toEqual(onParagraph.mock.calls.map(([value]) => value));
    expect(inflightBatchCount()).toBe(0);
    expect(vi.mocked(enhancedCache.set).mock.calls[0][5]).toBe(7);
  });

  it('刷新 join 重放首段并等待尾段，不重发 API，正确重映射所有 id', async () => {
    const tail = holdStream();
    const oldProgress = vi.fn();
    const owner = translateBatchWithJoin(request(), { onParagraph: oldProgress });
    await vi.waitFor(() => expect(oldProgress).toHaveBeenCalledTimes(1));
    const newProgress = vi.fn();
    let joinedDone = false;
    const joined = translateBatchWithJoin(request('new'), { onParagraph: newProgress }).then(value => { joinedDone = true; return value; });
    await vi.waitFor(() => expect(newProgress).toHaveBeenCalledTimes(1));
    expect(newProgress.mock.calls[0][0].id).toBe('new0');
    expect(inflightBatchCount()).toBe(2);
    expect(joinedDone).toBe(false);
    tail.resolve(fullResponse());
    const [, result] = await Promise.all([owner, joined]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(result.results.map(value => value.id)).toEqual(['new0', 'new1']);
    expect(newProgress).toHaveBeenCalledTimes(2);
  });

  it('同批相同原文只发一次，最终和同步进度均按各自 id 映射', async () => {
    api.mockResolvedValueOnce(fullResponse([first]));
    const onParagraph = vi.fn();
    const original = request();
    const result = await translateBatchWithJoin({ ...original, paragraphs: original.paragraphs.map(p => ({ ...p, text: 'Same paragraph.' })) }, { onParagraph });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][1]).not.toContain('[PARA_1]');
    expect(result.results.map(p => p.id)).toEqual(['p0', 'p1']);
    expect(onParagraph.mock.calls.map(([p]) => p.id)).toEqual(['p0', 'p1']);
  });

  it('join 取消只停止自身订阅，不取消 owner', async () => {
    const tail = holdStream();
    const ownerProgress = vi.fn();
    const owner = translateBatchWithJoin(request(), { onParagraph: ownerProgress });
    await vi.waitFor(() => expect(ownerProgress).toHaveBeenCalledTimes(1));
    const controller = new AbortController();
    const joinProgress = vi.fn();
    const joined = translateBatchWithJoin(request('new'), { signal: controller.signal, onParagraph: joinProgress });
    const rejected = expect(joined).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(joinProgress).toHaveBeenCalledTimes(1));
    controller.abort();
    await rejected;
    expect(inflightBatchCount()).toBe(2);
    tail.resolve(fullResponse());
    await owner;
    expect(ownerProgress).toHaveBeenCalledTimes(2);
    expect(joinProgress).toHaveBeenCalledTimes(1);
    expect(inflightBatchCount()).toBe(0);
  });

  it('owner 取消传播到 join，保留已发布首段但整体不伪成功', async () => {
    holdStream();
    const controller = new AbortController();
    const onParagraph = vi.fn();
    const owner = translateBatchWithJoin(request(), { signal: controller.signal, onParagraph });
    const ownerRejected = expect(owner).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(onParagraph).toHaveBeenCalledTimes(1));
    const joined = translateBatchWithJoin(request('new'));
    const joinRejected = expect(joined).rejects.toMatchObject({ name: 'AbortError' });
    await flush();
    controller.abort();
    await Promise.all([ownerRejected, joinRejected]);
    expect(onParagraph).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
    expect(inflightBatchCount()).toBe(0);
  });

  it('尾段失败不撤回已发布结果，不写半批缓存且清理所有条目', async () => {
    const tail = holdStream();
    const onParagraph = vi.fn();
    const pending = translateBatchWithJoin(request(), { onParagraph });
    const rejected = expect(pending).rejects.toThrow('tail failed');
    await vi.waitFor(() => expect(onParagraph).toHaveBeenCalledTimes(1));
    tail.reject(new Error('tail failed'));
    await rejected;
    expect(onParagraph).toHaveBeenCalledTimes(1);
    expect(enhancedCache.set).not.toHaveBeenCalled();
    expect(inflightBatchCount()).toBe(0);
  });

  it('重试重置解析器，不覆写首次完整结果；非法/重复/半截段落不得推送', async () => {
    api.mockImplementationOnce(async (_s, _p, _k, _c, _r, options) => {
      options?.onStreamStart?.();
      options?.onTextDelta?.('{"paragraphs":[{"id":"PARA_8","words":[],"fullText":"非法"},');
      options?.onTextDelta?.(`${JSON.stringify(first)},${JSON.stringify({ ...first, fullText: '重复' })},{"id":"PARA_1","fullText":"半截`);
      options?.onStreamStart?.();
      options?.onTextDelta?.(fullResponse([{ ...first, fullText: '重试首段' }, second]));
      return fullResponse([{ ...first, fullText: '重试首段' }, second]);
    });
    const onParagraph = vi.fn();
    const result = await BatchTranslationService.translateBatch(request(), { onParagraph });
    expect(onParagraph).toHaveBeenCalledTimes(2);
    expect(result.results[0].result.fullText).toBe('首段译文');
    expect(vi.mocked(enhancedCache.set).mock.calls[0][1].fullText).toBe('首段译文');
  });

  it.each([
    { id: 'PARA_0', fullText: '缺少数组' },
    { id: 'PARA_0', fullText: '错误数组', words: null },
    { id: 'PARA_0', fullText: '空成员', words: [null] },
    { fullText: '缺少 ID', words: [] },
    { id: 'PARA_0', fullText: '', words: [] },
  ])('非法完整对象不提前推送：%j', async invalid => {
    const tail = deferred<string>();
    api.mockImplementationOnce(async (_s, _p, _k, _c, _r, options) => {
      options?.onStreamStart?.();
      options?.onTextDelta?.(`{"paragraphs":[${JSON.stringify(invalid)},`);
      return tail.promise;
    });
    const onParagraph = vi.fn();
    const pending = BatchTranslationService.translateBatch(request(), { onParagraph });
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(onParagraph).not.toHaveBeenCalled();
    tail.resolve(fullResponse());
    await pending;
    expect(onParagraph).toHaveBeenCalledTimes(2);
  });

  it('缓存首段立即发布，尾段仍在等待 API', async () => {
    vi.mocked(enhancedCache.getBatch).mockResolvedValueOnce({ hits: new Map([['bilingual:First English paragraph.', { words: [], sentences: [], fullText: '缓存译文' }]]), misses: [] });
    const tail = deferred<string>();
    api.mockReturnValueOnce(tail.promise);
    const onParagraph = vi.fn();
    const pending = BatchTranslationService.translateBatch(request(), { onParagraph });
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    expect(onParagraph).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'p0', cached: true }));
    tail.resolve(fullResponse([{ ...first, fullText: '尾段译文' }]));
    await pending;
    expect(onParagraph).toHaveBeenCalledTimes(2);
  });

  it('length 只恢复未接受段落并重建 PARA_0，不降级已发布语法结果', async () => {
    const grammar = { original: 'First', explanation: '语法说明', type: '主语', position: [0, 5] };
    api.mockImplementationOnce(async (_s, _p, _k, _c, _r, options) => {
      options?.onStreamStart?.();
      options?.onTextDelta?.(`{"paragraphs":[${JSON.stringify({ ...first, grammarPoints: [grammar] })},`);
      throw TransportError.outputLimit();
    }).mockResolvedValueOnce(fullResponse([{ ...first, fullText: '恢复的尾段' }]));
    const onParagraph = vi.fn();
    const result = await BatchTranslationService.translateBatch(request(), { onParagraph });
    expect(api).toHaveBeenCalledTimes(2);
    expect(api.mock.calls[1][1]).toContain('[PARA_0]\nSecond English paragraph.');
    expect(api.mock.calls[1][1]).not.toContain('First English paragraph.');
    expect(result.results[0].result.grammarPoints).toEqual([grammar]);
    expect(result.results[1].result.fullText).toBe('恢复的尾段');
    expect(onParagraph).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).toHaveBeenCalledTimes(1);
    expect(vi.mocked(enhancedCache.set).mock.calls[0][0]).toBe('bilingual:First English paragraph.');
  });

  it.each([
    [{ ...first, id: 'PARA_9' }, second],
    [{ ...first, id: undefined }, second],
    [first, { ...second, id: 'PARA_0' }],
  ])('流式终包的未知、缺失或重复 ID 必须拒绝且不缓存：%j', async (...items) => {
    api.mockImplementationOnce(async (_s, _p, _k, _c, _r, options) => {
      options?.onStreamStart?.();
      options?.onTextDelta?.('{"paragraphs":[');
      return JSON.stringify({ paragraphs: items });
    });
    const onParagraph = vi.fn();
    await expect(BatchTranslationService.translateBatch(request(), { onParagraph })).rejects.toThrow('批量翻译响应格式无效');
    expect(onParagraph).not.toHaveBeenCalled();
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it.each([true, false])('已发布首段后重试回退 JSON，保留结果及严格 ID 校验：合法ID=%s', async validIds => {
    api.mockImplementationOnce(async (_s, _p, _k, _c, _r, options) => {
      options?.onStreamStart?.();
      options?.onTextDelta?.(`{"paragraphs":[${JSON.stringify(first)},`);
      options?.onStreamStart?.();
      return JSON.stringify({ paragraphs: [
        { ...first, id: validIds ? 'PARA_0' : undefined, fullText: '不得覆盖首段' }, second,
      ] });
    });
    const onParagraph = vi.fn();
    const pending = BatchTranslationService.translateBatch(request(), { onParagraph });
    if (validIds) {
      const result = await pending;
      expect(result.results[0].result.fullText).toBe('首段译文');
      expect(onParagraph).toHaveBeenCalledTimes(2);
    } else {
      await expect(pending).rejects.toThrow('批量翻译响应格式无效');
      expect(onParagraph).toHaveBeenCalledTimes(1);
      expect(enhancedCache.set).not.toHaveBeenCalled();
    }
  });

  it('全部段落已完整接受后 length 不再发恢复请求', async () => {
    api.mockImplementationOnce(async (_s, _p, _k, _c, _r, options) => {
      options?.onStreamStart?.();
      options?.onTextDelta?.(fullResponse());
      throw TransportError.outputLimit();
    });
    const onParagraph = vi.fn();
    const result = await BatchTranslationService.translateBatch(request(), { onParagraph });
    expect(result.results).toHaveLength(2);
    expect(api).toHaveBeenCalledTimes(1);
    expect(onParagraph).toHaveBeenCalledTimes(2);
    expect(enhancedCache.set).toHaveBeenCalledTimes(2);
  });

  it('本地空候选与中文跳过也逐段通知，不触发 API', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValueOnce({ ...settings, grammarTranslationEnabled: false, phraseTranslationEnabled: false });
    const onParagraph = vi.fn();
    const input = request();
    const result = await BatchTranslationService.translateBatch({ ...input, mode: 'inline-only',
      userLevel: { ...input.userLevel!, estimatedVocabulary: 99999, knownWords: ['first', 'english', 'paragraph'] },
      paragraphs: [input.paragraphs[0], { ...input.paragraphs[1], text: '这是完全中文的内容，不需要翻译。' }],
    }, { onParagraph });
    expect(api).not.toHaveBeenCalled();
    expect(onParagraph).toHaveBeenCalledTimes(2);
    expect(new Set(onParagraph.mock.calls.map(([value]) => value.id))).toEqual(new Set(['p0', 'p1']));
    expect(result.results.map(value => value.id)).toEqual(['p0', 'p1']);
  });

  it('流式与终包共用初始设置及 profile 快照，只读取一次', async () => {
    const tail = holdStream();
    const onParagraph = vi.fn();
    const input = { ...request(), userLevel: undefined };
    const pending = translateBatchWithJoin(input, { onParagraph });
    await vi.waitFor(() => expect(onParagraph).toHaveBeenCalledTimes(1));
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...settings, apiProvider: 'anthropic' });
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ ...profile, estimatedVocabulary: 99999 } as never);
    tail.resolve(fullResponse());
    await pending;
    expect(StorageManager.getSettings).toHaveBeenCalledTimes(1);
    expect(StorageManager.getUserProfile).toHaveBeenCalledTimes(1);
    expect(StorageManager.getApiKey).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][3]).toBe(settings);
    expect(enhancedCache.generateHash).toHaveBeenCalledWith('First English paragraph.', 'bilingual', expect.objectContaining({ settings, userLevel: profile }));
  });

  it('消费者同步抛错不能破坏批次或其他订阅', async () => {
    const tail = holdStream();
    const owner = translateBatchWithJoin(request(), { onParagraph: () => { throw new Error('listener'); } });
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(1));
    const onParagraph = vi.fn();
    const joined = translateBatchWithJoin(request('new'), { onParagraph });
    await vi.waitFor(() => expect(onParagraph).toHaveBeenCalledTimes(1));
    tail.resolve(fullResponse());
    await Promise.all([owner, joined]);
    expect(onParagraph).toHaveBeenCalledTimes(2);
  });
});

describe('真实消息入口文档定向进度', () => {
  const message = (requestId: string): Message => ({ type: 'BATCH_TRANSLATE_TEXT', requestId, payload: request() } as Message);

  it('刷新 join 将重放和尾段定向发给各自 documentId，绝不广播', async () => {
    const tail = holdStream();
    const owner = handleTranslationMessage(message('owner'), { tab: { id: 9 }, documentId: 'old', frameId: 0 } as chrome.runtime.MessageSender);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1));
    const joined = handleTranslationMessage(message('joined'), { tab: { id: 9 }, documentId: 'new', frameId: 0 } as chrome.runtime.MessageSender);
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, expect.objectContaining({ type: 'BATCH_TRANSLATION_PROGRESS', requestId: 'joined', payload: expect.objectContaining({ id: 'p0' }) }), { documentId: 'new' });
    tail.resolve(fullResponse());
    const results = await Promise.all([owner, joined]);
    expect(results.every(result => result.success)).toBe(true);
    expect(api).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(4);
    expect(vi.mocked(chrome.tabs.sendMessage).mock.calls.map(call => call[2])).toEqual([{ documentId: 'old' }, { documentId: 'new' }, { documentId: 'old' }, { documentId: 'new' }]);
  });

  it('没有 documentId 使用 frameId，推送失败不影响最终响应', async () => {
    api.mockResolvedValueOnce(fullResponse());
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('document closed'));
    const result = await handleTranslationMessage(message('frame'), { tab: { id: 9 }, frameId: 3 } as chrome.runtime.MessageSender);
    expect(result.success).toBe(true);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(9, expect.anything(), { frameId: 3 });
  });

  it('无 tab 或无 requestId 只返回最终结果不推送', async () => {
    api.mockResolvedValue(fullResponse());
    expect((await handleTranslationMessage(message('no-tab'), {})).success).toBe(true);
    expect((await handleTranslationMessage({ ...message('unused'), requestId: undefined }, { tab: { id: 9 } } as chrome.runtime.MessageSender)).success).toBe(true);
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
  });
});
