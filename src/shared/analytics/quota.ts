/**
 * API 试用配额管理服务
 * EXP-003: API 试用配额机制实验
 *
 * 管理用户翻译配额的发放、消耗和追踪
 */

import type {
  QuotaState,
  QuotaSource,
  QuotaUsageRecord,
  QuotaConsumeResult,
  QuotaGrantResult,
  QuotaAlert,
  DeviceQuotaInfo,
  QuotaType,
} from '@/shared/types/quota';
import {
  DEFAULT_QUOTA_CONFIG,
} from '@/shared/types/quota';
import { getOrCreateUserId } from './userProfile';
import { trackEvent } from './init';

/** 配额存储键名 */
const QUOTA_STATE_KEY = 'not_quota_state';
const DEVICE_INFO_KEY = 'not_device_quota_info';
const DEVICE_ID_KEY = 'not_device_id';

/**
 * 生成设备 ID
 */
function generateDeviceId(): string {
  const random = Math.random().toString(36).substring(2, 15);
  const timestamp = Date.now().toString(36);
  return `dev_${timestamp}_${random}`;
}

/**
 * 获取或创建设备 ID
 */
async function getOrCreateDeviceId(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(DEVICE_ID_KEY);
    if (result[DEVICE_ID_KEY]) {
      return result[DEVICE_ID_KEY] as string;
    }
  } catch {
    // 忽略错误
  }

  const deviceId = generateDeviceId();
  try {
    await chrome.storage.local.set({ [DEVICE_ID_KEY]: deviceId });
  } catch (error) {
    console.error('[Quota] Failed to save device ID:', error);
  }
  return deviceId;
}

/**
 * 加载配额状态
 */
export async function loadQuotaState(): Promise<QuotaState> {
  const userId = await getOrCreateUserId();
  const key = `${QUOTA_STATE_KEY}:${userId}`;

  try {
    const result = await chrome.storage.sync.get(key);
    const saved = result[key] as QuotaState | undefined;

    if (saved) {
      return saved;
    }
  } catch {
    try {
      const result = await chrome.storage.local.get(key);
      const saved = result[key] as QuotaState | undefined;
      if (saved) {
        return saved;
      }
    } catch {
      // 忽略错误
    }
  }

  // 初始化新状态
  return {
    totalQuota: 0,
    usedQuota: 0,
    remainingQuota: 0,
    sources: [],
    usageHistory: [],
    lastRefreshedAt: Date.now(),
  };
}

/**
 * 保存配额状态
 */
export async function saveQuotaState(state: QuotaState): Promise<void> {
  const userId = await getOrCreateUserId();
  const key = `${QUOTA_STATE_KEY}:${userId}`;

  try {
    await chrome.storage.sync.set({ [key]: state });
  } catch {
    try {
      await chrome.storage.local.set({ [key]: state });
    } catch (error) {
      console.error('[Quota] Failed to save state:', error);
    }
  }
}

/**
 * 检查是否是新用户 (没有配额记录)
 */
export async function isNewUser(): Promise<boolean> {
  const state = await loadQuotaState();
  return state.sources.length === 0;
}

/**
 * 检查设备是否还可以获得免费配额
 */
export async function canDeviceGetFreeQuota(): Promise<boolean> {
  const deviceId = await getOrCreateDeviceId();
  const key = `${DEVICE_INFO_KEY}:${deviceId}`;

  try {
    const result = await chrome.storage.local.get(key);
    const info = result[key] as DeviceQuotaInfo | undefined;

    if (!info) {
      return true;
    }

    return info.resetCount < DEFAULT_QUOTA_CONFIG.MAX_DEVICE_RESETS;
  } catch {
    return true;
  }
}

/**
 * 记录设备配额发放
 */
async function recordDeviceQuotaGranted(amount: number): Promise<void> {
  const deviceId = await getOrCreateDeviceId();
  const key = `${DEVICE_INFO_KEY}:${deviceId}`;

  try {
    const result = await chrome.storage.local.get(key);
    const existing = result[key] as DeviceQuotaInfo | undefined;

    const now = Date.now();
    const info: DeviceQuotaInfo = existing
      ? {
          ...existing,
          totalQuotaGranted: existing.totalQuotaGranted + amount,
          resetCount: existing.resetCount + 1,
          lastSeenAt: now,
        }
      : {
          deviceId,
          totalQuotaGranted: amount,
          resetCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
        };

    await chrome.storage.local.set({ [key]: info });
  } catch (error) {
    console.error('[Quota] Failed to record device quota:', error);
  }
}

/**
 * 发放新用户免费试用配额
 */
export async function grantFreeTrialQuota(): Promise<QuotaGrantResult> {
  // 检查是否是新用户
  if (!(await isNewUser())) {
    return {
      success: false,
      granted: 0,
      totalQuota: 0,
      error: '用户已有配额记录',
    };
  }

  // 检查设备限制
  if (!(await canDeviceGetFreeQuota())) {
    return {
      success: false,
      granted: 0,
      totalQuota: 0,
      error: '设备已达最大重置次数',
    };
  }

  const amount = DEFAULT_QUOTA_CONFIG.FREE_TRIAL_QUOTA;

  // 创建配额来源
  const source: QuotaSource = {
    type: 'free_trial',
    amount,
    description: '新用户免费试用额度',
    acquiredAt: Date.now(),
  };

  // 更新状态
  const state = await loadQuotaState();
  state.sources.push(source);
  state.totalQuota += amount;
  state.remainingQuota = state.totalQuota - state.usedQuota;
  state.lastRefreshedAt = Date.now();

  await saveQuotaState(state);
  await recordDeviceQuotaGranted(amount);

  // 追踪事件
  trackEvent('quota_granted', {
    type: 'free_trial',
    amount,
    total_quota: state.totalQuota,
  });

  return {
    success: true,
    granted: amount,
    totalQuota: state.totalQuota,
  };
}

