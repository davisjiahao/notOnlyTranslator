/**
 * 复习提醒服务
 * Review Reminder Service
 *
 * 实现 SM-2 间隔重复算法，调度生词复习提醒。
 */

import type { WordMastery } from '@/shared/types/vocabulary';
import {
  type ReviewReminderConfig,
  type ReviewScheduleItem,
  type SM2Parameters,
  type ReviewStats,
  type ReviewResult,
  ReviewQuality,
  DEFAULT_REVIEW_REMINDER_CONFIG,
  DEFAULT_SM2_PARAMETERS,
} from '@/shared/types/reviewReminder';
import { logger } from '@/shared/utils';

/**
 * 存储键名
 */
const STORAGE_KEYS = {
  CONFIG: 'reviewReminderConfig',
  SCHEDULE: 'reviewSchedule',
  STATS: 'reviewStats',
};

/**
 * SM-2 间隔重复算法实现
 *
 * @param currentInterval 当前间隔天数
 * @param easeFactor 当前难度因子
 * @param quality 复习质量评分 (0-5)
 * @param params SM-2 参数
 * @returns [新间隔, 新难度因子]
 */
export function calculateSM2Interval(
  currentInterval: number,
  easeFactor: number,
  quality: ReviewQuality,
  params: SM2Parameters = DEFAULT_SM2_PARAMETERS
): [number, number] {
  // 计算新的难度因子
  // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
  let newEaseFactor =
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

  // 难度因子不低于最小值
  newEaseFactor = Math.max(params.minEaseFactor, newEaseFactor);

  // 计算新间隔
  let newInterval: number;

  if (quality < ReviewQuality.CORRECT_HARD) {
    // 答错：重置间隔
    newInterval = params.lapseResetInterval;
  } else if (currentInterval === 0) {
    // 新词：第一次复习
    newInterval = 1;
  } else if (currentInterval === 1) {
    // 第二次复习
    newInterval = 6;
  } else {
    // 后续复习：间隔 = 前次间隔 × 难度因子
    newInterval = Math.round(currentInterval * newEaseFactor);

    // 如果是简单回答，增加额外间隔
    if (quality === ReviewQuality.CORRECT_INSTANT) {
      newInterval = Math.round(newInterval * params.easyBonus);
    }
  }

  return [newInterval, newEaseFactor];
}

/**
 * 计算下次复习时间
 *
 * @param word 词汇掌握度信息
 * @param config 复习配置
 * @returns 下次复习时间戳
 */
export function calculateNextReviewTime(
  word: WordMastery,
  config: ReviewReminderConfig = DEFAULT_REVIEW_REMINDER_CONFIG
): number {
  const now = Date.now();
  const dayInMs = 24 * 60 * 60 * 1000;

  // 如果已掌握，不需要复习
  if (word.consecutiveCorrect >= config.masteredThreshold) {
    return Number.MAX_SAFE_INTEGER; // 非常久以后
  }

  // 根据掌握度计算基础间隔
  let baseIntervalDays: number;
  switch (word.level) {
    case 0: // UNKNOWN
      baseIntervalDays = 1;
      break;
    case 1: // RECOGNIZING
      baseIntervalDays = 2;
      break;
    case 2: // LEARNING
      baseIntervalDays = 4;
      break;
    case 3: // FAMILIAR
      baseIntervalDays = 7;
      break;
    default:
      baseIntervalDays = 14;
  }

  // 根据难度系数调整
  const adjustedInterval = Math.round(
    baseIntervalDays * (1 + word.difficulty)
  );

  return now + adjustedInterval * dayInMs;
}

/**
 * 复习提醒管理器
 */
export class ReviewReminderManager {
  private config: ReviewReminderConfig;
  private schedule: Map<string, ReviewScheduleItem> = new Map();

  constructor(config: ReviewReminderConfig = DEFAULT_REVIEW_REMINDER_CONFIG) {
    this.config = config;
  }

