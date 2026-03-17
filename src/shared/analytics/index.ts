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

// 工具函数
export {
  generateId,
  getOrCreateSessionId,
  getOrCreateDeviceId,
  deepClone,
  getNestedValue,
  debounce,
  throttle,
} from './utils';

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

// 配置常量
export { AnalyticsEvents } from './types';
export { ANALYTICS_CONFIG } from '../types/analytics';
