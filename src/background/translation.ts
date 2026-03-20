import type {
  TranslationRequest,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import { logger, generateCacheKey } from '@/shared/utils';
import { StorageManager } from './storage';
import { TranslationApiService } from './translationApi';
import { TranslationPromptBuilder, promptVersionManager } from '@/shared/prompts';
import { enhancedCache } from './enhancedCache';
import { MetricType, recordMetric } from '@/shared/performance';
import { HybridTranslationService } from './hybridTranslation';
import { DeepLTranslationService } from './deeplTranslation';

/**
 * Translation Service - handles LLM API calls for translation
 * 使用 TranslationApiService 统一处理多供应商 API 调用
 * 支持混合翻译模式：传统API + LLM增强
 */
export class TranslationService {
  /**
   * Translate text based on user level
   * 支持多种翻译策略，根据设置自动选择最优翻译方式
   */
  static async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { text, mode } = request;
    const startTime = performance.now();

    logger.info('TranslationService.translate called:', { textLength: text?.length, mode });

    // 获取设置
    const settings = await StorageManager.getSettings();

    // 策略1: 如果启用混合翻译，使用 HybridTranslationService
    const hybridSettings = settings as UserSettings & { hybridTranslation?: { enabled?: boolean } };
    if (hybridSettings.hybridTranslation?.enabled) {
      logger.info('TranslationService: Using HybridTranslationService');
      return HybridTranslationService.translate(request);
    }

    // 策略2: DeepL 优先模式（如果配置了 DeepL API Key）
    const hasDeepLKey = await this.hasDeepLApiKey(settings);
    if (hasDeepLKey) {
      logger.info('TranslationService: Using DeepLTranslationService (primary)');
      return DeepLTranslationService.translate(request);
    }

    // 策略3: 标准 LLM 翻译
    logger.info('TranslationService: Using standard LLM translation');
    return this.translateWithLLM(request, settings, startTime);
  }

  /**
   * 检查是否有 DeepL API Key 配置
   */
  private static async hasDeepLApiKey(settings: UserSettings): Promise<boolean> {
    // 从混合翻译配置中检查
    if (settings.hybridTranslation?.traditionalApiKey) {
      return true;
    }

    // 从 apiConfigs 中查找 DeepL 配置
    const deeplConfig = settings.apiConfigs?.find(
      config => config.provider === 'deepl'
    );

    return !!deeplConfig?.apiKey;
  }

  /**
   * 标准 LLM 翻译（当 DeepL 不可用时使用）
   */
  private static async translateWithLLM(
    request: TranslationRequest,
    settings: UserSettings,
    startTime: number
  ): Promise<TranslationResult> {
    const { text, mode } = request;

    // 生成缓存键
    const cacheKey = generateCacheKey(text, mode);

    // 检查增强缓存
    const cached = await enhancedCache.get(cacheKey);
    if (cached) {
      const duration = performance.now() - startTime;
      recordMetric(MetricType.CACHE_OPERATION, 'cache_get', duration, true, { cacheHit: true, cacheKey });
      logger.info('TranslationService: Cache hit', { duration: `${duration.toFixed(2)}ms` });
      return cached;
    }

    // 记录缓存未命中
    recordMetric(MetricType.CACHE_OPERATION, 'cache_get', 0, true, { cacheHit: false, cacheKey });

    // Get settings for API config
    const apiKey = await StorageManager.getApiKey();
    logger.info('TranslationService: Settings loaded:', {
      apiProvider: settings.apiProvider,
      hasApiKey: !!apiKey,
      customApiUrl: settings.customApiUrl,
      customModelName: settings.customModelName
    });

    // Ollama 不需要 API Key
    if (!apiKey && settings.apiProvider !== 'ollama') {
      throw new Error('API key not configured. Please set your API key in settings.');
    }

    // Build prompt with settings
    const { systemPrompt, userPrompt } = this.buildPrompt(request, settings);
    logger.info('TranslationService: Prompt built, system length:', systemPrompt.length, 'user length:', userPrompt.length);

    // 使用统一 API 服务调用 LLM
    logger.info('TranslationService: Calling API provider:', settings.apiProvider);
    const apiStartTime = performance.now();
    const content = await TranslationApiService.callWithSystem(systemPrompt, userPrompt, apiKey, settings);
    const apiDuration = performance.now() - apiStartTime;
    const result = this.parseResponse(content, settings);

    logger.info('TranslationService: API call completed', {
      wordsCount: result.words?.length,
      hasFullText: !!result.fullText,
      apiDuration: `${apiDuration.toFixed(2)}ms`
    });

    // Cache result in enhanced cache
    const pageUrl = typeof window !== 'undefined' ? window.location.href : 'background';
    await enhancedCache.set(cacheKey, result, mode, pageUrl, 'llm');

    // 记录 API 调用性能
    const totalDuration = performance.now() - startTime;
    recordMetric(MetricType.API_RESPONSE_TIME, 'translate', apiDuration, true, {
      provider: settings.apiProvider,
      textLength: text?.length,
    });
    recordMetric(MetricType.TRANSLATION_TOTAL_TIME, 'translate_total', totalDuration, true, {
      provider: settings.apiProvider,
      textLength: text?.length,
    });

    return result;
  }

  /**
   * Build prompt for LLM using TranslationPromptBuilder or PromptVersionManager
   */
  private static buildPrompt(request: TranslationRequest, settings: UserSettings): { systemPrompt: string; userPrompt: string } {
    const { text, context, userLevel } = request;
    const { promptVersion } = settings;

    // 如果用户指定了提示词版本，使用版本管理器获取模板
    if (promptVersion && promptVersionManager.hasVersion(promptVersion)) {
      const template = promptVersionManager.getTemplate(promptVersion);
      const examLevel = 'CET-4'; // 默认水平
      const vocabularySize = userLevel.estimatedVocabulary;

      // 替换模板中的变量
      const systemPrompt = template.systemPrompt
        .replace(/{vocabulary_size}/g, String(vocabularySize))
        .replace(/{exam_level}/g, examLevel);

      const userPrompt = template.userPromptTemplate
        .replace(/{text}/g, text)
        .replace(/{context}/g, context || text);

      logger.info('TranslationService: Using prompt version:', promptVersion);
      return { systemPrompt, userPrompt };
    }

    // 默认使用动态构建器
    const builder = new TranslationPromptBuilder(
      userLevel,
      text,
      context,
      settings
    );

    return builder.build();
  }

  /**
   * Parse LLM response into TranslationResult
   */
  private static parseResponse(content: string, settings: UserSettings): TranslationResult {
    const { phraseTranslationEnabled, grammarTranslationEnabled } = settings;

    try {
      // Extract JSON from response (handle potential markdown wrapping)
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Validate and normalize result
      const result: TranslationResult = {
        words: [],
        sentences: [],
        grammarPoints: [],
        fullText: parsed.fullText ? String(parsed.fullText) : undefined,
      };

      // 处理词汇列表
      if (Array.isArray(parsed.words)) {
        result.words = parsed.words
          .map((w: Record<string, unknown>) => ({
            original: String(w.original || ''),
            translation: String(w.translation || ''),
            position: Array.isArray(w.position) && w.position.length >= 2
            ? [Number(w.position[0]), Number(w.position[1])] as [number, number]
            : [0, 0] as [number, number],
            difficulty: Number(w.difficulty) || 5,
            isPhrase: Boolean(w.isPhrase),
          }))
          // 如果禁用词组翻译，过滤掉标记为短语的条目
          .filter((w: { isPhrase: boolean }) => {
            return phraseTranslationEnabled || !w.isPhrase;
          });
      }

      if (Array.isArray(parsed.sentences)) {
        result.sentences = parsed.sentences.map((s: Record<string, unknown>) => ({
          original: String(s.original || ''),
          translation: String(s.translation || ''),
          grammarNote: s.grammarNote ? String(s.grammarNote) : undefined,
        }));
      }

      // 如果启用语法翻译，处理语法点
      if (grammarTranslationEnabled && Array.isArray(parsed.grammarPoints)) {
        result.grammarPoints = parsed.grammarPoints.map((g: Record<string, unknown>) => ({
          original: String(g.original || ''),
          explanation: String(g.explanation || ''),
          type: String(g.type || '语法点'),
          position: Array.isArray(g.position) ? g.position as [number, number] : [0, 0],
        }));
      }

      return result;
    } catch (error) {
      logger.error('Failed to parse LLM response:', error);
      throw new Error('Failed to parse translation response');
    }
  }

  /**
   * Quick translate a single word/phrase (no caching)
   * 优先使用 DeepL，失败时回退到 LLM
   */
  static async quickTranslate(
    text: string,
    _apiKey: string,
    _settings: UserSettings
  ): Promise<string> {
    // 使用 DeepLTranslationService 的快速翻译（优先 DeepL）
    return DeepLTranslationService.quickTranslate(text);
  }
}
