/**
 * 翻译传输层
 *
 * 职责：
 * - 可配置超时：AbortController 覆盖 fetch 连接与响应 body 读取全过程
 * - 支持调用方 AbortSignal；已取消/超时后不盲重试
 * - 重试等待可被 signal 中断
 * - 错误信息脱敏（不泄露 API Key / 请求原文），并区分 timeout / cancelled / unavailable
 *
 * 仅使用各服务的公开 HTTP 接口参数，不依赖任何原生端点专有字段。
 */

import { TransportError } from '@/shared/utils/translationErrors';
import { logger } from '@/shared/utils/logger';

/**
 * 传输层默认常量（集中管理）
 */
export const TRANSPORT_DEFAULTS = {
  /** 云端 LLM 默认单次尝试总超时（毫秒） */
  llmTimeoutMs: 60_000,
  /** 本地 Ollama 默认单次尝试总超时：模型冷加载（未驻留时）可能较慢，故放宽；
   *  Ollama 模型默认驻留约 5 分钟，并非每次请求都触发冷加载 */
  localLlmTimeoutMs: 90_000,
  /** 传统翻译引擎（DeepL/Google/有道/百度）默认单次尝试总超时 */
  legacyEngineTimeoutMs: 15_000,
  /** 纯文本翻译默认 max_tokens：替代旧固定值 100，避免长句截断 */
  defaultTextMaxTokens: 1024,
  /** max_tokens 允许下界 */
  minTokens: 128,
  /** max_tokens 允许上界 */
  maxTokens: 4096,
} as const;

/**
 * OpenAI 兼容接口的 response_format 选项
 */
export type ResponseFormatOption =
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown> } };

/**
 * 翻译 API 请求选项
 * 以可选参数追加在 call / callWithSystem / quickTranslate 等方法签名末尾
 */
export interface TranslationApiRequestOptions {
  /** 调用方取消信号：中止后不重试，错误 kind 为 'cancelled' */
  signal?: AbortSignal;
  /** 单次尝试总超时（毫秒），未指定时按引擎类型取 TRANSPORT_DEFAULTS */
  timeoutMs?: number;
  /** OpenAI 兼容接口的 response_format（仅 JSON 模式生效），默认 { type: 'json_object' }；
   *  Anthropic/Gemini/百度等私有格式不适用，将被忽略 */
  responseFormat?: ResponseFormatOption;
  /** 覆盖默认 max_tokens，自动收敛到 [TRANSPORT_DEFAULTS.minTokens, maxTokens] */
  maxTokens?: number;
  /** 每次尝试开始前重置增量解析状态。 */
  onStreamStart?: () => void;
  /** 提供此回调时，批量 LLM 请求启用流式响应。 */
  onTextDelta?: (delta: string) => void;
}

/**
 * 传输层重试配置
 */
export interface TransportRetryConfig {
  /** 最大重试次数（不含首次），默认 0 */
  maxRetries?: number;
  /** 初始等待（毫秒），默认 500 */
  initialDelay?: number;
  /** 退避倍数，默认 2 */
  backoffMultiplier?: number;
  /** 最大等待（毫秒），默认 5000 */
  maxDelay?: number;
  /** 重试回调 */
  onRetry?: (error: TransportError, attempt: number, delay: number) => void;
  /** 调用方自定义重试判定；返回 false 时不再重试 */
  shouldRetry?: (error: Error, attempt: number) => boolean;
}

/**
 * 计算 response_format：仅在 JSON 模式下返回
 */
export function resolveResponseFormat(
  options: TranslationApiRequestOptions | undefined,
  useJsonFormat: boolean
): ResponseFormatOption | undefined {
  if (!useJsonFormat) {
    return undefined;
  }
  return options?.responseFormat ?? { type: 'json_object' };
}

/**
 * max_tokens 有界化：非法值回退 fallback，越界值收敛到上下界
 */
export function boundedMaxTokens(
  requested: number | undefined,
  fallback: number = TRANSPORT_DEFAULTS.defaultTextMaxTokens
): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return fallback;
  }
  return Math.min(Math.max(Math.round(requested), TRANSPORT_DEFAULTS.minTokens), TRANSPORT_DEFAULTS.maxTokens);
}

/**
 * 错误信息脱敏：抹去敏感串、Bearer 令牌与 key 查询参数
 */
