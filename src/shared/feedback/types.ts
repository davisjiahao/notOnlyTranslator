// 用户反馈系统类型定义

/**
 * 反馈类型
 */
export type FeedbackCategory = 'bug' | 'feature' | 'ux' | 'performance' | 'other';

/**
 * 反馈类型标签配置
 */
export const FEEDBACK_CATEGORIES: Record<FeedbackCategory, { label: string; description: string }> = {
  bug: {
    label: 'Bug 反馈',
    description: '功能异常、崩溃、错误提示等问题'
  },
  feature: {
    label: '功能建议',
    description: '新功能需求或现有功能改进建议'
  },
  ux: {
    label: '体验问题',
    description: '界面设计、交互流程、使用困惑等'
  },
  performance: {
    label: '性能问题',
    description: '翻译慢、卡顿、内存占用高等'
  },
  other: {
    label: '其他',
    description: '不属于以上类别的问题或建议'
  }
};

/**
 * 反馈数据模型
 */
export interface Feedback {
  /** 唯一标识符 */
  id: string;
  /** 反馈类型 */
  category: FeedbackCategory;
  /** 用户评分 (1-5星) */
  rating: number;
  /** 反馈标题 */
  title: string;
  /** 详细描述 */
  description: string;
  /** 用户邮箱（可选，用于后续联系） */
  email?: string;
  /** 创建时间 */
  createdAt: number;
  /** 当前页面URL */
  pageUrl?: string;
  /** 浏览器信息 */
  browserInfo?: BrowserInfo;
  /** 插件版本 */
  extensionVersion?: string;
  /** 用户ID（匿名） */
  userId?: string;
  /** 处理状态 */
  status: FeedbackStatus;
  /** 是否已同步到服务器 */
  synced: boolean;
}

/**
 * 反馈处理状态
 */
export type FeedbackStatus = 'pending' | 'processing' | 'resolved' | 'rejected';

/**
 * 浏览器信息
 */
export interface BrowserInfo {
  userAgent: string;
  language: string;
  screenResolution: string;
  viewportSize: string;
}

/**
 * 反馈提交表单数据
 */
export interface FeedbackFormData {
  category: FeedbackCategory;
  rating: number;
  title: string;
  description: string;
  email?: string;
}

/**
 * 反馈统计信息
 */
export interface FeedbackStats {
  totalCount: number;
  pendingCount: number;
  resolvedCount: number;
  averageRating: number;
  categoryDistribution: Record<FeedbackCategory, number>;
}

/**
 * 反馈存储配置
 */
export interface FeedbackStorageConfig {
  /** 最大存储条数 */
  maxEntries: number;
  /** 是否自动同步 */
  autoSync: boolean;
  /** 同步间隔（毫秒） */
  syncInterval: number;
}

/**
 * 反馈提交结果
 */
export interface FeedbackSubmitResult {
  success: boolean;
  feedbackId?: string;
  error?: string;
}

/**
 * 反馈列表查询参数
 */
export interface FeedbackQueryParams {
  category?: FeedbackCategory;
  status?: FeedbackStatus;
  startDate?: number;
  endDate?: number;
  limit?: number;
  offset?: number;
}

/**
 * 反馈列表响应
 */
export interface FeedbackListResponse {
  feedbacks: Feedback[];
  total: number;
  hasMore: boolean;
}
