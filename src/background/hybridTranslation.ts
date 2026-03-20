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
 * 翻译引擎类型
 */
export type TranslationEngine = 'llm' | 'traditional' | 'hybrid';

/**
 * 传统翻译提供商
 */
export type TraditionalProvider = 'deepl' | 'google_translate' | 'youdao';

/**
 * 混合翻译配置
 */
export interface HybridTranslationConfig {
  /** 默认翻译引擎 */
  defaultEngine: TranslationEngine;
  /** 传统API提供商 */
  traditionalProvider: TraditionalProvider;
  /** 简单文本阈值（词数）- 已弃用，使用复杂度评分 */
  simpleTextThreshold: number;
  /** 复杂度阈值（0-100） */
  complexityThreshold: {
    simple: number;   // 简单文本上限
    complex: number;  // 复杂文本下限
  };
  /** 是否启用智能路由 */
  enableSmartRouting: boolean;
  /** 质量/速度优先级 */
  priority: 'quality' | 'speed' | 'balanced';
  /** 传统API API Key */
  traditionalApiKey?: string;
  /** 是否启用并行翻译 */
  enableParallelTranslation: boolean;
  /** 并行翻译超时时间（毫秒） */
  parallelTimeout: number;
  /** 回退策略 */
  fallbackStrategy: 'traditional_first' | 'llm_first' | 'fastest';
}

/**
 * 混合翻译服务
 * 结合传统翻译API和LLM，实现快速且高质量的翻译
 */
export class HybridTranslationService {
  private static config: HybridTranslationConfig = {
    defaultEngine: 'hybrid',
    traditionalProvider: 'youdao',
    simpleTextThreshold: 20,
    complexityThreshold: {
      simple: 35,   // 复杂度 <= 35 视为简单
      complex: 65,  // 复杂度 >= 65 视为复杂
    },
    enableSmartRouting: true,
    priority: 'balanced',
    enableParallelTranslation: false,
    parallelTimeout: 3000,
    fallbackStrategy: 'traditional_first',
  };

