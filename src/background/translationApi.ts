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
 * DeepL 翻译响应类型
 */
interface DeepLTranslation {
  text?: string;
  detected_source_language?: string;
}

interface DeepLResponse {
  translations?: DeepLTranslation[];
  message?: string;
}

/**
 * DeepL 格式响应提取器
 */
const deeplExtractor: ProviderResponseExtractor = {
  isValid: (data): data is DeepLResponse => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'translations' in data &&
      Array.isArray((data as DeepLResponse).translations)
    );
  },
  extractContent: (data) => {
    const d = data as DeepLResponse;
    return d.translations?.[0]?.text;
  },
  extractError: (data) => {
    if (typeof data !== 'object' || data === null) return undefined;
    return (data as DeepLResponse).message;
  },
};

/**
 * Google Translate 响应类型
 */
interface GoogleTranslation {
  translatedText?: string;
  detectedSourceLanguage?: string;
}

interface GoogleTranslateResponse {
  data?: {
    translations?: GoogleTranslation[];
  };
  error?: {
    message?: string;
  };
}

/**
 * Google Translate 格式响应提取器
 */
const googleTranslateExtractor: ProviderResponseExtractor = {
  isValid: (data): data is GoogleTranslateResponse => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'data' in data &&
      typeof (data as GoogleTranslateResponse).data === 'object'
    );
  },
  extractContent: (data) => {
    const d = data as GoogleTranslateResponse;
    return d.data?.translations?.[0]?.translatedText;
  },
  extractError: (data) => {
    if (typeof data !== 'object' || data === null) return undefined;
    return (data as GoogleTranslateResponse).error?.message;
  },
};

/**
 * 有道翻译响应类型
 */
interface YoudaoResponse {
  translation?: string[];
  query?: string;
  errorCode?: string;
}

/**
 * 有道翻译格式响应提取器
 */
