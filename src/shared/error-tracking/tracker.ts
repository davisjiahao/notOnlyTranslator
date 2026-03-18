// 错误追踪器核心类

import type {
  ErrorEntry,
  ErrorStats,
  ErrorCategory,
  ErrorSeverity,
  ErrorContext,
  ErrorReportResult,
  BrowserInfo
} from './types';
import {
  ERROR_AGGREGATION_CONFIG,
  EXTENSION_VERSION
} from './constants';
import {
  saveError,
  getErrorStats as getStatsFromStorage,
  getUnreportedErrors,
  markErrorsAsReported,
  clearAllErrors
} from './storage';

/**
 * 生成唯一ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取浏览器信息
 */
function getBrowserInfo(): BrowserInfo {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    platform: navigator.platform,
    extensionVersion: EXTENSION_VERSION
  };
}

/**
 * 判断是否为网络错误
 */
function isNetworkError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('xhr') ||
    message.includes('timeout') ||
    message.includes('connection') ||
    message.includes('abort')
  );
}

/**
 * 判断是否为存储错误
 */
function isStorageError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('storage') ||
    message.includes('quota') ||
    message.includes('indexeddb') ||
    message.includes('localstorage')
  );
}

/**
 * 自动分类错误
 */
function autoCategorize(error: Error): ErrorCategory {
  if (isNetworkError(error)) {
    return 'network';
  }
  if (isStorageError(error)) {
    return 'storage';
  }
  if (error.message.includes('翻译') || error.message.includes('translate')) {
    return 'translation';
  }
  if (error.message.includes('api') || error.message.includes('API')) {
    return 'api';
  }
  return 'runtime';
}

/**
 * 判断严重程度
 */
function determineSeverity(error: Error): ErrorSeverity {
  // 致命错误：内存溢出、栈溢出、不可恢复的错误
  if (
    error.message.includes('out of memory') ||
    error.message.includes('stack overflow') ||
    error.message.includes('fatal')
  ) {
    return 'fatal';
  }

  // 警告级别：非关键错误
  if (
    error.message.includes('warning') ||
    error.message.includes('deprecated') ||
    error.message.includes('timeout')
  ) {
    return 'warning';
  }

  return 'error';
}

/**
 * 截断堆栈追踪
 */
function truncateStack(stack?: string): string | undefined {
  if (!stack) return undefined;

  const lines = stack.split('\n');
  if (lines.length <= ERROR_AGGREGATION_CONFIG.maxStackDepth) {
    return stack;
  }

  return lines
    .slice(0, ERROR_AGGREGATION_CONFIG.maxStackDepth)
    .join('\n');
}

/**
 * 截断错误消息
 */
function truncateMessage(message: string): string {
  const maxLen = ERROR_AGGREGATION_CONFIG.maxMessageLength;
  if (message.length <= maxLen) return message;
  return message.substring(0, maxLen) + '...';
}

/**
 * 错误追踪器类
 */
export class ErrorTracker {
  private static isInitialized = false;
  private static originalErrorHandler?: OnErrorEventHandler;
  private static originalRejectionHandler?: ((event: PromiseRejectionEvent) => void) | null;

  /**
   * 初始化错误追踪器
   */
  static init(): void {
    if (this.isInitialized) return;

    // 捕获全局错误
    this.captureGlobalErrors();

    // 捕获未处理的 Promise 拒绝
    this.captureUnhandledRejections();

    this.isInitialized = true;
  }

