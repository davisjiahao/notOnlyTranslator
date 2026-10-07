import type {
  BatchTranslationRequest,
  BatchTranslationResponse,
  BatchParagraphResult,
  TranslationResult,
  UserProfile,
  UserSettings,
} from '@/shared/types';
import {
  DEFAULT_BATCH_CONFIG,
  CHINESE_DETECTION_THRESHOLD,
} from '@/shared/constants';
import {
  normalizeText,
  getChineseRatio,
  logger,
  extractJsonFromResponse,
  repairMalformedJson,
  type RetryOptions,
} from '@/shared/utils';
import { TranslationPromptBuilder } from '@/shared/prompts';
import { StorageManager } from './storage';
import { enhancedCache } from './enhancedCache';
import { TranslationApiService } from './translationApi';
import { boundedMaxTokens, TRANSPORT_DEFAULTS } from './translationRequest';
import { TransportError } from '@/shared/utils/translationErrors';
import { resolveLocalCandidates } from './localWordLookup';
import { recoverInlineVocabulary } from './inlineVocabRecovery';
import type { TranslationRequestOptions } from './translation';
import { createBatchParagraphParser } from './translationStream';

export interface BatchTranslationOptions extends TranslationRequestOptions {
  onParagraph?: (result: BatchParagraphResult) => void;
}

/**
 * 批量翻译的重试配置（优化延迟：初始 800ms → 原 1500ms，减少滑动中失败等待时间）
 */
const BATCH_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 800,
  backoffMultiplier: 2,
  maxDelay: 10000,
  onRetry: (error, attempt, delay) => {
    // 只记错误类别（kind/name），不记 error.message：上游响应正文片段可能被回显进日志
    const errorRecord = error as unknown as Record<string, unknown>;
    const kind = typeof errorRecord.kind === 'string' ? errorRecord.kind : error.name;
    logger.warn(
      `BatchTranslationService: API 调用失败（${kind}），第 ${attempt} 次重试，等待 ${Math.round(delay)}ms`
    );
  },
};

// Ollama 单次 JSON 输出不能超过 4096 token；按段落分批，为译文及标注留出空间。
const OLLAMA_BATCH_MAX_CHARS = 2000;

// 导出供其他模块使用
export { BATCH_RETRY_OPTIONS };

/**
 * 批量翻译服务
 *
 * 特性：
 * - 合并多个段落为单次API调用
 * - 使用 [PARA_n] 标记区分段落
 * - 自动缓存查询和结果存储
 * - 支持OpenAI、Anthropic和自定义API
 */
