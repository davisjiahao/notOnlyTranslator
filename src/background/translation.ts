import type {
  TranslationRequest,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import { logger, generateCacheKey, extractJsonFromResponse } from '@/shared/utils';
import { StorageManager } from './storage';
import { TranslationApiService, type TranslationApiRequestOptions } from './translationApi';
import { TranslationPromptBuilder, promptVersionManager, buildVocabOnlyPrompt } from '@/shared/prompts';
import { enhancedCache } from './enhancedCache';
import { MetricType, recordMetric } from '@/shared/performance';
import { HybridTranslationService } from './hybridTranslation';
import { DeepLTranslationService } from './deeplTranslation';
import { executeTransportRequest, TRANSPORT_DEFAULTS } from './translationRequest';
import {
  lookupWord,
  storeWordSense,
  resolveLocalCandidates,
  buildLocalTranslationResult,
  normalizeWord,
  getLocalWordDifficulty,
  markLocalSource,
} from './localWordLookup';

/**
 * 翻译请求可选选项（直接复用 LLM 传输层类型，signal 由 background 消息路由注入）
 */
export type TranslationRequestOptions = TranslationApiRequestOptions;

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
  static async translate(
    request: TranslationRequest,
    options?: TranslationRequestOptions
  ): Promise<TranslationResult> {
    options?.signal?.throwIfAborted();
    const { text, mode } = request;
    const startTime = performance.now();

    logger.info('TranslationService.translate called:', { textLength: text?.length, mode });

    // 获取设置
    const settings = await StorageManager.getSettings();
    options?.signal?.throwIfAborted();

    // 策略0: 单词/短语级查词先走本地链（生词本 → 语境缓存 → 离线词典）
    // 查词不因单词等级低被拒绝；本地命中在断网/无 Key 时同样可用
    const localHit = await this.tryLocalWordLookup(request);
    options?.signal?.throwIfAborted();
    if (localHit) {
      const duration = performance.now() - startTime;
      recordMetric(MetricType.TRANSLATION_TOTAL_TIME, 'translate_total', duration, true, {
        provider: 'local',
        textLength: text?.length,
      });
      return localHit;
    }

    // 免费 Google 只在用户明确选择时使用，绝不作为无密钥的自动回退。
    if (settings.apiProvider === 'free_google_translate') {
      return this.translateWithFreeGoogle(request, startTime, options);
    }

    const hasDeepLKey = settings.apiProvider === 'deepl' && await this.hasDeepLApiKey(settings);
    const apiKey = await StorageManager.getApiKey();
    options?.signal?.throwIfAborted();
    if (!apiKey && !hasDeepLKey && settings.apiProvider !== 'ollama') {
      // 未配置服务也可使用已有缓存；后续在缓存未命中时只走本地词典，不调用网络。
      return this.translateWithLLM(request, settings, startTime, options);
    }

    const hybridSettings = settings as UserSettings & { hybridTranslation?: { enabled?: boolean } };
    if (hybridSettings.hybridTranslation?.enabled) {
      logger.info('TranslationService: Using HybridTranslationService');
      return HybridTranslationService.translate(request, options);
    }

    if (hasDeepLKey) {
      logger.info('TranslationService: Using DeepLTranslationService (primary)');
      return DeepLTranslationService.translate(request, options);
    }

    logger.info('TranslationService: Using standard LLM translation');
    return this.translateWithLLM(request, settings, startTime, options);
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
   * 用户明确选择的免费 Google 翻译（无需 API Key）
   * 使用 Google Translate Web 端点进行简单文本翻译
   */
  private static async translateWithFreeGoogle(
    request: TranslationRequest,
    startTime: number,
    options?: TranslationRequestOptions
  ): Promise<TranslationResult> {
    options?.signal?.throwIfAborted();
    const { text, mode } = request;
    const cacheKey = generateCacheKey(text, mode);

    // 检查缓存
    const cached = await enhancedCache.get(cacheKey);
    options?.signal?.throwIfAborted();
    if (cached) {
      recordMetric(MetricType.CACHE_OPERATION, 'cache_get', 0, true, { cacheHit: true, cacheKey });
      return cached;
    }

    recordMetric(MetricType.CACHE_OPERATION, 'cache_get', 0, true, { cacheHit: false, cacheKey });

    const apiStartTime = performance.now();

    // 调用 Google Translate 免费端点
    const url = 'https://translate.googleapis.com/translate_a/single';
    const params = new URLSearchParams({
      client: 'gtx',
      sl: 'en',
      tl: 'zh-CN',
      dt: 't',
      q: text,
    });

    const fullText = await executeTransportRequest(`${url}?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    }, {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
      redactTexts: [text],
      onSuccess: data => {
        if (!Array.isArray(data) || !Array.isArray(data[0])) {
          throw new Error('免费翻译引擎返回格式无效');
        }
        const translated = data[0].flatMap((group: unknown) => {
          if (!Array.isArray(group)) return [];
          const value = Array.isArray(group[0]) ? group[0][0] : group[0];
          return typeof value === 'string' ? [value] : [];
        }).join('');
        if (!translated.trim()) throw new Error('免费翻译引擎返回空响应');
        return translated;
      },
    });

    const apiDuration = performance.now() - apiStartTime;
    const totalDuration = performance.now() - startTime;

    // 免费翻译只返回全文翻译，不做 JSON 解析和词汇提取
    const result: TranslationResult = {
      words: [],
      sentences: [],
      fullText,
      _source: 'free_google',
    };

    // 取消检查：已取消则不落缓存
    options?.signal?.throwIfAborted();
    const pageUrl = typeof window !== 'undefined' ? window.location.href : 'background';
    await enhancedCache.set(cacheKey, result, mode, pageUrl, 'free_google');

    recordMetric(MetricType.API_RESPONSE_TIME, 'translate_free', apiDuration, true, {
      provider: 'free_google_translate',
      textLength: text?.length,
    });
    recordMetric(MetricType.TRANSLATION_TOTAL_TIME, 'translate_total', totalDuration, true, {
      provider: 'free_google_translate',
      textLength: text?.length,
    });

    logger.info('TranslationService: Free Google Translate completed', {
      apiDuration: `${apiDuration.toFixed(2)}ms`,
      totalDuration: `${totalDuration.toFixed(2)}ms`,
    });

    return result;
  }

  /**
   * 标准 LLM 翻译（当 DeepL 不可用时使用）
   */
  private static async translateWithLLM(
    request: TranslationRequest,
    settings: UserSettings,
    startTime: number,
    options?: TranslationRequestOptions
  ): Promise<TranslationResult> {
    options?.signal?.throwIfAborted();
    const { text, mode } = request;

    // 生成缓存键
    const cacheKey = generateCacheKey(text, mode);

    // 检查增强缓存
    const cached = await enhancedCache.get(cacheKey);
    options?.signal?.throwIfAborted();
    if (cached) {
      const duration = performance.now() - startTime;
      recordMetric(MetricType.CACHE_OPERATION, 'cache_get', duration, true, { cacheHit: true, cacheKey });
      logger.info('TranslationService: Cache hit', { duration: `${duration.toFixed(2)}ms` });
      return cached;
    }

    // 记录缓存未命中，尝试模糊匹配
    const fuzzyMatch = await enhancedCache.fuzzyGet(text, mode);
    options?.signal?.throwIfAborted();
    if (fuzzyMatch) {
      const duration = performance.now() - startTime;
      recordMetric(MetricType.CACHE_OPERATION, 'cache_get_fuzzy', duration, true, { cacheHit: true, cacheKey: cacheKey + ':fuzzy', similarity: fuzzyMatch.similarity });
      logger.info('TranslationService: Fuzzy cache hit', { similarity: `${(fuzzyMatch.similarity * 100).toFixed(1)}%`, duration: `${duration.toFixed(2)}ms` });
      return fuzzyMatch.result;
    }

    recordMetric(MetricType.CACHE_OPERATION, 'cache_get', 0, true, { cacheHit: false, cacheKey });

    // Get settings for API config
    const apiKey = await StorageManager.getApiKey();
    options?.signal?.throwIfAborted();
    logger.info('TranslationService: Settings loaded:', {
      apiProvider: settings.apiProvider,
      hasApiKey: !!apiKey,
      hasCustomApiUrl: !!settings.customApiUrl,
      customModelName: settings.customModelName
    });

    // 密钥检查必须在本地缓存之后，缓存未命中才判定是否允许外发。
    if (!apiKey && settings.apiProvider !== 'ollama') {
      if (mode === 'inline-only') {
        const context = request.context ? `${text}\n${request.context}` : text;
        const local = resolveLocalCandidates(text, request.userLevel, { context });
        if (local.needsContext.length > 0) {
          throw new Error('部分词汇在本地词典未收录，请配置翻译服务后重试');
        }
        return local.result;
      }
      throw new Error('请先配置翻译服务，或明确选择免费 Google 翻译后重试');
    }

    // Ollama 本地小模型：inline-only 且未开启语法增强时走轻量词汇模式
    // 候选词/难度/位置全部本地确定，模型仅补充候选词的语境释义；
    // 短语/语法增强仍由用户显式开关走完整流程，不在此强制并行请求
    if (
      settings.apiProvider === 'ollama' &&
      request.mode === 'inline-only' &&
      !settings.grammarTranslationEnabled &&
      !settings.phraseTranslationEnabled
    ) {
      logger.info('TranslationService: Using lightweight vocab mode (local-first)');
      return this.translateWithLightweightVocab(request, settings, startTime, options);
    }

    // Build prompt with settings
    const { systemPrompt, userPrompt } = this.buildPrompt(request, settings);
    logger.info('TranslationService: Prompt built, system length:', systemPrompt.length, 'user length:', userPrompt.length);

    // 使用统一 API 服务调用 LLM（末位可选参数携带取消信号等请求选项）
    logger.info('TranslationService: Calling API provider:', settings.apiProvider);
    const apiStartTime = performance.now();
    const content = await TranslationApiService.callWithSystem(systemPrompt, userPrompt, apiKey, settings, undefined, options);
    const apiDuration = performance.now() - apiStartTime;
    const result = this.parseResponse(content, settings);

    logger.info('TranslationService: API call completed', {
      wordsCount: result.words?.length,
      hasFullText: !!result.fullText,
      apiDuration: `${apiDuration.toFixed(2)}ms`
    });

    // 取消检查：已取消则不落缓存，取消错误向上传播（不吞掉后继续 fallback）
    options?.signal?.throwIfAborted();
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
   * 轻量词汇模式（本地优先 + Ollama）：
   * 本地确定候选词、难度与原句位置，模型仅补充候选词的语境释义。
   * 模型响应不含位置/难度/全文——位置本地计算、难度本地评估、候选集闭环校验。
   */
  private static async translateWithLightweightVocab(
    request: TranslationRequest,
    settings: UserSettings,
    startTime: number,
    options?: TranslationRequestOptions
  ): Promise<TranslationResult> {
    options?.signal?.throwIfAborted();
    const { text, context, userLevel } = request;
    const senseContext = context ? `${text}\n${context}` : text;

    // 语境缓存必须包含原句，避免相同外部语境下的不同句子共享词义。
    const resolution = resolveLocalCandidates(text, userLevel, { context: senseContext });

    // 无候选词或全部本地可解：无需模型
    if (resolution.candidates.length === 0 || resolution.needsContext.length === 0) {
      logger.info('TranslationService: 轻量词汇模式本地全可解，跳过模型调用');
      const duration = performance.now() - startTime;
      recordMetric(MetricType.TRANSLATION_TOTAL_TIME, 'translate_total', duration, true, {
        provider: 'local',
        textLength: text?.length,
      });
      return resolution.result;
    }

    // 仅把未释义候选交给模型，要求只返回词与语境释义
    const { systemPrompt, userPrompt } = buildVocabOnlyPrompt({
      sentence: text,
      context,
      candidates: resolution.needsContext.map((c) => c.original),
    });

    const apiKey = await StorageManager.getApiKey();
    options?.signal?.throwIfAborted();
    const apiStartTime = performance.now();
    const content = await TranslationApiService.callWithSystem(
      systemPrompt,
      userPrompt,
      apiKey,
      settings,
      undefined,
      options
    );
    const apiDuration = performance.now() - apiStartTime;
    recordMetric(MetricType.API_RESPONSE_TIME, 'translate', apiDuration, true, {
      provider: settings.apiProvider,
      textLength: text?.length,
    });

    const senses = this.parseVocabOnlyResponse(content);

    // 取消检查：已取消则不再解析、不写语境缓存，错误向上传播
    options?.signal?.throwIfAborted();

    // 按候选集回填语境释义（候选之外的模型输出自动忽略，位置沿用本地已验证值）
    const senseByLemma = new Map(senses.map((s) => [normalizeWord(s.original), s]));
    let llmAdoptedCount = 0;
    const finalCandidates = resolution.candidates.map((c) => {
      if (c.translation) return c;
      const sense = senseByLemma.get(c.lemma);
      if (!sense) return c;
      llmAdoptedCount += 1;
      // 语境释义写入缓存：同词同语境再次查询不再调用模型
      storeWordSense(c.lemma, senseContext, sense.translation);
      return { ...c, translation: sense.translation, source: 'sense_cache' as const };
    });

    const localResult = buildLocalTranslationResult(text, finalCandidates);
    if (localResult.words.length === 0) {
      throw new Error('模型未返回有效的语境释义，请重试');
    }
    const result: TranslationResult = llmAdoptedCount > 0
      ? { ...localResult, _source: 'llm' }
      : localResult;
    const totalDuration = performance.now() - startTime;
    recordMetric(MetricType.TRANSLATION_TOTAL_TIME, 'translate_total', totalDuration, true, {
      provider: settings.apiProvider,
      textLength: text?.length,
    });
    return result;
  }

  /**
   * 解析轻量词汇模式响应（{"words":[{"original","translation"}]}）
   * 只采纳非空字符串词义；调用方在没有任何可用结果时报告失败。
   */
  private static parseVocabOnlyResponse(content: string): Array<{ original: string; translation: string }> {
    try {
      const jsonStr = extractJsonFromResponse(content);
      if (!jsonStr) {
        logger.warn('TranslationService: 轻量词汇响应中未找到 JSON');
        return [];
      }
      const parsed = JSON.parse(jsonStr);
      if (!parsed || !Array.isArray(parsed.words)) {
        return [];
      }
      return parsed.words.flatMap((word: unknown) => {
        if (!word || typeof word !== 'object' || Array.isArray(word)) return [];
        const { original, translation } = word as Record<string, unknown>;
        if (typeof original !== 'string' || typeof translation !== 'string') return [];
        if (!original.trim() || !translation.trim()) return [];
        return [{ original: original.trim(), translation: translation.trim() }];
      });
    } catch {
      // 只记固定文案：SyntaxError.message 在部分运行时会附带响应正文片段，不得入日志
      logger.warn('TranslationService: 轻量词汇响应解析失败，保留本地结果');
      return [];
    }
  }

  /**
   * 单词/短语级查词的本地优先解析（≤3 个词）
   * 命中返回完整结果；未命中返回 null 走原有策略（LLM / 免费引擎），不因等级低拒绝查词
   */
  private static async tryLocalWordLookup(request: TranslationRequest): Promise<TranslationResult | null> {
    const { text, context, userLevel } = request;
    if (!text || typeof text !== 'string') return null;

    const tokenRegex = /[a-zA-Z]+(?:-[a-zA-Z]+)*/g;
    const tokens = text.match(tokenRegex);
    if (!tokens || tokens.length === 0 || tokens.length > 3) return null;

    const hit = await lookupWord(text, { userProfile: userLevel, context });
    if (!hit) return null;

    // 本地计算并验证原文位置（切片回读比对）
    const first = tokenRegex.exec(text);
    const position: [number, number] =
      first && text.slice(first.index, first.index + first[0].length).toLowerCase() === hit.word
        ? [first.index, first.index + first[0].length]
        : [0, text.length];

    const result: TranslationResult = {
      words: [
        {
          original: first ? first[0] : text,
          translation: hit.translation,
          position,
          difficulty: getLocalWordDifficulty(hit.word),
          isPhrase: tokens.length > 1,
          ...(hit.phonetic ? { phonetic: hit.phonetic } : {}),
        },
      ],
      sentences: [],
      grammarPoints: [],
      fullText: hit.translation,
    };
    logger.info('TranslationService: 单词级查询本地命中', { word: hit.word, source: hit.source });
    return markLocalSource(result);
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
    } catch {
      logger.error('翻译响应解析失败');
      throw new Error('Failed to parse translation response');
    }
  }

  /**
   * Quick translate a single word/phrase (no caching)
   * 本地优先：生词本/语境缓存/离线词典命中即返回（断网可用）；
   * 未命中时仅使用用户明确选择的免费 Google，其他服务保留原有 DeepL 回退链。
   */
  static async quickTranslate(
    text: string,
    _apiKey: string,
    _settings: UserSettings,
    options?: TranslationRequestOptions
  ): Promise<string> {
    options?.signal?.throwIfAborted();
    const hit = await lookupWord(text);
    options?.signal?.throwIfAborted();
    if (hit) {
      logger.info('TranslationService: quickTranslate 本地命中', { word: hit.word, source: hit.source });
      return hit.translation;
    }
    if (_settings.apiProvider === 'free_google_translate') {
      return TranslationApiService.quickTranslate(text, '', _settings, options);
    }
    if (!_apiKey && _settings.apiProvider !== 'ollama' && !(_settings.apiProvider === 'deepl' && await this.hasDeepLApiKey(_settings))) {
      throw new Error('请先配置翻译服务，或明确选择免费 Google 翻译后重试');
    }
    options?.signal?.throwIfAborted();
    // 使用 DeepLTranslationService 的快速翻译（优先 DeepL）
    return DeepLTranslationService.quickTranslate(text, options);
  }

  /**
   * 纯文本机器翻译小接口（未来纯文本 MT 适配的明确入口）
   * 与复杂 JSON 主链解耦：只接收文本、返回译文文本，支持通过 signal 取消
   */
  static async translatePlainText(
    text: string,
    options?: TranslationRequestOptions
  ): Promise<string> {
    if (!text || !text.trim()) {
      throw new Error('translatePlainText: 文本不能为空');
    }
    const settings = await StorageManager.getSettings();
    options?.signal?.throwIfAborted();
    if (settings.apiProvider !== 'free_google_translate') {
      throw new Error('请先配置翻译服务，或明确选择免费 Google 翻译后重试');
    }

    const request: TranslationRequest = {
      text,
      context: '',
      userLevel: {
        examType: 'custom',
        estimatedVocabulary: 0,
        knownWords: [],
        unknownWords: [],
        levelConfidence: 0,
        createdAt: 0,
        updatedAt: 0,
      },
      mode: 'full-translate',
    };

    const { fullText } = await this.translateWithFreeGoogle(request, performance.now(), options);
    if (!fullText) {
      throw new Error('translatePlainText: 翻译引擎返回空结果');
    }
    return fullText;
  }

  /**
   * 测试 API 连接
   * 发送一个简单的翻译请求来验证 API Key 是否有效
   */
  static async testConnection(
    provider: import('@/shared/types').ApiProvider,
    apiKey: string,
    apiUrl?: string
  ): Promise<boolean> {
    try {
      logger.info('TranslationService: Testing API connection', { provider, hasCustomUrl: !!apiUrl });

      // 构建临时设置对象
      const tempSettings: UserSettings = {
        enabled: true,
        autoHighlight: true,
        vocabHighlightEnabled: true,
        phraseTranslationEnabled: true,
        grammarTranslationEnabled: false,
        translationMode: 'inline-only',
        showDifficulty: true,
        highlightColor: '#ffeb3b',
        fontSize: 14,
        apiProvider: provider,
        customApiUrl: apiUrl,
        blacklist: [],
        apiConfigs: [],
        hoverDelay: 300,
        theme: 'system',
      };

      // 使用 TranslationApiService 进行简单的翻译测试
      const response = await TranslationApiService.callWithSystem(
        'You are a translation assistant. Translate the given text to Chinese.',
        'Translate "hello" to Chinese. Only output the Chinese translation.',
        apiKey,
        tempSettings,
        { maxRetries: 1, initialDelay: 1000, backoffMultiplier: 1, maxDelay: 5000 }
      );

      // 检查响应是否有效
      const isValid = !!(response && response.trim().length > 0);
      logger.info('TranslationService: API connection test result', { provider, isValid, response: response?.substring(0, 50) });
      return isValid;
    } catch (error) {
      logger.error('TranslationService: API connection test failed', error);
      return false;
    }
  }
}
