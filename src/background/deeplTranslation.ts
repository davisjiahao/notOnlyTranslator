import type {
  TranslationRequest,
  TranslationResult,
  UserSettings,
  TranslatedWord,
} from '@/shared/types';
import { logger, generateCacheKey } from '@/shared/utils';
import { StorageManager } from './storage';
import { TranslationApiService } from './translationApi';
import { TranslationPromptBuilder, promptVersionManager } from '@/shared/prompts';
import { enhancedCache } from './enhancedCache';
import { MetricType, recordMetric } from '@/shared/performance';
import { TextComplexityAnalyzer } from './textComplexityAnalyzer';

/**
 * DeepL 翻译服务
 *
 * 特性：
 * - 优先使用 DeepL 进行翻译（速度快、成本低、质量高）
 * - DeepL 失败时自动回退到 LLM
 * - 智能缓存策略，DeepL 结果长期缓存
 * - 性能监控和指标收集
 */
export class DeepLTranslationService {
  /**
   * 主翻译方法 - 优先 DeepL，失败回退 LLM
   */
  static async translate(request: TranslationRequest): Promise<TranslationResult> {
    const startTime = performance.now();
    const { text, mode } = request;

    logger.info('DeepLTranslationService.translate:', {
      textLength: text.length,
      mode,
    });

    // 初始化缓存
    await enhancedCache.initialize();

    // 生成缓存键
    const cacheKey = generateCacheKey(text, mode);

    // 检查缓存
    const cached = await enhancedCache.get(cacheKey);
    if (cached) {
      const duration = performance.now() - startTime;
      recordMetric(MetricType.CACHE_OPERATION, 'deepl_cache_hit', duration, true, {
        cacheHit: true,
        source: cached._source,
      });
      logger.info('DeepLTranslationService: Cache hit', { duration: `${duration.toFixed(2)}ms` });
      return cached;
    }

    // 获取设置
    const settings = await StorageManager.getSettings();

    // 尝试 DeepL 翻译
    const deeplResult = await this.tryDeepLTranslate(request, settings);

    let result: TranslationResult;
    let source: 'deepl' | 'llm';

    if (deeplResult) {
      result = deeplResult;
      source = 'deepl';
      logger.info('DeepLTranslationService: Using DeepL result');
    } else {
      // DeepL 失败，回退到 LLM
      logger.info('DeepLTranslationService: DeepL failed, falling back to LLM');
      result = await this.translateWithLLM(request, settings);
      source = 'llm';
    }

    // 标记结果来源（用于调试和分析）
    (result as TranslationResult & { _source?: string })._source = source;

    // 缓存结果
    const pageUrl = typeof window !== 'undefined' ? window.location.href : 'background';
    await enhancedCache.set(cacheKey, result, mode, pageUrl, source);

    // 记录性能指标
    const totalDuration = performance.now() - startTime;
    recordMetric(MetricType.TRANSLATION_TOTAL_TIME, 'deepl_primary_translate', totalDuration, true, {
      source,
      textLength: text.length,
      wordCount: result.words?.length || 0,
    });

    // 记录来源分布指标
    recordMetric(MetricType.CACHE_OPERATION, 'translation_source', 0, true, {
      source,
      textComplexity: TextComplexityAnalyzer.analyze(text).level,
    });

    return result;
  }