  /**
   * 加载配置和计划
   */
  async load(): Promise<void> {
    try {
      // 加载配置
      const configResult = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
      if (configResult[STORAGE_KEYS.CONFIG]) {
        this.config = {
          ...DEFAULT_REVIEW_REMINDER_CONFIG,
          ...configResult[STORAGE_KEYS.CONFIG],
        };
      }

      // 加载计划
      const scheduleResult = await chrome.storage.local.get(STORAGE_KEYS.SCHEDULE);
      if (scheduleResult[STORAGE_KEYS.SCHEDULE]) {
        const scheduleData = scheduleResult[STORAGE_KEYS.SCHEDULE] as ReviewScheduleItem[];
        this.schedule = new Map(scheduleData.map(item => [item.word, item]));
      }

      logger.info('ReviewReminderManager: 数据加载完成');
    } catch (error) {
      logger.error('ReviewReminderManager: 加载失败', error);
    }
  }

  /**
   * 保存配置和计划
   */
  async save(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.CONFIG]: this.config,
        [STORAGE_KEYS.SCHEDULE]: Array.from(this.schedule.values()),
      });
      logger.debug('ReviewReminderManager: 数据保存完成');
    } catch (error) {
      logger.error('ReviewReminderManager: 保存失败', error);
    }
  }

  /**
   * 更新配置
   */
  async updateConfig(updates: Partial<ReviewReminderConfig>): Promise<void> {
    this.config = { ...this.config, ...updates };
    await this.save();
    await this.scheduleReminderAlarm();
  }

  /**
   * 获取当前配置
   */
  getConfig(): ReviewReminderConfig {
    return { ...this.config };
  }

  /**
   * 添加词汇到复习计划
   */
  async addWordToSchedule(word: WordMastery): Promise<void> {
    const nextReviewAt = calculateNextReviewTime(word, this.config);
    const interval = Math.round(
      (nextReviewAt - Date.now()) / (24 * 60 * 60 * 1000)
    );

    const scheduleItem: ReviewScheduleItem = {
      word: word.word,
      nextReviewAt,
      interval: Math.max(1, interval),
      easeFactor: DEFAULT_SM2_PARAMETERS.defaultEaseFactor,
      consecutiveCorrect: word.consecutiveCorrect,
      reviewCount: word.reviewCount,
    };

    this.schedule.set(word.word, scheduleItem);
    await this.save();
  }

  /**
   * 批量添加词汇到复习计划
   */
  async addWordsToSchedule(words: WordMastery[]): Promise<void> {
    for (const word of words) {
      await this.addWordToSchedule(word);
    }
  }

  /**
   * 从复习计划中移除词汇
   */
  async removeWordFromSchedule(word: string): Promise<void> {
    this.schedule.delete(word);
    await this.save();
  }

  /**
   * 获取待复习词汇列表
   */
  getWordsForReview(limit?: number): ReviewScheduleItem[] {
    const now = Date.now();
    const pending = Array.from(this.schedule.values())
      .filter(item => item.nextReviewAt <= now)
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt);

    return limit ? pending.slice(0, limit) : pending;
  }

  /**
   * 记录复习结果
   */
  async recordReviewResult(
    word: string,
    quality: ReviewQuality
  ): Promise<ReviewResult> {
    const item = this.schedule.get(word);
    if (!item) {
      throw new Error(`词汇 ${word} 不在复习计划中`);
    }

    const [newInterval, newEaseFactor] = calculateSM2Interval(
      item.interval,
      item.easeFactor,
      quality
    );

    const now = Date.now();
    const dayInMs = 24 * 60 * 60 * 1000;

    // 更新计划项
    item.interval = newInterval;
    item.easeFactor = newEaseFactor;
    item.nextReviewAt = now + newInterval * dayInMs;
    item.reviewCount += 1;

    if (quality >= ReviewQuality.CORRECT_HARD) {
      item.consecutiveCorrect += 1;
    } else {
      item.consecutiveCorrect = 0;
    }

    await this.save();

    return {
      word,
      quality,
      reviewedAt: now,
      previousInterval: item.interval,
      newInterval,
      previousEaseFactor: item.easeFactor,
      newEaseFactor,
    };
  }

  /**
   * 获取复习统计
   */
  async getStats(): Promise<ReviewStats> {
    const today = new Date().toISOString().split('T')[0];

    // 从存储中获取统计数据
    const statsResult = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    const savedStats = statsResult[STORAGE_KEYS.STATS] || {
      todayReviewed: 0,
      weeklyReviewed: 0,
      totalCorrect: 0,
      totalReviews: 0,
      streakDays: 0,
      lastReviewDate: '',
    };

    // 计算待复习数量
    const todayPending = this.getWordsForReview().length;

    // 计算正确率
    const averageAccuracy =
      savedStats.totalReviews > 0
        ? savedStats.totalCorrect / savedStats.totalReviews
        : 0;

    // 重置今日计数（如果是新的一天）
    const todayReviewed =
      savedStats.lastReviewDate === today ? savedStats.todayReviewed : 0;

    return {
      todayReviewed,
      todayPending,
      weeklyReviewed: savedStats.weeklyReviewed,
      averageAccuracy,
      streakDays: savedStats.streakDays,
      lastReviewDate: savedStats.lastReviewDate,
    };
  }

  /**
   * 更新复习统计
   */
  async updateStats(isCorrect: boolean): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    const statsResult = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    const stats = statsResult[STORAGE_KEYS.STATS] || {
      todayReviewed: 0,
      weeklyReviewed: 0,
      totalCorrect: 0,
      totalReviews: 0,
      streakDays: 0,
      lastReviewDate: '',
    };

    // 更新统计
    if (stats.lastReviewDate === today) {
      stats.todayReviewed += 1;
    } else {
      // 新的一天
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      if (stats.lastReviewDate === yesterday) {
        stats.streakDays += 1;
      } else {
        stats.streakDays = 1;
      }

      stats.todayReviewed = 1;
    }

    stats.weeklyReviewed += 1;
    stats.totalReviews += 1;
    if (isCorrect) {
      stats.totalCorrect += 1;
    }
    stats.lastReviewDate = today;

    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
  }

  /**
   * 设置复习提醒闹钟
   */
  async scheduleReminderAlarm(): Promise<void> {
    if (!this.config.enabled) {
      // 清除闹钟
      await chrome.alarms.clear('review-reminder');
      logger.info('ReviewReminderManager: 复习提醒已禁用');
      return;
    }

    const now = new Date();
    const reminderTime = new Date();
    reminderTime.setHours(this.config.reminderHour, this.config.reminderMinute, 0, 0);

    // 如果今天的提醒时间已过，设置为明天
    if (reminderTime <= now) {
      reminderTime.setDate(reminderTime.getDate() + 1);
    }

    const alarmInfo = {
      when: reminderTime.getTime(),
      periodInMinutes: 24 * 60, // 每天重复
    };

    await chrome.alarms.create('review-reminder', alarmInfo);

    logger.info(
      `ReviewReminderManager: 提醒已设置为 ${reminderTime.toLocaleString()}`
    );
  }

  /**
   * 检查是否需要发送提醒
   */
  async checkAndSendReminder(): Promise<boolean> {
    if (!this.config.enabled || !this.config.enableNotifications) {
      return false;
    }

    const pendingWords = this.getWordsForReview(this.config.dailyReviewLimit);

    if (pendingWords.length < this.config.minWordsForReminder) {
      logger.debug(
        `ReviewReminderManager: 待复习词汇不足 ${this.config.minWordsForReminder}，跳过提醒`
      );
      return false;
    }

    // 发送浏览器通知
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: '📚 生词复习提醒',
      message: `你有 ${pendingWords.length} 个生词等待复习，点击开始学习！`,
      priority: 2,
      requireInteraction: true,
    });

    logger.info(`ReviewReminderManager: 已发送复习提醒，${pendingWords.length} 个待复习`);
    return true;
  }
}

// 导出单例
export const reviewReminderManager = new ReviewReminderManager();