const youdaoExtractor: ProviderResponseExtractor = {
  isValid: (data): data is YoudaoResponse => {
    return (
      typeof data === 'object' &&
      data !== null &&
      'translation' in data &&
      Array.isArray((data as YoudaoResponse).translation)
    );
  },
  extractContent: (data) => {
    const d = data as YoudaoResponse;
    return d.translation?.[0];
  },
  extractError: (data) => {
    if (typeof data !== 'object' || data === null) return undefined;
    const d = data as YoudaoResponse;
    if (d.errorCode && d.errorCode !== '0') {
      return `有道翻译错误: ${d.errorCode}`;
    }
    return undefined;
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
   * 调用 LLM API 进行翻译（使用内置系统提示词）
   * @deprecated 请使用 callWithSystem 以支持自定义系统提示词
   */
  static async call(
    prompt: string,
    apiKey: string,
    settings: UserSettings,
    retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS
  ): Promise<string> {
    // 构建默认的系统提示词
    const defaultSystemPrompt = 'You are an English learning assistant. Always respond with valid JSON.';
    return this.callWithSystem(defaultSystemPrompt, prompt, apiKey, settings, retryOptions);
  }

  /**
   * 调用 LLM API 进行翻译（使用自定义系统提示词）
   * 这是新的主要调用方法，支持通过 TranslationPromptBuilder 构建的自定义提示词
   */
  static async callWithSystem(
    systemPrompt: string,
    userPrompt: string,
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
      return this.callBaiduFormatWithSystem(systemPrompt, userPrompt, apiKey, settings.secondaryApiKey || '', model, retryOptions);
    }

    // DeepL 格式特殊处理
    if (apiFormat === 'deepl') {
      return this.callDeepLFormat(systemPrompt, userPrompt, apiKey, endpoint, retryOptions, config.name);
    }

    // Google Translate 格式特殊处理
    if (apiFormat === 'google_translate') {
      return this.callGoogleTranslateFormat(systemPrompt, userPrompt, apiKey, endpoint, retryOptions, config.name);
    }

    // 有道翻译 格式特殊处理
    if (apiFormat === 'youdao_translate') {
      return this.callYoudaoTranslateFormat(systemPrompt, userPrompt, apiKey, endpoint, retryOptions, config.name);
    }

    // DashScope 直接使用 OpenAI 兼容格式
    if (apiFormat === 'dashscope') {
      apiFormat = 'openai';
    }

    const providerConfig = this.PROVIDER_CONFIGS[apiFormat];
    if (!providerConfig) {
      throw new Error(`不支持的 API 格式: ${apiFormat}`);
    }

    // 准备消息 - 根据不同 API 格式处理系统提示词
    const messages = this.buildMessages(apiFormat, systemPrompt, userPrompt);

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
   * 根据不同 API 格式构建消息数组
   */
  private static buildMessages(
    apiFormat: string,
    systemPrompt: string,
    userPrompt: string
  ): Array<{ role: string; content: string }> {
    switch (apiFormat) {
      case 'anthropic':
        // Anthropic: 不支持 system 消息，将系统提示词与用户提示词合并
        return [{
          role: 'user',
          content: `${systemPrompt}\n\n${userPrompt}\n\nPlease respond with valid JSON only.`
        }];

      case 'gemini':
        // Gemini: 在系统提示词末尾添加 JSON 要求，然后与用户提示词合并
        return [{
          role: 'user',
          content: `${systemPrompt}\n\nAlways respond with valid JSON.\n\n${userPrompt}`
        }];

      case 'ollama':
      case 'openai':
      default:
        // OpenAI 兼容格式：使用标准的 system + user 消息结构
        return [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ];
    }
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
   * 调用 DeepL API 进行翻译
   * DeepL 是一个直接的翻译服务，不需要 messages 格式
   */
  private static async callDeepLFormat(
    _systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    endpoint: string,
    retryOptions: RetryOptions,
    providerName: string
  ): Promise<string> {
    return retryWithBackoff(async () => {
      // DeepL 使用 POST 请求，格式为 x-www-form-urlencoded
      const params = new URLSearchParams();
      params.append('text', userPrompt);
      params.append('target_lang', 'ZH');
      params.append('source_lang', 'EN');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = deeplExtractor.extractError?.(errorData) ||
          `${providerName} API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!deeplExtractor.isValid(data)) {
        throw new ApiError(`${providerName} API 返回格式无效`, undefined, true);
      }

      const content = deeplExtractor.extractContent(data);
      if (!content) {
        throw new ApiError(`${providerName} API 返回空响应`, undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 调用 Google Translate API 进行翻译
   * Google Translate 使用 JSON 格式请求
   */
  private static async callGoogleTranslateFormat(
    _systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    endpoint: string,
    retryOptions: RetryOptions,
    providerName: string
  ): Promise<string> {
    return retryWithBackoff(async () => {
      // Google Translate API 需要在 URL 中传递 key
      const url = new URL(endpoint);
      url.searchParams.append('key', apiKey);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: userPrompt,
          source: 'en',
          target: 'zh',
          format: 'text',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = googleTranslateExtractor.extractError?.(errorData) ||
          `${providerName} API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!googleTranslateExtractor.isValid(data)) {
        throw new ApiError(`${providerName} API 返回格式无效`, undefined, true);
      }

      const content = googleTranslateExtractor.extractContent(data);
      if (!content) {
        throw new ApiError(`${providerName} API 返回空响应`, undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 调用有道翻译 API 进行翻译
   * 有道翻译使用签名验证机制
   */
  private static async callYoudaoTranslateFormat(
    _systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    endpoint: string,
    retryOptions: RetryOptions,
    providerName: string
  ): Promise<string> {
    return retryWithBackoff(async () => {
      // 有道API使用 appKey + appSecret 签名机制
      // 注意：settings中存储的 apiKey 格式为 "appKey:appSecret"
      const [appKey, appSecret] = apiKey.split(':');

      if (!appKey || !appSecret) {
        throw new ApiError('有道翻译需要 appKey:appSecret 格式的API密钥', undefined, false);
      }

      const salt = Date.now().toString();
      const curtime = Math.round(Date.now() / 1000).toString();
      const sign = await this.generateYoudaoSign(appKey, appSecret, userPrompt, salt, curtime);

      const params = new URLSearchParams();
      params.append('q', userPrompt);
      params.append('from', 'en');
      params.append('to', 'zh-CHS');
      params.append('appKey', appKey);
      params.append('salt', salt);
      params.append('sign', sign);
      params.append('signType', 'v3');
      params.append('curtime', curtime);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new ApiError(`${providerName} API 请求失败 (${response.status})`, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!youdaoExtractor.isValid(data)) {
        const errorMsg = youdaoExtractor.extractError?.(data);
        throw new ApiError(errorMsg || `${providerName} API 返回格式无效`, undefined, true);
      }

      const content = youdaoExtractor.extractContent(data);
      if (!content) {
        throw new ApiError(`${providerName} API 返回空响应`, undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 调用百度文心 API（使用自定义系统提示词）
   * 需要先获取 access token
   */
  private static async callBaiduFormatWithSystem(
    systemPrompt: string,
    userPrompt: string,
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

    // 百度格式：将系统提示词与用户提示词合并
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

    return retryWithBackoff(async () => {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: combinedPrompt,
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

    // DeepL 快速翻译
    if (apiFormat === 'deepl') {
      return this.quickTranslateDeepL(text, apiKey, endpoint, config.name);
    }

    // Google Translate 快速翻译
    if (apiFormat === 'google_translate') {
      return this.quickTranslateGoogle(text, apiKey, endpoint, config.name);
    }

    // 有道翻译 快速翻译
    if (apiFormat === 'youdao_translate') {
      return this.quickTranslateYoudao(text, apiKey, endpoint, config.name);
    }

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
   * 快速翻译 - 支持自定义系统提示词
   * 用于混合翻译中的LLM分析场景
   */
  static async quickTranslateWithSystem(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    const provider = settings.apiProvider;
    const config = getProviderConfig(provider);
    let apiFormat = config.apiFormat;
    const model = settings.customModelName || config.recommendedModel;
    const endpoint = getChatEndpoint(provider, model, settings.customApiUrl);

    // 百度格式特殊处理
    if (apiFormat === 'baidu') {
      return this.quickTranslateBaidu(
        `${systemPrompt}\n\n${userPrompt}`,
        apiKey,
        settings.secondaryApiKey || '',
        model
      );
    }

    // DashScope 使用 OpenAI 兼容格式
    if (apiFormat === 'dashscope') {
      apiFormat = 'openai';
    }

    const providerConfig = this.PROVIDER_CONFIGS[apiFormat];
    if (!providerConfig) {
      throw new Error(`不支持的 API 格式: ${apiFormat}`);
    }

    // 根据API格式构建消息
    const messages = this.buildMessages(apiFormat, systemPrompt, userPrompt);

    return this.executeApiCall(
      providerConfig,
      apiKey,
      endpoint,
      model,
      messages,
      false, // 快速翻译不使用 JSON 格式
      QUICK_RETRY_OPTIONS,
      config.name
    ).catch(() => ''); // 快速翻译失败时返回空字符串
  }

  /**
   * 快速翻译 - DeepL 格式
   */
  private static async quickTranslateDeepL(
    text: string,
    apiKey: string,
    endpoint: string,
    providerName: string
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const params = new URLSearchParams();
      params.append('text', text);
      params.append('target_lang', 'ZH');
      params.append('source_lang', 'EN');

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new ApiError(`${providerName} API 请求失败 (${response.status})`, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json() as DeepLResponse;
      return data.translations?.[0]?.text || '';
    }, QUICK_RETRY_OPTIONS).catch(() => '');
  }

  /**
   * 快速翻译 - Google Translate 格式
   */
  private static async quickTranslateGoogle(
    text: string,
    apiKey: string,
    endpoint: string,
    providerName: string
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const url = new URL(endpoint);
      url.searchParams.append('key', apiKey);

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          q: text,
          source: 'en',
          target: 'zh',
          format: 'text',
        }),
      });

      if (!response.ok) {
        throw new ApiError(`${providerName} API 请求失败 (${response.status})`, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json() as GoogleTranslateResponse;
      return data.data?.translations?.[0]?.translatedText || '';
    }, QUICK_RETRY_OPTIONS).catch(() => '');
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

  /**
   * 快速翻译 - 有道格式
   * 有道API需要appKey和appSecret进行签名
   */
  private static async quickTranslateYoudao(
    text: string,
    appKey: string,
    endpoint: string,
    providerName: string
  ): Promise<string> {
    return retryWithBackoff(async () => {
      // 有道API使用 appKey + appSecret 签名机制
      // 注意：settings中存储的 apiKey 格式为 "appKey:appSecret"
      const [actualAppKey, appSecret] = appKey.split(':');

      if (!actualAppKey || !appSecret) {
        throw new ApiError('有道翻译需要 appKey:appSecret 格式的API密钥', undefined, false);
      }

      const salt = Date.now().toString();
      const curtime = Math.round(Date.now() / 1000).toString();
      const sign = await this.generateYoudaoSign(actualAppKey, appSecret, text, salt, curtime);

      const params = new URLSearchParams();
      params.append('q', text);
      params.append('from', 'en');
      params.append('to', 'zh-CHS');
      params.append('appKey', actualAppKey);
      params.append('salt', salt);
      params.append('sign', sign);
      params.append('signType', 'v3');
      params.append('curtime', curtime);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        throw new ApiError(`${providerName} API 请求失败 (${response.status})`, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json() as YoudaoResponse;

      if (data.errorCode && data.errorCode !== '0') {
        throw new ApiError(`有道翻译错误: ${data.errorCode}`, undefined, false);
      }

      return data.translation?.[0] || '';
    }, QUICK_RETRY_OPTIONS).catch(() => '');
  }

  /**
   * 生成有道API签名
   * 签名规则：sha256(appKey + truncate(q) + salt + curtime + appSecret)
   */
  private static async generateYoudaoSign(
    appKey: string,
    appSecret: string,
    q: string,
    salt: string,
    curtime: string
  ): Promise<string> {
    const truncate = (str: string): string => {
      if (str.length <= 20) return str;
      return str.substring(0, 10) + str.length + str.substring(str.length - 10);
    };

    const str = appKey + truncate(q) + salt + curtime + appSecret;

    // 使用 Web Crypto API 生成 SHA-256 哈希
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