export function sanitizeErrorMessage(message: string, secrets: Array<string | undefined> = []): string {
  let safe = message;
  for (const secret of secrets) {
    // 过短的串（如 Ollama 占位值之外的单词）不做全文替换，避免误伤
    if (secret && secret.length >= 6) {
      safe = safe.split(secret).join('[已脱敏]');
    }
  }
  safe = safe.replace(/Bearer\s+\S+/gi, 'Bearer [已脱敏]');
  safe = safe.replace(/([?&](?:key|access_token|api_key)=)[^&\s]+/gi, '$1[已脱敏]');
  return safe;
}

/**
 * 请求初始化（不含 signal，由传输层统一注入内部 AbortController）
 */
export interface TransportRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * 传输请求配置
 */
export interface TransportRequestConfig {
  /** 单次尝试总超时（毫秒）；Infinity 表示不限制 */
  timeoutMs?: number;
  /** 调用方取消信号 */
  signal?: AbortSignal;
  /** 需要从错误信息中抹除的敏感串（如 apiKey） */
  secrets?: string[];
  /** 需要从错误信息中抹除的用户正文（如服务端错误回显请求原文时） */
  redactTexts?: string[];
  /** 重试配置：timeout/cancelled 一律不重试 */
  retry?: TransportRetryConfig;
  /** 从 HTTP 错误响应体中提取错误信息 */
  extractErrorMessage?: (data: unknown) => string | undefined;
  /** 每次尝试开始前运行，重试时同样调用。 */
  onAttemptStart?: () => void;
  /** 自定义成功响应读取，仍受单次尝试的取消和超时约束。 */
  readResponse?: (response: Response, attemptSignal: AbortSignal) => Promise<string>;
  /** 处理 2xx 响应数据并提取内容；可抛 TransportError 表示响应无效（参与重试） */
  onSuccess: (data: unknown) => string;
}

/**
 * 判断是否为 fetch 抛出的中止类错误
 */
function isAbortLike(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * 判断错误是否应自动重试：取消/超时一律不重试
 */
function isRetryableFailure(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) {
    return false;
  }
  return error instanceof TransportError && error.retryable;
}

/**
 * 可被 signal 中断的等待；被中断时抛 cancelled
 */
async function cancellableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw TransportError.cancelled();
  }
  if (ms <= 0) {
    return;
  }
  return new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) {
        reject(TransportError.cancelled());
      } else {
        resolve();
      }
    };
    const onAbort = () => finish();
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', onAbort);
  });
}

/**
 * HTTP 错误的固定 public 文案：不回显服务端原文，仅暴露状态码
 */
function publicUnavailableMessage(statusCode: number): string {
  if (statusCode === 401 || statusCode === 403) {
    return 'API Key 无效或未授权';
  }
  if (statusCode === 429) {
    return '请求过于频繁';
  }
  if (statusCode >= 500) {
    return `翻译服务暂时不可用 (HTTP ${statusCode})`;
  }
  return `请求被服务拒绝 (HTTP ${statusCode})`;
}

/**
 * TransportError 的固定 public 文案：message 一律来自固定模板，
 * 服务端原文只保留在脱敏后的 detail 中（禁止进入日志）
 */
function fixedPublicTransportMessage(error: TransportError, timeoutMs: number): string {
  if (error.kind === 'timeout') {
    return `请求超时：request timeout after ${timeoutMs}ms`;
  }
  if (error.kind === 'cancelled') {
    return '请求已取消：request cancelled';
  }
  if (error.kind === 'output_limit') {
    return TransportError.outputLimit().message;
  }
  return error.statusCode !== undefined
    ? publicUnavailableMessage(error.statusCode)
    : '翻译服务暂时不可用，请稍后重试';
}

/**
 * 单次尝试：fetch 连接与响应 body 读取全程受同一 AbortController 保护
 */
