// 错误追踪模块导出

// 类型导出
export type {
  ErrorEntry,
  ErrorStats,
  ErrorCategory,
  ErrorSeverity,
  ErrorContext,
  ErrorReportResult,
  ErrorQueryParams,
  ErrorListResponse,
  ErrorTrackingConfig,
  ErrorStorageConfig,
  BrowserInfo
} from './types';

// 从types.ts导出常量
export { ERROR_CATEGORIES } from './types';

// 常量导出
export {
  ERROR_STORAGE_KEY,
  ERROR_CONFIG_KEY,
  DEFAULT_ERROR_TRACKING_CONFIG,
  ERROR_REPORT_CONFIG,
  ERROR_AGGREGATION_CONFIG,
  ERROR_API_ENDPOINTS,
  EXTENSION_VERSION
} from './constants';

// 存储模块导出
export {
  getErrorConfig,
  updateErrorConfig,
  getAllErrors,
  getErrorById,
  queryErrors,
  saveError,
  saveErrors,
  deleteError,
  deleteErrors,
  getUnreportedErrors,
  markErrorsAsReported,
  clearAllErrors,
  getErrorStats
} from './storage';

// 追踪器模块导出
export {
  ErrorTracker,
  captureError,
  initErrorTracking,
  withErrorTracking
} from './tracker';
