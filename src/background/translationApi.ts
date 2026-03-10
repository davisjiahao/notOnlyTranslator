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
 * API 错误响应类型
 */
interface ApiErrorResponse {
  error?: {
    message?: string;
  };
}

/**
 * OpenAI 格式 API 响应
 */
interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

/**
 * Anthropic 格式 API 响应
 */
interface AnthropicResponse {
  content?: Array<{
    text?: string;
  }>;
}

/**
 * Gemini 格式 API 响应
 */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}

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

let baiduTokenCache: BaiduTokenCache | null = null;

/**
 * 类型守卫函数
 */
function isOpenAIResponse(data: unknown): data is OpenAIResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'choices' in data &&
    Array.isArray((data as OpenAIResponse).choices)
  );
}

function isAnthropicResponse(data: unknown): data is AnthropicResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'content' in data &&
    Array.isArray((data as AnthropicResponse).content)
  );
}

function isGeminiResponse(data: unknown): data is GeminiResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'candidates' in data &&
    Array.isArray((data as GeminiResponse).candidates)
  );
}

function getErrorMessage(errorData: unknown): string | undefined {
  if (typeof errorData !== 'object' || errorData === null) {
    return undefined;
  }
  const data = errorData as ApiErrorResponse;
  return data.error?.message;
}

function isBaiduTokenResponse(data: unknown): data is BaiduTokenResponse {
  return typeof data === 'object' && data !== null && 'access_token' in data;
}

function isBaiduResponse(data: unknown): data is BaiduResponse {
  return typeof data === 'object' && data !== null;
}

function getBaiduErrorMessage(errorData: unknown): string | undefined {
  if (typeof errorData !== 'object' || errorData === null) {
    return undefined;
  }
  const data = errorData as { error_msg?: string };
  return data.error_msg;
}

/**
 * 统一 API 调用服务
 * 支持多种 API 格式：OpenAI、Anthropic、Gemini、DashScope、百度
 */
export class TranslationApiService {
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
    const apiFormat = config.apiFormat;

    // 获取模型名称
    const model = settings.customModelName || config.recommendedModel;

    // 获取 API 端点
    const endpoint = getChatEndpoint(provider, model, settings.customApiUrl);

    logger.info(`TranslationApiService: 调用 ${config.name} API`, {
      provider,
      model,
      endpoint: endpoint.substring(0, 50) + '...',
      apiFormat,
    });

