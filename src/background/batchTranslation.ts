import type {
  BatchTranslationRequest,
  BatchTranslationResponse,
  BatchParagraphResult,
  TranslationResult,
  UserProfile,
  UserSettings,
} from '@/shared/types';
import {
  EXAM_DISPLAY_NAMES,
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
import { StorageManager } from './storage';
import { enhancedCache } from './enhancedCache';
import { frequencyManager } from './frequencyManager';
import { TranslationApiService } from './translationApi';

/**
 * 批量翻译的重试配置（比单段翻译稍长，因为请求更大）
 */
const BATCH_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1500,
  backoffMultiplier: 2,
  maxDelay: 20000,
  onRetry: (error, attempt, delay) => {
    logger.warn(
      `BatchTranslationService: API 调用失败，第 ${attempt} 次重试，等待 ${Math.round(delay)}ms`,
      error.message
    );
  },
};

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
   */
  static async translateBatch(
    request: BatchTranslationRequest
  ): Promise<BatchTranslationResponse> {
    const { paragraphs, mode, pageUrl } = request;

    logger.info(`BatchTranslationService: 收到批量翻译请求，${paragraphs.length} 个段落`);

    // 并行获取用户配置
    const [userProfile, settings, apiKey] = await Promise.all([
      request.userLevel || StorageManager.getUserProfile(),
      StorageManager.getSettings(),
      StorageManager.getApiKey(),
    ]);

    // 调试日志
    logger.info('BatchTranslationService: 配置信息', {
      hasApiKey: !!apiKey,
      apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + '...' : 'empty',
      activeApiConfigId: settings.activeApiConfigId,
      apiConfigsCount: settings.apiConfigs?.length || 0,
      apiProvider: settings.apiProvider,
    });

    if (!apiKey) {
      throw new Error('API key not configured. Please set your API key in settings.');
    }

    // 为每个段落生成缓存哈希
    const paragraphsWithHash = paragraphs.map((p) => ({
      ...p,
      textHash: enhancedCache.generateHash(p.text, mode),
    }));

    // 批量查询缓存
    const textHashes = paragraphsWithHash.map((p) => p.textHash);
    const { hits: cacheHits, misses: cacheMisses } = await enhancedCache.getBatch(textHashes);

    // 准备结果数组
    const results: BatchParagraphResult[] = [];

    // 添加缓存命中的结果
    for (const p of paragraphsWithHash) {
      const cachedResult = cacheHits.get(p.textHash);
      if (cachedResult) {
        results.push({
          id: p.id,
          result: cachedResult,
          cached: true,
        });
      }
    }

    // 获取需要翻译的段落
    let toTranslate = paragraphsWithHash.filter((p) => cacheMisses.includes(p.textHash));

    // 过滤掉中文占比过高的段落（>20%）
    // 同时也过滤掉本地判定为"太简单"的段落
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

      // 2. 本地静态过滤 (Local Static Filtering)
      // 优化：仅在"行内翻译"模式下进行生词过滤。
      // 在"全文翻译"或"双语对照"模式下，用户需要看到整段译文，即使没有生词也要翻译。
      if (mode === 'inline-only') {
        const hasPotentialUnknown = frequencyManager.hasPotentialUnknownWords(
          p.text,
          userProfile.estimatedVocabulary
        );

        if (!hasPotentialUnknown) {
          logger.info('BatchTranslationService: 跳过简单段落 (本地过滤)', p.id);
          skippedParagraphs.push({
            id: p.id,
            result: this.createEmptyResult(), // 返回空结果，即无高亮
            cached: false
          });
          return false;
        }
      }

      return true;
    });

    // 将跳过的结果加入结果集
    results.push(...skippedParagraphs);

    logger.info(`BatchTranslationService: 缓存命中 ${cacheHits.size} 个，跳过 ${skippedParagraphs.length} 个，需翻译 ${toTranslate.length} 个`);

    // 如果有需要翻译的段落，调用API
    if (toTranslate.length > 0) {
      const apiResults = await this.callBatchAPI(
        toTranslate,
        userProfile,
        settings,
        apiKey,
        mode
      );

      // 添加API翻译结果
      for (const [index, p] of toTranslate.entries()) {
        const result = apiResults[index] || this.createEmptyResult();
        results.push({
          id: p.id,
          result,
          cached: false,
        });

        // 缓存结果
        await enhancedCache.set(p.textHash, result, mode, pageUrl);
      }
    }

    // 按原始顺序排序结果 - 使用 Map 实现 O(1) 查找
    const resultsById = new Map(results.map(r => [r.id, r]));
    const orderedResults = paragraphs.map((p) =>
      resultsById.get(p.id) ?? { id: p.id, result: this.createEmptyResult(), cached: false }
    );

    return {
      results: orderedResults,
      apiCallCount: toTranslate.length > 0 ? 1 : 0,
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
    _mode: string
  ): Promise<TranslationResult[]> {
    // 构建带标记的段落文本
    const paragraphsText = paragraphs
      .map((p, index) => `[PARA_${index}]\n${normalizeText(p.text)}`)
      .join('\n\n');

    // 根据设置动态构建任务列表
    const { phraseTranslationEnabled, grammarTranslationEnabled } = settings;
    let taskList = '1. 单词（超出{exam_level}词汇范围的）\n';
    if (phraseTranslationEnabled) {
      taskList += '2. 短语/习语\n';
    }
    if (grammarTranslationEnabled) {
      taskList += `${phraseTranslationEnabled ? '3' : '2'}. 复杂语法结构（如倒装句、虚拟语气、复杂从句等）\n`;
    }

    // 动态构建 grammarPoints 字段说明
    const grammarPointsField = grammarTranslationEnabled
      ? `      "grammarPoints": [
        {
          "original": "语法结构原文片段",
          "explanation": "语法解释",
          "type": "语法类型（如：虚拟语气、倒装句、定语从句等）",
          "position": [起始位置, 结束位置]
        }
      ]`
      : '';

    const grammarNote = grammarTranslationEnabled
      ? '\n\n注意：grammarPoints 用于标注文本中的特殊语法结构，帮助学习者理解复杂语法。只有当段落中存在值得学习的语法点时才需要返回，普通简单句不需要标注。'
      : '';

    // 构建自定义提示词
    const customPrompt = `你是一个英语学习助手。用户的英语水平约为 {vocabulary_size} 词汇量（相当于{exam_level}水平）。

请分析以下多个英文段落（用 [PARA_n] 标记区分），找出每个段落中可能超出用户水平的：
${taskList}
对于每个识别出的内容，提供：
- 中文翻译
- 难度等级（1-10）

同时提供每个段落的完整中文翻译。

段落内容：
{paragraphs}

请以JSON格式返回结果，格式如下：
{
  "paragraphs": [
    {
      "id": "[PARA_n]中的n",
      "fullText": "该段落的完整中文翻译",
      "words": [
        {
          "original": "词汇原文",
          "translation": "中文翻译",
          "position": [起始位置, 结束位置],
          "difficulty": 难度等级1-10,
          "isPhrase": 是否为短语
        }
      ],
      "sentences": [
        {
          "original": "复杂句子原文",
          "translation": "中文翻译",
          "grammarNote": "语法说明（可选）"
        }
      ]${grammarTranslationEnabled ? ',' : ''}
${grammarPointsField}
    }
  ]
}${grammarNote}`;

    // 构建提示词
    const prompt = customPrompt
      .replace('{vocabulary_size}', userProfile.estimatedVocabulary.toString())
      .replace(/{exam_level}/g, EXAM_DISPLAY_NAMES[userProfile.examType])
      .replace('{paragraphs}', paragraphsText);

    logger.info('BatchTranslationService: 调用API，提示词长度:', prompt.length);

    // 使用统一 API 服务调用
    const response = await TranslationApiService.call(prompt, apiKey, settings, BATCH_RETRY_OPTIONS);

    // 解析响应
    return this.parseBatchResponse(response, paragraphs.length, settings);
  }

  /**
   * 解析批量翻译响应（增强鲁棒性）
   */
  private static parseBatchResponse(
    content: string,
    expectedCount: number,
    settings: UserSettings
  ): TranslationResult[] {
    try {
      // 1. 提取 JSON 内容 (使用共享工具)
      const jsonStr = extractJsonFromResponse(content);
      if (!jsonStr) {
        logger.error('BatchTranslationService: 无法从响应中提取 JSON');
        return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
      }

      // 2. 尝试解析并修复常见的 JSON 语法错误
      let parsed: Record<string, unknown> | unknown[];
      try {
        parsed = JSON.parse(jsonStr);
      } catch (e) {
        const repairedJson = repairMalformedJson(jsonStr);
        try {
          parsed = JSON.parse(repairedJson);
        } catch (repairedError) {
          logger.error('BatchTranslationService: JSON 解析失败且无法修复', repairedError);
          return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
        }
      }

      // 3. 验证基础结构
      if (!parsed || typeof parsed !== 'object') {
        return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
      }

      // 兼容不同的返回格式 (有些 LLM 可能会直接返回数组或包装在 data 中)
      const rawParagraphs = Array.isArray(parsed) 
        ? parsed 
        : (parsed.paragraphs || parsed.results || parsed.data || []);

      if (!Array.isArray(rawParagraphs)) {
        logger.error('BatchTranslationService: 响应中未找到有效的段落列表');
        return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
      }

      // 4. 建立索引 (通过 id 匹配)
      const resultsById = new Map<string, TranslationResult>();
      rawParagraphs.forEach((para: Record<string, unknown>, index: number) => {
        if (!para || typeof para !== 'object') return;

        // 尝试获取 ID，如果没提供 ID 则根据顺序猜测
        const id = para.id !== undefined ? String(para.id) : String(index);
        resultsById.set(id, this.parseParaResult(para, settings));
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
          // 如果按 ID 找不到，且返回的总数和预期一致，尝试按索引找
          const fallbackPara = rawParagraphs[i];
          if (fallbackPara && !resultsById.has(String(i))) {
             const fallbackResult = this.parseParaResult(fallbackPara, settings);
             finalResults.push(fallbackResult);
             foundCount++;
          } else {
             finalResults.push(this.createEmptyResult());
          }
        }
      }

      logger.info(`BatchTranslationService: 解析完成，成功挽救 ${foundCount}/${expectedCount} 个段落`);
      return finalResults;
    } catch (error) {
      logger.error('BatchTranslationService: 解析响应发生致命错误', error);
      return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
    }
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
  static splitIntoBatches(
    paragraphs: Array<{ id: string; text: string; elementPath: string }>
  ): Array<Array<{ id: string; text: string; elementPath: string }>> {
    const batches: Array<Array<{ id: string; text: string; elementPath: string }>> = [];
    let currentBatch: Array<{ id: string; text: string; elementPath: string }> = [];
    let currentChars = 0;

    for (const para of paragraphs) {
      const paraLength = para.text.length;

      // 检查是否需要开启新批次
      if (
        currentBatch.length >= DEFAULT_BATCH_CONFIG.maxParagraphsPerBatch ||
        currentChars + paraLength > DEFAULT_BATCH_CONFIG.maxCharsPerBatch
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
