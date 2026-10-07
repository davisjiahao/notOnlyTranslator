/**
 * 翻译错误处理模块
 *
 * 提供统一的翻译错误分类、用户友好提示和自动重试机制
 *
 * @module shared/utils/translationErrors
 */

import { logger } from './logger';

/**
 * 翻译错误类型
 */
export enum TranslationErrorType {
  /** API Key 无效或缺失 */
  INVALID_API_KEY = 'INVALID_API_KEY',
  /** 网络连接失败 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 离线模式 */
  OFFLINE = 'OFFLINE',
  /** API 速率限制 */
  RATE_LIMIT = 'RATE_LIMIT',
  /** API 配额耗尽 */
  QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED',
  /** 请求超时 */
  TIMEOUT = 'TIMEOUT',
  /** API 返回无效响应 */
  INVALID_RESPONSE = 'INVALID_RESPONSE',
  /** 内容被过滤 */
  CONTENT_FILTERED = 'CONTENT_FILTERED',
  /** 模型不可用 */
  MODEL_UNAVAILABLE = 'MODEL_UNAVAILABLE',
  /** 请求被调用方取消 */
  REQUEST_CANCELLED = 'REQUEST_CANCELLED',
  /** 服务暂不可用（网络失败或 5xx 等） */
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  /** 未知错误 */
  UNKNOWN = 'UNKNOWN',
}

/**
 * 传输层错误类别
 */
export type TransportErrorKind = 'timeout' | 'cancelled' | 'unavailable' | 'output_limit';

/**
 * TransportError 构造选项
 */
export interface TransportErrorOptions {
  /** HTTP 状态码（unavailable 时可能存在） */
  statusCode?: number;
  /** 是否可自动重试，默认 unavailable 为 true，其余为 false */
  retryable?: boolean;
  /** 已脱敏的服务端补充细节；不属于 public 文案，禁止进入日志 */
  detail?: string;
}

/**
 * 传输层结构化错误
 * 区分 超时 / 取消 / 服务不可用，让重试决策不再依赖字符串猜测：
 * 超时与取消一律不可自动重试（调用方已放弃或主动中止）。
 * message 必须是固定 public 文案；服务端原文一律放入 detail（脱敏后）。
 */
export class TransportError extends Error {
  public readonly kind: TransportErrorKind;
  public readonly statusCode?: number;
  public readonly retryable: boolean;
  public readonly detail?: string;

  constructor(kind: TransportErrorKind, message: string, options: TransportErrorOptions = {}) {
    super(message);
    this.name = 'TransportError';
    this.kind = kind;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? kind === 'unavailable';
    this.detail = options.detail;
  }

  /** 请求超时（单次尝试总时长已耗尽，重试决策交还调用方） */
  static timeout(timeoutMs: number): TransportError {
    return new TransportError('timeout', `请求超时：request timeout after ${timeoutMs}ms`, {
      retryable: false,
    });
  }

  /** 请求被调用方取消 */
  static cancelled(): TransportError {
    return new TransportError('cancelled', '请求已取消：request cancelled', { retryable: false });
  }

  /** 输出预算耗尽时原样重试无效，不得误判为网络故障。 */
  static outputLimit(): TransportError {
    return new TransportError('output_limit', '模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型', { retryable: false });
  }

  /**
   * 服务不可用：网络层失败或 HTTP 错误状态
   * 与旧 defaultShouldRetry 语义保持一致：仅网络失败、429、5xx 可自动重试，其余 4xx 不重试
   * message 为固定 public 文案；服务端原文经脱敏后放入 detail
   */
  static unavailable(message: string, statusCode?: number, detail?: string): TransportError {
    const retryable = statusCode === undefined || statusCode === 429 || statusCode >= 500;
    return new TransportError('unavailable', message, { statusCode, retryable, detail });
  }
}

/**
 * 翻译错误信息接口
 */
export interface TranslationErrorInfo {
  /** 错误类型 */
  type: TranslationErrorType;
  /** 错误标题（用户友好） */
  title: string;
  /** 错误详情（用户友好） */
  message: string;
  /** 技术详情（调试用） */
  technicalDetails?: string;
  /** 是否可重试 */
  retryable: boolean;
  /** 建议的重试延迟（毫秒） */
  retryDelay?: number;
  /** 建议的操作 */
  action?: string;
}

