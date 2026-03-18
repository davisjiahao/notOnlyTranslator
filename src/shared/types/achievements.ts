/**
 * 成就系统类型定义
 * EXP-002: 成就系统与社交分享实验
 */

/** 成就等级 */
export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'platinum';

/** 成就类别 */
export type AchievementCategory = 'vocabulary' | 'streak' | 'social' | 'milestone';

/** 成就解锁条件类型 */
export type UnlockConditionType =
  | 'words_marked_total'
  | 'words_known_total'
  | 'consecutive_days'
  | 'total_translations'
  | 'first_share'
  | 'referrals_count';

/** 成就解锁条件 */
export interface UnlockCondition {
  type: UnlockConditionType;
  threshold: number;
  description: string;
}

/** 成就定义 */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  tier: AchievementTier;
  category: AchievementCategory;
  condition: UnlockCondition;
  points: number;
  unlockedAt?: number;
  isNew?: boolean;
}

/** 用户成就进度 */
export interface AchievementProgress {
  achievementId: string;
  currentValue: number;
  targetValue: number;
  percentage: number;
  isUnlocked: boolean;
  unlockedAt?: number;
}

/** 成就系统状态 */
export interface AchievementState {
  achievements: Achievement[];
  totalPoints: number;
  unlockedCount: number;
  lastCheckedAt: number;
}

/** 分享卡片数据 */
export interface ShareCardData {
  achievement: Achievement;
  userStats: {
    totalWords: number;
    streakDays: number;
    rank?: string;
  };
  shareUrl: string;
  inviteCode: string;
}

/** 邀请追踪数据 */
export interface ReferralData {
  inviteCode: string;
  referrerId: string;
  createdAt: number;
  clicks: number;
  installs: number;
  activated: number;
  rewardClaimed: boolean;
}

/** 分享平台 */
export type SharePlatform = 'twitter' | 'weibo' | 'wechat' | 'copy';

/** 分享结果 */
export interface ShareResult {
  platform: SharePlatform;
  success: boolean;
  url?: string;
  error?: string;
}

// ========== 预定义成就配置 ==========

/** 成就配置列表 */
export const ACHIEVEMENT_CONFIGS: Omit<Achievement, 'unlockedAt' | 'isNew'>[] = [
  {
    id: 'first_word',
    name: '词汇小白',
    description: '标记了第一个生词，开启学习之旅',
    icon: '🌱',
    tier: 'bronze',
    category: 'vocabulary',
    condition: {
      type: 'words_marked_total',
      threshold: 1,
      description: '标记1个生词',
    },
    points: 10,
  },
  {
    id: 'streak_3_days',
    name: '每日学习',
    description: '连续3天使用扩展，养成学习习惯',
    icon: '🔥',
    tier: 'silver',
    category: 'streak',
    condition: {
      type: 'consecutive_days',
      threshold: 3,
      description: '连续3天活跃',
    },
    points: 50,
  },
  {
    id: 'vocabulary_master',
    name: '词汇达人',
    description: '掌握了100个词汇，进步显著',
    icon: '📚',
    tier: 'gold',
    category: 'vocabulary',
    condition: {
      type: 'words_known_total',
      threshold: 100,
      description: '掌握100个词汇',
    },
    points: 100,
  },
  {
    id: 'dedication',
    name: '坚持不懈',
    description: '连续30天使用，学习已成为习惯',
    icon: '💎',
    tier: 'platinum',
    category: 'streak',
    condition: {
      type: 'consecutive_days',
      threshold: 30,
      description: '连续30天活跃',
    },
    points: 300,
  },
  {
    id: 'translator',
    name: '翻译新手',
    description: '完成首次翻译，开始探索英文世界',
    icon: '🌐',
    tier: 'bronze',
    category: 'milestone',
    condition: {
      type: 'total_translations',
      threshold: 1,
      description: '完成1次翻译',
    },
    points: 10,
  },
  {
    id: 'sharer',
    name: '分享达人',
    description: '首次分享成就，与朋友一起进步',
    icon: '📢',
    tier: 'silver',
    category: 'social',
    condition: {
      type: 'first_share',
      threshold: 1,
      description: '首次分享成就',
    },
    points: 30,
  },
  {
    id: 'referrer',
    name: '推荐大使',
    description: '成功邀请1位朋友使用',
    icon: '🤝',
    tier: 'gold',
    category: 'social',
    condition: {
      type: 'referrals_count',
      threshold: 1,
      description: '成功邀请1位朋友',
    },
    points: 100,
  },
];

/** 等级名称映射 */
export const TIER_NAMES: Record<AchievementTier, string> = {
  bronze: '青铜',
  silver: '白银',
  gold: '黄金',
  platinum: '铂金',
};

/** 等级颜色映射 (Tailwind classes) */
export const TIER_COLORS: Record<AchievementTier, { bg: string; text: string; border: string }> = {
  bronze: {
    bg: 'bg-amber-100',
    text: 'text-amber-800',
    border: 'border-amber-300',
  },
  silver: {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-300',
  },
  gold: {
    bg: 'bg-yellow-100',
    text: 'text-yellow-800',
    border: 'border-yellow-300',
  },
  platinum: {
    bg: 'bg-purple-100',
    text: 'text-purple-800',
    border: 'border-purple-300',
  },
};
