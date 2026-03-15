/**
 * 词汇掌握度系统类型定义
 *
 * 基于贝叶斯推断的词汇掌握度跟踪系统
 */

import type { UnknownWordEntry } from './index';

/**
 * CEFR 词汇水平等级
 */
export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';

/**
 * 单词掌握度条目
 * 跟踪单个单词的掌握情况
 */
export interface WordMasteryEntry extends UnknownWordEntry {
  /** 掌握度分数 (0-1)，0.5 表示不确定，接近 1 表示掌握良好 */
  masteryLevel: number;
  /** 掌握度置信度 (0-1)，反映我们对此掌握度估计的确信程度 */
  confidence: number;
  /** 用户标记认识的次数 */
  knownCount: number;
  /** 用户标记不认识的次数 */
  unknownCount: number;
  /** 下次复习时间（时间戳） */
  nextReviewAt: number;
  /** CEFR 等级估计 */
  estimatedLevel: CEFRLevel;
}

/**
 * 单词掌握度统计摘要
 */
export interface WordMasteryStats {
  /** 总词汇数 */
  totalWords: number;
  /** 已掌握词汇数 (masteryLevel >= 0.8) */
  masteredWords: number;
  /** 学习中词汇数 (0.3 <= masteryLevel < 0.8) */
  learningWords: number;
  /** 困难词汇数 (masteryLevel < 0.3) */
  strugglingWords: number;
  /** 需要复习的词汇数 */
  dueForReview: number;
  /** 各 CEFR 等级词汇分布 */
  levelDistribution: Record<CEFRLevel, number>;
}

/**
 * 用户词汇掌握度档案
 * 扩展 UserProfile，包含详细的单词级掌握度数据
 */
export interface MasteryProfile {
  /** 用户 ID */
  userId: string;
  /** 单词掌握度映射 (word -> mastery entry) */
  wordMastery: Record<string, WordMasteryEntry>;
  /** 全局掌握度统计 */
  stats: WordMasteryStats;
  /** 整体 CEFR 水平估计 */
  estimatedOverallLevel: CEFRLevel;
  /** 最后更新时间 */
  lastUpdatedAt: number;
}

/**
 * 掌握度更新结果
 */
export interface MasteryUpdateResult {
  /** 更新后的掌握度 */
  newMasteryLevel: number;
  /** 更新后的置信度 */
  newConfidence: number;
  /** 新的复习间隔（天） */
  nextReviewInterval: number;
  /** 是否升级了 CEFR 等级 */
  levelUpgraded: boolean;
  /** 新的 CEFR 等级 */
  newLevel: CEFRLevel;
}

/**
 * 贝叶斯更新参数
 */
export interface BayesianUpdateParams {
  /** 先验掌握度 */
  priorMastery: number;
  /** 先验置信度 */
  priorConfidence: number;
  /** 观察结果 (true = 用户认识, false = 不认识) */
  observation: boolean;
  /** 单词难度 (1-10) */
  wordDifficulty: number;
  /** 用户当前估计词汇量 */
  userVocabularySize: number;
}

/**
 * CEFR 等级对应的词汇量范围
 */
export interface CEFRRange {
  level: CEFRLevel;
  minVocabulary: number;
  maxVocabulary: number;
  description: string;
}

/**
 * 掌握度可视化数据点
 */
export interface MasteryDataPoint {
  /** 日期 */
  date: string;
  /** 已掌握单词数 */
  masteredCount: number;
  /** 学习中单词数 */
  learningCount: number;
  /** 新增单词数 */
  newWordsCount: number;
  /** 估计词汇量 */
  estimatedVocabulary: number;
}

/**
 * 掌握度趋势数据
 */
export interface MasteryTrend {
  /** 最近 30 天数据 */
  last30Days: MasteryDataPoint[];
  /** 掌握度变化率 (-1 到 1，正值表示进步) */
  masteryChangeRate: number;
  /** 预计达到下一级所需天数 */
  daysToNextLevel: number | null;
}

/**
 * 复习提醒条目
 */
export interface ReviewReminder {
  word: string;
  masteryLevel: number;
  daysOverdue: number;
  context: string;
  translation: string;
}

/**
 * CEFR 等级查询响应
 * 用于 GET_CEFR_LEVEL 消息响应
 */
export interface CEFRLevelResponse {
  level: CEFRLevel;
  confidence: number;
  vocabularyEstimate: number;
}

/**
 * 学习活动记录
 * 追踪用户每日学习行为
 */
export interface LearningActivity {
  /** 日期 (YYYY-MM-DD) */
  date: string;
  /** 新学单词数 */
  newWords: number;
  /** 复习单词数 */
  reviewWords: number;
  /** 标记认识的单词数 */
  knownCount: number;
  /** 标记不认识的单词数 */
  unknownCount: number;
  /** 学习时长（分钟，估算） */
  studyMinutes: number;
  /** 连续学习天数 */
  streakDays: number;
}

/**
 * 学习热力图数据点
 */
export interface HeatmapDataPoint {
  /** 日期 (YYYY-MM-DD) */
  date: string;
  /** 活动强度 (0-4) */
  intensity: number;
  /** 具体数量 */
  count: number;
  /** 活动类型 */
  type: 'new' | 'review' | 'mixed';
}

/**
 * 学习统计数据
 * 用于统计仪表盘
 */
export interface LearningStatistics {
  /** 总学习天数 */
  totalStudyDays: number;
  /** 当前连续学习天数 */
  currentStreak: number;
  /** 最长连续学习天数 */
  longestStreak: number;
  /** 本周学习天数 */
  weeklyStudyDays: number;
  /** 本月学习天数 */
  monthlyStudyDays: number;
  /** 平均每日学习单词数 */
  averageDailyWords: number;
  /** 总学习时长（分钟） */
  totalStudyMinutes: number;
  /** 热力图数据 */
  heatmapData: HeatmapDataPoint[];
  /** 最近活动记录 */
  recentActivity: LearningActivity[];
}
