// 错误追踪系统类型定义

/**
 * 错误严重程度
 */
export type ErrorSeverity = 'fatal' | 'error' | 'warning';

/**
 * 错误分类
 */
export type ErrorCategory =
  | 'runtime'      // 运行时错误
  | 'network'      // 网络错误
  | 'storage'      // 存储错误
  | 'translation'  // 翻译相关错误
  | 'api'          // API 调用错误
  | 'ui'           // UI 渲染错误
  | 'unknown';     // 未知错误

/**
 * 错误分类配置
 */
export const ERROR_CATEGORIES: Record<ErrorCategory, { label: string; description: string }> = {
  runtime: {
    label: '运行时错误',
    description: 'JavaScript 运行时异常'
  },
  network: {
    label: '网络错误',
    description: '网络连接或请求失败'
  },
  storage: {
    label: '存储错误',
    description: 'Chrome Storage 操作失败'
  },
  translation: {
    label: '翻译错误',
    description: '翻译服务相关错误'
  },
  api: {
    label: 'API 错误',
    description: 'API 调用失败或返回错误'
  },
  ui: {
    label: 'UI 错误',
    description: '界面渲染或交互错误'
  },
  unknown: {
    label: '未知错误',
    description: '未分类的错误'
  }
};

/**
 * 错误上下文信息
 */
export interface ErrorContext {
  // 错误发生的页面 URL
  url?: string;
  // 错误发生的组件/模块
  component?: string;
  // 错误发生的操作
  action?: string;
  // 用户操作序列
  userActions?: string[];
  // 额外的自定义上下文
  metadata?: Record<string, unknown>;
}

/**
 * 错误条目
 */
export interface ErrorEntry {
  // 唯一标识
  id: string;
  // 错误消息
  message: string;
  // 错误堆栈
  stack?: string;
  // 错误分类
  category: ErrorCategory;
  // 严重程度
  severity: ErrorSeverity;
  // 上下文信息
  context?: ErrorContext;
  // 发生时间戳
  timestamp: number;
  // 是否已上报
  reported: boolean;
  // 上报时间
  reportedAt?: number;
  // 发生次数（用于重复错误聚合）
  count: number;
  // 首次发生时间
  firstOccurredAt: number;
  // 浏览器信息
  browserInfo?: BrowserInfo;
}

/**
 * 浏览器信息
 */
export interface BrowserInfo {
  userAgent: string;
  language: string;
  platform: string;
  extensionVersion: string;
}

/**
 * 错误统计
 */
export interface ErrorStats {
  // 总错误数
  totalErrors: number;
  // 未上报错误数
  unreportedErrors: number;
  // 按分类统计
  byCategory: Record<ErrorCategory, number>;
  // 按严重程度统计
  bySeverity: Record<ErrorSeverity, number>;
  // 最近24小时错误数
  last24Hours: number;
  // 最近7天错误数
  last7Days: number;
  // 最常发生的错误（前5）
  topErrors: Array<{
    message: string;
    count: number;
    category: ErrorCategory;
  }>;
}

/**
 * 错误查询参数
 */
export interface ErrorQueryParams {
  // ID列表（可选）
  ids?: string[];
  // 分类过滤
  category?: ErrorCategory;
  // 严重程度过滤
  severity?: ErrorSeverity;
  // 是否已上报
  reported?: boolean;
  // 时间范围开始
  startTime?: number;
  // 时间范围结束
  endTime?: number;
  // 分页限制
  limit?: number;
  // 分页偏移
  offset?: number;
}

/**
 * 错误列表响应
 */
export interface ErrorListResponse {
  errors: ErrorEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * 错误上报结果
 */
export interface ErrorReportResult {
  success: boolean;
  reportedCount: number;
  failedCount: number;
  errors?: string[];
}

/**
 * 错误追踪配置
 */
export interface ErrorTrackingConfig {
  // 最大存储条目数
  maxEntries: number;
  // 是否自动上报
  autoReport: boolean;
  // 上报间隔（毫秒）
  reportInterval: number;
  // 是否捕获全局错误
  captureGlobalErrors: boolean;
  // 是否捕获未处理的 Promise 拒绝
  captureUnhandledRejections: boolean;
  // 采样率（0-1）
  sampleRate: number;
}

/**
 * 错误追踪存储配置
 */
export interface ErrorStorageConfig {
  // 存储键名前缀
  storageKeyPrefix: string;
  // 配置存储键名
  configKey: string;
}
