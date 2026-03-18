// 反馈系统模块导出

// 类型导出
export type {
  Feedback,
  FeedbackCategory,
  FeedbackStatus,
  FeedbackFormData,
  FeedbackSubmitResult,
  FeedbackStats,
  FeedbackQueryParams,
  FeedbackListResponse,
  FeedbackStorageConfig,
  BrowserInfo
} from './types';

// 从types.ts导出常量
export { FEEDBACK_CATEGORIES } from './types';

// 常量导出
export {
  FEEDBACK_STORAGE_KEY,
  FEEDBACK_CONFIG_KEY,
  DEFAULT_FEEDBACK_CONFIG,
  RATING_CONFIG,
  FEEDBACK_VALIDATION,
  FEEDBACK_API_ENDPOINTS,
  EXTENSION_VERSION
} from './constants';

// 存储模块导出
export {
  getFeedbackConfig,
  updateFeedbackConfig,
  getAllFeedbacks,
  getFeedbackById,
  queryFeedbacks,
  saveFeedback,
  saveFeedbacks,
  deleteFeedback,
  deleteFeedbacks,
  getUnsyncedFeedbacks,
  markFeedbacksAsSynced,
  clearAllFeedbacks,
  getFeedbackStats
} from './storage';

// 收集器模块导出
export {
  validateFeedbackForm,
  createFeedback,
  submitFeedback,
  submitQuickFeedback,
  initFeedbackCollector,
  getFeedbackHints,
  getFeedbackCategoryLabel,
  getRatingLabel
} from './collector';