  /**
   * 设置全局错误捕获
   */
  private static captureGlobalErrors(): void {
    this.originalErrorHandler = window.onerror;

    window.onerror = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error
    ) => {
      if (error) {
        this.capture(error, {
          component: source,
          metadata: { lineno, colno }
        });
      } else {
        // 非 Error 对象的错误
        const errorObj = new Error(String(message));
        this.capture(errorObj, {
          component: source,
          metadata: { lineno, colno, nonError: true }
        });
      }

      // 调用原始处理器
      if (this.originalErrorHandler) {
        return this.originalErrorHandler(message, source, lineno, colno, error);
      }
      return false;
    };
  }

  /**
   * 设置未处理的 Promise 拒绝捕获
   */
  private static captureUnhandledRejections(): void {
    this.originalRejectionHandler = window.onunhandledrejection;

    window.onunhandledrejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;

      if (reason instanceof Error) {
        this.capture(reason, {
          component: 'Promise',
          metadata: { unhandledRejection: true }
        });
      } else {
        const error = new Error(String(reason));
        this.capture(error, {
          component: 'Promise',
          metadata: { unhandledRejection: true, originalReason: reason }
        });
      }

      // 调用原始处理器
      if (this.originalRejectionHandler) {
        this.originalRejectionHandler(event);
      }
    };
  }

  /**
   * 捕获并记录错误
   */
  static capture(
    error: Error,
    context?: Partial<ErrorContext>,
    category?: ErrorCategory,
    severity?: ErrorSeverity
  ): ErrorEntry {
    const errorEntry: ErrorEntry = {
      id: generateId(),
      message: truncateMessage(error.message),
      stack: truncateStack(error.stack),
      category: category || autoCategorize(error),
      severity: severity || determineSeverity(error),
      context: {
        url: context?.component || window.location.href,
        component: context?.component,
        action: context?.action,
        userActions: context?.userActions,
        metadata: context?.metadata
      },
      timestamp: Date.now(),
      reported: false,
      count: 1,
      firstOccurredAt: Date.now(),
      browserInfo: getBrowserInfo()
    };

    // 异步保存错误
    saveError(errorEntry).catch(err => {
      console.error('Failed to save error:', err);
    });

    return errorEntry;
  }

  /**
   * 捕获 API 错误
   */
  static captureApiError(
    error: Error,
    apiName: string,
    requestData?: unknown
  ): ErrorEntry {
    return this.capture(error, {
      component: apiName,
      action: 'API_CALL',
      metadata: { requestData }
    }, 'api', 'error');
  }

  /**
   * 捕获网络错误
   */
  static captureNetworkError(
    error: Error,
    url: string,
    method?: string
  ): ErrorEntry {
    return this.capture(error, {
      component: 'Network',
      action: method || 'REQUEST',
      metadata: { url, method }
    }, 'network', 'warning');
  }

  /**
   * 捕获存储错误
   */
  static captureStorageError(
    error: Error,
    operation: string
  ): ErrorEntry {
    return this.capture(error, {
      component: 'Storage',
      action: operation,
      metadata: { operation }
    }, 'storage', 'error');
  }

  /**
   * 捕获翻译错误
   */
  static captureTranslationError(
    error: Error,
    provider: string,
    text?: string
  ): ErrorEntry {
    return this.capture(error, {
      component: `Translation:${provider}`,
      action: 'TRANSLATE',
      metadata: { provider, textLength: text?.length }
    }, 'translation', 'error');
  }

  /**
   * 捕获 UI 错误
   */
  static captureUiError(
    error: Error,
    component: string,
    action?: string
  ): ErrorEntry {
    return this.capture(error, {
      component,
      action,
      metadata: { uiError: true }
    }, 'ui', 'warning');
  }

  /**
   * 上报错误到服务器
   */
  static async report(): Promise<ErrorReportResult> {
    try {
      const unreported = await getUnreportedErrors();

      if (unreported.length === 0) {
        return { success: true, reportedCount: 0, failedCount: 0 };
      }

      // 模拟上报过程（未来对接真实 API）
      const ids = unreported.map(e => e.id);
      await markErrorsAsReported(ids);

      return {
        success: true,
        reportedCount: unreported.length,
        failedCount: 0
      };
    } catch (error) {
      console.error('Error reporting failed:', error);
      return {
        success: false,
        reportedCount: 0,
        failedCount: 0,
        errors: [String(error)]
      };
    }
  }

  /**
   * 获取错误统计
   */
  static async getStats(): Promise<ErrorStats> {
    return getStatsFromStorage();
  }

  /**
   * 清除所有错误记录
   */
  static async clear(): Promise<void> {
    await clearAllErrors();
  }

  /**
   * 销毁错误追踪器（恢复原始处理器）
   */
  static destroy(): void {
    if (this.originalErrorHandler) {
      window.onerror = this.originalErrorHandler;
    }
    if (this.originalRejectionHandler) {
      window.onunhandledrejection = this.originalRejectionHandler;
    }
    this.isInitialized = false;
  }
}

/**
 * 便捷的错误捕获函数
 */
export function captureError(
  error: Error,
  context?: Partial<ErrorContext>
): ErrorEntry {
  return ErrorTracker.capture(error, context);
}

/**
 * 初始化错误追踪
 */
export function initErrorTracking(): void {
  ErrorTracker.init();
}

/**
 * 包装函数以自动捕获错误
 */
export function withErrorTracking<T extends (...args: unknown[]) => unknown>(
  fn: T,
  context?: Partial<ErrorContext>
): T {
  return function (...args: unknown[]): unknown {
    try {
      const result = fn(...args);

      // 处理 Promise
      if (result instanceof Promise) {
        return result.catch(error => {
          ErrorTracker.capture(
            error instanceof Error ? error : new Error(String(error)),
            context
          );
          throw error;
        });
      }

      return result;
    } catch (error) {
      ErrorTracker.capture(
        error instanceof Error ? error : new Error(String(error)),
        context
      );
      throw error;
    }
  } as T;
}
