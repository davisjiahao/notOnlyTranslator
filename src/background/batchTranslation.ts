import type {
  BatchTranslationRequest,
  BatchTranslationResponse,
  BatchParagraphResult,
  TranslationResult,
  UserProfile,
  UserSettings,
} from '@/shared/types';
import {
  BATCH_TRANSLATION_PROMPT_TEMPLATE,
  EXAM_DISPLAY_NAMES,
  API_ENDPOINTS,
  DEFAULT_BATCH_CONFIG,
} from '@/shared/constants';
import {
  normalizeText,
  getChineseRatio,
  retryWithBackoff,
  ApiError,
  type RetryOptions,
} from '@/shared/utils';
import { StorageManager } from './storage';
import { enhancedCache } from './enhancedCache';
import { frequencyManager } from './frequencyManager';

/**
 * 批量翻译的重试配置（比单段翻译稍长，因为请求更大）
 */
const BATCH_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1500,
  backoffMultiplier: 2,
  maxDelay: 20000,
  onRetry: (error, attempt, delay) => {
    console.warn(
      `BatchTranslationService: API 调用失败，第 ${attempt} 次重试，等待 ${Math.round(delay)}ms`,
      error.message
    );
  },
};

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

    console.log(`BatchTranslationService: 收到批量翻译请求，${paragraphs.length} 个段落`);

    // 获取用户配置
    const userProfile = request.userLevel || (await StorageManager.getUserProfile());
    const settings = await StorageManager.getSettings();
    const apiKey = await StorageManager.getApiKey();

    // 调试日志
    console.log('BatchTranslationService: 配置信息', {
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
      // 1. 检查中文占比
      const chineseRatio = getChineseRatio(p.text);
      if (chineseRatio > 0.2) {
        console.log(`BatchTranslationService: 跳过中文占比过高的段落 (${(chineseRatio * 100).toFixed(1)}%)`, p.id);
        skippedParagraphs.push({
          id: p.id,
          result: this.createEmptyResult(),
          cached: false
        });
        return false;
      }

      // 2. 本地静态过滤 (Local Static Filtering)
      // 如果段落中所有单词都在用户的舒适区内，则跳过 API 调用
      // 注意：这假设用户不需要"全文翻译"功能，只需要"生词高亮"
      const hasPotentialUnknown = frequencyManager.hasPotentialUnknownWords(
        p.text,
        userProfile.estimatedVocabulary
      );

      if (!hasPotentialUnknown) {
        console.log('BatchTranslationService: 跳过简单段落 (本地过滤)', p.id);
        skippedParagraphs.push({
          id: p.id,
          result: this.createEmptyResult(), // 返回空结果，即无高亮
          cached: false
        });
        return false;
      }

      return true;
    });

    // 将跳过的结果加入结果集
    results.push(...skippedParagraphs);

    console.log(`BatchTranslationService: 缓存命中 ${cacheHits.size} 个，跳过 ${skippedParagraphs.length} 个，需翻译 ${toTranslate.length} 个`);

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

    // 按原始顺序排序结果
    const orderedResults = paragraphs.map((p) => {
      const found = results.find((r) => r.id === p.id);
      return found || { id: p.id, result: this.createEmptyResult(), cached: false };
    });

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

    // 构建提示词
    const prompt = BATCH_TRANSLATION_PROMPT_TEMPLATE
      .replace('{vocabulary_size}', userProfile.estimatedVocabulary.toString())
      .replace(/{exam_level}/g, EXAM_DISPLAY_NAMES[userProfile.examType])
      .replace('{paragraphs}', paragraphsText);

    console.log('BatchTranslationService: 调用API，提示词长度:', prompt.length);

    // 根据API提供商调用
    let response: string;
    if (settings.apiProvider === 'openai') {
      response = await this.callOpenAI(prompt, apiKey, settings);
    } else if (settings.apiProvider === 'anthropic') {
      response = await this.callAnthropic(prompt, apiKey, settings);
    } else if (settings.apiProvider === 'custom') {
      response = await this.callCustomAPI(prompt, apiKey, settings);
    } else {
      throw new Error('Invalid API provider');
    }

    // 解析响应
    return this.parseBatchResponse(response, paragraphs.length);
  }

  /**
   * 调用OpenAI API（带重试机制）
   */
  private static async callOpenAI(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    const apiUrl = settings.customApiUrl || API_ENDPOINTS.OPENAI;
    const modelName = settings.customModelName || 'gpt-4o-mini';

    return retryWithBackoff(async () => {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: 'You are an English learning assistant. Always respond with valid JSON.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `OpenAI API request failed (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new ApiError('Empty response from OpenAI', undefined, true);
      }

      return content;
    }, BATCH_RETRY_OPTIONS);
  }

  /**
   * 调用Anthropic API（带重试机制）
   */
  private static async callAnthropic(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    const apiUrl = settings.customApiUrl || API_ENDPOINTS.ANTHROPIC;
    const modelName = settings.customModelName || 'claude-3-haiku-20240307';

    return retryWithBackoff(async () => {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 8192,
          messages: [
            {
              role: 'user',
              content: prompt + '\n\nPlease respond with valid JSON only.',
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || `Anthropic API request failed (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();
      const content = data.content[0]?.text;

      if (!content) {
        throw new ApiError('Empty response from Anthropic', undefined, true);
      }

      return content;
    }, BATCH_RETRY_OPTIONS);
  }

  /**
   * 调用自定义API（带重试机制）
   */
  private static async callCustomAPI(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    if (!settings.customApiUrl) {
      throw new Error('Custom API URL not configured');
    }

    const modelName = settings.customModelName || 'gpt-3.5-turbo';

    return retryWithBackoff(async () => {
      const response = await fetch(settings.customApiUrl!, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: 'You are an English learning assistant. Always respond with valid JSON.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ApiError(
          `Custom API request failed: ${errorText}`,
          response.status,
          response.status >= 500 || response.status === 429
        );
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || data.content?.[0]?.text;

      if (!content) {
        throw new ApiError('Empty response from custom API', undefined, true);
      }

      return content;
    }, BATCH_RETRY_OPTIONS);
  }

  /**
   * 解析批量翻译响应（增强校验）
   *
   * 校验内容：
   * - JSON 格式有效性
   * - paragraphs 数组存在性
   * - 段落 ID 完整性检查
   * - 段落内容有效性校验
   */
  private static parseBatchResponse(
    content: string,
    expectedCount: number
  ): TranslationResult[] {
    try {
      // 提取JSON（处理可能的markdown包装）
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      // 尝试解析 JSON
      let parsed: { paragraphs?: unknown[] };
      try {
        parsed = JSON.parse(jsonStr.trim());
      } catch (parseError) {
        console.error('BatchTranslationService: JSON 解析失败', parseError);
        console.error('BatchTranslationService: 原始响应内容:', content.substring(0, 500));
        return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
      }

      // 验证响应格式
      if (!parsed.paragraphs || !Array.isArray(parsed.paragraphs)) {
        console.error('BatchTranslationService: 响应格式无效，缺少 paragraphs 数组');
        console.error('BatchTranslationService: 响应结构:', Object.keys(parsed));
        return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
      }

      // 收集返回的段落 ID
      const returnedIds = new Set<string>();
      const paragraphsById = new Map<string, Record<string, unknown>>();

      for (const para of parsed.paragraphs) {
        if (para && typeof para === 'object' && 'id' in para) {
          const id = String((para as Record<string, unknown>).id);
          returnedIds.add(id);
          paragraphsById.set(id, para as Record<string, unknown>);
        }
      }

      // 检查缺失的段落 ID
      const missingIds: string[] = [];
      for (let i = 0; i < expectedCount; i++) {
        if (!returnedIds.has(String(i))) {
          missingIds.push(String(i));
        }
      }

      if (missingIds.length > 0) {
        console.warn(
          `BatchTranslationService: 响应中缺少 ${missingIds.length} 个段落`,
          `缺失 ID: [${missingIds.join(', ')}]`,
          `期望 ${expectedCount} 个，实际返回 ${returnedIds.size} 个`
        );
      }

      // 检查多余的段落 ID（可能是 LLM 幻觉）
      const extraIds = Array.from(returnedIds).filter(
        id => parseInt(id, 10) >= expectedCount || parseInt(id, 10) < 0 || isNaN(parseInt(id, 10))
      );
      if (extraIds.length > 0) {
        console.warn(
          `BatchTranslationService: 响应中包含无效/多余的段落 ID: [${extraIds.join(', ')}]`
        );
      }

      // 转换为 TranslationResult 数组
      const results: TranslationResult[] = [];
      let successCount = 0;
      let emptyCount = 0;

      for (let i = 0; i < expectedCount; i++) {
        const para = paragraphsById.get(String(i));

        if (para) {
          const result = this.parseParaResult(para);
          results.push(result);

          // 统计有效结果
          if (result.words.length > 0 || result.fullText) {
            successCount++;
          } else {
            emptyCount++;
          }
        } else {
          results.push(this.createEmptyResult());
          emptyCount++;
        }
      }

      // 输出详细的解析统计
      console.log(
        `BatchTranslationService: 解析完成`,
        `总计 ${expectedCount} 个段落`,
        `成功 ${successCount} 个`,
        `空结果 ${emptyCount} 个`,
        `缺失 ${missingIds.length} 个`
      );

      return results;
    } catch (error) {
      console.error('BatchTranslationService: 解析响应失败', error);
      return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
    }
  }

  /**
   * 解析单个段落结果
   */
  private static parseParaResult(para: Record<string, unknown>): TranslationResult {
    const result: TranslationResult = {
      words: [],
      sentences: [],
      grammarPoints: [],
      fullText: para.fullText ? String(para.fullText) : undefined,
    };

    if (Array.isArray(para.words)) {
      result.words = para.words.map((w: Record<string, unknown>) => ({
        original: String(w.original || ''),
        translation: String(w.translation || ''),
        position: Array.isArray(w.position) ? w.position as [number, number] : [0, 0],
        difficulty: Number(w.difficulty) || 5,
        isPhrase: Boolean(w.isPhrase),
      }));
    }

    if (Array.isArray(para.sentences)) {
      result.sentences = para.sentences.map((s: Record<string, unknown>) => ({
        original: String(s.original || ''),
        translation: String(s.translation || ''),
        grammarNote: s.grammarNote ? String(s.grammarNote) : undefined,
      }));
    }

    if (Array.isArray(para.grammarPoints)) {
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

    console.log(`BatchTranslationService: ${paragraphs.length} 个段落分为 ${batches.length} 批`);
    return batches;
  }
}