/**
 * 错误分类映射
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  type: TranslationErrorType;
  title: string;
  message: string;
  retryable: boolean;
  retryDelay?: number;
  action?: string;
}> = [
  // API Key 错误
  {
    pattern: /api[_\s]?key|authentication|unauthorized|401|403/i,
    type: TranslationErrorType.INVALID_API_KEY,
    title: 'API Key 无效',
    message: '您的 API Key 无效或已过期。请在设置中检查并更新您的 API Key。',
    retryable: false,
    action: 'open_settings',
  },
  // 请求被取消/中止（置于网络错误之前，避免 "fetch aborted" 被误判为网络故障）
  {
    pattern: /abort|已取消|已中止/i,
    type: TranslationErrorType.REQUEST_CANCELLED,
    title: '请求已取消',
    message: '翻译请求已取消。',
    retryable: false,
    action: 'retry',
  },
  // 网络错误
  {
    pattern: /network|fetch|failed to fetch|connection|ECONNREFUSED|ENOTFOUND/i,
    type: TranslationErrorType.NETWORK_ERROR,
    title: '网络连接失败',
    message: '无法连接到翻译服务。请检查您的网络连接。',
    retryable: true,
    retryDelay: 3000,
    action: 'retry',
  },
  // 离线模式
  {
    pattern: /offline|navigator\.onLine/i,
    type: TranslationErrorType.OFFLINE,
    title: '您已离线',
    message: '您的设备处于离线状态。翻译功能需要网络连接。',
    retryable: true,
    retryDelay: 5000,
    action: 'check_connection',
  },
  // 速率限制
  {
    pattern: /rate[_\s]?limit|429|too[_\s]?many[_\s]?requests/i,
    type: TranslationErrorType.RATE_LIMIT,
    title: '请求过于频繁',
    message: '您发送的请求太多，请稍后再试。',
    retryable: true,
    retryDelay: 60000,
    action: 'wait',
  },
  // 服务不可用（5xx，置于"模型不可用"等模式之前）
  {
    pattern: /service[_\s]?unavailable|服务器?不可用|502|503|504/i,
    type: TranslationErrorType.SERVICE_UNAVAILABLE,
    title: '服务暂不可用',
    message: '翻译服务暂时不可用，请稍后重试。',
    retryable: true,
    retryDelay: 3000,
    action: 'retry',
  },
  // 配额耗尽
  {
    pattern: /quota|exceeded|limit|billing|payment|402/i,
    type: TranslationErrorType.QUOTA_EXHAUSTED,
    title: 'API 配额已用完',
    message: '您的 API 配额已耗尽。请检查您的账户余额或升级套餐。',
    retryable: false,
    action: 'check_billing',
  },
  // 超时
  {
    pattern: /timeout|timed?[_\s]?out|ETIMEDOUT/i,
    type: TranslationErrorType.TIMEOUT,
    title: '请求超时',
    message: '翻译服务响应时间过长。可能是网络问题或服务繁忙。',
    retryable: true,
    retryDelay: 5000,
    action: 'retry',
  },
  // 无效响应
  {
    pattern: /invalid|parse|json|syntax|unexpected/i,
    type: TranslationErrorType.INVALID_RESPONSE,
    title: '响应解析失败',
    message: '翻译服务返回了无法解析的响应。请稍后重试。',
    retryable: true,
    retryDelay: 3000,
    action: 'retry',
  },
  // 内容过滤
  {
    pattern: /content[_\s]?filter|safety|moderation|policy|violation/i,
    type: TranslationErrorType.CONTENT_FILTERED,
    title: '内容被过滤',
    message: '翻译服务无法处理此内容。可能包含敏感信息或违反使用政策。',
    retryable: false,
    action: 'change_content',
  },
  // 模型不可用
  {
    pattern: /model|unavailable|deprecated|not[_\s]?found|404/i,
    type: TranslationErrorType.MODEL_UNAVAILABLE,
    title: '模型不可用',
    message: '选定的 AI 模型当前不可用。请在设置中切换其他模型。',
    retryable: false,
    action: 'switch_model',
  },
];

/**
 * 分类翻译错误
 * @param error 原始错误
 * @returns 错误信息
 */