async function attemptOnce(
  url: string,
  init: TransportRequestInit,
  config: TransportRequestConfig,
  timeoutMs: number
): Promise<string> {
  const signal = config.signal;
  // 调用方在请求发出前已取消：不发起请求，也不重试
  if (signal?.aborted) {
    throw TransportError.cancelled();
  }

  // 所有错误出口统一脱敏：密钥 + 调用方提供的用户正文（重复脱敏幂等）
  const redactions = [...(config.secrets ?? []), ...(config.redactTexts ?? [])];

  const controller = new AbortController();
  let timedOut = false;

  // 本地中止通知通道：不依赖 AbortController 自身的事件实现（各环境实现有差异），
  // 确保即使底层 fetch 未遵守 signal（或已进入 body 读取阶段），挂起的 await 也立即失败
  let notifyAborted: () => void = () => {};
  const whenAborted = new Promise<never>((_resolve, reject) => {
    notifyAborted = () => {
      reject(timedOut ? TransportError.timeout(timeoutMs) : TransportError.cancelled());
    };
  });

  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
          notifyAborted();
        }, timeoutMs)
      : undefined;

  const onCallerAbort = () => {
    controller.abort();
    notifyAborted();
  };
  signal?.addEventListener('abort', onCallerAbort);

  try {
    config.onAttemptStart?.();
    const response = await Promise.race([fetch(url, { ...init, signal: controller.signal }), whenAborted]);

    if (!response.ok) {
      const errorData = await Promise.race([response.json().catch(() => ({})), whenAborted]);
      const detail = config.extractErrorMessage?.(errorData);
      // public 文案固定；服务端原文脱敏后仅放入 detail（禁止进入日志）
      throw TransportError.unavailable(
        publicUnavailableMessage(response.status),
        response.status,
        detail ? sanitizeErrorMessage(detail, redactions) : undefined
      );
    }

    if (config.readResponse) {
      return await Promise.race([config.readResponse(response, controller.signal), whenAborted]);
    }
    const data = await Promise.race([response.json(), whenAborted]);
    return config.onSuccess(data);
  } catch (error) {
    if (timedOut) {
      throw TransportError.timeout(timeoutMs);
    }
    if (isAbortLike(error)) {
      throw TransportError.cancelled();
    }
    if (error instanceof TransportError) {
      // onSuccess 等内部抛出的 TransportError 统一重建：message 为固定 public 文案，
      // 服务端原文仅保留在脱敏后的 detail（幂等）
      throw new TransportError(error.kind, fixedPublicTransportMessage(error, timeoutMs), {
        statusCode: error.statusCode,
        retryable: error.retryable,
        detail: error.detail !== undefined ? sanitizeErrorMessage(error.detail, redactions) : undefined,
      });
    }
    if (error instanceof SyntaxError) {
      // JSON 解析失败的 SyntaxError 消息可能携带响应正文片段，使用固定文案避免泄露
      throw TransportError.unavailable('响应解析失败：invalid JSON response');
    }
    // 网络层失败（DNS 解析、连接拒绝等）：固定文案，不回显底层错误原文
    throw TransportError.unavailable('网络请求失败，无法连接翻译服务');
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * 执行传输请求：超时 + 取消 + 可中断重试 + 错误脱敏
 *
 * - 单次尝试总时长受 timeoutMs 约束（覆盖 fetch 与 body 读取）
 * - 超时/取消后立即失败，不重试
 * - 服务不可用（网络失败、429、5xx、响应无效）按 retry 配置退避重试，
 *   重试等待期间 signal 可随时打断
 */
export async function executeTransportRequest(
  url: string,
  init: TransportRequestInit,
  config: TransportRequestConfig
): Promise<string> {
  const { maxRetries = 0, initialDelay = 500, backoffMultiplier = 2, maxDelay = 5000, onRetry } = config.retry ?? {};
  const timeoutMs = config.timeoutMs ?? Number.POSITIVE_INFINITY;

  let delay = initialDelay;
  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce(url, init, config, timeoutMs);
    } catch (error) {
      const isLastAttempt = attempt >= maxRetries;
      const retryError = error instanceof Error ? error : new Error('翻译请求失败');
      const retryAllowed = isRetryableFailure(error, config.signal)
        && (config.retry?.shouldRetry?.(retryError, attempt) ?? true);
      if (isLastAttempt || !retryAllowed) {
        throw error;
      }
      // 带随机抖动的指数退避，避免惊群
      const jitter = Math.random() * 0.3 * delay;
      const actualDelay = Math.min(delay + jitter, maxDelay);
      onRetry?.(error as TransportError, attempt + 1, actualDelay);
      // 公共日志只保留 kind/状态码等固定信息，不输出错误详情（详情可能含 provider 回显内容）
      const transportError = error as TransportError;
      logger.warn(`翻译传输层：第 ${attempt + 1} 次尝试失败，${Math.round(actualDelay)}ms 后重试`, {
        kind: transportError.kind,
        statusCode: transportError.statusCode,
      });
      await cancellableSleep(actualDelay, config.signal);
      delay = Math.min(delay * backoffMultiplier, maxDelay);
    }
  }
}