export class BatchTranslationService {
  /**
   * 批量翻译段落
   *
   * 无 Key 的检查移到本地解析之后：仅当确实存在必须走 LLM 的段落时才要求配置，
   * 缓存命中与本地可解内容在无 Key/断网时同样可用（与单段路径行为一致）
   * @param preloaded 调用方已读取的设置与密钥快照：在途去重等场景必须保证
   *   缓存键与实际翻译使用同一份快照，避免读取间隙切换配置导致键与结果错配；
   *   未传时维持服务自读（既有调用方行为不变）
   */
  static async translateBatch(
    request: BatchTranslationRequest,
    options?: BatchTranslationOptions,
    preloaded?: { settings: UserSettings; apiKey: string }
  ): Promise<BatchTranslationResponse> {
    options?.signal?.throwIfAborted();
    const { paragraphs, mode, pageUrl } = request;

    logger.info(`BatchTranslationService: 收到批量翻译请求，${paragraphs.length} 个段落`);

    // 配置与密钥必须来自同一设置快照，避免切换期间跨端点泄露密钥。
    const [userProfile, settings] = await Promise.all([
      request.userLevel || StorageManager.getUserProfile(),
      preloaded?.settings ?? StorageManager.getSettings(),
    ]);
    options?.signal?.throwIfAborted();
    const apiKey = preloaded?.apiKey ?? await StorageManager.getApiKey(settings);
    options?.signal?.throwIfAborted();

    // 调试日志
    logger.info('BatchTranslationService: 配置信息', {
      hasApiKey: !!apiKey,
      activeApiConfigId: settings.activeApiConfigId,
      apiConfigsCount: settings.apiConfigs?.length || 0,
      apiProvider: settings.apiProvider,
    });

    // 为每个段落生成缓存哈希
    const paragraphsWithHash = paragraphs.map((p) => ({
      ...p,
      textHash: enhancedCache.generateHash(p.text, mode, {
        settings, userLevel: userProfile, context: apiKey, engine: 'batch',
      }),
    }));

    // 批量查询缓存
    const textHashes = paragraphsWithHash.map((p) => p.textHash);
    const { hits } = await enhancedCache.getBatch(textHashes);
    options?.signal?.throwIfAborted();
    // 旧版空译文缓存按未命中处理，不能绕过当前模式的全文要求。
    const cacheHits = new Map([...hits].filter(([, result]) =>
      mode === 'inline-only' || (typeof result.fullText === 'string' && result.fullText.trim().length > 0)
    ));

    const accepted = new Map<string, BatchParagraphResult>();
    const publish = (paragraph: BatchParagraphResult): BatchParagraphResult => {
      const previous = accepted.get(paragraph.id);
      if (previous) return previous;
      accepted.set(paragraph.id, paragraph);
      if (!options?.signal?.aborted) {
        try { options?.onParagraph?.(paragraph); } catch {
          // 页面回调失败不能改变翻译结果或缓存内容。
        }
      }
      return paragraph;
    };

    // 添加缓存命中的结果
    for (const p of paragraphsWithHash) {
      const cachedResult = cacheHits.get(p.textHash);
      if (cachedResult) {
        publish({
          id: p.id,
          result: cachedResult,
          cached: true,
        });
      }
    }

    // 获取需要翻译的段落
    let toTranslate = paragraphsWithHash.filter((p) => !cacheHits.has(p.textHash));

    // 中文占比过高的段落无需翻译；英文候选统一按个人词表和 CEFR 筛选
    const skippedParagraphs: BatchParagraphResult[] = [];
    toTranslate = toTranslate.filter(p => {
      const chineseRatio = getChineseRatio(p.text);
      if (chineseRatio > CHINESE_DETECTION_THRESHOLD.PARAGRAPH) {
        logger.info(`BatchTranslationService: 跳过中文占比过高的段落 (${(chineseRatio * 100).toFixed(1)}%)`, p.id);
        skippedParagraphs.push({
          id: p.id,
          result: this.createEmptyResult(),
          cached: false
        });
        return false;
      }

      return true;
    });

    // 将跳过的结果加入结果集
    skippedParagraphs.forEach(publish);

    logger.info(`BatchTranslationService: 精确缓存命中 ${cacheHits.size} 个，跳过 ${skippedParagraphs.length} 个，需翻译 ${toTranslate.length} 个`);

    let apiCallCount = 0;

    // 如果有需要翻译的段落，先做本地优先解析，剩余段落才调用API
    if (toTranslate.length > 0) {
      // 本地优先：inline-only 段落候选全部可本地释义时直接产出结果，不进 API
      const localResolvedIds = new Set<string>();
      if (mode === 'inline-only' && !settings.phraseTranslationEnabled && !settings.grammarTranslationEnabled) {
        for (const p of toTranslate) {
          const resolution = resolveLocalCandidates(p.text, userProfile, { context: p.text });
          if (resolution.needsContext.length === 0) {
            localResolvedIds.add(p.id);
            publish({
              id: p.id,
              result: resolution.result,
              cached: false,
            });
            logger.info(`BatchTranslationService: 段落本地全可解（无 API 调用）`, p.id);
          }
        }
      }

      const apiNeeded = toTranslate.filter((p) => !localResolvedIds.has(p.id));

      if (apiNeeded.length > 0) {
        // 行内模式只展示词汇标记；免费 Google 仅返回全文，不能发出不可见的翻译请求。
        if (settings.apiProvider === 'free_google_translate' && mode === 'inline-only') {
          throw new Error('免费 Google 翻译不支持仅行内模式，请选择双语或全文翻译');
        }
        // 无 Key 仅在确实存在必须走 LLM 的段落时才抛错（不把失败伪装成成功）
        if (!apiKey && settings.apiProvider !== 'ollama' && settings.apiProvider !== 'free_google_translate') {
          throw new Error('API key not configured. Please set your API key in settings.');
        }
        const cacheGeneration = enhancedCache.getGeneration();

        // 本地模型的 JSON 输出受 4096 token 硬上限约束；拆小批次，避免 10000 字符合并后截断。
        // 单个超长段落保持原子性，由 token 上限和超时保护；若需完整支持，须先实现位置安全的分段合并。
        const batches = settings.apiProvider === 'ollama'
          ? this.splitIntoBatches(apiNeeded, OLLAMA_BATCH_MAX_CHARS)
          : [apiNeeded];
        const timeoutMs = options?.timeoutMs ?? TRANSPORT_DEFAULTS.localLlmTimeoutMs;
        const controller = settings.apiProvider === 'ollama' ? new AbortController() : undefined;
        const deadline = controller ? Date.now() + timeoutMs : undefined;
        const timer = controller && Number.isFinite(timeoutMs) && timeoutMs > 0
          ? setTimeout(() => controller.abort(), timeoutMs)
          : undefined;
        const signal = controller && options?.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller?.signal ?? options?.signal;
        const checkDeadline = () => {
          options?.signal?.throwIfAborted();
          if (deadline !== undefined && (Date.now() >= deadline || controller?.signal.aborted)) {
            throw TransportError.timeout(timeoutMs);
          }
        };
        let apiResults: TranslationResult[] = [];
        let fallbackIds: ReadonlySet<string> = new Set();
        try {
          if (settings.apiProvider === 'free_google_translate') {
            // 免费 Google 只返回纯文本：逐段发送原文，不能拼 JSON 提示词后解析。
            for (const paragraph of apiNeeded) {
              options?.signal?.throwIfAborted();
              const fullText = await TranslationApiService.callWithSystem(
                '', normalizeText(paragraph.text), apiKey, settings, BATCH_RETRY_OPTIONS, options
              );
              options?.signal?.throwIfAborted();
              if (!fullText.trim()) throw TransportError.unavailable('免费翻译引擎返回空响应');
              const result: TranslationResult = { words: [], sentences: [], fullText, _source: 'free_google' };
              apiResults = [...apiResults, result];
              publish({ id: paragraph.id, result, cached: false });
              apiCallCount++;
            }
          } else {
            for (const batch of batches) {
              checkDeadline();
              const remainingMs = deadline === undefined ? undefined : deadline - Date.now();
              const batchOptions = remainingMs === undefined ? options : {
                ...options,
                signal,
                timeoutMs: remainingMs,
                maxTokens: options?.maxTokens ?? boundedMaxTokens(
                  512 + batch.reduce((sum, paragraph) => sum + paragraph.text.length, 0) * 1.5
                ),
              };
              try {
                apiResults = [...apiResults, ...await this.callBatchAPI(
                  batch, userProfile, settings, apiKey, mode, { ...batchOptions, onParagraph: publish }
                )];
              } catch (error) {
                checkDeadline();
                if (!(error instanceof TransportError) || error.kind !== 'output_limit') throw error;
                // 沿用原取消信号和本地截止时间，恢复任务不重复复杂分析。
                const fallbackOptions = deadline === undefined ? batchOptions : {
                  ...batchOptions, timeoutMs: deadline - Date.now(),
                };
                const missing = batch.filter(paragraph => !accepted.has(paragraph.id));
                if (missing.length > 0) {
                  let recoveredResults: TranslationResult[];
                  if (mode === 'inline-only') {
                    const recovered = await recoverInlineVocabulary(
                      missing, userProfile, settings, apiKey, fallbackOptions, true
                    );
                    recoveredResults = recovered.results;
                    apiCallCount += recovered.apiCallCount;
                  } else {
                    recoveredResults = await this.translateFullTextBatch(
                      missing, userProfile, settings, apiKey, mode, fallbackOptions
                    );
                    apiCallCount++;
                  }
                  missing.forEach((paragraph, index) => publish({ id: paragraph.id, result: recoveredResults[index], cached: false }));
                  fallbackIds = new Set([...fallbackIds, ...missing.map(paragraph => paragraph.id)]);
                }
                apiResults = [...apiResults, ...batch.map(paragraph => accepted.get(paragraph.id)!.result)];
              }
              checkDeadline();
              apiCallCount++;
            }
          }
        } catch (error) {
          // 只转换本地整体截止，不改变云端及免费引擎原有的取消错误类型。
          if (controller) checkDeadline();
          throw error;
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }

        // 取消检查：已取消则不逐段落缓存，错误向上传播（不吞掉后返回半截结果）
        options?.signal?.throwIfAborted();

        // 添加API翻译结果
        for (const [index, p] of apiNeeded.entries()) {
          options?.signal?.throwIfAborted();
          const result = accepted.get(p.id)?.result ?? apiResults[index] ?? this.createEmptyResult();
          publish({
            id: p.id,
            result,
            cached: false,
          });

          // 纯全文降级未完成语法分析，不能写入原复杂任务的缓存身份。
          if (!fallbackIds.has(p.id)) {
            await enhancedCache.set(
              p.textHash, result, mode, pageUrl,
              settings.apiProvider === 'free_google_translate' ? 'free_google' : undefined,
              cacheGeneration
            );
          }
          options?.signal?.throwIfAborted();
        }
      }
    }

    // 按原始顺序排序结果 - 使用 Map 实现 O(1) 查找
    const orderedResults = paragraphs.map((p) =>
      accepted.get(p.id) ?? { id: p.id, result: this.createEmptyResult(), cached: false }
    );

    return {
      results: orderedResults,
      apiCallCount,
      cacheHitCount: cacheHits.size,
    };
  }

