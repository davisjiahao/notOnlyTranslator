// 反馈系统常量

// 从types.ts重新导出FEEDBACK_CATEGORIES
export { FEEDBACK_CATEGORIES } from './types';

/**
 * 存储键名
 */
export const FEEDBACK_STORAGE_KEY = 'userFeedbacks';
export const FEEDBACK_CONFIG_KEY = 'feedbackConfig';

/**
 * 默认存储配置
 */
export const DEFAULT_FEEDBACK_CONFIG = {
  maxEntries: 100,
  autoSync: true,
  syncInterval: 5 * 60 * 1000 // 5分钟
};

/**
 * 评分星星配置
 */
export const RATING_CONFIG = {
  min: 1,
  max: 5,
  labels: ['非常不满意', '不满意', '一般', '满意', '非常满意']
};

/**
 * 反馈表单验证规则
 */
export const FEEDBACK_VALIDATION = {
  title: {
    minLength: 5,
    maxLength: 100,
    required: true
  },
  description: {
    minLength: 10,
    maxLength: 2000,
    required: true
  },
  email: {
    required: false,
    pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  }
};

/**
 * API端点（预留，未来对接后端）
 */
export const FEEDBACK_API_ENDPOINTS = {
  submit: '/api/feedback/submit',
  list: '/api/feedback/list',
  update: '/api/feedback/update',
  delete: '/api/feedback/delete'
};

/**
 * 版本信息（用于追踪反馈来源）
 */
export const EXTENSION_VERSION = '1.0.0';
