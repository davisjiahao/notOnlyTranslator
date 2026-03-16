/**
 * 增长实验数据埋点系统 - 类型定义
 *
 * 本模块定义了所有增长实验相关的事件追踪、用户画像、实验分组等类型
 *
 * @module types/analytics
 */

// ========== 核心事件追踪类型 ==========

/**
 * 追踪事件接口 - 所有事件的基础结构
 */
export interface TrackEvent {
  /** 事件名称 */
  event: string;
  /** 事件属性 */
  properties: Record<string, unknown>;
  /** 时间戳（毫秒） */
  timestamp: number;
  /** 用户ID */
  user_id: string;
  /** 会话ID */
  session_id: string;
  /** 设备ID（用于去重） */
  device_id: string;
}

/**
 * 本地事件队列 - 存储在 Chrome storage 中的事件
 */
export interface LocalEventQueue {
  /** 待发送的事件列表 */
  events: TrackEvent[];
  /** 上次同步时间戳 */
  lastSync: number;
  /** 设备唯一标识 */
  deviceId: string;
}

// ========== 用户画像类型 ==========

/**
 * 用户画像接口 - 存储在服务器端的用户属性
 */
export interface UserAnalyticsProfile {
  /** 唯一用户标识 */
  user_id: string;
  /** 安装日期（ISO格式） */
  install_date: string;
  /** 安装来源 */
  install_source: 'organic' | 'referral' | 'social' | 'ads' | string;
  /** 初始英语水平 */
  initial_level: string;
  /** API提供商 */
  api_provider: string;
  /** 最后活跃日期 */
  last_active_date: string;
  /** 累计标记词汇数 */
  total_words_marked: number;
  /** 累计掌握词汇数 */
  total_words_known: number;
  /** 当前词汇量估计 */
  current_vocabulary_estimate: number;
  /** 实验分组映射 */
  experiment_groups: Record<string, string>;
  /** 推荐人ID（如有） */
  referrer_id?: string;
  /** 近7天活跃天数 */
  days_active_last_7: number;
  /** 近30天活跃天数 */
  days_active_last_30: number;
}

// ========== 实验分组类型 ==========

/**
 * 实验组配置
 */
export interface ExperimentGroup {
  /** 组唯一标识 */
  id: string;
  /** 组名称 */
  name: string;
  /** 流量权重（百分比） */
  weight: number;
  /** 变体标识 */
  variant: string;
}

/**
 * 实验指标配置
 */
export interface ExperimentMetrics {
  /** 主要指标 */
  primary: string;
  /** 次要指标 */
  secondary: string[];
}

/**
 * 实验配置接口
 */
export interface ExperimentConfig {
  /** 实验唯一标识 */
  id: string;
  /** 实验名称 */
  name: string;
  /** 开始日期 */
  startDate: string;
  /** 结束日期 */
  endDate: string;
  /** 参与实验的流量百分比 */
  trafficAllocation: number;
  /** 实验分组 */
  groups: ExperimentGroup[];
  /** 实验指标 */
  metrics: ExperimentMetrics;
  /** 每组最小样本量 */
  minimumSampleSize: number;
}

/**
 * 实验分配结果
 */
export interface ExperimentAssignment {
  /** 实验ID */
  experimentId: string;
  /** 分配的组ID */
  groupId: string;
  /** 变体标识 */
  variant: string;
  /** 分配时间戳 */
  assignedAt: number;
}

// ========== 事件类型枚举 ==========

/**
 * 获客阶段事件
 */
export type AcquisitionEvent =
  | 'store_view'
  | 'store_click'
  | 'install_complete'
  | 'install_source';

/**
 * 激活阶段事件
 */
export type ActivationEvent =
  | 'onboarding_start'
  | 'onboarding_step_complete'
  | 'onboarding_complete'
  | 'onboarding_skip'
  | 'first_translation'
  | 'first_word_marked'
  | 'api_configured'
  | 'trial_quota_used';

/**
 * 留存阶段事件
 */
export type RetentionEvent =
  | 'translation_request'
  | 'word_marked'
  | 'vocabulary_review'
  | 'flashcard_practice'
  | 'settings_changed'
  | 'theme_switched'
  | 'data_exported';

/**
 * 推荐阶段事件
 */
export type ReferralEvent =
  | 'achievement_unlocked'
  | 'share_clicked'
  | 'share_completed'
  | 'invite_link_generated'
  | 'referral_install'
  | 'referral_activated';

/**
 * 所有追踪事件类型
 */
export type AnalyticsEvent =
  | AcquisitionEvent
  | ActivationEvent
  | RetentionEvent
  | ReferralEvent;

// ========== 漏斗分析类型 ==========

/**
 * 漏斗步骤
 */
export interface FunnelStep {
  /** 步骤名称 */
  name: string;
  /** 对应事件 */
  event: string;
  /** 步骤顺序 */
  order: number;
}

/**
 * 漏斗配置
 */
export interface FunnelConfig {
  /** 漏斗唯一标识 */
  id: string;
  /** 漏斗名称 */
  name: string;
  /** 漏斗步骤 */
  steps: FunnelStep[];
  /** 分析时间窗口（天） */
  timeWindow: number;
}

/**
 * 漏斗分析结果
 */
export interface FunnelAnalysis {
  /** 漏斗ID */
  funnelId: string;
  /** 分析开始时间 */
  startDate: string;
  /** 分析结束时间 */
  endDate: string;
  /** 各步骤数据 */
  steps: Array<{
    stepName: string;
    users: number;
    conversionRate: number;
    dropOffRate: number;
  }>;
  /** 整体转化率 */
  overallConversionRate: number;
}

// ========== 配置常量 ==========

/**
 * 默认配置
 */
export const ANALYTICS_CONFIG = {
  /** 批量发送事件阈值 */
  BATCH_SIZE: 50,
  /** 发送间隔（毫秒） */
  FLUSH_INTERVAL: 30000,
  /** 最大重试次数 */
  MAX_RETRIES: 3,
  /** 本地存储事件最大数量 */
  MAX_LOCAL_EVENTS: 1000,
  /** 会话超时时间（毫秒） */
  SESSION_TIMEOUT: 30 * 60 * 1000, // 30分钟
} as const;

// Re-export from existing types for compatibility
export type { UserProfile, ExamType, ApiProvider, TranslationMode } from './index';