    switch (apiFormat) {
      case 'openai':
        return this.callOpenAIFormat(prompt, apiKey, model, endpoint, retryOptions);
      case 'anthropic':
        return this.callAnthropicFormat(prompt, apiKey, model, endpoint, retryOptions);
      case 'gemini':
        return this.callGeminiFormat(prompt, apiKey, model, endpoint, retryOptions);
      case 'dashscope':
        return this.callDashScopeFormat(prompt, apiKey, model, endpoint, retryOptions);
      case 'baidu':
        return this.callBaiduFormat(
          prompt,
          apiKey,
          settings.secondaryApiKey || '',
          model,
          retryOptions
        );
      case 'ollama':
        return this.callOllamaFormat(prompt, apiKey, model, endpoint, retryOptions);
      default:
        throw new Error(`不支持的 API 格式: ${apiFormat}`);
    }
  }

  /**
   * 调用 OpenAI 格式 API
   * 适用于：OpenAI、Groq、DeepSeek、智谱、自定义兼容 API
   */
  private static async callOpenAIFormat(
    prompt: string,
    apiKey: string,
    model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
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
        const errorMessage =
          getErrorMessage(errorData) ||
          `API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!isOpenAIResponse(data)) {
        throw new ApiError('API 返回格式无效', undefined, true);
      }

      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new ApiError('API 返回空响应', undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 调用 Anthropic 格式 API
   */
  private static async callAnthropicFormat(
    prompt: string,
    apiKey: string,
    model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
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
        const errorMessage =
          getErrorMessage(errorData) ||
          `Anthropic API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!isAnthropicResponse(data)) {
        throw new ApiError('Anthropic API 返回格式无效', undefined, true);
      }

      const content = data.content?.[0]?.text;

      if (!content) {
        throw new ApiError('Anthropic API 返回空响应', undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 调用 Gemini 格式 API
   * 注意：model 参数未使用，因为 Gemini 的端点 URL 已经包含了模型名
   */
  private static async callGeminiFormat(
    prompt: string,
    apiKey: string,
    _model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    // Gemini 使用 URL 参数传递 API Key，模型名已在 endpoint 中
    const urlWithKey = `${endpoint}?key=${apiKey}`;

    return retryWithBackoff(async () => {
      const response = await fetch(urlWithKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: 'You are an English learning assistant. Always respond with valid JSON.\n\n' + prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          getErrorMessage(errorData) ||
          `Gemini API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!isGeminiResponse(data)) {
        throw new ApiError('Gemini API 返回格式无效', undefined, true);
      }

      const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!content) {
        throw new ApiError('Gemini API 返回空响应', undefined, true);
      }

      return content;
    }, retryOptions);
  }

  /**
   * 调用 DashScope 格式 API（阿里通义）
   * 实际使用 OpenAI 兼容模式
   */
  private static async callDashScopeFormat(
    prompt: string,
    apiKey: string,
    model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    // 阿里通义的兼容模式实际上就是 OpenAI 格式
    return this.callOpenAIFormat(prompt, apiKey, model, endpoint, retryOptions);
  }

  /**
   * 调用 Ollama API（使用 OpenAI 兼容格式）
   * 使用 /v1/chat/completions 端点，避免 CORS 问题
   */
  private static async callOllamaFormat(
    prompt: string,
    _apiKey: string,
    model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Ollama 的 OpenAI 兼容 API 不需要认证，但需要提供 Authorization 头
          'Authorization': 'Bearer ollama',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an English learning assistant. Always respond with valid JSON only, no markdown formatting.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          // 注意：Ollama 的 OpenAI 兼容 API 不支持 response_format 参数
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          getErrorMessage(errorData) ||
          `Ollama API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();
      // OpenAI 兼容格式响应：{ choices: [{ message: { content: "..." } }] }

      if (!isOpenAIResponse(data)) {
        throw new ApiError('Ollama API 返回格式无效', undefined, true);
      }

      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new ApiError('Ollama API 返回空响应', undefined, true);
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

    // 获取 access token（带缓存）
    const accessToken = await this.getBaiduAccessToken(apiKey, secretKey);

    const chatUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${accessToken}`;

    return retryWithBackoff(async () => {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content:
                'You are an English learning assistant. Always respond with valid JSON.\n\n' + prompt,
            },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          getBaiduErrorMessage(errorData) ||
          `百度 API 请求失败 (${response.status})`;
        throw new ApiError(errorMessage, response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!isBaiduResponse(data)) {
        throw new ApiError('百度 API 返回格式无效', undefined, true);
      }

      // 检查百度 API 错误
      if (data.error_code) {
        // 如果是 token 过期错误，清除缓存
        if (data.error_code === 110 || data.error_code === 111) {
          baiduTokenCache = null;
        }
        throw new ApiError(
          data.error_msg || `百度 API 错误 (${data.error_code})`,
          undefined,
          true
        );
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
    if (baiduTokenCache && baiduTokenCache.expiresAt > Date.now() + 5 * 60 * 1000) {
      return baiduTokenCache.token;
    }

    const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${apiKey}&client_secret=${secretKey}`;

    const response = await fetch(tokenUrl, { method: 'POST' });

    if (!response.ok) {
      throw new Error('获取百度 access token 失败');
    }

    const data = await response.json();

    if (!isBaiduTokenResponse(data)) {
      throw new Error('获取百度 access token 失败：响应格式无效');
    }

    if (!data.access_token) {
      throw new Error(data.error || '获取百度 access token 失败');
    }

    // 缓存 token
    baiduTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 2592000) * 1000,
    };

    return data.access_token;
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
    const model = settings.customModelName || config.recommendedModel;
    const endpoint = getChatEndpoint(provider, model, settings.customApiUrl);

    const prompt = `Translate the following English word or phrase to Chinese. Only respond with the translation, nothing else.\n\n${text}`;

    const quickRetryOptions: RetryOptions = {
      maxRetries: 2,
      initialDelay: 500,
      backoffMultiplier: 2,
      maxDelay: 5000,
    };

    // 根据 API 格式调用
    switch (config.apiFormat) {
      case 'anthropic':
        return this.quickTranslateAnthropic(prompt, apiKey, model, endpoint, quickRetryOptions);
      case 'gemini':
        return this.quickTranslateGemini(prompt, apiKey, endpoint, quickRetryOptions);
      case 'baidu':
        return this.quickTranslateBaidu(prompt, apiKey, settings.secondaryApiKey || '', model, quickRetryOptions);
      case 'ollama':
        return this.quickTranslateOllama(prompt, apiKey, model, endpoint, quickRetryOptions);
      default:
        // OpenAI 兼容格式
        return this.quickTranslateOpenAI(prompt, apiKey, model, endpoint, quickRetryOptions);
    }
  }

  /**
   * 快速翻译 - OpenAI 格式
   */
  private static async quickTranslateOpenAI(
    prompt: string,
    apiKey: string,
    model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 100,
        }),
      });

      if (!response.ok) {
        throw new ApiError('翻译请求失败', response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!isOpenAIResponse(data)) {
        return '';
      }

      return data.choices?.[0]?.message?.content || '';
    }, retryOptions);
  }

  /**
   * 快速翻译 - Anthropic 格式
   */
  private static async quickTranslateAnthropic(
    prompt: string,
    apiKey: string,
    model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new ApiError('翻译请求失败', response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!isAnthropicResponse(data)) {
        return '';
      }

      return data.content?.[0]?.text || '';
    }, retryOptions);
  }

  /**
   * 快速翻译 - Gemini 格式
   */
  private static async quickTranslateGemini(
    prompt: string,
    apiKey: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    // Gemini endpoint 已经包含模型名，直接使用
    const urlWithKey = `${endpoint}?key=${apiKey}`;

    return retryWithBackoff(async () => {
      const response = await fetch(urlWithKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 100 },
        }),
      });

      if (!response.ok) {
        throw new ApiError('翻译请求失败', response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();

      if (!isGeminiResponse(data)) {
        return '';
      }

      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }, retryOptions);
  }

  /**
   * 快速翻译 - 百度格式
   */
  private static async quickTranslateBaidu(
    prompt: string,
    apiKey: string,
    secretKey: string,
    model: string,
    retryOptions: RetryOptions
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

      const data = await response.json();

      if (!isBaiduResponse(data)) {
        return '';
      }

      return data.result || '';
    }, retryOptions);
  }

  /**
   * 快速翻译 - Ollama（使用 OpenAI 兼容格式）
   */
  private static async quickTranslateOllama(
    prompt: string,
    _apiKey: string,
    model: string,
    endpoint: string,
    retryOptions: RetryOptions
  ): Promise<string> {
    return retryWithBackoff(async () => {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ollama',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 100,
        }),
      });

      if (!response.ok) {
        throw new ApiError('翻译请求失败', response.status, response.status >= 500 || response.status === 429);
      }

      const data = await response.json();
      // OpenAI 兼容格式响应

      if (!isOpenAIResponse(data)) {
        return '';
      }

      return data.choices?.[0]?.message?.content || '';
    }, retryOptions);
  }
}
