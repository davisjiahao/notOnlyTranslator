/**
 * 用户画像追踪
 *
 * 管理用户属性、实验分组和用户生命周期追踪
 *
 * @module analytics/userProfile
 */

import type {
  UserAnalyticsProfile,
  TrackEvent,
} from '../types/analytics';
import { ANALYTICS_CONFIG } from '../types/analytics';
import { getUserExperimentGroups } from './experimentation';
import { generateId, getOrCreateSessionId } from './utils';

/** 用户画像存储键名 */
const USER_PROFILE_KEY = 'analytics_user_profile';

/** 用户ID存储键名 */
const USER_ID_KEY = 'analytics_user_id';

/**
 * 获取或创建用户ID
 * @returns 用户唯一标识
 */
export async function getOrCreateUserId(): Promise<string> {
  try {
    const result = await chrome.storage.sync.get(USER_ID_KEY);
    if (result[USER_ID_KEY]) {
      return result[USER_ID_KEY] as string;
    }
  } catch {
    // 同步存储失败，尝试本地存储
    try {
      const result = await chrome.storage.local.get(USER_ID_KEY);
      if (result[USER_ID_KEY]) {
        return result[USER_ID_KEY] as string;
      }
    } catch {
      // 忽略错误
    }
  }

  // 创建新用户ID
  const userId = generateId();
  try {
    await chrome.storage.sync.set({ [USER_ID_KEY]: userId });
  } catch {
    // 同步存储失败，使用本地存储
    try {
      await chrome.storage.local.set({ [USER_ID_KEY]: userId });
    } catch {
      // 忽略错误
    }
  }

  return userId;
}

/**
 * 加载用户画像
 * @param userId - 用户ID
 * @returns 用户画像或null
 */
