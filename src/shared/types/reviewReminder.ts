/**
 * 复习提醒系统类型定义
 * Review Reminder System Type Definitions
 */

/**
 * 复习提醒配置
 * Review Reminder Configuration
 */
export interface ReviewReminderConfig {
  /** 是否启用复习提醒 */
  enabled: boolean;
  /** 提醒时间（小时，24小时制） */
  reminderHour: number;
  /** 提醒时间（分钟） */
  reminderMinute: number;
  /** 每日复习数量上限 */
  dailyReviewLimit: number;
  /** 最小待复习词汇数量才触发提醒 */
  minWordsForReminder: number;
  /** 是否启用浏览器通知 */
  enableNotifications: boolean;
  /** 连续正确多少次视为已掌握 */
  masteredThreshold: number;
}

/**
 * 默认复习提醒配置
 */
export const DEFAULT_REVIEW_REMINDER_CONFIG: ReviewReminderConfig = {
  enabled: true,
  reminderHour: 20, // 晚上8点
  reminderMinute: 0,
  dailyReviewLimit: 20,
  minWordsForReminder: 5,
  enableNotifications: true,
  masteredThreshold: 3,
};

/**
 * SM-2 算法参数
 * SM-2 Algorithm Parameters
 */
export interface SM2Parameters {
  /** 最小间隔因子 */
  minEaseFactor: number;
  /** 默认间隔因子 */
  defaultEaseFactor: number;
  /** 简单回答间隔倍数 */
  easyBonus: number;
  /** 失败后重置间隔 */
  lapseResetInterval: number;
}

/**
 * 默认 SM-2 参数
 */
export const DEFAULT_SM2_PARAMETERS: SM2Parameters = {
  minEaseFactor: 1.3,
  defaultEaseFactor: 2.5,
  easyBonus: 1.3,
  lapseResetInterval: 1, // 1天
};

/**
 * 复习质量评分（SM-2 使用 0-5 分制）
 * Review Quality Rating
 */
export enum ReviewQuality {
  /** 完全忘记 */
  COMPLETE_FORGET = 0,
  /** 错误，但记得见过 */
  WRONG_BUT_FAMILIAR = 1,
  /** 错误，但想起来很费劲 */
  WRONG_HARD = 2,
  /** 正确，但很费劲 */
  CORRECT_HARD = 3,
  /** 正确，稍微想了想 */
  CORRECT_EASY = 4,
  /** 立即正确 */
  CORRECT_INSTANT = 5,
}

/**
 * 复习计划项
 * Review Schedule Item
 */
export interface ReviewScheduleItem {
  /** 单词 */
  word: string;
  /** 下次复习时间 */
  nextReviewAt: number;
  /** 当前间隔天数 */
  interval: number;
  /** 难度因子 */
  easeFactor: number;
  /** 连续正确次数 */
  consecutiveCorrect: number;
  /** 复习次数 */
  reviewCount: number;
}

/**
 * 复习统计
 * Review Statistics
 */
export interface ReviewStats {
  /** 今日已复习 */
  todayReviewed: number;
  /** 今日待复习 */
  todayPending: number;
  /** 本周复习总数 */
  weeklyReviewed: number;
  /** 平均正确率 */
  averageAccuracy: number;
  /** 连续复习天数 */
  streakDays: number;
  /** 上次复习日期 */
  lastReviewDate: string;
}

/**
 * 复习结果
 * Review Result
 */
export interface ReviewResult {
  word: string;
  quality: ReviewQuality;
  reviewedAt: number;
  previousInterval: number;
  newInterval: number;
  previousEaseFactor: number;
  newEaseFactor: number;
}