  /**
   * 调用API进行批量翻译
   */
  private static async callBatchAPI(
    paragraphs: Array<{ id: string; text: string; textHash: string }>,
    userProfile: UserProfile,
    settings: UserSettings,
    apiKey: string,
    mode: BatchTranslationRequest['mode'],
    options?: BatchTranslationOptions
  ): Promise<TranslationResult[]> {
    // 构建带标记的段落文本
    const paragraphsText = paragraphs
      .map((p, index) => `[PARA_${index}]\n${normalizeText(p.text)}`)
      .join('\n\n');

    // 使用 TranslationPromptBuilder 构建提示词
    const builder = new TranslationPromptBuilder(
      userProfile,
      '', // text not needed for batch
      '', // context not needed for batch
      settings,
      paragraphsText // paragraphs parameter for batch mode
    );
    const { systemPrompt, userPrompt } = builder.build();

    logger.info('BatchTranslationService: 调用API，提示词长度:', systemPrompt.length + userPrompt.length);

    const accepted = new Map<number, TranslationResult>();
    const publish = (index: number, result: TranslationResult) => {
      if (accepted.has(index)) return;
      accepted.set(index, result);
      options?.onParagraph?.({ id: paragraphs[index].id, result, cached: false });
    };
    const acceptParagraph = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const para = value as Record<string, unknown>;
      if (typeof para.id !== 'string' || !/^PARA_(0|[1-9]\d*)$/.test(para.id)) return;
      const index = Number(para.id.slice(5));
      if (index >= paragraphs.length || accepted.has(index) || !this.validStreamParagraph(para, mode)) return;
      publish(index, this.parseParaResult(para, settings));
    };
    let streamed = false;
    let parser = createBatchParagraphParser(acceptParagraph);
    const response = await TranslationApiService.callWithSystem(
      systemPrompt, userPrompt, apiKey, settings, BATCH_RETRY_OPTIONS,
      {
        ...options,
        onStreamStart: () => {
          parser = createBatchParagraphParser(acceptParagraph);
          options?.onStreamStart?.();
        },
        onTextDelta: delta => {
          if (delta.length > 0) streamed = true;
          parser.push(delta);
          options?.onTextDelta?.(delta);
        },
      }
    );
    const parsed = this.parseBatchResponse(response, paragraphs.length, settings, mode, false, streamed);
    parsed.forEach((result, index) => publish(index, result));
    return paragraphs.map((_, index) => accepted.get(index)!);
  }

  /** 复杂分析耗尽预算后，仅恢复全文，并用本地词典补充已知释义。 */
  private static async translateFullTextBatch(
    paragraphs: Array<{ id: string; text: string; textHash: string }>,
    userProfile: UserProfile,
    settings: UserSettings,
    apiKey: string,
    mode: BatchTranslationRequest['mode'],
    options?: TranslationRequestOptions
  ): Promise<TranslationResult[]> {
    options?.signal?.throwIfAborted();
    const example = { paragraphs: paragraphs.map((_, index) => ({ id: `PARA_${index}`, fullText: '完整中文译文', words: [] })) };
    const text = paragraphs.map((paragraph, index) => `[PARA_${index}]\n${normalizeText(paragraph.text)}`).join('\n\n');
    const response = await TranslationApiService.callWithSystem(
      'Translate English into Chinese. Return only valid JSON with complete Chinese fullText values. Preserve proper names.',
      `Translate every paragraph below. Preserve every paragraph ID. Return only JSON matching this example: ${JSON.stringify(example)}\nDo not analyze words or grammar; use empty words arrays.\n\nParagraphs:\n${text}`,
      apiKey, settings, { ...BATCH_RETRY_OPTIONS, maxRetries: 0 },
      { ...options, responseFormat: { type: 'json_object' } }
    );
    options?.signal?.throwIfAborted();
    const parsed = this.parseBatchResponse(response, paragraphs.length, settings, mode, true);
    const cacheScope = enhancedCache.generateHash('', 'inline-only', { settings, userLevel: userProfile, engine: 'llm' });
    return parsed.map((result, index) => ({
      words: resolveLocalCandidates(paragraphs[index].text, userProfile, { context: paragraphs[index].text, cacheScope }).result.words,
      sentences: [], fullText: result.fullText, _source: 'llm',
    }));
  }

  /**
   * 解析批量翻译响应（增强鲁棒性）
   */
  private static parseBatchResponse(
    content: string,
    expectedCount: number,
    settings: UserSettings,
    mode: BatchTranslationRequest['mode'],
    requireExactIds = false,
    streamed = false
  ): TranslationResult[] {
    try {
      // 直接数组须保留外层，否则对象优先的提取器会丢失段落列表
      const trimmedContent = content.trim();
      const jsonStr = trimmedContent.startsWith('[')
        ? trimmedContent
        : extractJsonFromResponse(content);
      if (!jsonStr) {
        throw new Error('批量翻译响应格式无效');
      }

      // 2. 尝试解析并修复常见的 JSON 语法错误
      let parsed: Record<string, unknown> | unknown[];
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        const repairedJson = repairMalformedJson(jsonStr);
        try {
          parsed = JSON.parse(repairedJson);
        } catch {
          throw new Error('批量翻译响应格式无效');
        }
      }

      // 3. 验证基础结构
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('批量翻译响应格式无效');
      }

      // 兼容不同的返回格式 (有些 LLM 可能会直接返回数组或包装在 data 中)
      const rawParagraphs = Array.isArray(parsed) 
        ? parsed 
        : (parsed.paragraphs || parsed.results || parsed.data || []);

      if (!Array.isArray(rawParagraphs) || rawParagraphs.length !== expectedCount
        || rawParagraphs.some(para => !para || typeof para !== 'object' || Array.isArray(para)
          || (mode !== 'inline-only' && (typeof para.fullText !== 'string' || !para.fullText.trim()))
          || (!Array.isArray(para.words) && typeof para.fullText !== 'string'
            && !Array.isArray(para.grammarPoints)))) {
        throw new Error('批量翻译响应格式无效');
      }
      // 降级任务必须完整回传标记；不能按位置猜测重排后的段落归属。
      const expectedIds = new Set(Array.from({ length: expectedCount }, (_, index) => `PARA_${index}`));
      if ((requireExactIds || streamed) && rawParagraphs.some(para => typeof para.id !== 'string' || !expectedIds.has(para.id)
        || (streamed && !this.validStreamParagraph(para, mode)))) {
        throw new Error('批量翻译响应格式无效');
      }
      const explicitIds = rawParagraphs
        .filter((para: Record<string, unknown>) => para.id !== undefined)
        .map((para: Record<string, unknown>) => String(para.id));
      if (new Set(explicitIds).size !== explicitIds.length) {
        throw new Error('批量翻译响应格式无效');
      }
      const hasNumericIds = explicitIds.some(id => /^(?:PARA_)?\d+$/.test(id));

      // 4. 建立索引 (通过 id 匹配)
      const resultsById = new Map<string, TranslationResult>();
      rawParagraphs.forEach((para: Record<string, unknown>, index: number) => {
        if (!para || typeof para !== 'object') return;

        // 尝试获取 ID，如果没提供 ID 则根据顺序猜测
        const rawId = para.id !== undefined ? String(para.id) : String(index);
        const id = rawId.replace(/^PARA_(\d+)$/, '$1');
        // 纯全文任务不解析模型额外夹带的分析字段，本地词汇由调用方补充。
        resultsById.set(id, this.parseParaResult(requireExactIds ? { fullText: para.fullText } : para, settings));
      });

      // 5. 组装结果，确保数量与预期一致
      const finalResults: TranslationResult[] = [];
      let foundCount = 0;

      for (let i = 0; i < expectedCount; i++) {
        const result = resultsById.get(String(i));
        if (result && (result.words.length > 0 || result.fullText || (result.grammarPoints?.length || 0) > 0)) {
          finalResults.push(result);
          foundCount++;
        } else {
          // 无数字 ID 的完整响应才允许按位置回填，避免把其他段的译文错配。
          if (resultsById.has(String(i))) {
            finalResults.push(this.createEmptyResult());
          } else if (!hasNumericIds) {
            finalResults.push(this.parseParaResult(rawParagraphs[i], settings));
            foundCount++;
          } else {
            throw new Error('批量翻译响应格式无效');
          }
        }
      }

      logger.info(`BatchTranslationService: 解析完成，成功挽救 ${foundCount}/${expectedCount} 个段落`);
      return finalResults;
    } catch {
      logger.error('BatchTranslationService: 解析响应发生致命错误');
      throw new Error('批量翻译响应格式无效');
    }
  }

  private static validStreamParagraph(para: Record<string, unknown>, mode: BatchTranslationRequest['mode']): boolean {
    if (!Array.isArray(para.words)
      || (mode !== 'inline-only' && (typeof para.fullText !== 'string' || !para.fullText.trim()))
      || (para.fullText !== undefined && typeof para.fullText !== 'string')) return false;
    const arrays = [
      { value: para.words, fields: ['original', 'translation'] },
      { value: para.sentences, fields: ['original', 'translation'] },
      { value: para.grammarPoints, fields: ['original', 'explanation'] },
    ];
    return arrays.every(({ value, fields }) => value === undefined || (Array.isArray(value) && value.every(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const entry = item as Record<string, unknown>;
      return fields.every(field => typeof entry[field] === 'string')
        && (entry.position === undefined || (Array.isArray(entry.position) && entry.position.length === 2
          && entry.position.every(position => typeof position === 'number' && Number.isFinite(position))));
    })));
  }

  /**
   * 解析单个段落结果
   */
  private static parseParaResult(
    para: Record<string, unknown>,
    settings?: UserSettings
  ): TranslationResult {
    const { phraseTranslationEnabled, grammarTranslationEnabled } = settings || {};

    const result: TranslationResult = {
      words: [],
      sentences: [],
      grammarPoints: [],
      fullText: para.fullText ? String(para.fullText) : undefined,
    };

    if (Array.isArray(para.words)) {
      result.words = para.words
        .map((w: Record<string, unknown>) => {
          const pos = Array.isArray(w.position) && w.position.length >= 2
            ? [Number(w.position[0]), Number(w.position[1])] as [number, number]
            : [0, 0] as [number, number];
          return {
            original: String(w.original || ''),
            translation: String(w.translation || ''),
            position: pos,
            difficulty: Number(w.difficulty) || 5,
            isPhrase: Boolean(w.isPhrase),
          };
        })
        // 如果禁用词组翻译，过滤掉短语
        .filter((w: { isPhrase: boolean }) => phraseTranslationEnabled !== false || !w.isPhrase);
    }

    if (Array.isArray(para.sentences)) {
      result.sentences = para.sentences.map((s: Record<string, unknown>) => ({
        original: String(s.original || ''),
        translation: String(s.translation || ''),
        grammarNote: s.grammarNote ? String(s.grammarNote) : undefined,
      }));
    }

    // 只有在启用语法翻译时才解析语法点
    if (grammarTranslationEnabled !== false && Array.isArray(para.grammarPoints)) {
      result.grammarPoints = para.grammarPoints.map((g: Record<string, unknown>) => ({
        original: String(g.original || ''),
        explanation: String(g.explanation || ''),
        type: String(g.type || '语法点'),
        position: Array.isArray(g.position) ? g.position as [number, number] : [0, 0],
      }));
    }

    return result;
  }

  /**
   * 创建空结果
   */
  private static createEmptyResult(): TranslationResult {
    return {
      words: [],
      sentences: [],
    };
  }

  /**
   * 将段落分批（根据配置限制）
   */
  static splitIntoBatches<T extends { text: string }>(
    paragraphs: T[],
    maxCharsPerBatch: number = DEFAULT_BATCH_CONFIG.maxCharsPerBatch
  ): T[][] {
    const batches: T[][] = [];
    let currentBatch: T[] = [];
    let currentChars = 0;

    for (const para of paragraphs) {
      const paraLength = para.text.length;

      // 检查是否需要开启新批次
      if (
        currentBatch.length >= DEFAULT_BATCH_CONFIG.maxParagraphsPerBatch ||
        currentChars + paraLength > maxCharsPerBatch
      ) {
        if (currentBatch.length > 0) {
          batches.push(currentBatch);
          currentBatch = [];
          currentChars = 0;
        }
      }

      currentBatch.push(para);
      currentChars += paraLength;
    }

    // 添加最后一批
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    logger.info(`BatchTranslationService: ${paragraphs.length} 个段落分为 ${batches.length} 批`);
    return batches;
  }
}
