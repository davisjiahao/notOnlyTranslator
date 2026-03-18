// 错误追踪系统常量

// 从types.ts重新导出ERROR_CATEGORIES
export { ERROR_CATEGORIES } from './types';

/**
 * 存储键名
 */
export const ERROR_STORAGE_KEY = 'errorTracking';
export const ERROR_CONFIG_KEY = 'errorTrackingConfig';

/**
 * 默认错误追踪配置
 */
export const DEFAULT_ERROR_TRACKING_CONFIG = {
  maxEntries: 100,
  autoReport: true,
  reportInterval: 5 * 60 * 1000, // 5分钟
  captureGlobalErrors: true,
  captureUnhandledRejections: true,
  sampleRate: 1.0 // 100%采样
};

/**
 * 错误上报配置
 */
export const ERROR_REPORT_CONFIG = {
  // 最大批量上报数量
  maxBatchSize: 50,
  // 上报重试次数
  maxRetries: 3,
  // 重试延迟（毫秒）
  retryDelay: 1000,
  // 上报超时时间
  timeout: 30000
};

/**
 * 错误聚合配置
 */
export const ERROR_AGGREGATION_CONFIG = {
  // 相似错误判定时间窗口（毫秒）- 30分钟内
  timeWindow: 30 * 60 * 1000,
  // 最大堆栈追踪深度
  maxStackDepth: 20,
  // 截断长消息的长度
  maxMessageLength: 500
};

/**
 * API端点（预留，未来对接后端）
 */
export const ERROR_API_ENDPOINTS = {
  report: '/api/errors/report',
  batch: '/api/errors/batch',
  stats: '/api/errors/stats'
};

/**
 * 版本信息（用于追踪错误来源）
 */
export const EXTENSION_VERSION = '1.0.0';
