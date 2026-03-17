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
  /** 未知错误 */
  UNKNOWN = 'UNKNOWN',
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
