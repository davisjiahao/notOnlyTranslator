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
import { normalizeText } from '@/shared/utils';
import { StorageManager } from './storage';
import { enhancedCache } from './enhancedCache';

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
    const toTranslate = paragraphsWithHash.filter((p) => cacheMisses.includes(p.textHash));

    console.log(`BatchTranslationService: 缓存命中 ${cacheHits.size} 个，需翻译 ${toTranslate.length} 个`);

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
   * 调用OpenAI API
   */
  private static async callOpenAI(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    const apiUrl = settings.customApiUrl || API_ENDPOINTS.OPENAI;
    const modelName = settings.customModelName || 'gpt-4o-mini';

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
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API request failed');
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  /**
   * 调用Anthropic API
   */
  private static async callAnthropic(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    const apiUrl = settings.customApiUrl || API_ENDPOINTS.ANTHROPIC;
    const modelName = settings.customModelName || 'claude-3-haiku-20240307';

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
      const error = await response.json();
      throw new Error(error.error?.message || 'Anthropic API request failed');
    }

    const data = await response.json();
    return data.content[0]?.text || '';
  }

  /**
   * 调用自定义API
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

    const response = await fetch(settings.customApiUrl, {
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
      throw new Error(`Custom API request failed: ${errorText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
  }

  /**
   * 解析批量翻译响应
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

      const parsed = JSON.parse(jsonStr.trim());

      // 验证响应格式
      if (!parsed.paragraphs || !Array.isArray(parsed.paragraphs)) {
        console.error('BatchTranslationService: 响应格式无效，缺少paragraphs数组');
        return Array(expectedCount).fill(null).map(() => this.createEmptyResult());
      }

      // 转换为TranslationResult数组
      const results: TranslationResult[] = [];

      for (let i = 0; i < expectedCount; i++) {
        const para = parsed.paragraphs.find(
          (p: Record<string, unknown>) => String(p.id) === String(i)
        );

        if (para) {
          results.push(this.parseParaResult(para));
        } else {
          results.push(this.createEmptyResult());
        }
      }

      console.log(`BatchTranslationService: 解析完成，${results.length} 个结果`);
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
