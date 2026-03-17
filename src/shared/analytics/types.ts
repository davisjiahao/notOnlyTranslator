/**
 * Analytics 类型定义
 * 用于增长实验和用户行为追踪
 */

// ========== 事件追踪类型 ==========

/** 事件追踪数据 */
export interface TrackEvent {
  event: string
  properties?: Record<string, unknown>
  timestamp: number
  userId?: string
  sessionId?: string
}

/** 用户属性 */
export interface UserTraits {
  userId: string
  installDate: number
  installSource?: string
  initialLevel?: string
  apiProvider?: string
  experimentGroups?: Record<string, string>
  referrerId?: string
  [key: string]: unknown
}

// ========== A/B 测试类型 ==========

/** 实验配置 */
export interface Experiment {
  id: string
  name: string
  description: string
  startDate: string
  endDate: string
  trafficAllocation: number
  groups: ExperimentGroup[]
  primaryMetric: string
  secondaryMetrics: string[]
  minimumSampleSize: number
}

/** 实验分组 */
export interface ExperimentGroup {
  id: string
  name: string
  weight: number
  variant: string
  config?: Record<string, unknown>
}

/** 用户实验分配 */
export interface UserExperimentAssignment {
  experimentId: string
  groupId: string
  variant: string
  assignedAt: number
}

// ========== 漏斗分析类型 ==========

/** 漏斗步骤 */
export interface FunnelStep {
  name: string
  event: string
  filter?: Record<string, unknown>
}

/** 漏斗分析请求 */
export interface FunnelAnalysisRequest {
  funnelName: string
  steps: FunnelStep[]
  startDate: number
  endDate: number
}

/** 漏斗分析结果 */
export interface FunnelAnalysisResult {
  funnelName: string
  steps: Array<{
    name: string
    count: number
    conversionRate: number
    dropOffRate: number
  }>
  totalConversionRate: number
}

// ========== 留存分析类型 ==========

/** 留存分析类型 */
export type RetentionType = 'n-day' | 'unbounded' | 'rolling'

/** 留存分析请求 */
export interface RetentionAnalysisRequest {
  cohortEvent: string
  returnEvent: string
  startDate: number
  endDate: number
  retentionType: RetentionType
  retentionDays: number[]
}

// ========== 分析仪表板配置 ==========

/** 仪表板指标卡片 */
export interface MetricCard {
  id: string
  title: string
  metric: string
  format: 'number' | 'percentage' | 'time' | 'currency'
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: number
  comparisonPeriod?: 'day' | 'week' | 'month'
}

/** 仪表板配置 */
export interface DashboardConfig {
  id: string
  name: string
  description: string
  cards: MetricCard[]
  defaultDateRange: '7d' | '30d' | '90d'
  refreshInterval: number
}

// ========== 增长实验特定事件 ==========

/** 预定义事件名称 */
export const AnalyticsEvents = {
  // 获客阶段
  STORE_VIEW: 'store_view',
  STORE_CLICK: 'store_click',
  INSTALL_COMPLETE: 'install_complete',
  INSTALL_SOURCE: 'install_source',

  // 激活阶段
  ONBOARDING_START: 'onboarding_start',
  ONBOARDING_STEP_COMPLETE: 'onboarding_step_complete',
  ONBOARDING_COMPLETE: 'onboarding_complete',
  ONBOARDING_SKIP: 'onboarding_skip',
  FIRST_TRANSLATION: 'first_translation',
  FIRST_WORD_MARKED: 'first_word_marked',
  API_CONFIGURED: 'api_configured',
  TRIAL_QUOTA_USED: 'trial_quota_used',

  // 留存阶段
  TRANSLATION_REQUEST: 'translation_request',
  WORD_MARKED: 'word_marked',
  VOCABULARY_REVIEW: 'vocabulary_review',
  FLASHCARD_PRACTICE: 'flashcard_practice',
  SETTINGS_CHANGED: 'settings_changed',
  THEME_SWITCHED: 'theme_switched',
  DATA_EXPORTED: 'data_exported',

  // 推荐阶段
  ACHIEVEMENT_UNLOCKED: 'achievement_unlocked',
  SHARE_CLICKED: 'share_clicked',
  SHARE_COMPLETED: 'share_completed',
  INVITE_LINK_GENERATED: 'invite_link_generated',
  REFERRAL_INSTALL: 'referral_install',
  REFERRAL_ACTIVATED: 'referral_activated',

  // 实验相关
  EXPERIMENT_ASSIGNED: 'experiment_assigned',
  EXPERIMENT_CONVERTED: 'experiment_converted',
} as const

/** 实验状态 */
export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'cancelled'

/** 用户漏斗阶段 */
export type UserFunnelStage = 'acquisition' | 'activation' | 'retention' | 'referral' | 'revenue'

// ========== 缺失的类型别名（用于兼容性） ==========

/** @deprecated 使用 UserExperimentAssignment 代替 */
export type ExperimentAssignment = UserExperimentAssignment

/** @deprecated 使用 Experiment 代替 */
export type ExperimentConfig = Experiment

/** 用户分析画像（简化版） */
export interface UserAnalyticsProfile {
  userId: string
  traits: UserTraits
  createdAt: number
  updatedAt: number
  experimentGroups?: Record<string, string>
  vocabularyStats?: {
    totalMarked: number
    knownWords: number
    unknownWords: number
  }
}

/** 漏斗配置 */
export interface FunnelConfig {
  id: string
  name: string
  steps: FunnelStep[]
}

/** 漏斗分析结果（别名） */
export type FunnelAnalysis = FunnelAnalysisResult

/** 获客事件 */
export interface AcquisitionEvent {
  type: 'store_view' | 'store_click' | 'install_complete'
  source?: string
  timestamp: number
  properties?: Record<string, unknown>
}

/** 激活事件 */
export interface ActivationEvent {
  type: 'onboarding_complete' | 'first_translation' | 'api_configured'
  timestamp: number
  properties?: Record<string, unknown>
}

/** 留存事件 */
export interface RetentionEvent {
  type: 'translation_request' | 'vocabulary_review' | 'flashcard_practice'
  timestamp: number
  properties?: Record<string, unknown>
}

/** 推荐事件 */
export interface ReferralEvent {
  type: 'share_completed' | 'invite_sent' | 'referral_install'
  timestamp: number
  properties?: Record<string, unknown>
}

/** 通用分析事件 */
export interface AnalyticsEvent {
  id: string
  event: string
  properties: Record<string, unknown>
  timestamp: number
  userId?: string
  sessionId?: string
}
