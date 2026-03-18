/**
 * 成就系统服务
 * EXP-002: 成就系统与社交分享实验
 *
 * 管理成就解锁、进度追踪和用户统计
 */

import {
  ACHIEVEMENT_CONFIGS,
  type Achievement,
  type AchievementProgress,
  type AchievementState,
  type ShareCardData,
  type ReferralData,
  type SharePlatform,
  type ShareResult,
} from '@/shared/types/achievements';
import { getOrCreateUserId } from './userProfile';
import { trackEvent } from './init';

/** 成就存储键名 */
const ACHIEVEMENTS_KEY = 'not_achievements_state';
const REFERRAL_KEY = 'not_referral_data';
const SHARE_HISTORY_KEY = 'not_share_history';

/**
 * 加载成就状态
 */
export async function loadAchievementState(): Promise<AchievementState> {
  const userId = await getOrCreateUserId();
  const key = `${ACHIEVEMENTS_KEY}:${userId}`;

  try {
    const result = await chrome.storage.sync.get(key);
    const saved = result[key] as AchievementState | undefined;

    if (saved) {
      // 合并新添加的成就配置
      const mergedAchievements = ACHIEVEMENT_CONFIGS.map(config => {
        const existing = saved.achievements.find(a => a.id === config.id);
        return existing
          ? { ...config, ...existing }
          : { ...config, isNew: false };
      });

      return {
        ...saved,
        achievements: mergedAchievements,
      };
    }
  } catch {
    // 尝试本地存储
    try {
      const result = await chrome.storage.local.get(key);
      const saved = result[key] as AchievementState | undefined;
      if (saved) {
        const mergedAchievements = ACHIEVEMENT_CONFIGS.map(config => {
          const existing = saved.achievements.find(a => a.id === config.id);
          return existing
            ? { ...config, ...existing }
            : { ...config, isNew: false };
        });
        return { ...saved, achievements: mergedAchievements };
      }
    } catch {
      // 忽略错误
    }
  }

  // 初始化新状态
  return {
    achievements: ACHIEVEMENT_CONFIGS.map(config => ({ ...config, isNew: false })),
    totalPoints: 0,
    unlockedCount: 0,
    lastCheckedAt: Date.now(),
  };
}

/**
 * 保存成就状态
 */
export async function saveAchievementState(state: AchievementState): Promise<void> {
  const userId = await getOrCreateUserId();
  const key = `${ACHIEVEMENTS_KEY}:${userId}`;

  try {
    await chrome.storage.sync.set({ [key]: state });
  } catch {
    try {
      await chrome.storage.local.set({ [key]: state });
    } catch (error) {
      console.error('[Achievements] Failed to save state:', error);
    }
  }
}

/**
 * 检查并解锁成就
 * @param type 条件类型
 * @param currentValue 当前值
 * @returns 新解锁的成就列表
 */
export async function checkAndUnlockAchievements(
  type: string,
  currentValue: number
): Promise<Achievement[]> {
  const state = await loadAchievementState();
  const newlyUnlocked: Achievement[] = [];

  for (const achievement of state.achievements) {
    // 跳过已解锁的
    if (achievement.unlockedAt) continue;

    // 检查条件是否满足
    if (achievement.condition.type === type && currentValue >= achievement.condition.threshold) {
      achievement.unlockedAt = Date.now();
      achievement.isNew = true;
      newlyUnlocked.push(achievement);

      // 追踪事件
      trackEvent('achievement_unlocked', {
        achievement_id: achievement.id,
        achievement_name: achievement.name,
        achievement_tier: achievement.tier,
        points: achievement.points,
      });
    }
  }

  if (newlyUnlocked.length > 0) {
    // 更新统计
    state.totalPoints = state.achievements
      .filter(a => a.unlockedAt)
      .reduce((sum, a) => sum + a.points, 0);
    state.unlockedCount = state.achievements.filter(a => a.unlockedAt).length;
    state.lastCheckedAt = Date.now();

    await saveAchievementState(state);
  }

  return newlyUnlocked;
}

/**
 * 获取成就进度
 */
export async function getAchievementProgress(): Promise<AchievementProgress[]> {
  const state = await loadAchievementState();
  const userId = await getOrCreateUserId();

  // 获取用户统计数据
  const stats = await getUserStatsForAchievements(userId);

  return state.achievements.map(achievement => {
    const currentValue = getCurrentValueForCondition(achievement.condition.type, stats);

    return {
      achievementId: achievement.id,
      currentValue,
      targetValue: achievement.condition.threshold,
      percentage: Math.min(100, Math.round((currentValue / achievement.condition.threshold) * 100)),
      isUnlocked: !!achievement.unlockedAt,
      unlockedAt: achievement.unlockedAt,
    };
  });
}

/**
 * 标记成就为已查看 (清除 new 标记)
 */
