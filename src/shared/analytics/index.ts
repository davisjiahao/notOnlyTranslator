/**
 * Analytics 数据埋点系统
 *
 * 用于增长实验的事件追踪、用户画像、A/B 测试等功能
 *
 * @module analytics
 */

// 核心类
export { Analytics, analytics } from './Analytics';
export { ExperimentFramework, experimentFramework } from './ExperimentFramework';

// 页面访问追踪
export {
  startPageViewTracking,
  stopPageViewTracking,
  getCurrentPageView,
  collectPagePerformanceData,
  trackPagePerformance,
  startSession,
  endSession,
  getCurrentSessionId,
  getCurrentUrlInfo,
  parseReferrer,
  type PageViewData,
  type PageViewSession,
  type PagePerformanceData,
} from './pageView';

// 功能模块
export {
  enqueueEvent,
  enqueueEvents,
  flushEvents,
  getQueueStatus,
  clearQueue,
  initPeriodicFlush,
} from './eventQueue';

export {
  getOrCreateUserId,
  loadUserProfile,
  saveUserProfile,
  initializeUserProfile,
  updateUserProfile,
  updateVocabularyStats,
  updateActivityStats,
  trackUserEvent,
} from './userProfile';

export {
  fnv1a,
  generateExperimentHash,
  assignGroupByWeight,
  assignUserToExperiment,
  isUserInExperimentTraffic,
  loadExperiments,
  saveExperiments,
  loadUserAssignments,
  saveUserAssignments,
  getUserExperimentGroup,
  getUserExperimentGroups,
  createExperimentConfig,
} from './experimentation';

// 漏斗分析
export {
  trackConversion,
  analyzeFunnel,
  trackAcquisition,
  trackActivation,
  trackRetention,
  trackReferral,
  PredefinedFunnels,
  type FunnelStage,
  type ConversionEvent,
  type FunnelConversionData,
} from './funnel';

// 成就系统
export {
  loadAchievementState,
  saveAchievementState,
  checkAndUnlockAchievements,
  getAchievementProgress,
  getUnlockedAchievements,
  getNewAchievements,
  markAchievementAsViewed,
  generateShareCardData,
  shareToPlatform,
  getOrCreateInviteCode,
  trackReferralClick,
  trackReferralInstall,
  recordTranslationCompleted,
  recordWordMarked,
  recordActivityDay,
} from './achievements';

// 类型定义
export type {
  TrackEvent,
  UserTraits,
  LocalEventQueue,
  Experiment,
  ExperimentGroup,
  ExperimentConfig,
  ExperimentStatus,
  ExperimentAssignment,
  UserExperimentAssignment,
  UserAnalyticsProfile,
  FunnelStep,
  FunnelConfig,
  FunnelAnalysis,
  RetentionType,
  RetentionAnalysisRequest,
  AcquisitionEvent,
  ActivationEvent,
  RetentionEvent,
  ReferralEvent,
  AnalyticsEvent,
} from './types';

// 成就系统类型
export type {
  Achievement,
  AchievementTier,
  AchievementCategory,
  UnlockConditionType,
  UnlockCondition,
  AchievementProgress,
  AchievementState,
  ShareCardData,
  ReferralData,
  SharePlatform,
  ShareResult,
} from '@/shared/types/achievements';

// 配置常量
export { AnalyticsEvents } from './types';
export { ANALYTICS_CONFIG } from '../types/analytics';
