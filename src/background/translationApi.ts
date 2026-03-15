import type { UserSettings } from '@/shared/types';
import { getProviderConfig, getChatEndpoint } from '@/shared/constants/providers';
import { retryWithBackoff, ApiError, logger, type RetryOptions } from '@/shared/utils';

/**
 * 默认重试配置
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 15000,
  onRetry: (error, attempt, delay) => {
    logger.warn(
      `TranslationApiService: API 调用失败，第 ${attempt} 次重试，等待 ${Math.round(delay)}ms`,
      error.message
    );
  },
};

/**
 * 快速翻译重试配置
 */
const QUICK_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  initialDelay: 500,
  backoffMultiplier: 2,
  maxDelay: 5000,
};

/**
 * API 错误响应类型
 */
interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

/**
 * Provider 响应提取配置
 */
interface ProviderResponseExtractor {
  /** 检查响应是否有效 */
  isValid: (data: unknown) => boolean;
  /** 从响应中提取内容 */
  extractContent: (data: unknown) => string | undefined;
  /** 从错误响应中提取错误信息 */
  extractError?: (data: unknown) => string | undefined;
}

/**
 * Provider API 调用配置
 */
interface ProviderCallConfig {
  /** 构建请求 URL */
  buildUrl: (endpoint: string, apiKey: string) => string;
  /** 构建请求 headers */
  buildHeaders: (apiKey: string) => Record<string, string>;
  /** 构建请求 body */
  buildBody: (model: string, messages: Array<{ role: string; content: string }>, useJsonFormat: boolean) => unknown;
  /** 响应提取器 */
  responseExtractor: ProviderResponseExtractor;
}

/**
 * OpenAI 格式响应提取器
 */
const openAIExtractor: ProviderResponseExtractor = {
  isValid: (data): data is { choices?: Array<{ message?: { content?: string } }> } => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'choices' in data &&
      Array.isArray((data as { choices?: unknown }).choices)
    );
  },
  extractContent: (data) => {
    const d = data as { choices?: Array<{ message?: { content?: string } }> };
    return d.choices?.[0]?.message?.content;
  },
  extractError: (data) => {
    if (typeof data !== 'object' || data === null) return undefined;
    return (data as ApiErrorResponse).error?.message;
  },
};

/**
 * Anthropic 格式响应提取器
 */
const anthropicExtractor: ProviderResponseExtractor = {
  isValid: (data): data is { content?: Array<{ text?: string }> } => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'content' in data &&
      Array.isArray((data as { content?: unknown }).content)
    );
  },
  extractContent: (data) => {
    const d = data as { content?: Array<{ text?: string }> };
    return d.content?.[0]?.text;
  },
};

/**
 * Gemini 格式响应提取器
 */
const geminiExtractor: ProviderResponseExtractor = {
  isValid: (data): data is { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'candidates' in data &&
      Array.isArray((data as { candidates?: unknown }).candidates)
    );
  },
  extractContent: (data) => {
    const d = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return d.candidates?.[0]?.content?.parts?.[0]?.text;
  },
};

/**
 * 百度 Token 响应类型
 */
interface BaiduTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

/**
 * 百度 API 响应类型
 */
interface BaiduResponse {
  result?: string;
  error_code?: number;
  error_msg?: string;
}

/**
 * 百度 access token 缓存
 */
interface BaiduTokenCache {
  token: string;
  expiresAt: number;
}

/**
 * 统一 API 调用服务
 * 支持多种 API 格式：OpenAI、Anthropic、Gemini、DashScope、百度
 */
export class TranslationApiService {
  /** 百度 access token 缓存（类静态成员，避免模块级别可变状态） */
  private static baiduTokenCache: BaiduTokenCache | null = null;