export async function loadUserProfile(
  userId: string
): Promise<UserAnalyticsProfile | null> {
  try {
    const key = `${USER_PROFILE_KEY}:${userId}`;
    const result = await chrome.storage.sync.get(key);
    return (result[key] as UserAnalyticsProfile) ?? null;
  } catch {
    // 尝试从本地存储加载
    try {
      const key = `${USER_PROFILE_KEY}:${userId}`;
      const result = await chrome.storage.local.get(key);
      return (result[key] as UserAnalyticsProfile) ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * 保存用户画像
 * @param userId - 用户ID
 * @param profile - 用户画像
 */
export async function saveUserProfile(
  userId: string,
  profile: UserAnalyticsProfile
): Promise<void> {
  const key = `${USER_PROFILE_KEY}:${userId}`;
  try {
    await chrome.storage.sync.set({ [key]: profile });
  } catch {
    // 同步存储失败，使用本地存储
    try {
      await chrome.storage.local.set({ [key]: profile });
    } catch (error) {
      console.error('[Analytics] Failed to save user profile:', error);
    }
  }
}

/**
 * 初始化用户画像
 * @param options - 初始化选项
 * @returns 初始化后的用户画像
 */
export async function initializeUserProfile(options: {
  installSource?: string;
  initialLevel?: string;
  apiProvider?: string;
  referrerId?: string;
} = {}): Promise<UserAnalyticsProfile> {
  const userId = await getOrCreateUserId();

  // 检查是否已存在画像
  const existingProfile = await loadUserProfile(userId);
  if (existingProfile) {
    return existingProfile;
  }

  // 获取实验分组
  const experimentGroups = await getUserExperimentGroups(userId);

  // 创建新画像
  const now = new Date().toISOString();
  const profile: UserAnalyticsProfile = {
    user_id: userId,
    install_date: now,
    install_source: options.installSource ?? 'organic',
    initial_level: options.initialLevel ?? 'unknown',
    api_provider: options.apiProvider ?? 'unknown',
    last_active_date: now,
    total_words_marked: 0,
    total_words_known: 0,
    current_vocabulary_estimate: 0,
    experiment_groups: experimentGroups,
    referrer_id: options.referrerId,
    days_active_last_7: 0,
    days_active_last_30: 0,
  };

  await saveUserProfile(userId, profile);

  // 追踪安装事件
  await trackUserEvent('install_complete', {
    source: options.installSource,
    referrer_id: options.referrerId,
  });

  return profile;
}

/**
 * 更新用户画像
 * @param updates - 部分更新的字段
 * @returns 更新后的用户画像
 */
export async function updateUserProfile(
  updates: Partial<Omit<UserAnalyticsProfile, 'user_id'>>
): Promise<UserAnalyticsProfile | null> {
  const userId = await getOrCreateUserId();
  const profile = await loadUserProfile(userId);

  if (!profile) {
    return null;
  }

  const updatedProfile: UserAnalyticsProfile = {
    ...profile,
    ...updates,
    user_id: userId, // 确保 user_id 不被覆盖
    last_active_date: new Date().toISOString(),
  };

  await saveUserProfile(userId, updatedProfile);
  return updatedProfile;
}

/**
 * 更新用户词汇统计
 * @param wordsMarked - 本次标记的词汇数
 * @param wordsKnown - 本次掌握的词汇数
 */
export async function updateVocabularyStats(
  wordsMarked: number,
  wordsKnown: number
): Promise<void> {
  const userId = await getOrCreateUserId();
  const profile = await loadUserProfile(userId);

  if (!profile) {
    return;
  }

  const updatedProfile: UserAnalyticsProfile = {
    ...profile,
    total_words_marked: profile.total_words_marked + wordsMarked,
    total_words_known: profile.total_words_known + wordsKnown,
    last_active_date: new Date().toISOString(),
  };

  await saveUserProfile(userId, updatedProfile);
}

/**
 * 更新活跃天数统计
 * @param isActive - 今日是否活跃
 */
export async function updateActivityStats(isActive: boolean): Promise<void> {
  if (!isActive) return;

  const userId = await getOrCreateUserId();
  const profile = await loadUserProfile(userId);

  if (!profile) {
    return;
  }

  // 检查今天是否已计入活跃
  const today = new Date().toISOString().split('T')[0];
  const lastActiveDate = profile.last_active_date.split('T')[0];

  if (lastActiveDate === today) {
    // 今天已经活跃过了
    return;
  }

  const updatedProfile: UserAnalyticsProfile = {
    ...profile,
    days_active_last_7: Math.min(7, profile.days_active_last_7 + 1),
    days_active_last_30: Math.min(30, profile.days_active_last_30 + 1),
    last_active_date: new Date().toISOString(),
  };

  await saveUserProfile(userId, updatedProfile);
}

/**
 * 追踪用户事件并自动关联用户画像
 * @param eventName - 事件名称
 * @param properties - 事件属性
 */
export async function trackUserEvent(
  eventName: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  const userId = await getOrCreateUserId();
  const sessionId = await getOrCreateSessionId();
  const deviceId = await getOrCreateDeviceId();

  const event: TrackEvent = {
    event: eventName,
    properties,
    timestamp: Date.now(),
    user_id: userId,
    session_id: sessionId,
    device_id: deviceId,
  };

  const { enqueueEvent } = await import('./eventQueue');
  await enqueueEvent(event);
}

// ========== 内部辅助函数 ==========

/**
 * 获取或创建会话ID
 * @returns 会话ID
 */
async function getOrCreateSessionId(): Promise<string> {
  const SESSION_KEY = 'analytics_session_id';
  const SESSION_TIMESTAMP_KEY = 'analytics_session_timestamp';

  try {
    const result = await chrome.storage.session.get([SESSION_KEY, SESSION_TIMESTAMP_KEY]);
    const existingSession = result[SESSION_KEY] as string | undefined;
    const lastActivity = result[SESSION_TIMESTAMP_KEY] as number | undefined;

    const now = Date.now();

    // 检查会话是否超时
    if (existingSession && lastActivity) {
      if (now - lastActivity < ANALYTICS_CONFIG.SESSION_TIMEOUT) {
        // 更新活动时间
        await chrome.storage.session.set({ [SESSION_TIMESTAMP_KEY]: now });
        return existingSession;
      }
    }

    // 创建新会话
    const newSessionId = generateId();
    await chrome.storage.session.set({
      [SESSION_KEY]: newSessionId,
      [SESSION_TIMESTAMP_KEY]: now,
    });
    return newSessionId;
  } catch {
    // 如果存储访问失败，返回临时会话ID
    return generateId();
  }
}

/**
 * 获取或创建设备ID
 * @returns 设备ID
 */
async function getOrCreateDeviceId(): Promise<string> {
  const DEVICE_KEY = 'analytics_device_id';

  try {
    const result = await chrome.storage.local.get(DEVICE_KEY);
    if (result[DEVICE_KEY]) {
      return result[DEVICE_KEY] as string;
    }

    // 创建新设备ID
    const deviceId = generateId();
    await chrome.storage.local.set({ [DEVICE_KEY]: deviceId });
    return deviceId;
  } catch {
    // 存储访问失败，返回临时ID
    return generateId();
  }
}

/**
 * 生成唯一ID
 * @returns 唯一标识符
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

// Re-export types for convenience
export type {
  ExperimentConfig,
  ExperimentGroup,
  ExperimentAssignment,
  UserAnalyticsProfile,
  TrackEvent,
} from '../types/analytics';
