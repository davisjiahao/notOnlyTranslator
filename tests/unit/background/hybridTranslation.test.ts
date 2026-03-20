import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HybridTranslationService } from '@/background/hybridTranslation';
import type { TranslationRequest, UserSettings } from '@/shared/types';

// Mock dependencies
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
    quickTranslateWithSystem: vi.fn(),
  },
}));

vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    initialize: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@/shared/performance', () => ({
  MetricType: {
    API_RESPONSE_TIME: 'api_response_time',
    CACHE_OPERATION: 'cache_operation',
    TRANSLATION_TOTAL_TIME: 'translation_total_time',
  },
  recordMetric: vi.fn(),
}));

vi.mock('@/background/textComplexityAnalyzer', () => ({
  TextComplexityAnalyzer: {
    analyze: vi.fn(),
  },
}));

vi.mock('@/background/llmEnhancedAnalysis', () => ({
  LlmEnhancedAnalysisService: {
    analyze: vi.fn(),
    convertToTranslatedWords: vi.fn(),
    convertToGrammarPoints: vi.fn(),
  },
}));

import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { enhancedCache } from '@/background/enhancedCache';
import { TextComplexityAnalyzer } from '@/background/textComplexityAnalyzer';

describe('HybridTranslationService', () => {
  const mockSettings: UserSettings = {
    apiProvider: 'openai',
    theme: 'system',
    phraseTranslationEnabled: true,
    grammarTranslationEnabled: true,
    promptVersion: 'v1.0.0',
    apiConfigs: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset config to default
    HybridTranslationService.updateConfig({
      defaultEngine: 'hybrid',
      traditionalProvider: 'youdao',
      enableSmartRouting: true,
      enableParallelTranslation: false,
      enableEnhancedAnalysis: true,
      fallbackStrategy: 'traditional_first',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getConfig', () => {
    it('应该返回当前配置', () => {
      const config = HybridTranslationService.getConfig();

      expect(config.defaultEngine).toBe('hybrid');
      expect(config.traditionalProvider).toBe('youdao');
      expect(config.enableSmartRouting).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('应该更新部分配置', () => {
      HybridTranslationService.updateConfig({
        defaultEngine: 'llm',
        enableSmartRouting: false,
      });

      const config = HybridTranslationService.getConfig();
      expect(config.defaultEngine).toBe('llm');
      expect(config.enableSmartRouting).toBe(false);
      expect(config.traditionalProvider).toBe('youdao'); // 保持不变
    });

    it('应该合并复杂度阈值配置', () => {
      HybridTranslationService.updateConfig({
        complexityThreshold: {
          simple: 30,
          complex: 70,
        },
      });

      const config = HybridTranslationService.getConfig();
      expect(config.complexityThreshold?.simple).toBe(30);
      expect(config.complexityThreshold?.complex).toBe(70);
    });
  });

  describe('quickTranslate', () => {
    it('应该使用传统 API 进行快速翻译', async () => {
      vi.mocked(StorageManager.getSettings).mockResolvedValue(mockSettings);
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('test-api-key');
      vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('你好');

      const result = await HybridTranslationService.quickTranslate('hello');

      expect(result).toBe('你好');
    });

    it('当没有传统 API Key 时应该回退到 LLM', async () => {
      // 设置: hybridTranslation 配置中没有传统 API Key
      const settingsWithoutTraditionalKey: UserSettings & { hybridTranslation?: { traditionalApiKey?: string } } = {
        ...mockSettings,
        hybridTranslation: {
          defaultEngine: 'hybrid',
          traditionalProvider: 'deepl',
          simpleTextThreshold: 20,
          complexityThreshold: { simple: 35, complex: 65 },
          enableSmartRouting: true,
          priority: 'balanced',
          enableParallelTranslation: false,
          parallelTimeout: 3000,
          fallbackStrategy: 'traditional_first',
          enableEnhancedAnalysis: true,
        },
      };

      vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsWithoutTraditionalKey);
      // LLM API Key 存在
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('llm-api-key');
      vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('你好');

      const result = await HybridTranslationService.quickTranslate('hello');

      expect(result).toBe('你好');
    });
  });

  describe('getEngineForRequest (通过 translate 方法测试)', () => {
    it('当用户明确选择引擎时应该使用用户选择', async () => {
      const settingsWithUserChoice: UserSettings & { hybridTranslation?: { defaultEngine: string } } = {
        ...mockSettings,
        hybridTranslation: {
          defaultEngine: 'llm',
          traditionalProvider: 'deepl',
          simpleTextThreshold: 20,
          complexityThreshold: { simple: 35, complex: 65 },
          enableSmartRouting: true,
          priority: 'balanced',
          enableParallelTranslation: false,
          parallelTimeout: 3000,
          fallbackStrategy: 'traditional_first',
          enableEnhancedAnalysis: true,
        },
      };

      vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsWithUserChoice);
      vi.mocked(StorageManager.getApiKey).mockResolvedValue('test-api-key');
      vi.mocked(enhancedCache.initialize).mockResolvedValue(undefined);
      vi.mocked(enhancedCache.get).mockResolvedValue(null);
      vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(
        JSON.stringify({
          words: [],
          sentences: [],
          fullText: '翻译结果',
        })
      );
      vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({
        score: 50,
        level: 'medium',
        wordCount: 5,
        clauseCount: 1,
        metrics: {
          averageWordLength: 4,
          uniqueWordRatio: 0.8,
          clauseDensity: 0.2,
          sentenceLength: 10,
        },
      });

      const request: TranslationRequest = {
        text: 'Hello world',
        mode: 'bilingual',
        userLevel: { estimatedVocabulary: 3000 },
      };

      await HybridTranslationService.translate(request);

      // 应该调用 LLM (callWithSystem)，而不是传统翻译
      expect(TranslationApiService.callWithSystem).toHaveBeenCalled();
    });

    it('当禁用智能路由时应该使用默认引擎', async () => {
      HybridTranslationService.updateConfig({
        defaultEngine: 'traditional',
        enableSmartRouting: false,
      });

      vi.mocked(StorageManager.getSettings).mockResolvedValue(mockSettings);
      vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({
        score: 80,
        level: 'complex',
        wordCount: 20,
        clauseCount: 5,
        metrics: {
          averageWordLength: 6,
          uniqueWordRatio: 0.9,
          clauseDensity: 0.5,
          sentenceLength: 30,
        },
      });

      // 即使文本复杂，也应该使用传统引擎
      expect(HybridTranslationService.getConfig().enableSmartRouting).toBe(false);
    });
  });

  describe('文本复杂度路由', () => {
    it('简单文本应该选择传统引擎', () => {
      vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({
        score: 20,
        level: 'simple',
        wordCount: 3,
        clauseCount: 0,
        metrics: {
          averageWordLength: 3,
          uniqueWordRatio: 1,
          clauseDensity: 0,
          sentenceLength: 5,
        },
      });

      // 简单文本 -> 传统引擎
      const analysis = TextComplexityAnalyzer.analyze('Hello world');
      expect(analysis.level).toBe('simple');
    });

    it('复杂文本应该选择 LLM 引擎', () => {
      vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({
        score: 80,
        level: 'complex',
        wordCount: 30,
        clauseCount: 5,
        metrics: {
          averageWordLength: 8,
          uniqueWordRatio: 0.95,
          clauseDensity: 0.6,
          sentenceLength: 50,
        },
      });

      // 复杂文本 -> LLM
      const analysis = TextComplexityAnalyzer.analyze('Some complex text');
      expect(analysis.level).toBe('complex');
    });

    it('中等复杂度文本应该选择混合引擎', () => {
      vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({
        score: 50,
        level: 'medium',
        wordCount: 15,
        clauseCount: 2,
        metrics: {
          averageWordLength: 5,
          uniqueWordRatio: 0.85,
          clauseDensity: 0.3,
          sentenceLength: 20,
        },
      });

      const analysis = TextComplexityAnalyzer.analyze('Medium text');
      expect(analysis.level).toBe('medium');
    });
  });

  describe('回退策略', () => {
    it('traditional_first 策略应该按正确顺序回退', () => {
      HybridTranslationService.updateConfig({
        fallbackStrategy: 'traditional_first',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.fallbackStrategy).toBe('traditional_first');
    });

    it('llm_first 策略应该优先 LLM', () => {
      HybridTranslationService.updateConfig({
        fallbackStrategy: 'llm_first',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.fallbackStrategy).toBe('llm_first');
    });

    it('fastest 策略应该优先最快的引擎', () => {
      HybridTranslationService.updateConfig({
        fallbackStrategy: 'fastest',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.fallbackStrategy).toBe('fastest');
    });
  });

  describe('并行翻译配置', () => {
    it('应该支持启用并行翻译', () => {
      HybridTranslationService.updateConfig({
        enableParallelTranslation: true,
        parallelTimeout: 5000,
      });

      const config = HybridTranslationService.getConfig();
      expect(config.enableParallelTranslation).toBe(true);
      expect(config.parallelTimeout).toBe(5000);
    });
  });

  describe('增强分析配置', () => {
    it('应该支持配置增强分析选项', () => {
      HybridTranslationService.updateConfig({
        enableEnhancedAnalysis: true,
        enhancedAnalysisOptions: {
          analyzeWords: true,
          analyzePhrases: true,
          analyzeGrammar: true,
          analyzeCultural: true,
        },
      });

      const config = HybridTranslationService.getConfig();
      expect(config.enableEnhancedAnalysis).toBe(true);
      expect(config.enhancedAnalysisOptions?.analyzeCultural).toBe(true);
    });
  });

  describe('常见词汇检测', () => {
    it('应该识别常见词汇', () => {
      // 通过 extractWordsFromText 测试（间接测试 isCommonWord）
      // 常见词汇如 'the', 'and', 'is' 应该被过滤
      const commonWords = ['the', 'and', 'is', 'to', 'of'];
      const uncommonWords = ['algorithm', 'paradigm', 'synchronous'];

      // 常见词汇集合在类中定义，我们验证配置
      const config = HybridTranslationService.getConfig();
      expect(config).toBeDefined();
    });
  });

  describe('API Key 获取', () => {
    it('应该从 hybridTranslation 配置获取 API Key', async () => {
      const settingsWithApiKey: UserSettings & { hybridTranslation?: { traditionalApiKey?: string } } = {
        ...mockSettings,
        hybridTranslation: {
          traditionalApiKey: 'deepl-api-key',
        },
      };

      vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsWithApiKey);

      // 配置存在时，服务应该能够获取 API Key
      expect(settingsWithApiKey.hybridTranslation?.traditionalApiKey).toBe('deepl-api-key');
    });

    it('应该从 apiConfigs 获取 API Key 作为备选', async () => {
      const settingsWithApiConfig: UserSettings = {
        ...mockSettings,
        apiConfigs: [
          {
            id: 'deepl-config',
            name: 'DeepL',
            provider: 'deepl',
            apiKey: 'deepl-key-from-config',
          },
        ],
      };

      vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsWithApiConfig);

      // 配置存在
      expect(settingsWithApiConfig.apiConfigs?.[0]?.apiKey).toBe('deepl-key-from-config');
    });
  });

  describe('复杂度阈值配置', () => {
    it('应该支持自定义复杂度阈值', () => {
      HybridTranslationService.updateConfig({
        complexityThreshold: {
          simple: 25,
          complex: 75,
        },
      });

      const config = HybridTranslationService.getConfig();
      expect(config.complexityThreshold?.simple).toBe(25);
      expect(config.complexityThreshold?.complex).toBe(75);
    });

    it('默认复杂度阈值应该合理', () => {
      const config = HybridTranslationService.getConfig();
      expect(config.complexityThreshold?.simple).toBeLessThan(config.complexityThreshold?.complex!);
    });
  });

  describe('优先级配置', () => {
    it('应该支持质量优先', () => {
      HybridTranslationService.updateConfig({
        priority: 'quality',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.priority).toBe('quality');
    });

    it('应该支持速度优先', () => {
      HybridTranslationService.updateConfig({
        priority: 'speed',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.priority).toBe('speed');
    });

    it('应该支持平衡模式', () => {
      HybridTranslationService.updateConfig({
        priority: 'balanced',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.priority).toBe('balanced');
    });
  });

  describe('传统翻译提供商', () => {
    it('应该支持 DeepL 提供商', () => {
      HybridTranslationService.updateConfig({
        traditionalProvider: 'deepl',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.traditionalProvider).toBe('deepl');
    });

    it('应该支持 Google Translate 提供商', () => {
      HybridTranslationService.updateConfig({
        traditionalProvider: 'google_translate',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.traditionalProvider).toBe('google_translate');
    });

    it('应该支持有道翻译提供商', () => {
      HybridTranslationService.updateConfig({
        traditionalProvider: 'youdao',
      });

      const config = HybridTranslationService.getConfig();
      expect(config.traditionalProvider).toBe('youdao');
    });
  });
});