export async function markAchievementAsViewed(achievementId: string): Promise<void> {
  const state = await loadAchievementState();
  const achievement = state.achievements.find(a => a.id === achievementId);

  if (achievement) {
    achievement.isNew = false;
    await saveAchievementState(state);
  }
}

/**
 * 获取所有已解锁成就
 */
export async function getUnlockedAchievements(): Promise<Achievement[]> {
  const state = await loadAchievementState();
  return state.achievements.filter(a => a.unlockedAt);
}

/**
 * 获取新解锁的成就 (未查看)
 */
export async function getNewAchievements(): Promise<Achievement[]> {
  const state = await loadAchievementState();
  return state.achievements.filter(a => a.unlockedAt && a.isNew);
}

/**
 * 生成分享卡片数据
 */
export async function generateShareCardData(
  achievementId: string
): Promise<ShareCardData | null> {
  const state = await loadAchievementState();
  const achievement = state.achievements.find(a => a.id === achievementId);

  if (!achievement || !achievement.unlockedAt) {
    return null;
  }

  const userId = await getOrCreateUserId();
  const stats = await getUserStatsForAchievements(userId);
  const inviteCode = await getOrCreateInviteCode(userId);

  // 生成分享URL
  const shareUrl = `https://not-only-translator.app?utm_source=share&utm_medium=achievement&utm_campaign=${achievementId}&ref=${inviteCode}`;

  return {
    achievement,
    userStats: {
      totalWords: stats.wordsKnown,
      streakDays: stats.consecutiveDays,
      rank: calculateUserRank(state.totalPoints),
    },
    shareUrl,
    inviteCode,
  };
}

/**
 * 分享到指定平台
 */
export async function shareToPlatform(
  platform: SharePlatform,
  data: ShareCardData
): Promise<ShareResult> {
  const text = encodeURIComponent(
    `🏆 我刚刚解锁了「${data.achievement.name}」成就！\n` +
      `${data.achievement.description}\n\n` +
      `📊 已掌握 ${data.userStats.totalWords} 个词汇，连续学习 ${data.userStats.streakDays} 天\n\n` +
      `用 NotOnlyTranslator 提升英语阅读能力，只翻译你需要的单词 📖`
  );

  let url: string;

  switch (platform) {
    case 'twitter':
      url = `https://twitter.com/intent/tweet?text=${text}&url=${encodeURIComponent(data.shareUrl)}`;
      break;
    case 'weibo':
      url = `https://service.weibo.com/share/share.php?title=${text}&url=${encodeURIComponent(data.shareUrl)}`;
      break;
    default:
      url = data.shareUrl;
  }

  // 记录分享事件
  trackEvent('share_clicked', {
    platform,
    achievement_id: data.achievement.id,
  });

  // 保存分享历史
  await recordShareHistory(platform, data.achievement.id);

  // 检查首次分享成就
  await checkAndUnlockAchievements('first_share', 1);

  return {
    platform,
    success: true,
    url,
  };
}

/**
 * 获取或创建邀请码
 */
export async function getOrCreateInviteCode(userId?: string): Promise<string> {
  const uid = userId ?? (await getOrCreateUserId());
  const key = `${REFERRAL_KEY}:${uid}`;

  try {
    const result = await chrome.storage.sync.get(key);
    const existing = result[key] as ReferralData | undefined;

    if (existing) {
      return existing.inviteCode;
    }
  } catch {
    try {
      const result = await chrome.storage.local.get(key);
      const existing = result[key] as ReferralData | undefined;
      if (existing) {
        return existing.inviteCode;
      }
    } catch {
      // 忽略错误
    }
  }

  // 创建新的邀请码
  const inviteCode = generateInviteCode(uid);
  const referralData: ReferralData = {
    inviteCode,
    referrerId: uid,
    createdAt: Date.now(),
    clicks: 0,
    installs: 0,
    activated: 0,
    rewardClaimed: false,
  };

  try {
    await chrome.storage.sync.set({ [key]: referralData });
  } catch {
    try {
      await chrome.storage.local.set({ [key]: referralData });
    } catch (error) {
      console.error('[Achievements] Failed to save referral:', error);
    }
  }

  return inviteCode;
}

/**
 * 追踪邀请链接点击
 */
export async function trackReferralClick(inviteCode: string): Promise<void> {
  // 在实际应用中，这会通过服务器API记录
  trackEvent('invite_link_clicked', { invite_code: inviteCode });
}

/**
 * 追踪推荐安装
 */
export async function trackReferralInstall(inviteCode: string): Promise<void> {
  trackEvent('referral_install', { invite_code: inviteCode });

  // 更新推荐人的邀请数据
  // 注意：实际实现需要通过服务器API或共享存储
}

// ========== 内部辅助函数 ==========

/** 用户统计缓存 */
interface UserStats {
  wordsMarked: number;
  wordsKnown: number;
  consecutiveDays: number;
  totalTranslations: number;
  hasShared: boolean;
  referralsCount: number;
}