export function classifyTranslationError(error: Error | string | unknown): TranslationErrorInfo {
  const errorMessage = error instanceof Error ? error.message : String(error);

  logger.info('TranslationErrorHandler: 分析错误', errorMessage);

  // 先检查是否离线
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      type: TranslationErrorType.OFFLINE,
      title: '您已离线',
      message: '您的设备处于离线状态。翻译功能需要网络连接。',
      technicalDetails: errorMessage,
      retryable: true,
      retryDelay: 5000,
      action: 'check_connection',
    };
  }

  // 传输层结构化错误：优先按 kind 精确分类，不依赖字符串猜测
  if (error instanceof TransportError) {
    // detail 为已脱敏的服务端细节，仅进入 technicalDetails 调试字段
    const techDetails = error.detail ? `${errorMessage} | ${error.detail}` : errorMessage;

    if (error.kind === 'cancelled') {
      return {
        type: TranslationErrorType.REQUEST_CANCELLED,
        title: '请求已取消',
        message: '翻译请求已取消。',
        technicalDetails: techDetails,
        retryable: false,
        action: 'retry',
      };
    }
    if (error.kind === 'timeout') {
      return {
        type: TranslationErrorType.TIMEOUT,
        title: '请求超时',
        message: '翻译服务响应时间过长。可能是网络问题或服务繁忙。',
        technicalDetails: techDetails,
        retryable: true,
        retryDelay: 5000,
        action: 'retry',
      };
    }
    if (error.kind === 'output_limit') {
      return {
        type: TranslationErrorType.INVALID_RESPONSE,
        title: '模型输出被截断',
        message: '模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型',
        technicalDetails: techDetails,
        retryable: false,
        action: 'open_settings',
      };
    }
    // kind === 'unavailable'：按状态码细分
    if (error.statusCode === 401 || error.statusCode === 403) {
      return {
        type: TranslationErrorType.INVALID_API_KEY,
        title: 'API Key 无效',
        message: '您的 API Key 无效或已过期。请在设置中检查并更新您的 API Key。',
        technicalDetails: techDetails,
        retryable: false,
        action: 'open_settings',
      };
    }
    if (error.statusCode === 429) {
      return {
        type: TranslationErrorType.RATE_LIMIT,
        title: '请求过于频繁',
        message: '您发送的请求太多，请稍后再试。',
        technicalDetails: techDetails,
        retryable: true,
        retryDelay: 60000,
        action: 'wait',
      };
    }
    if (error.statusCode !== undefined && error.statusCode >= 500) {
      return {
        type: TranslationErrorType.SERVICE_UNAVAILABLE,
        title: '服务暂不可用',
        message: '翻译服务暂时不可用，请稍后重试。',
        technicalDetails: techDetails,
        retryable: true,
        retryDelay: 3000,
        action: 'retry',
      };
    }
    return {
      type: TranslationErrorType.NETWORK_ERROR,
      title: '网络连接失败',
      message: '无法连接到翻译服务。请检查您的网络连接。',
      technicalDetails: techDetails,
      retryable: true,
      retryDelay: 3000,
      action: 'retry',
    };
  }

  // 匹配错误模式
  for (const pattern of ERROR_PATTERNS) {
    if (pattern.pattern.test(errorMessage)) {
      return {
        type: pattern.type,
        title: pattern.title,
        message: pattern.message,
        technicalDetails: errorMessage,
        retryable: pattern.retryable,
        retryDelay: pattern.retryDelay,
        action: pattern.action,
      };
    }
  }

  // 未知错误
  return {
    type: TranslationErrorType.UNKNOWN,
    title: '翻译失败',
    message: '翻译过程中出现意外错误。请稍后重试。',
    technicalDetails: errorMessage,
    retryable: true,
    retryDelay: 3000,
    action: 'retry',
  };
}

/**
 * 检查是否处于离线状态
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

/**
 * 监听在线状态变化
 * @param callback 状态变化回调
 * @returns 取消监听的函数
 */
export function onOnlineStatusChange(callback: (isOnline: boolean) => void): () => void {
  const handleOnline = () => callback(true);
  const handleOffline = () => callback(false);

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

/**
 * 带有错误处理的包装函数
 * @param fn 要执行的函数
 * @param onError 错误处理回调
 * @param maxRetries 最大重试次数
 * @returns 包装后的函数
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  onError?: (error: TranslationErrorInfo) => void,
  maxRetries: number = 3
): (...args: Parameters<T>) => Promise<ReturnType<T> | null> {
  return async (...args: Parameters<T>): Promise<ReturnType<T> | null> => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await fn(...args);
        return result as ReturnType<T>;
      } catch (error) {
        const errorInfo = classifyTranslationError(error);

        logger.warn(`TranslationErrorHandler: 尝试 ${attempt + 1}/${maxRetries} 失败`, {
          type: errorInfo.type,
          retryable: errorInfo.retryable,
        });

        // 如果不可重试，立即抛出
        if (!errorInfo.retryable) {
          onError?.(errorInfo);
          throw new TranslationError(errorInfo);
        }

        // 最后一次尝试，不再重试
        if (attempt === maxRetries - 1) {
          onError?.(errorInfo);
          throw new TranslationError(errorInfo);
        }

        // 等待后重试
        if (errorInfo.retryDelay) {
          await delay(errorInfo.retryDelay);
        }
      }
    }

    return null;
  };
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 翻译错误类
 */
export class TranslationError extends Error {
  public readonly info: TranslationErrorInfo;

  constructor(info: TranslationErrorInfo) {
    super(info.message);
    this.name = 'TranslationError';
    this.info = info;
  }
}

/**
 * 错误提示建议
 */
export const ERROR_ACTIONS: Record<string, { label: string; handler: () => void }> = {
  open_settings: {
    label: '打开设置',
    handler: () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    },
  },
  retry: {
    label: '重试',
    handler: () => {
      // 重试逻辑由调用方处理
    },
  },
  check_connection: {
    label: '检查网络',
    handler: () => {
      // 检查网络状态
      if (navigator.onLine) {
        window.location.reload();
      }
    },
  },
  check_billing: {
    label: '查看账户',
    handler: () => {
      // 打开对应提供商的账单页面
      window.open('https://platform.openai.com/account/billing', '_blank');
    },
  },
  switch_model: {
    label: '切换模型',
    handler: () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE', payload: { tab: 'api' } });
    },
  },
  change_content: {
    label: '了解详情',
    handler: () => {
      window.open('https://openai.com/policies/usage-policies', '_blank');
    },
  },
  wait: {
    label: '稍后重试',
    handler: () => {
      // 等待逻辑由调用方处理
    },
  },
};