  /**
   * 尝试使用 DeepL 翻译
   * 如果 DeepL 未配置或调用失败，返回 null
   */
  private static async tryDeepLTranslate(
    request: TranslationRequest,
    settings: UserSettings
  ): Promise<TranslationResult | null> {
    const startTime = performance.now();
    const { text, userLevel } = request;

    // 获取 DeepL API Key
    const deeplApiKey = await this.getDeepLApiKey(settings);
    if (!deeplApiKey) {
      logger.info('DeepLTranslationService: DeepL API key not configured');
      return null;
    }

    // 构建 DeepL 设置
    const deeplSettings: UserSettings = {
      ...settings,
      apiProvider: 'deepl',
    };

    try {
      // 调用 DeepL API
      const apiStartTime = performance.now();
      const translatedText = await TranslationApiService.quickTranslate(
        text,
        deeplApiKey,
        deeplSettings
      );
      const apiDuration = performance.now() - apiStartTime;

      if (!translatedText) {
        throw new Error('DeepL returned empty result');
      }

      // 记录 DeepL API 性能
      recordMetric(MetricType.API_RESPONSE_TIME, 'deepl_translate', apiDuration, true, {
        textLength: text.length,
      });

      // 构建翻译结果
      const result: TranslationResult = {
        words: [],
        sentences: [
          {
            original: text,
            translation: translatedText,
          },
        ],
        fullText: translatedText,
      };

      // 异步分析生词（使用 LLM）
      const words = await this.analyzeWordsAsync(text, translatedText, userLevel, settings);
      result.words = words;

      const totalDuration = performance.now() - startTime;
      logger.info('DeepLTranslationService: DeepL translation successful', {
        apiDuration: `${apiDuration.toFixed(2)}ms`,
        totalDuration: `${totalDuration.toFixed(2)}ms`,
        wordCount: words.length,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('DeepLTranslationService: DeepL translation failed:', errorMessage);

      // 记录失败指标
      recordMetric(MetricType.API_RESPONSE_TIME, 'deepl_translate', 0, false, {
        error: errorMessage,
        textLength: text.length,
      });

      return null;
    }
  }

  /**
   * 使用 LLM 进行翻译（DeepL 失败时的回退）
   */
  private static async translateWithLLM(
    request: TranslationRequest,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const startTime = performance.now();
    const { text } = request;

    // 获取 API Key
    const apiKey = await StorageManager.getApiKey();
    if (!apiKey && settings.apiProvider !== 'ollama') {
      throw new Error('API key not configured');
    }

    // 构建提示词
    const { systemPrompt, userPrompt } = this.buildPrompt(request, settings);

    // 调用 LLM
    const apiStartTime = performance.now();
    const content = await TranslationApiService.callWithSystem(
      systemPrompt,
      userPrompt,
      apiKey || '',
      settings
    );
    const apiDuration = performance.now() - apiStartTime;

    // 解析结果
    const result = this.parseResponse(content, settings);

    // 记录 LLM 性能
    recordMetric(MetricType.API_RESPONSE_TIME, 'llm_fallback_translate', apiDuration, true, {
      provider: settings.apiProvider,
      textLength: text.length,
    });

    const totalDuration = performance.now() - startTime;
    logger.info('DeepLTranslationService: LLM fallback translation successful', {
      apiDuration: `${apiDuration.toFixed(2)}ms`,
      totalDuration: `${totalDuration.toFixed(2)}ms`,
    });

    return result;
  }

  /**
   * 获取 DeepL API Key
   * 优先从 hybridTranslation.traditionalApiKey 获取，其次从 apiConfigs 查找
   */
  private static async getDeepLApiKey(settings: UserSettings): Promise<string | null> {
    // 优先从混合翻译配置中获取
    if (settings.hybridTranslation?.traditionalApiKey) {
      return settings.hybridTranslation.traditionalApiKey;
    }

    // 从 apiConfigs 中查找 DeepL 配置
    const deeplConfig = settings.apiConfigs?.find(
      config => config.provider === 'deepl'
    );

    if (deeplConfig?.apiKey) {
      return deeplConfig.apiKey;
    }

    return null;
  }

  /**
   * 异步分析生词
   * 使用 LLM 分析文本中的生词，为用户提供详细解释
   */
  private static async analyzeWordsAsync(
    originalText: string,
    translatedText: string,
    userLevel: { estimatedVocabulary: number },
    settings: UserSettings
  ): Promise<TranslatedWord[]> {
    const apiKey = await StorageManager.getApiKey();
    if (!apiKey && settings.apiProvider !== 'ollama') {
      return [];
    }

    try {
      // 提取可能的生词
      const words = this.extractWordsFromText(originalText);

      // 构建提示词分析生词
      const prompt = `Analyze these English words and return JSON with detailed info for words above difficulty level ${Math.floor(userLevel.estimatedVocabulary / 1000)}:

Words: ${words.join(', ')}

Context (English): ${originalText}
Context (Chinese): ${translatedText}

Return format:
{
  "words": [
    {
      "original": "word",
      "translation": "中文释义",
      "difficulty": 1-10,
      "isPhrase": false,
      "phonetic": "/phonetic/",
      "partOfSpeech": "noun/verb/etc",
      "examples": ["example sentence"]
    }
  ]
}

Only include words that would be challenging for a learner with ~${userLevel.estimatedVocabulary} vocabulary size.`;

      const content = await TranslationApiService.callWithSystem(
        'You are an English learning assistant. Always respond with valid JSON.',
        prompt,
        apiKey || '',
        settings
      );

      return this.parseWordAnalysis(content);
    } catch (error) {
      logger.error('DeepLTranslationService: Word analysis failed:', error);
      return [];
    }
  }

  /**
   * 从文本中提取单词
   */
  private static extractWordsFromText(text: string): string[] {
    // 简单的词频分析，提取可能的重要词汇
    const words = text
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length >= 4 && !this.isCommonWord(w));

    // 去重并限制数量
    return Array.from(new Set(words)).slice(0, 20);
  }

  /**
   * 常见词汇集合
   */
  private static readonly COMMON_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'when', 'where', 'which', 'who', 'why', 'how', 'all', 'any', 'both', 'each',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'can', 'just', 'should', 'now', 'about',
    'could', 'would', 'should', 'may', 'might', 'must', 'shall', 'will',
  ]);

  /**
   * 判断是否为常见词汇
   */
  private static isCommonWord(word: string): boolean {
    return this.COMMON_WORDS.has(word.toLowerCase());
  }

  /**
   * 解析词汇分析结果
   */
  private static parseWordAnalysis(content: string): TranslatedWord[] {
    try {
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      const parsed = JSON.parse(jsonStr.trim());

      if (!Array.isArray(parsed.words)) {
        return [];
      }

      return parsed.words.map((w: Record<string, unknown>) => ({
        original: String(w.original || ''),
        translation: String(w.translation || ''),
        position: [0, 0] as [number, number],
        difficulty: Number(w.difficulty) || 5,
        isPhrase: Boolean(w.isPhrase),
        phonetic: w.phonetic ? String(w.phonetic) : undefined,
        partOfSpeech: w.partOfSpeech ? String(w.partOfSpeech) : undefined,
        examples: Array.isArray(w.examples) ? w.examples.map(String) : undefined,
      }));
    } catch (error) {
      logger.error('DeepLTranslationService: Failed to parse word analysis:', error);
      return [];
    }
  }

  /**
   * 构建 LLM 提示词
   */
  private static buildPrompt(
    request: TranslationRequest,
    settings: UserSettings
  ): { systemPrompt: string; userPrompt: string } {
    const { text, context, userLevel } = request;
    const { promptVersion } = settings;

    // 如果用户指定了提示词版本，使用版本管理器获取模板
    if (promptVersion && promptVersionManager.hasVersion(promptVersion)) {
      const template = promptVersionManager.getTemplate(promptVersion);
      const examLevel = 'CET-4';
      const vocabularySize = userLevel.estimatedVocabulary;

      const systemPrompt = template.systemPrompt
        .replace(/{vocabulary_size}/g, String(vocabularySize))
        .replace(/{exam_level}/g, examLevel);

      const userPrompt = template.userPromptTemplate
        .replace(/{text}/g, text)
        .replace(/{context}/g, context || text);

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
   * 解析 LLM 响应
   */
  private static parseResponse(content: string, settings: UserSettings): TranslationResult {
    const { phraseTranslationEnabled, grammarTranslationEnabled } = settings;

    try {
      // 提取 JSON
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());

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
            phonetic: w.phonetic ? String(w.phonetic) : undefined,
            partOfSpeech: w.partOfSpeech ? String(w.partOfSpeech) : undefined,
            examples: Array.isArray(w.examples) ? w.examples.map(String) : undefined,
          }))
          .filter((w: { isPhrase: boolean }) => phraseTranslationEnabled || !w.isPhrase);
      }

      // 处理句子
      if (Array.isArray(parsed.sentences)) {
        result.sentences = parsed.sentences.map((s: Record<string, unknown>) => ({
          original: String(s.original || ''),
          translation: String(s.translation || ''),
          grammarNote: s.grammarNote ? String(s.grammarNote) : undefined,
        }));
      }

      // 处理语法点
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
      logger.error('DeepLTranslationService: Failed to parse LLM response:', error);
      throw new Error('Failed to parse translation response');
    }
  }

  /**
   * 快速翻译单个词/短语
   * 优先使用 DeepL，失败时回退到 LLM
   */
  static async quickTranslate(text: string): Promise<string> {
    const settings = await StorageManager.getSettings();

    // 优先使用 DeepL
    const deeplApiKey = await this.getDeepLApiKey(settings);
    if (deeplApiKey) {
      try {
        const deeplSettings: UserSettings = {
          ...settings,
          apiProvider: 'deepl',
        };
        const result = await TranslationApiService.quickTranslate(text, deeplApiKey, deeplSettings);
        if (result) {
          return result;
        }
      } catch (error) {
        logger.warn('DeepLTranslationService: DeepL quick translate failed:', error);
      }
    }

    // 回退到 LLM 快速翻译
    const llmApiKey = await StorageManager.getApiKey();
    if (!llmApiKey && settings.apiProvider !== 'ollama') {
      throw new Error('No API key configured');
    }

    return TranslationApiService.quickTranslate(text, llmApiKey || '', settings);
  }
}