  /**
   * Provider API 配置映射
   */
  private static readonly PROVIDER_CONFIGS: Record<string, ProviderCallConfig> = {
    openai: {
      buildUrl: (endpoint) => endpoint,
      buildHeaders: (apiKey) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      }),
      buildBody: (model, messages, useJsonFormat) => ({
        model,
        messages,
        temperature: 0.3,
        ...(useJsonFormat ? { response_format: { type: 'json_object' } } : {}),
      }),
      responseExtractor: openAIExtractor,
    },
    anthropic: {
      buildUrl: (endpoint) => endpoint,
      buildHeaders: (apiKey) => ({
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      }),
      buildBody: (model, messages) => ({
        model,
        max_tokens: 4096,
        messages,
      }),
      responseExtractor: anthropicExtractor,
    },
    gemini: {
      buildUrl: (endpoint, apiKey) => `${endpoint}?key=${apiKey}`,
      buildHeaders: () => ({
        'Content-Type': 'application/json',
      }),
      buildBody: (_model, messages, useJsonFormat) => ({
        contents: messages.map(m => ({
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: 0.3,
          ...(useJsonFormat ? { responseMimeType: 'application/json' } : { maxOutputTokens: 100 }),
        },
      }),
      responseExtractor: geminiExtractor,
    },
    ollama: {
      buildUrl: (endpoint) => endpoint,
      buildHeaders: () => ({
        'Content-Type': 'application/json',
        Authorization: 'Bearer ollama',
      }),
      buildBody: (model, messages, useJsonFormat) => ({
        model,
        messages,
        temperature: 0.3,
        ...(useJsonFormat ? {} : { max_tokens: 100 }),
      }),
      responseExtractor: openAIExtractor,
    },
  };

  /**
   * 调用 LLM API 进行翻译
   */
  static async call(
    prompt: string,
    apiKey: string,
    settings: UserSettings,
    retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
  ): Promise<string> {
    const provider = settings.apiProvider;
    const config = getProviderConfig(provider);
    let apiFormat = config.apiFormat;

    const model = settings.customModelName || config.recommendedModel;
    const endpoint = getChatEndpoint(provider, model, settings.customApiUrl);

    logger.info(`TranslationApiService: 调用 ${config.name} API`, {
      provider,
      model,
      endpoint: endpoint.substring(0, 50) + '...',
      apiFormat,
    });

    // 百度格式特殊处理（需要 access token）
    if (apiFormat === 'baidu') {
      return this.callBaiduFormat(prompt, apiKey, settings.secondaryApiKey || '', model, retryOptions);
    }

    // DashScope 直接使用 OpenAI 兼容格式
    if (apiFormat === 'dashscope') {
      apiFormat = 'openai';
    }

    const providerConfig = this.PROVIDER_CONFIGS[apiFormat];
    if (!providerConfig) {
      throw new Error(`不支持的 API 格式: ${apiFormat}`);
    }

    // 准备消息
    const systemMessage = apiFormat === 'gemini'
      ? 'You are an English learning assistant. Always respond with valid JSON.\n\n' + prompt
      : 'You are an English learning assistant. Always respond with valid JSON.';

    const messages = apiFormat === 'anthropic'
      ? [{ role: 'user', content: prompt + '\n\nPlease respond with valid JSON only.' }]
      : [
          { role: 'system', content: systemMessage },
          { role: 'user', content: prompt },
        ];

    return this.executeApiCall(
      providerConfig,
      apiKey,
      endpoint,
      model,
      messages,
      true,
      retryOptions,
      config.name
    );
  }

  /**
   * 执行统一的 API 调用
   */
  private static async executeApiCall(
    providerConfig: ProviderCallConfig,
    apiKey: string,
    endpoint: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    useJsonFormat: boolean,
    retryOptions: RetryOptions,
    providerName: string
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const url = providerConfig.buildUrl(endpoint, apiKey);
      const headers = providerConfig.buildHeaders(apiKey);
      const body = providerConfig.buildBody(model, messages, useJsonFormat);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          providerConfig.responseExtractor.extractError?.(errorData) ||
          `${providerName} API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!providerConfig.responseExtractor.isValid(data)) {
        throw new ApiError(`${providerName} API 返回格式无效`, undefined, true);
      }

      const content = providerConfig.responseExtractor.extractContent(data);
      if (!content) {
        throw new ApiError(`${providerName} API 返回空响应`, undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 调用百度文心 API
   * 需要先获取 access token
   */
  private static async callBaiduFormat(
    prompt: string,
    apiKey: string,
    secretKey: string,
    model: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    if (!secretKey) {
      throw new Error('百度文心需要 Secret Key');
    }

    const accessToken = await this.getBaiduAccessToken(apiKey, secretKey);
    const chatUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${accessToken}`;

    return retryWithBackoff(async () => {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: 'You are an English learning assistant. Always respond with valid JSON.\n\n' + prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = (errorData as BaiduResponse).error_msg;
        throw new ApiError(errorMsg || `百度 API 请求失败 (${response.status})`, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json() as BaiduResponse;

      // 检查百度 API 错误
      if (data.error_code) {
        // token 过期，清除缓存后重试
        if (data.error_code === 110 || data.error_code === 111) {
          TranslationApiService.baiduTokenCache = null;
        }
        throw new ApiError(data.error_msg || `百度 API 错误 (${data.error_code})`, undefined, true);
      }

      const content = data.result;
      if (!content) {
        throw new ApiError('百度 API 返回空响应', undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 获取百度 access token（带缓存）
   */
  private static async getBaiduAccessToken(apiKey: string, secretKey: string): Promise<string> {
    // 检查缓存是否有效（提前 5 分钟过期）
    if (TranslationApiService.baiduTokenCache && TranslationApiService.baiduTokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return TranslationApiService.baiduTokenCache.token;
    }

    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;

    const response = await fetch(tokenUrl, { method: 'POST' });

    if (!response.ok) {
      throw new Error('获取百度 access token 失败');
    }

    const data = await response.json();

    if (!data || typeof data !== 'object' || !('access_token' in data)) {
      throw new Error('获取百度 access token 失败：响应格式无效');
    }

    const tokenData = data as BaiduTokenResponse;
    if (!tokenData.access_token) {
      throw new Error(tokenData.error || '获取百度 access token 失败');
    }

    // 缓存 token
    TranslationApiService.baiduTokenCache = {
      token: tokenData.access_token,
      expiresAt: Date.now() + (tokenData.expires_in || 2592000) * 1000,
    };

    return tokenData.access_token;
  }

  /**
   * 快速翻译单个词/短语（不使用 JSON 格式）
   */
  static async quickTranslate(
    text: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    const provider = settings.apiProvider;
    const config = getProviderConfig(provider);
    const apiFormat = config.apiFormat;
    const model = settings.customModelName || config.recommendedModel;
    const endpoint = getChatEndpoint(provider, model, settings.customApiUrl);

    const prompt = `Translate the following English word or phrase to Chinese. Only respond with the translation, nothing else.\n\n${text}`;

    // 百度格式特殊处理
    if (apiFormat === 'baidu') {
      return this.quickTranslateBaidu(prompt, apiKey, settings.secondaryApiKey || '', model);
    }

    // DashScope 使用 OpenAI 兼容格式
    const actualFormat = apiFormat === 'dashscope' ? 'openai' : apiFormat;
    const providerConfig = this.PROVIDER_CONFIGS[actualFormat];

    if (!providerConfig) {
      throw new Error(`不支持的 API 格式: ${apiFormat}`);
    }

    // 快速翻译使用简单消息格式
    const messages = [{ role: 'user', content: prompt }];

    return this.executeApiCall(
      providerConfig,
      apiKey,
      endpoint,
      model,
      messages,
      false, // 不使用 JSON 格式
      QUICK_RETRY_OPTIONS,
      config.name
    ).catch(() => ''); // 快速翻译失败时返回空字符串
  }

  /**
   * 快速翻译 - 百度格式（特殊处理）
   */
  private static async quickTranslateBaidu(
    prompt: string,
    apiKey: string,
    secretKey: string,
    model: string
  ): Promise<string> {
    const accessToken = await this.getBaiduAccessToken(apiKey, secretKey);
    const chatUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${accessToken}`;

    return retryWithBackoff(async () => {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new ApiError('翻译请求失败', response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json() as BaiduResponse;
      return data.result || '';
    }, QUICK_RETRY_OPTIONS).catch(() => '');
  }
}