/** 获取用户统计数据 */
async function getUserStatsForAchievements(_userId: string): Promise<UserStats> {
  // 从用户画像获取统计数据
  const { loadUserProfile } = await import('./userProfile');
  const profile = await loadUserProfile(_userId);

  // 从本地存储获取活跃天数
  const activityData = await chrome.storage.local.get([
    'not_activity_dates',
    'not_total_translations',
    'not_has_shared',
  ]);

  const activityDates = (activityData['not_activity_dates'] as string[]) ?? [];
  const consecutiveDays = calculateConsecutiveDays(activityDates);

  return {
    wordsMarked: profile?.total_words_marked ?? 0,
    wordsKnown: profile?.total_words_known ?? 0,
    consecutiveDays,
    totalTranslations: (activityData['not_total_translations'] as number) ?? 0,
    hasShared: (activityData['not_has_shared'] as boolean) ?? false,
    referralsCount: 0, // 需要通过服务器获取
  };
}

/** 根据条件类型获取当前值 */
function getCurrentValueForCondition(type: string, stats: UserStats): number {
  switch (type) {
    case 'words_marked_total':
      return stats.wordsMarked;
    case 'words_known_total':
      return stats.wordsKnown;
    case 'consecutive_days':
      return stats.consecutiveDays;
    case 'total_translations':
      return stats.totalTranslations;
    case 'first_share':
      return stats.hasShared ? 1 : 0;
    case 'referrals_count':
      return stats.referralsCount;
    default:
      return 0;
  }
}

/** 计算连续活跃天数 */
function calculateConsecutiveDays(dates: string[]): number {
  if (dates.length === 0) return 0;

  const sorted = [...dates].sort().reverse();
  const today = new Date().toISOString().split('T')[0];

  // 检查今天或昨天是否活跃
  const lastActive = sorted[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  if (lastActive !== today && lastActive !== yesterday) {
    return 0; // 连续已中断
  }

  let consecutive = 1;
  for (let i = 1; i < sorted.length; i++) {
    const current = new Date(sorted[i - 1]);
    const prev = new Date(sorted[i]);
    const diff = (current.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diff === 1) {
      consecutive++;
    } else {
      break;
    }
  }

  return consecutive;
}

/** 计算用户等级 */
function calculateUserRank(points: number): string {
  if (points >= 500) return '词汇大师';
  if (points >= 300) return '学习专家';
  if (points >= 150) return '进阶学者';
  if (points >= 50) return '积极学习者';
  return '初学者';
}

/** 生成邀请码 */
function generateInviteCode(userId: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const userPart = userId.slice(-4).toUpperCase();
  return `NOT${userPart}${timestamp.slice(-4)}`;
}

/** 记录分享历史 */
async function recordShareHistory(platform: string, achievementId: string): Promise<void> {
  const history = {
    platform,
    achievementId,
    timestamp: Date.now(),
  };

  try {
    const result = await chrome.storage.local.get(SHARE_HISTORY_KEY);
    const existing = (result[SHARE_HISTORY_KEY] as typeof history[]) ?? [];
    existing.push(history);
    await chrome.storage.local.set({ [SHARE_HISTORY_KEY]: existing });
    await chrome.storage.local.set({ not_has_shared: true });
  } catch (error) {
    console.error('[Achievements] Failed to record share:', error);
  }
}

// ========== 便利函数 ==========

/**
 * 记录翻译完成
 * 触发相关成就检查
 */
export async function recordTranslationCompleted(): Promise<void> {
  const key = 'not_total_translations';

  try {
    const result = await chrome.storage.local.get(key);
    const count = ((result[key] as number) ?? 0) + 1;
    await chrome.storage.local.set({ [key]: count });

    await checkAndUnlockAchievements('total_translations', count);
  } catch (error) {
    console.error('[Achievements] Failed to record translation:', error);
  }
}

/**
 * 记录词汇标记
 * 触发相关成就检查
 */
export async function recordWordMarked(isKnown: boolean): Promise<void> {
  // 统计由 userProfile.updateVocabularyStats 处理
  // 这里只需要触发成就检查
  const userId = await getOrCreateUserId();
  const stats = await getUserStatsForAchievements(userId);

  await checkAndUnlockAchievements('words_marked_total', stats.wordsMarked + 1);

  if (isKnown) {
    await checkAndUnlockAchievements('words_known_total', stats.wordsKnown + 1);
  }
}

/**
 * 记录活跃天数
 */
export async function recordActivityDay(): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const key = 'not_activity_dates';

  try {
    const result = await chrome.storage.local.get(key);
    const dates = (result[key] as string[]) ?? [];

    if (!dates.includes(today)) {
      dates.push(today);
      // 只保留最近90天
      if (dates.length > 90) {
        dates.shift();
      }
      await chrome.storage.local.set({ [key]: dates });

      const consecutiveDays = calculateConsecutiveDays(dates);
      await checkAndUnlockAchievements('consecutive_days', consecutiveDays);
    }
  } catch (error) {
    console.error('[Achievements] Failed to record activity:', error);
  }
}