  /**
   * 常见词汇集合（用于过滤）
   */
  private static readonly COMMON_WORDS = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
    'when', 'where', 'which', 'who', 'why', 'how', 'all', 'any', 'both', 'each',
    'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'can', 'just', 'should', 'now', 'about',
    'could', 'would', 'should', 'may', 'might', 'must', 'shall', 'will', 'use',
    'used', 'using', 'make', 'made', 'making', 'take', 'took', 'taken', 'taking',
    'get', 'got', 'gotten', 'getting', 'go', 'went', 'gone', 'going', 'see',
    'saw', 'seen', 'seeing', 'know', 'knew', 'known', 'knowing', 'think',
    'thought', 'thinking', 'come', 'came', 'coming', 'want', 'wanted', 'wanting',
    'look', 'looked', 'looking', 'find', 'found', 'finding', 'give', 'gave',
    'given', 'giving', 'tell', 'told', 'telling', 'work', 'worked', 'working',
  ]);

  /**
   * 更新混合翻译配置
   */
  static updateConfig(newConfig: Partial<HybridTranslationConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('HybridTranslationService config updated:', this.config);
  }

  /**
   * 获取当前配置
   */
  static getConfig(): HybridTranslationConfig {
    return { ...this.config };
  }

  /**
   * 主翻译方法
   * 根据配置选择不同的翻译策略
   */
  static async translate(request: TranslationRequest): Promise<TranslationResult> {
    const startTime = performance.now();
    const settings = await StorageManager.getSettings();

    // 获取混合翻译配置
    const engine = this.getEngineForRequest(request, settings);

    logger.info('HybridTranslationService.translate:', {
      engine,
      textLength: request.text.length,
      mode: request.mode,
    });

    let result: TranslationResult;

    switch (engine) {
      case 'traditional':
        result = await this.translateWithTraditional(request, settings);
        break;
      case 'llm':
        result = await this.translateWithLLM(request, settings);
        break;
      case 'hybrid':
      default:
        result = await this.translateWithHybrid(request, settings);
        break;
    }

    const duration = performance.now() - startTime;
    recordMetric(MetricType.TRANSLATION_TOTAL_TIME, 'hybrid_translate', duration, true, {
      engine,
      textLength: request.text.length,
    });

    return result;
  }

  /**
   * 根据请求内容选择最合适的翻译引擎
   * 基于文本复杂度分析的智能路由
   */
  private static getEngineForRequest(
    request: TranslationRequest,
    settings: UserSettings
  ): TranslationEngine {
    // 如果用户明确选择了引擎，使用用户选择
    const hybridSettings = settings as UserSettings & { hybridTranslation?: HybridTranslationConfig };
    if (hybridSettings.hybridTranslation?.defaultEngine) {
      const userEngine = hybridSettings.hybridTranslation.defaultEngine;
      if (userEngine !== 'hybrid') {
        return userEngine;
      }
    }

    // 如果禁用智能路由，使用默认引擎
    if (!this.config.enableSmartRouting) {
      return this.config.defaultEngine;
    }

    // 使用复杂度分析器进行智能路由
    const complexityAnalysis = TextComplexityAnalyzer.analyze(request.text);

    logger.info('HybridTranslationService: Complexity analysis', {
      score: complexityAnalysis.score,
      level: complexityAnalysis.level,
      wordCount: complexityAnalysis.wordCount,
      clauseCount: complexityAnalysis.clauseCount,
    });

    // 根据复杂度等级选择引擎
    switch (complexityAnalysis.level) {
      case 'simple':
        // 简单文本：使用传统API（快速、低成本）
        return 'traditional';
      case 'medium':
        // 中等复杂度：使用混合模式（传统API + LLM分析）
        return 'hybrid';
      case 'complex':
        // 复杂文本：使用LLM（高质量、完整功能）
        return 'llm';
      default:
        return this.config.defaultEngine;
    }
  }

  /**
   * 使用传统翻译API进行翻译
   * 速度快，成本低，适合简单翻译
   * 支持错误回退机制
   */
  private static async translateWithTraditional(
    request: TranslationRequest,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const startTime = performance.now();
    const { text, userLevel } = request;

    // 获取传统API配置
    const traditionalSettings: UserSettings = {
      ...settings,
      apiProvider: this.config.traditionalProvider,
    };

    // 从storage获取传统API的API Key
    const traditionalApiKey = await this.getTraditionalApiKey();
    if (!traditionalApiKey) {
      logger.warn('Traditional API key not configured, falling back to LLM');
      return this.translateWithLLM(request, settings);
    }

    try {
      // 调用传统API进行翻译
      const translatedText = await TranslationApiService.quickTranslate(
        text,
        traditionalApiKey,
        traditionalSettings
      );

      if (!translatedText) {
        throw new Error('Traditional translation returned empty result');
      }

      const apiDuration = performance.now() - startTime;
      recordMetric(MetricType.API_RESPONSE_TIME, 'traditional_translate', apiDuration, true, {
        provider: this.config.traditionalProvider,
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

      // 异步分析生词（不阻塞主流程，但需要等待完成）
      const words = await this.analyzeWordsAsync(text, translatedText, userLevel, settings);
      result.words = words;

      return result;
    } catch (error) {
      logger.error('Traditional translation failed:', error);
      // 失败时回退到LLM
      logger.info('Falling back to LLM translation');
      return this.translateWithLLM(request, settings);
    }
  }

  /**
   * 使用LLM进行翻译
   * 功能完整，但速度较慢
   */
  private static async translateWithLLM(
    request: TranslationRequest,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const startTime = performance.now();
    const { text, mode } = request;

    // 初始化缓存
    await enhancedCache.initialize();

    // 生成缓存键
    const cacheKey = generateCacheKey(text, mode);

    // 检查缓存
    const cached = await enhancedCache.get(cacheKey);
    if (cached) {
      const duration = performance.now() - startTime;
      recordMetric(MetricType.CACHE_OPERATION, 'cache_get', duration, true, { cacheHit: true });
      return cached;
    }

    // 获取API配置
    const apiKey = await StorageManager.getApiKey();
    if (!apiKey && settings.apiProvider !== 'ollama') {
      throw new Error('API key not configured');
    }

    // 构建提示词
    const { systemPrompt, userPrompt } = this.buildPrompt(request, settings);

    // 调用LLM
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

    // 缓存结果
    const pageUrl = typeof window !== 'undefined' ? window.location.href : 'background';
    await enhancedCache.set(cacheKey, result, mode, pageUrl, 'llm');

    // 记录指标
    recordMetric(MetricType.API_RESPONSE_TIME, 'llm_translate', apiDuration, true, {
      provider: settings.apiProvider,
      textLength: text.length,
    });

    return result;
  }

  /**
   * 混合翻译策略
   * 传统API快速翻译 + LLM深度分析
   * 支持并行处理模式
   */
  private static async translateWithHybrid(
    request: TranslationRequest,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const startTime = performance.now();
    const { text } = request;

    // 如果启用并行翻译，使用并行策略
    if (this.config.enableParallelTranslation) {
      return this.translateWithParallel(request, settings);
    }

    // 串行策略：先传统API，再LLM补充分析
    try {
      // 步骤1: 使用传统API快速翻译
      const traditionalResult = await this.translateWithTraditional(request, settings);

      // 步骤2: 识别需要LLM深度分析的内容
      const wordsToAnalyze = traditionalResult.words.filter(w => w.difficulty >= 7);

      // 步骤3: 如果存在复杂词汇，使用LLM进行深度分析
      if (wordsToAnalyze.length > 0) {
        const apiKey = await StorageManager.getApiKey();
        if (apiKey || settings.apiProvider === 'ollama') {
          try {
            const analysis = await this.analyzeWithLLM(wordsToAnalyze, text, settings);

            // 合并分析结果
            traditionalResult.words = this.mergeWordAnalysis(
              traditionalResult.words,
              analysis
            );
          } catch (error) {
            logger.warn('LLM analysis failed in hybrid mode:', error);
            // LLM分析失败不影响主翻译结果
          }
        }
      }

      const duration = performance.now() - startTime;
      logger.info('Hybrid translation completed:', {
        duration: `${duration.toFixed(2)}ms`,
        wordCount: traditionalResult.words.length,
      });

      return traditionalResult;
    } catch (error) {
      // 使用增强的错误回退
      logger.error('Hybrid translation failed, using fallback:', error);
      return this.translateWithFallback(request, settings);
    }
  }

  /**
   * 异步分析生词
   * 不阻塞主翻译流程
   */
  private static async analyzeWordsAsync(
    originalText: string,
    _translatedText: string,
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
      logger.error('Word analysis failed:', error);
      return [];
    }
  }

  /**
   * 使用LLM深度分析词汇
   */
  private static async analyzeWithLLM(
    words: TranslatedWord[],
    context: string,
    settings: UserSettings
  ): Promise<TranslatedWord[]> {
    const apiKey = await StorageManager.getApiKey();
    if (!apiKey && settings.apiProvider !== 'ollama') {
      return words;
    }

    const wordList = words.map(w => w.original).join(', ');

    const prompt = `Analyze these words in context and provide detailed explanations:

Context: "${context}"
Words: ${wordList}

Return JSON:
{
  "words": [
    {
      "original": "word",
      "translation": "详细中文释义",
      "difficulty": 1-10,
      "isPhrase": false,
      "phonetic": "/phonetic/",
      "partOfSpeech": "词性",
      "examples": ["例句1", "例句2"]
    }
  ]
}`;

    try {
      const content = await TranslationApiService.quickTranslateWithSystem(
        'You are an English learning assistant. Always respond with valid JSON.',
        prompt,
        apiKey || '',
        settings
      );

      return this.parseWordAnalysis(content);
    } catch (error) {
      logger.error('LLM analysis failed:', error);
      return words;
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
      logger.error('Failed to parse word analysis:', error);
      return [];
    }
  }

  /**
   * 合并词汇分析结果
   */
  private static mergeWordAnalysis(
    originalWords: TranslatedWord[],
    analyzedWords: TranslatedWord[]
  ): TranslatedWord[] {
    const analyzedMap = new Map(analyzedWords.map(w => [w.original.toLowerCase(), w]));

    return originalWords.map(word => {
      const analyzed = analyzedMap.get(word.original.toLowerCase());
      if (analyzed) {
        return {
          ...word,
          translation: analyzed.translation || word.translation,
          phonetic: analyzed.phonetic || word.phonetic,
          partOfSpeech: analyzed.partOfSpeech || word.partOfSpeech,
          examples: analyzed.examples || word.examples,
        };
      }
      return word;
    });
  }

  /**
   * 获取传统API的API Key
   */
  private static async getTraditionalApiKey(): Promise<string | null> {
    // 从storage获取传统API的API Key
    const settings = await StorageManager.getSettings();
    const hybridSettings = settings as UserSettings & { hybridTranslation?: HybridTranslationConfig };

    if (hybridSettings.hybridTranslation?.traditionalApiKey) {
      return hybridSettings.hybridTranslation.traditionalApiKey;
    }

    // 尝试从apiConfigs中查找传统API的配置
    const traditionalConfig = settings.apiConfigs?.find(
      config => config.provider === this.config.traditionalProvider
    );

    if (traditionalConfig?.apiKey) {
      return traditionalConfig.apiKey;
    }

    return null;
  }

  /**
   * 构建提示词
   */
  private static buildPrompt(request: TranslationRequest, settings: UserSettings): { systemPrompt: string; userPrompt: string } {
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
   * 解析LLM响应
   */
  private static parseResponse(content: string, settings: UserSettings): TranslationResult {
    const { phraseTranslationEnabled, grammarTranslationEnabled } = settings;

    try {
      // 提取JSON
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
      logger.error('Failed to parse LLM response:', error);
      throw new Error('Failed to parse translation response');
    }
  }

  /**
   * 并行翻译策略
   * 同时调用传统API和LLM，返回最快的结果
   * 如果传统API先返回且结果质量可接受，使用传统API结果
   * 否则等待LLM结果
   */
  private static async translateWithParallel(
    request: TranslationRequest,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const startTime = performance.now();
    const { text, userLevel } = request;

    logger.info('HybridTranslationService: Starting parallel translation', {
      textLength: text.length,
      timeout: this.config.parallelTimeout,
    });

    // 创建两个翻译Promise
    const traditionalPromise = this.translateWithTraditional(request, settings)
      .then(result => ({ source: 'traditional' as const, result, duration: performance.now() - startTime }))
      .catch(error => ({ source: 'traditional' as const, error, duration: performance.now() - startTime }));

    const llmPromise = this.translateWithLLM(request, settings)
      .then(result => ({ source: 'llm' as const, result, duration: performance.now() - startTime }))
      .catch(error => ({ source: 'llm' as const, error, duration: performance.now() - startTime }));

    // 使用Promise.race获取第一个完成的
    const firstResult = await Promise.race([traditionalPromise, llmPromise]);

    if ('error' in firstResult) {
      // 第一个完成的失败了，等待另一个
      logger.warn(`Parallel translation: ${firstResult.source} failed first, waiting for other`, {
        error: firstResult.error,
      });

      const secondResult = await Promise.race([
        traditionalPromise,
        llmPromise,
      ]);

      if ('error' in secondResult) {
        // 两个都失败了
        throw new Error('Both traditional and LLM translation failed');
      }

      logger.info(`Parallel translation: Using ${secondResult.source} result after fallback`, {
        duration: `${secondResult.duration.toFixed(2)}ms`,
      });

      return secondResult.result;
    }

    // 第一个成功完成
    logger.info(`Parallel translation: ${firstResult.source} completed first`, {
      duration: `${firstResult.duration.toFixed(2)}ms`,
    });

    // 如果是传统API先完成，进行质量评估
    if (firstResult.source === 'traditional') {
      const complexityAnalysis = TextComplexityAnalyzer.analyze(text);

      // 如果文本较简单，接受传统API结果
      if (complexityAnalysis.level !== 'complex') {
        logger.info('Parallel translation: Traditional result accepted for simple text');

        // 异步补充生词分析
        this.enrichResultWithWordAnalysis(firstResult.result, text, userLevel, settings);

        return firstResult.result;
      }

      // 复杂文本，等待LLM结果
      logger.info('Parallel translation: Waiting for LLM result for complex text');
    }

    // 如果是LLM先完成，直接使用
    if (firstResult.source === 'llm') {
      return firstResult.result;
    }

    // 等待LLM完成（如果传统API先返回但文本复杂）
    const llmResult = await llmPromise;
    if ('error' in llmResult) {
      // LLM失败，回退到传统API结果
      logger.warn('Parallel translation: LLM failed, falling back to traditional');
      return firstResult.result;
    }

    return llmResult.result;
  }

  /**
   * 增强的错误回退翻译
   * 多层次回退策略确保翻译始终可用
   */
  private static async translateWithFallback(
    request: TranslationRequest,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const { text } = request;
    const errors: Array<{ source: string; error: Error }> = [];

    // 根据回退策略确定尝试顺序
    const strategies = this.getFallbackStrategies();

    for (const strategy of strategies) {
      try {
        logger.info(`HybridTranslationService: Trying fallback strategy: ${strategy}`);

        switch (strategy) {
          case 'traditional':
            return await this.translateWithTraditional(request, settings);
          case 'llm':
            return await this.translateWithLLM(request, settings);
          case 'simple':
            // 极简回退：直接返回原文作为译文
            return this.createSimpleResult(text);
          default:
            continue;
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push({ source: strategy, error: err });
        logger.warn(`Fallback strategy ${strategy} failed:`, err.message);
      }
    }

    // 所有策略都失败，返回原文
    logger.error('All fallback strategies failed:', errors);
    return this.createSimpleResult(text);
  }

  /**
   * 获取回退策略顺序
   */
  private static getFallbackStrategies(): Array<'traditional' | 'llm' | 'simple'> {
    switch (this.config.fallbackStrategy) {
      case 'traditional_first':
        return ['traditional', 'llm', 'simple'];
      case 'llm_first':
        return ['llm', 'traditional', 'simple'];
      case 'fastest':
      default:
        return ['traditional', 'llm', 'simple'];
    }
  }

  /**
   * 创建简单的翻译结果（回退用）
   */
  private static createSimpleResult(text: string): TranslationResult {
    return {
      words: [],
      sentences: [{
        original: text,
        translation: text, // 回退到原文
      }],
      fullText: text,
    };
  }

  /**
   * 为结果补充生词分析（异步）
   */
  private static async enrichResultWithWordAnalysis(
    result: TranslationResult,
    originalText: string,
    userLevel: { estimatedVocabulary: number },
    settings: UserSettings
  ): Promise<void> {
    try {
      const words = await this.analyzeWordsAsync(originalText, '', userLevel, settings);
      result.words = words;
    } catch (error) {
      logger.error('Failed to enrich result with word analysis:', error);
    }
  }

  /**
   * 快速翻译单个词/短语
   */
  static async quickTranslate(text: string): Promise<string> {
    const settings = await StorageManager.getSettings();
    const apiKey = await this.getTraditionalApiKey();

    if (apiKey) {
      // 优先使用传统API
      const traditionalSettings: UserSettings = {
        ...settings,
        apiProvider: this.config.traditionalProvider,
      };
      return TranslationApiService.quickTranslate(text, apiKey, traditionalSettings);
    }

    // 回退到LLM快速翻译
    const llmApiKey = await StorageManager.getApiKey();
    if (!llmApiKey && settings.apiProvider !== 'ollama') {
      throw new Error('No API key configured');
    }

    return TranslationApiService.quickTranslate(text, llmApiKey || '', settings);
  }
}

// 导出复杂度分析器和相关类型
export { TextComplexityAnalyzer, type ComplexityAnalysis } from './textComplexityAnalyzer';