/**
 * 发放邀请奖励配额
 */
export async function grantReferralBonusQuota(): Promise<QuotaGrantResult> {
  const amount = DEFAULT_QUOTA_CONFIG.REFERRAL_BONUS_QUOTA;

  const source: QuotaSource = {
    type: 'referral_bonus',
    amount,
    description: '邀请奖励额度',
    acquiredAt: Date.now(),
  };

  const state = await loadQuotaState();
  state.sources.push(source);
  state.totalQuota += amount;
  state.remainingQuota = state.totalQuota - state.usedQuota;
  state.lastRefreshedAt = Date.now();

  await saveQuotaState(state);

  trackEvent('quota_granted', {
    type: 'referral_bonus',
    amount,
    total_quota: state.totalQuota,
  });

  return {
    success: true,
    granted: amount,
    totalQuota: state.totalQuota,
  };
}

/**
 * 消耗配额
 */
export async function consumeQuota(context: string): Promise<QuotaConsumeResult> {
  const state = await loadQuotaState();

  // 检查是否有配额
  if (state.remainingQuota <= 0) {
    const alert: QuotaAlert = {
      level: 'exhausted',
      message: '您的免费翻译额度已用完，请配置 API Key 继续使用',
      remaining: 0,
      action: '配置 API Key',
    };

    trackEvent('quota_exhausted', { context });

    return {
      success: false,
      remaining: 0,
      error: '配额已用完',
      alert,
    };
  }

  // 扣除配额
  state.usedQuota += 1;
  state.remainingQuota = state.totalQuota - state.usedQuota;

  // 记录使用
  const record: QuotaUsageRecord = {
    timestamp: Date.now(),
    amount: 1,
    context,
    success: true,
  };
  state.usageHistory.push(record);

  // 只保留最近 100 条记录
  if (state.usageHistory.length > 100) {
    state.usageHistory = state.usageHistory.slice(-100);
  }

  await saveQuotaState(state);

  // 检查是否需要警告
  const alert = getQuotaAlert(state.remainingQuota);

  trackEvent('quota_consumed', {
    context,
    remaining: state.remainingQuota,
    alert_level: alert?.level,
  });

  return {
    success: true,
    remaining: state.remainingQuota,
    alert,
  };
}

/**
 * 获取配额警告
 */
function getQuotaAlert(remaining: number): QuotaAlert | undefined {
  if (remaining === 0) {
    return {
      level: 'exhausted',
      message: '您的免费翻译额度已用完',
      remaining: 0,
      action: '配置 API Key',
    };
  }

  if (remaining <= DEFAULT_QUOTA_CONFIG.CRITICAL_QUOTA_THRESHOLD) {
    return {
      level: 'critical',
      message: `仅剩 ${remaining} 次免费翻译机会，请尽快配置 API Key`,
      remaining,
      action: '配置 API Key',
    };
  }

  if (remaining <= DEFAULT_QUOTA_CONFIG.LOW_QUOTA_THRESHOLD) {
    return {
      level: 'low',
      message: `剩余 ${remaining} 次免费翻译机会`,
      remaining,
    };
  }

  return undefined;
}

/**
 * 获取当前配额状态
 */
export async function getQuotaStatus(): Promise<{
  total: number;
  used: number;
  remaining: number;
  alert?: QuotaAlert;
}> {
  const state = await loadQuotaState();

  return {
    total: state.totalQuota,
    used: state.usedQuota,
    remaining: state.remainingQuota,
    alert: getQuotaAlert(state.remainingQuota),
  };
}

/**
 * 检查是否有足够配额
 */
export async function hasEnoughQuota(): Promise<boolean> {
  const state = await loadQuotaState();
  return state.remainingQuota > 0;
}

/**
 * 获取配额使用统计
 */
export async function getQuotaStats(): Promise<{
  totalGranted: number;
  totalUsed: number;
  bySource: Record<QuotaType, number>;
  averageDailyUse: number;
}> {
  const state = await loadQuotaState();

  // 按来源统计
  const bySource: Record<QuotaType, number> = {
    free_trial: 0,
    referral_bonus: 0,
    purchase: 0,
    promotional: 0,
  };

  for (const source of state.sources) {
    bySource[source.type] += source.amount;
  }

  // 计算日均使用量
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const daysSinceStart = state.sources.length > 0
    ? Math.max(1, Math.floor((now - Math.min(...state.sources.map(s => s.acquiredAt))) / oneDay))
    : 1;

  const averageDailyUse = Math.round(state.usedQuota / daysSinceStart);

  return {
    totalGranted: state.totalQuota,
    totalUsed: state.usedQuota,
    bySource,
    averageDailyUse,
  };
}

/**
 * 初始化新用户配额
 * 应在用户首次使用时调用
 */
export async function initializeNewUserQuota(): Promise<QuotaGrantResult> {
  // 检查是否已有配额
  const state = await loadQuotaState();
  if (state.totalQuota > 0) {
    return {
      success: false,
      granted: 0,
      totalQuota: state.totalQuota,
      error: '用户已有配额',
    };
  }

  return grantFreeTrialQuota();
}
