/**
 * TranslationService 测试
 *
 * 测试核心翻译逻辑：
 * - parseResponse: LLM 响应解析
 * - buildPrompt: 提示词构建
 * - 响应格式验证
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock dependencies before importing
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getSettings: vi.fn(),
    getApiKey: vi.fn(),
  },
}));

vi.mock('@/background/translationApi', () => ({
  TranslationApiService: {
    callWithSystem: vi.fn(),
    quickTranslate: vi.fn(),
  },
}));

vi.mock('@/background/translationRequest', () => ({
  executeTransportRequest: vi.fn(),
  TRANSPORT_DEFAULTS: { legacyEngineTimeoutMs: 1000 },
}));

vi.mock('@/shared/performance', () => ({
  MetricType: {
    CACHE_OPERATION: 'cache_operation',
    API_RESPONSE_TIME: 'api_response_time',
    TRANSLATION_TOTAL_TIME: 'translation_total_time',
  },
  recordMetric: vi.fn(),
}));

vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    get: vi.fn().mockResolvedValue(null),
    fuzzyGet: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/hybridTranslation', () => ({
  HybridTranslationService: {
    translate: vi.fn(),
  },
}));

vi.mock('@/background/deeplTranslation', () => ({
  DeepLTranslationService: {
    translate: vi.fn(),
    quickTranslate: vi.fn(),
  },
}));

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  generateCacheKey: vi.fn().mockReturnValue('test-cache-key'),
}));

import { TranslationService } from '@/background/translation';
import { setOfflineWordSource, resetOfflineWordSource } from '@/background/localWordLookup';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { executeTransportRequest } from '@/background/translationRequest';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings, UserProfile, TranslationRequest, TranslationResult } from '@/shared/types';

interface TranslationInternals {
  parseResponse(content: string, settings: UserSettings): TranslationResult;
  hasDeepLApiKey(settings: UserSettings): Promise<boolean>;
  buildPrompt(request: TranslationRequest, settings: UserSettings): { systemPrompt: string; userPrompt: string };
}

// Helper to create default user settings
function createMockSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    enabled: true,
    autoHighlight: true,
    vocabHighlightEnabled: true,
    phraseTranslationEnabled: true,
    grammarTranslationEnabled: true,
    translationMode: 'inline-only',
    showDifficulty: true,
    highlightColor: '#ffff00',
    fontSize: 14,
    apiProvider: 'openai',
    blacklist: [],
    apiConfigs: [],
    hoverDelay: 300,
    theme: 'system',
    ...overrides,
  };
}

// Helper to create default user profile
function createMockUserProfile(): UserProfile {
  return {
    examType: 'cet4',
    estimatedVocabulary: 4000,
    knownWords: [],
    unknownWords: [],
    levelConfidence: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// Helper to create default translation request
function createMockRequest(overrides: Partial<TranslationRequest> = {}): TranslationRequest {
  return {
    text: 'Hello world',
    context: 'Hello world',
    userLevel: createMockUserProfile(),
    mode: 'inline-only',
    ...overrides,
  };
}

describe('TranslationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('translate', () => {
    afterEach(() => resetOfflineWordSource());

    it('默认无密钥自动翻译仅返回本地词典释义，不把页面正文发送给 Google 或其他服务', async () => {
      setOfflineWordSource({ lookup: word => word === 'intricate' ? { translation: '错综复杂的' } : undefined });
      vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('');
      const request = createMockRequest({ text: 'The Intricate book is here.', userLevel: { ...createMockUserProfile(), estimatedVocabulary: 0, knownWords: ['the', 'book', 'is', 'here'] } });

      const result = await TranslationService.translate(request);

      expect(result).toMatchObject({ _source: 'local', words: [expect.objectContaining({ original: 'Intricate', translation: '错综复杂的' })] });
      expect(executeTransportRequest).not.toHaveBeenCalled();
      expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    });

    it('无密钥时部分本地释义不得伪装完整成功，也不得外发未释义正文', async () => {
      setOfflineWordSource({ lookup: word => word === 'intricate' ? { translation: '错综复杂的' } : undefined });
      vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('');

      await expect(TranslationService.translate(createMockRequest({
        text: 'Intricate unfamiliar vocabulary appears everywhere.',
        userLevel: { ...createMockUserProfile(), estimatedVocabulary: 0 },
      }))).rejects.toThrow(/部分词汇.*本地词典/);
      expect(executeTransportRequest).not.toHaveBeenCalled();
      expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    });

    it('未配置当前服务但其他配置有密钥时，仍不得自动外发正文', async () => {
      setOfflineWordSource(null);
      vi.mocked(StorageManager.getSettings).mockResolvedValue(createMockSettings({
        apiConfigs: [{ id: 'old', name: '旧服务', provider: 'anthropic', apiKey: 'old-key', tested: true, createdAt: 0 }],
      }));
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('');

      await expect(TranslationService.translate(createMockRequest({ text: 'A long page paragraph requiring online translation.', mode: 'full-translate' })))
        .rejects.toThrow(/配置.*翻译服务|API [Kk]ey/);
      expect(executeTransportRequest).not.toHaveBeenCalled();
      expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    });

    it('默认无密钥且本地词典无法释义时返回可理解的配置提示，不外发正文', async () => {
      setOfflineWordSource(null);
      vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('');

      await expect(TranslationService.translate(createMockRequest({
        text: 'Intricate vocabulary remains incomprehensible on this page.',
        userLevel: { ...createMockUserProfile(), estimatedVocabulary: 0 },
      }))).rejects.toThrow(/本地词典.*配置翻译服务/);
      expect(executeTransportRequest).not.toHaveBeenCalled();
      expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    });

    it('默认全文翻译无密钥时拒绝请求，不外发正文', async () => {
      setOfflineWordSource(null);
      vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('');

      await expect(TranslationService.translate(createMockRequest({ text: 'Entire private page content should stay local.', mode: 'full-translate' })))
        .rejects.toThrow(/请先配置翻译服务/);
      expect(executeTransportRequest).not.toHaveBeenCalled();
      expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    });

    it('用户明确选择免费 Google 翻译时，无密钥仍可使用原服务', async () => {
      setOfflineWordSource(null);
      vi.mocked(StorageManager.getSettings).mockResolvedValue(createMockSettings({ apiProvider: 'free_google_translate' }));
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('');
      vi.mocked(executeTransportRequest).mockResolvedValue('你好世界');
      const text = 'Hello world from an explicit Google selection.';

      const result = await TranslationService.translate(createMockRequest({ text }));

      expect(result).toMatchObject({ fullText: '你好世界', _source: 'free_google' });
      expect(executeTransportRequest).toHaveBeenCalledWith(expect.stringContaining(`q=${encodeURIComponent(text).replace(/%20/g, '+')}`), expect.any(Object), expect.any(Object));
    });

    it('应该使用 HybridTranslationService 当混合翻译启用时', async () => {
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('test-key');
      const { HybridTranslationService } = await import('@/background/hybridTranslation');
      const mockResult = {
        words: [{ original: 'hello', translation: '你好', position: [0, 5] as [number, number], difficulty: 3, isPhrase: false }],
        sentences: [],
        grammarPoints: [],
      };

      vi.mocked(HybridTranslationService.translate).mockResolvedValue(mockResult);
      vi.mocked(StorageManager.getSettings).mockResolvedValue(createMockSettings({
        hybridTranslation: {
          enabled: true,
          defaultEngine: 'hybrid',
          traditionalProvider: 'deepl',
          simpleTextThreshold: 10,
          enableSmartRouting: true,
          priority: 'balanced',
        },
      }));

      const result = await TranslationService.translate(createMockRequest());

      expect(HybridTranslationService.translate).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe('parseResponse', () => {
    const service = TranslationService as unknown as TranslationInternals;

    it('应该解析有效的 JSON 响应', () => {
      const content = JSON.stringify({
        words: [
          { original: 'hello', translation: '你好', position: [0, 5], difficulty: 3, isPhrase: false },
        ],
        sentences: [
          { original: 'Hello world', translation: '你好世界' },
        ],
        fullText: '你好世界',
      });

      const result = service.parseResponse(content, createMockSettings());

      expect(result.words).toHaveLength(1);
      expect(result.words[0].original).toBe('hello');
      expect(result.words[0].translation).toBe('你好');
      expect(result.sentences).toHaveLength(1);
      expect(result.fullText).toBe('你好世界');
    });

    it('应该处理 markdown 包裹的 JSON', () => {
      const jsonContent = JSON.stringify({
        words: [{ original: 'test', translation: '测试', position: [0, 4], difficulty: 5, isPhrase: false }],
        sentences: [],
      });
      const content = '```json\n' + jsonContent + '\n```';

      const result = service.parseResponse(content, createMockSettings());

      expect(result.words).toHaveLength(1);
      expect(result.words[0].original).toBe('test');
    });

    it('应该处理不带语言标记的 markdown 代码块', () => {
      const jsonContent = JSON.stringify({
        words: [{ original: 'code', translation: '代码', position: [0, 4], difficulty: 4, isPhrase: false }],
        sentences: [],
      });
      const content = '```\n' + jsonContent + '\n```';

      const result = service.parseResponse(content, createMockSettings());

      expect(result.words).toHaveLength(1);
      expect(result.words[0].original).toBe('code');
    });

    it('应该过滤掉短语当 phraseTranslationEnabled 为 false 时', () => {
      const content = JSON.stringify({
        words: [
          { original: 'hello', translation: '你好', position: [0, 5], difficulty: 3, isPhrase: false },
          { original: 'look at', translation: '看', position: [6, 13], difficulty: 4, isPhrase: true },
        ],
        sentences: [],
      });

      const result = service.parseResponse(content, createMockSettings({
        phraseTranslationEnabled: false,
      }));

      expect(result.words).toHaveLength(1);
      expect(result.words[0].original).toBe('hello');
    });

    it('应该保留短语当 phraseTranslationEnabled 为 true 时', () => {
      const content = JSON.stringify({
        words: [
          { original: 'hello', translation: '你好', position: [0, 5], difficulty: 3, isPhrase: false },
          { original: 'look at', translation: '看', position: [6, 13], difficulty: 4, isPhrase: true },
        ],
        sentences: [],
      });

      const result = service.parseResponse(content, createMockSettings({
        phraseTranslationEnabled: true,
      }));

      expect(result.words).toHaveLength(2);
    });

    it('应该处理语法点当 grammarTranslationEnabled 为 true 时', () => {
      const content = JSON.stringify({
        words: [],
        sentences: [],
        grammarPoints: [
          { original: 'have been', explanation: '现在完成进行时', position: [0, 9], type: '时态' },
        ],
      });

      const result = service.parseResponse(content, createMockSettings({
        grammarTranslationEnabled: true,
      }));

      expect(result.grammarPoints).toHaveLength(1);
      expect(result.grammarPoints![0].original).toBe('have been');
      expect(result.grammarPoints![0].type).toBe('时态');
    });

    it('不应该处理语法点当 grammarTranslationEnabled 为 false 时', () => {
      const content = JSON.stringify({
        words: [],
        sentences: [],
        grammarPoints: [
          { original: 'have been', explanation: '现在完成进行时', position: [0, 9], type: '时态' },
        ],
      });

      const result = service.parseResponse(content, createMockSettings({
        grammarTranslationEnabled: false,
      }));

      // grammarPoints 初始化为空数组，禁用时保持为空
      expect(result.grammarPoints).toEqual([]);
    });

    it('应该处理缺失的可选字段', () => {
      const content = JSON.stringify({
        words: [{ original: 'test' }], // 缺少 translation 和 position
        sentences: [],
      });

      const result = service.parseResponse(content, createMockSettings());

      expect(result.words).toHaveLength(1);
      expect(result.words[0].translation).toBe(''); // 默认空字符串
      expect(result.words[0].position).toEqual([0, 0]); // 默认位置
    });

    it('应该抛出错误当 JSON 无效时', () => {
      const content = 'not valid json';

      expect(() => service.parseResponse(content, createMockSettings())).toThrow(
        'Failed to parse translation response'
      );
    });

    it('应该处理空响应', () => {
      const content = JSON.stringify({});

      const result = service.parseResponse(content, createMockSettings());

      expect(result.words).toEqual([]);
      expect(result.sentences).toEqual([]);
      // grammarPoints 初始化为空数组
      expect(result.grammarPoints).toEqual([]);
    });

    it('应该处理句子中的语法注释', () => {
      const content = JSON.stringify({
        words: [],
        sentences: [
          { original: 'I am happy', translation: '我很高兴', grammarNote: '主语+系动词+形容词' },
        ],
      });

      const result = service.parseResponse(content, createMockSettings());

      expect(result.sentences).toHaveLength(1);
      expect(result.sentences[0].grammarNote).toBe('主语+系动词+形容词');
    });
  });

  describe('hasDeepLApiKey', () => {
    const service = TranslationService as unknown as TranslationInternals;

    it('应该在 hybridTranslation.traditionalApiKey 存在时返回 true', async () => {
      const settings = createMockSettings({
        hybridTranslation: {
          enabled: false,
          defaultEngine: 'llm',
          traditionalProvider: 'deepl',
          simpleTextThreshold: 10,
          enableSmartRouting: false,
          priority: 'quality',
          traditionalApiKey: 'test-deepl-key',
        },
      });

      const result = await service.hasDeepLApiKey(settings);
      expect(result).toBe(true);
    });

    it('应该在 apiConfigs 中有 DeepL 配置时返回 true', async () => {
      const settings = createMockSettings({
        apiConfigs: [
          { id: '1', name: 'DeepL', provider: 'deepl', apiKey: 'test-key', tested: true, createdAt: Date.now() },
        ],
      });

      const result = await service.hasDeepLApiKey(settings);
      expect(result).toBe(true);
    });

    it('应该在没有 DeepL 配置时返回 false', async () => {
      const settings = createMockSettings();

      const result = await service.hasDeepLApiKey(settings);
      expect(result).toBe(false);
    });
  });

  describe('buildPrompt', () => {
    const service = TranslationService as unknown as TranslationInternals;

    it('应该使用默认提示词构建器', () => {
      const request = createMockRequest();
      const settings = createMockSettings();

      const result = service.buildPrompt(request, settings);

      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('userPrompt');
      expect(result.systemPrompt.length).toBeGreaterThan(0);
      expect(result.userPrompt).toContain('Hello world');
    });

    it('应该使用指定版本当 promptVersion 存在时', () => {
      const request = createMockRequest();
      const settings = createMockSettings({
        promptVersion: 'v1',
      });

      // promptVersionManager.hasVersion('v1') 可能返回 false，取决于注册的版本
      // 此测试验证调用流程
      const result = service.buildPrompt(request, settings);

      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('userPrompt');
    });
  });

  describe('translatePlainText', () => {
    it('默认设置禁止纯文本入口绕过显式授权向 Google 发送正文', async () => {
      vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS });

      await expect(TranslationService.translatePlainText('Private page paragraph')).rejects.toThrow(/请先配置翻译服务/);
      expect(executeTransportRequest).not.toHaveBeenCalled();
    });
  });

  describe('quickTranslate', () => {
    afterEach(() => {
      resetOfflineWordSource();
    });

    it('本地词典命中时直接返回释义，不调用 DeepL（本地优先）', async () => {
      const { DeepLTranslationService } = await import('@/background/deeplTranslation');

      const result = await TranslationService.quickTranslate('hello', 'test-key', createMockSettings());

      expect(result).toContain('喂');
      expect(DeepLTranslationService.quickTranslate).not.toHaveBeenCalled();
    });

    it('无密钥默认快速查词未命中时不尝试未选择的在线服务', async () => {
      setOfflineWordSource(null);

      await expect(TranslationService.quickTranslate('unknownword', '', { ...DEFAULT_SETTINGS }))
        .rejects.toThrow(/请先配置翻译服务/);
      const { DeepLTranslationService } = await import('@/background/deeplTranslation');
      expect(DeepLTranslationService.quickTranslate).not.toHaveBeenCalled();
      expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    });

    it('显式选择免费 Google 时，本地未命中快速查词可使用所选服务', async () => {
      setOfflineWordSource(null);
      vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('译文');
      const settings = createMockSettings({ apiProvider: 'free_google_translate' });

      expect(await TranslationService.quickTranslate('unknownword', '', settings)).toBe('译文');
      expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith('unknownword', '', settings, undefined);
    });

    it('本地未命中时应该调用 DeepLTranslationService.quickTranslate', async () => {
      const { DeepLTranslationService } = await import('@/background/deeplTranslation');
      vi.mocked(DeepLTranslationService.quickTranslate).mockResolvedValue('你好');
      setOfflineWordSource(null);

      const result = await TranslationService.quickTranslate('hello', 'test-key', createMockSettings());

      expect(DeepLTranslationService.quickTranslate).toHaveBeenCalledWith('hello', undefined);
      expect(result).toBe('你好');
    });
  });
});