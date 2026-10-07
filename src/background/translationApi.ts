import type { UserSettings } from '@/shared/types';
import { getProviderConfig, getChatEndpoint } from '@/shared/constants/providers';
import { ApiError, logger, type RetryOptions } from '@/shared/utils';
import { TransportError } from '@/shared/utils/translationErrors';
import { readTranslationStream, validateJsonTranslationCompletion, type TranslationStreamFormat } from './translationStream';
import {
  executeTransportRequest,
  resolveResponseFormat,
  boundedMaxTokens,
  TRANSPORT_DEFAULTS,
  type TranslationApiRequestOptions,
  type TransportRetryConfig,
} from '@/background/translationRequest';

// 对外透出传输层请求选项类型，方便调用方引用
export type { TranslationApiRequestOptions, ResponseFormatOption } from '@/background/translationRequest';

/**
 * 默认重试配置
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  initialDelay: 1000,
  backoffMultiplier: 2,
  maxDelay: 15000,
  onRetry: (error, attempt, delay) => {
    // 公共日志不输出错误详情（可能含 provider 回显内容），仅记录类别
    const kind = error instanceof TransportError ? error.kind : 'unknown';
    logger.warn(`TranslationApiService: API 调用失败，第 ${attempt} 次重试，等待 ${Math.round(delay)}ms`, { kind });
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
  /** 构建请求 body（options 提供超时/取消/响应格式/maxTokens 覆盖） */
  buildBody: (
    model: string,
    messages: Array<{ role: string; content: string }>,
    useJsonFormat: boolean,
    options?: TranslationApiRequestOptions
  ) => unknown;
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
 *
 * 传输能力（超时/取消/重试/脱敏）由 background/translationRequest 提供，
 * 通过各方法末尾的可选 options 参数透传。
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
      buildBody: (model, messages, useJsonFormat, options) => ({
        model,
        messages,
        temperature: 0.1,
        max_tokens: boundedMaxTokens(options?.maxTokens, 2000),
        ...(useJsonFormat ? { response_format: resolveResponseFormat(options, useJsonFormat) } : {}),
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
      buildBody: (model, messages, _useJsonFormat, options) => ({
        model,
        max_tokens: boundedMaxTokens(options?.maxTokens, 2000),
        messages,
      }),
      responseExtractor: anthropicExtractor,
    },
    gemini: {
      buildUrl: (endpoint, apiKey) => `${endpoint}?key=${apiKey}`,
      buildHeaders: () => ({
        'Content-Type': 'application/json',
      }),
      buildBody: (_model, messages, useJsonFormat, options) => ({
        contents: messages.map(m => ({
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: 0.1,
          // 纯文本请求使用有界 maxOutputTokens（旧固定 100 会截断长句）
          ...(useJsonFormat
            ? { responseMimeType: 'application/json' }
            : { maxOutputTokens: boundedMaxTokens(options?.maxTokens) }),
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
      buildBody: (model, messages, useJsonFormat, options) => ({
        model,
        messages,
        temperature: 0.1,
        // OpenAI 兼容端点参数：关闭 Qwen3 等思考型模型的思考阶段以降低延迟；
        // 非思考模型会忽略该参数。原生 think/format/keep_alive 属于 /api/chat，不能用于兼容端点。
        reasoning_effort: 'none',
        // OpenAI 兼容端点始终消费有界 max_tokens，JSON 请求同样受调用方预算约束。
        max_tokens: boundedMaxTokens(options?.maxTokens),
        ...(useJsonFormat ? { response_format: resolveResponseFormat(options, useJsonFormat) } : {}),
      }),
      responseExtractor: openAIExtractor,
    },
  };

  /**
   * 将共享 RetryOptions 适配为传输层重试配置
   */
  private static toTransportRetry(retryOptions: RetryOptions): TransportRetryConfig {
    return {
      maxRetries: retryOptions.maxRetries,
      initialDelay: retryOptions.initialDelay,
      backoffMultiplier: retryOptions.backoffMultiplier,
      maxDelay: retryOptions.maxDelay,
      onRetry: retryOptions.onRetry,
      shouldRetry: retryOptions.shouldRetry,
    };
  }

  /**
   * 按引擎类型取默认超时：本地 Ollama 冷加载（模型未驻留时）放宽；
   * Ollama 模型默认驻留约 5 分钟，并非每次请求都触发冷加载
   */
  private static resolveDefaultTimeoutMs(apiFormat: string): number {
    return apiFormat === 'ollama' ? TRANSPORT_DEFAULTS.localLlmTimeoutMs : TRANSPORT_DEFAULTS.llmTimeoutMs;
  }

  /** 快速翻译保留旧的空串降级，但取消与超时必须交给上层停止调用链。 */
  private static handleQuickTranslateFailure(error: unknown): string {
    if (error instanceof TransportError && (error.kind === 'cancelled' || error.kind === 'timeout')) {
      throw error;
    }
    return '';
  }

  /** 百度令牌读取缓存前也遵循调用方已取消的信号。 */
  private static throwIfAborted(options?: TranslationApiRequestOptions): void {
    if (options?.signal?.aborted) {
      throw TransportError.cancelled();
    }
  }

  /**
   * 调用 LLM API 进行翻译（使用内置系统提示词）
   * @deprecated 请使用 callWithSystem 以支持自定义系统提示词
   */
  static async call(
    prompt: string,
    apiKey: string,
    settings: UserSettings,
    retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    // 构建默认的系统提示词
    const defaultSystemPrompt = 'You are an English learning assistant. Always respond with valid JSON.';
    return this.callWithSystem(defaultSystemPrompt, prompt, apiKey, settings, retryOptions, options);
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
    retryOptions: RetryOptions = DEFAULT_RETRY_OPTIONS,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    const provider = settings.apiProvider;
    const config = getProviderConfig(provider);
    let apiFormat = config.apiFormat;

    const model = settings.customModelName || config.recommendedModel;
    const endpoint = getChatEndpoint(provider, model, settings.customApiUrl);

    logger.info(`TranslationApiService: 调用 ${config.name} API`, {
      provider,
      model,
      apiFormat,
      hasCustomApiUrl: Boolean(settings.customApiUrl),
    });

    const defaultTimeoutMs = TranslationApiService.resolveDefaultTimeoutMs(apiFormat);

    // 百度格式特殊处理（需要 access token）
    if (apiFormat === 'baidu') {
      return this.callBaiduFormatWithSystem(systemPrompt, userPrompt, apiKey, settings.secondaryApiKey || '', model, retryOptions, options);
    }

    // DeepL 格式特殊处理
    if (apiFormat === 'deepl') {
      return this.callDeepLFormat(systemPrompt, userPrompt, apiKey, endpoint, retryOptions, config.name, options);
    }

    // Google Translate 格式特殊处理（付费 Cloud API）
    if (apiFormat === 'google_translate') {
      return this.callGoogleTranslateFormat(systemPrompt, userPrompt, apiKey, endpoint, retryOptions, config.name, options);
    }

    // Google 翻译免费 Web 端点（无需 API Key）
    if (apiFormat === 'free_google_translate') {
      return this.callFreeGoogleTranslateFormat(systemPrompt, userPrompt, endpoint, retryOptions, options);
    }

    // 有道翻译 格式特殊处理
    if (apiFormat === 'youdao_translate') {
      return this.callYoudaoTranslateFormat(systemPrompt, userPrompt, apiKey, endpoint, retryOptions, config.name, options);
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
      config.name,
      options,
      defaultTimeoutMs
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
   * 传输层负责超时、取消、重试与错误脱敏；本方法只负责请求构建与响应提取
   */
  private static async executeApiCall(
    providerConfig: ProviderCallConfig,
    apiKey: string,
    endpoint: string,
    model: string,
    messages: Array<{ role: string; content: string }>,
    useJsonFormat: boolean,
    retryOptions: RetryOptions,
    providerName: string,
    options?: TranslationApiRequestOptions,
    defaultTimeoutMs: number = TRANSPORT_DEFAULTS.llmTimeoutMs
  ): Promise<string> {
    const stream = useJsonFormat && Boolean(options?.onTextDelta);
    const streamFormat: TranslationStreamFormat = providerConfig.responseExtractor === anthropicExtractor
      ? 'anthropic' : providerConfig.responseExtractor === geminiExtractor ? 'gemini' : 'openai';
    const requestEndpoint = stream && streamFormat === 'gemini'
      ? endpoint.replace(':generateContent', ':streamGenerateContent') : endpoint;
    const url = providerConfig.buildUrl(requestEndpoint, apiKey) + (stream && streamFormat === 'gemini' ? '&alt=sse' : '');
    const headers = providerConfig.buildHeaders(apiKey);
    const originalBody = providerConfig.buildBody(model, messages, useJsonFormat, options);
    const body = stream && streamFormat !== 'gemini' ? { ...originalBody as object, stream: true } : originalBody;
    // 服务端错误可能回显请求原文，把用户提示词加入脱敏列表
    const lastUserContent = messages[messages.length - 1]?.content;
    const onSuccess = (data: unknown): string => {
      validateJsonTranslationCompletion(data, streamFormat);
      if (!providerConfig.responseExtractor.isValid(data)) {
        throw TransportError.unavailable(`${providerName} API 返回格式无效`);
      }
      const content = providerConfig.responseExtractor.extractContent(data);
      if (typeof content !== 'string' || !content.trim()) {
        throw TransportError.unavailable(`${providerName} API 返回空响应`);
      }
      return content;
    };

    return executeTransportRequest(
      url,
      { method: 'POST', headers, body: JSON.stringify(body) },
      {
        timeoutMs: options?.timeoutMs ?? defaultTimeoutMs,
        signal: options?.signal,
        secrets: [apiKey],
        redactTexts: lastUserContent ? [lastUserContent] : undefined,
        retry: TranslationApiService.toTransportRetry(retryOptions),
        extractErrorMessage: providerConfig.responseExtractor.extractError,
        onAttemptStart: stream ? options?.onStreamStart : undefined,
        readResponse: stream ? async (response, signal) => {
          if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
            return onSuccess(await response.json());
          }
          return readTranslationStream(response, signal, streamFormat, options!.onTextDelta!);
        } : undefined,
        onSuccess,
      }
    );
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
    providerName: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    // DeepL 使用 POST 请求，格式为 x-www-form-urlencoded
    const params = new URLSearchParams();
    params.append('text', userPrompt);
    params.append('target_lang', 'ZH');
    params.append('source_lang', 'EN');

    return executeTransportRequest(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        secrets: [apiKey],
        redactTexts: [userPrompt],
        retry: TranslationApiService.toTransportRetry(retryOptions),
        extractErrorMessage: deeplExtractor.extractError,
        onSuccess: (data) => {
          if (!deeplExtractor.isValid(data)) {
            throw TransportError.unavailable(`${providerName} API 返回格式无效`);
          }

          const content = deeplExtractor.extractContent(data);
          if (!content) {
            throw TransportError.unavailable(`${providerName} API 返回空响应`);
          }

          return content;
        },
      }
    );
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
    providerName: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    // Google Translate API 需要在 URL 中传递 key
    const url = new URL(endpoint);
    url.searchParams.append('key', apiKey);

    return executeTransportRequest(
      url.toString(),
      {
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
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        secrets: [apiKey],
        redactTexts: [userPrompt],
        retry: TranslationApiService.toTransportRetry(retryOptions),
        extractErrorMessage: googleTranslateExtractor.extractError,
        onSuccess: (data) => {
          if (!googleTranslateExtractor.isValid(data)) {
            throw TransportError.unavailable(`${providerName} API 返回格式无效`);
          }

          const content = googleTranslateExtractor.extractContent(data);
          if (!content) {
            throw TransportError.unavailable(`${providerName} API 返回空响应`);
          }

          return content;
        },
      }
    );
  }

  /**
   * 调用 Google 翻译免费 Web 端点（无需 API Key）
   * 使用 translate.googleapis.com/translate_a/single 接口
   */
  private static async callFreeGoogleTranslateFormat(
    _systemPrompt: string,
    userPrompt: string,
    endpoint: string,
    retryOptions: RetryOptions,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    const url = new URL(endpoint);
    url.searchParams.append('client', 'gtx');
    url.searchParams.append('sl', 'en');
    url.searchParams.append('tl', 'zh-CN');
    url.searchParams.append('dt', 't');
    url.searchParams.append('q', userPrompt);

    return executeTransportRequest(
      url.toString(),
      { method: 'GET' },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        redactTexts: [userPrompt],
        retry: TranslationApiService.toTransportRetry(retryOptions),
        onSuccess: (data) => {
          // 响应格式: [[[["译文","原文",null,null,3]],null,"en",...]
          if (!Array.isArray(data) || !Array.isArray(data[0])) {
            throw TransportError.unavailable('Google 翻译免费端点返回格式无效');
          }

          // 从嵌套数组中提取翻译结果
          const sentences: string[] = [];
          for (const sentenceGroup of data[0]) {
            if (Array.isArray(sentenceGroup) && typeof sentenceGroup[0] === 'string') {
              sentences.push(sentenceGroup[0]);
            }
          }

          const content = sentences.join('');
          if (!content) {
            throw TransportError.unavailable('Google 翻译免费端点返回空响应');
          }

          return content;
        },
      }
    );
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
    providerName: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
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

    return executeTransportRequest(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        secrets: [appSecret],
        redactTexts: [userPrompt],
        retry: TranslationApiService.toTransportRetry(retryOptions),
        onSuccess: (data) => {
          if (!youdaoExtractor.isValid(data)) {
            const errorMsg = youdaoExtractor.extractError?.(data);
            throw TransportError.unavailable(errorMsg || `${providerName} API 返回格式无效`);
          }

          const content = youdaoExtractor.extractContent(data);
          if (!content) {
            throw TransportError.unavailable(`${providerName} API 返回空响应`);
          }

          return content;
        },
      }
    );
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
    retryOptions: RetryOptions,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    if (!secretKey) {
      throw new Error('百度文心需要 Secret Key');
    }

    const accessToken = await this.getBaiduAccessToken(apiKey, secretKey, options);
    const chatUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${accessToken}`;

    // 百度格式：将系统提示词与用户提示词合并
    const combinedPrompt = `${systemPrompt}\n\n${userPrompt}`;

    return executeTransportRequest(
      chatUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: combinedPrompt,
            },
          ],
          temperature: 0.1,
        }),
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.llmTimeoutMs,
        signal: options?.signal,
        secrets: [apiKey, secretKey, accessToken],
        redactTexts: [combinedPrompt],
        retry: TranslationApiService.toTransportRetry(retryOptions),
        extractErrorMessage: (data) => (data as BaiduResponse).error_msg,
        onSuccess: (data) => {
          const d = data as BaiduResponse;

          // 检查百度 API 错误
          if (d.error_code) {
            // token 过期，清除缓存后重试
            if (d.error_code === 110 || d.error_code === 111) {
              TranslationApiService.baiduTokenCache = null;
            }
            // message 由传输层重建为固定 public 文案；error_code 与 error_msg 原文降级为 detail，由传输层统一脱敏
            throw new TransportError('unavailable', `百度 API 错误 (code ${d.error_code})`, {
              detail: `error_code ${d.error_code}: ${d.error_msg}`,
            });
          }

          if (!d.result) {
            throw TransportError.unavailable('百度 API 返回空响应');
          }

          return d.result;
        },
      }
    );
  }

  /**
   * 获取百度 access token（带缓存）
   */
  private static async getBaiduAccessToken(
    apiKey: string,
    secretKey: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    TranslationApiService.throwIfAborted(options);

    // 检查缓存是否有效（提前 5 分钟过期）
    if (TranslationApiService.baiduTokenCache && TranslationApiService.baiduTokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return TranslationApiService.baiduTokenCache.token;
    }

    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;
    const requestedTimeoutMs = options?.timeoutMs;
    const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs && requestedTimeoutMs > 0
      ? Math.min(requestedTimeoutMs, TRANSPORT_DEFAULTS.legacyEngineTimeoutMs)
      : TRANSPORT_DEFAULTS.legacyEngineTimeoutMs;

    return executeTransportRequest(
      tokenUrl,
      { method: 'POST' },
      {
        timeoutMs,
        signal: options?.signal,
        secrets: [apiKey, secretKey],
        onSuccess: (data) => {
          const tokenData = data as BaiduTokenResponse;
          if (!tokenData?.access_token) {
            throw TransportError.unavailable('获取百度 access token 失败');
          }

          TranslationApiService.baiduTokenCache = {
            token: tokenData.access_token,
            expiresAt: Date.now() + (tokenData.expires_in || 2592000) * 1000,
          };

          return tokenData.access_token;
        },
      }
    );
  }

  /**
   * 快速翻译单个词/短语（不使用 JSON 格式）
   */
  static async quickTranslate(
    text: string,
    apiKey: string,
    settings: UserSettings,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    const provider = settings.apiProvider;
    const config = getProviderConfig(provider);
    const apiFormat = config.apiFormat;
    const model = settings.customModelName || config.recommendedModel;
    const endpoint = getChatEndpoint(provider, model, settings.customApiUrl);

    // DeepL 快速翻译
    if (apiFormat === 'deepl') {
      return this.quickTranslateDeepL(text, apiKey, endpoint, config.name, options);
    }

    // Google Translate 快速翻译
    if (apiFormat === 'google_translate') {
      return this.quickTranslateGoogle(text, apiKey, endpoint, config.name, options);
    }

    // Google 翻译免费端点 快速翻译
    if (apiFormat === 'free_google_translate') {
      return this.quickTranslateFreeGoogle(text, endpoint, options);
    }

    // 有道翻译 快速翻译
    if (apiFormat === 'youdao_translate') {
      return this.quickTranslateYoudao(text, apiKey, endpoint, config.name, options);
    }

    const prompt = `Translate the following English word or phrase to Chinese. Only respond with the translation, nothing else.\n\n${text}`;

    // 百度格式特殊处理
    if (apiFormat === 'baidu') {
      return this.quickTranslateBaidu(prompt, apiKey, settings.secondaryApiKey || '', model, options);
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
      config.name,
      options,
      TranslationApiService.resolveDefaultTimeoutMs(apiFormat)
    ).catch((error: unknown) => this.handleQuickTranslateFailure(error)); // 快速翻译失败时返回空字符串
  }

  /**
   * 快速翻译 - 支持自定义系统提示词
   * 用于混合翻译中的LLM分析场景
   */
  static async quickTranslateWithSystem(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    settings: UserSettings,
    options?: TranslationApiRequestOptions
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
        model,
        options
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
      config.name,
      options,
      TranslationApiService.resolveDefaultTimeoutMs(apiFormat)
    ).catch((error: unknown) => this.handleQuickTranslateFailure(error)); // 快速翻译失败时返回空字符串
  }

  /**
   * 快速翻译 - DeepL 格式
   */
  private static async quickTranslateDeepL(
    text: string,
    apiKey: string,
    endpoint: string,
    _providerName: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    const params = new URLSearchParams();
    params.append('text', text);
    params.append('target_lang', 'ZH');
    params.append('source_lang', 'EN');

    return executeTransportRequest(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        secrets: [apiKey],
        redactTexts: [text],
        retry: TranslationApiService.toTransportRetry(QUICK_RETRY_OPTIONS),
        onSuccess: (data) => deeplExtractor.extractContent(data) || '',
      }
    ).catch((error: unknown) => this.handleQuickTranslateFailure(error));
  }

  /**
   * 快速翻译 - Google Translate 格式
   */
  private static async quickTranslateGoogle(
    text: string,
    apiKey: string,
    endpoint: string,
    _providerName: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    const url = new URL(endpoint);
    url.searchParams.append('key', apiKey);

    return executeTransportRequest(
      url.toString(),
      {
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
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        secrets: [apiKey],
        redactTexts: [text],
        retry: TranslationApiService.toTransportRetry(QUICK_RETRY_OPTIONS),
        onSuccess: (data) => googleTranslateExtractor.extractContent(data) || '',
      }
    ).catch((error: unknown) => this.handleQuickTranslateFailure(error));
  }

  /**
   * 快速翻译 - Google 翻译免费端点（无需 API Key）
   */
  private static async quickTranslateFreeGoogle(
    text: string,
    endpoint: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    const url = new URL(endpoint);
    url.searchParams.append('client', 'gtx');
    url.searchParams.append('sl', 'en');
    url.searchParams.append('tl', 'zh-CN');
    url.searchParams.append('dt', 't');
    url.searchParams.append('q', text);

    return executeTransportRequest(
      url.toString(),
      { method: 'GET' },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        redactTexts: [text],
        retry: TranslationApiService.toTransportRetry(QUICK_RETRY_OPTIONS),
        onSuccess: (data) => {
          if (!Array.isArray(data) || !Array.isArray(data[0])) {
            // 快速翻译路径容错：格式无效直接返回空串
            return '';
          }

          const sentences: string[] = [];
          for (const sentenceGroup of data[0]) {
            if (Array.isArray(sentenceGroup) && typeof sentenceGroup[0] === 'string') {
              sentences.push(sentenceGroup[0]);
            }
          }

          return sentences.join('');
        },
      }
    ).catch((error: unknown) => this.handleQuickTranslateFailure(error));
  }

  /**
   * 快速翻译 - 百度格式（特殊处理）
   */
  private static async quickTranslateBaidu(
    prompt: string,
    apiKey: string,
    secretKey: string,
    model: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
    const accessToken = await this.getBaiduAccessToken(apiKey, secretKey, options);
    const chatUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${accessToken}`;

    return executeTransportRequest(
      chatUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.llmTimeoutMs,
        signal: options?.signal,
        secrets: [apiKey, secretKey, accessToken],
        redactTexts: [prompt],
        retry: TranslationApiService.toTransportRetry(QUICK_RETRY_OPTIONS),
        onSuccess: (data) => (data as BaiduResponse).result || '',
      }
    ).catch((error: unknown) => this.handleQuickTranslateFailure(error));
  }

  /**
   * 快速翻译 - 有道格式
   * 有道API需要appKey和appSecret进行签名
   */
  private static async quickTranslateYoudao(
    text: string,
    appKey: string,
    endpoint: string,
    _providerName: string,
    options?: TranslationApiRequestOptions
  ): Promise<string> {
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

    return executeTransportRequest(
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
      {
        timeoutMs: options?.timeoutMs ?? TRANSPORT_DEFAULTS.legacyEngineTimeoutMs,
        signal: options?.signal,
        secrets: [appSecret],
        redactTexts: [text],
        retry: TranslationApiService.toTransportRetry(QUICK_RETRY_OPTIONS),
        onSuccess: (data) => {
          const d = data as YoudaoResponse;

          if (d.errorCode && d.errorCode !== '0') {
            // 业务错误码不自动重试
            throw new TransportError('unavailable', `有道翻译错误: ${d.errorCode}`, { retryable: false });
          }

          return d.translation?.[0] || '';
        },
      }
    ).catch((error: unknown) => this.handleQuickTranslateFailure(error));
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
