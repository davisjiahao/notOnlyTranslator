/**
 * API 试用配额系统类型定义
 * EXP-003: API 试用配额机制实验
 */

/** 配额类型 */
export type QuotaType = 'free_trial' | 'referral_bonus' | 'purchase' | 'promotional';

/** 配额来源 */
export interface QuotaSource {
  type: QuotaType;
  amount: number;
  description: string;
  acquiredAt: number;
  expiresAt?: number;
}

/** 用户使用记录 */
export interface QuotaUsageRecord {
  timestamp: number;
  amount: number;
  context: string;
  success: boolean;
}

/** 配额状态 */
export interface QuotaState {
  totalQuota: number;
  usedQuota: number;
  remainingQuota: number;
  sources: QuotaSource[];
  usageHistory: QuotaUsageRecord[];
  lastRefreshedAt: number;
}

/** 设备配额追踪 */
export interface DeviceQuotaInfo {
  deviceId: string;
  totalQuotaGranted: number;
  resetCount: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

/** IP 配额追踪 */
export interface IpQuotaInfo {
  ip: string;
  newUsersToday: number;
  lastNewUserAt: number;
}

/** 配额警告级别 */
export type QuotaAlertLevel = 'none' | 'low' | 'critical' | 'exhausted';

/** 配额警告 */
export interface QuotaAlert {
  level: QuotaAlertLevel;
  message: string;
  remaining: number;
  action?: string;
}

/** 配额检查配置 */
export interface QuotaCheckConfig {
  /** 新用户默认免费额度 */
  FREE_TRIAL_QUOTA: number;
  /** 邀请奖励额度 */
  REFERRAL_BONUS_QUOTA: number;
  /** 每设备最大重置次数 */
  MAX_DEVICE_RESETS: number;
  /** 每日每 IP 最大新用户数 */
  MAX_NEW_USERS_PER_IP_PER_DAY: number;
  /** 低配额警告阈值 */
  LOW_QUOTA_THRESHOLD: number;
  /** 临界配额警告阈值 */
  CRITICAL_QUOTA_THRESHOLD: number;
}

/** 默认配额配置 */
export const DEFAULT_QUOTA_CONFIG: QuotaCheckConfig = {
  FREE_TRIAL_QUOTA: 100,
  REFERRAL_BONUS_QUOTA: 50,
  MAX_DEVICE_RESETS: 5,
  MAX_NEW_USERS_PER_IP_PER_DAY: 3,
  LOW_QUOTA_THRESHOLD: 20,
  CRITICAL_QUOTA_THRESHOLD: 5,
};

/** 配额消耗结果 */
export interface QuotaConsumeResult {
  success: boolean;
  remaining: number;
  error?: string;
  alert?: QuotaAlert;
}

/** 配额赠送结果 */
export interface QuotaGrantResult {
  success: boolean;
  granted: number;
  totalQuota: number;
  error?: string;
}
