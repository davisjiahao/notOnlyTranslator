/**
 * 词汇掌握度系统类型定义
 * Vocabulary Mastery System Type Definitions
 */

/**
 * 词汇掌握度等级
 * Vocabulary Mastery Levels
 */
export enum MasteryLevel {
  UNKNOWN = 0,      // 未知/新词 Unknown/New word
  RECOGNIZING = 1,  // 开始认识 Starting to recognize
  LEARNING = 2,     // 学习中 Actively learning
  FAMILIAR = 3,     // 熟悉 Familiar
  MASTERED = 4,     // 已掌握 Mastered
}

/**
 * 获取掌握度等级的显示文本
 * Get display text for mastery level
 */
export function getMasteryLevelText(level: MasteryLevel): string {
  const texts: Record<MasteryLevel, string> = {
    [MasteryLevel.UNKNOWN]: '未知',
    [MasteryLevel.RECOGNIZING]: '开始认识',
    [MasteryLevel.LEARNING]: '学习中',
    [MasteryLevel.FAMILIAR]: '熟悉',
    [MasteryLevel.MASTERED]: '已掌握',
  };
  return texts[level] ?? '未知';
}

/**
 * 获取掌握度等级的颜色
 * Get color for mastery level
 */
export function getMasteryLevelColor(level: MasteryLevel): string {
  const colors: Record<MasteryLevel, string> = {
    [MasteryLevel.UNKNOWN]: '#9CA3AF',     // gray-400
    [MasteryLevel.RECOGNIZING]: '#60A5FA', // blue-400
    [MasteryLevel.LEARNING]: '#FBBF24',    // amber-400
    [MasteryLevel.FAMILIAR]: '#34D399',    // emerald-400
    [MasteryLevel.MASTERED]: '#10B981',    // emerald-500
  };
  return colors[level] ?? '#9CA3AF';
}

/**
 * 词汇掌握度信息
 * Word Mastery Information
 */
export interface WordMastery {
  word: string;                    // 单词
  level: MasteryLevel;             // 掌握度等级
  firstSeenAt: number;             // 首次遇到时间
  lastReviewedAt: number;          // 上次复习时间
  reviewCount: number;             // 复习次数
  correctCount: number;            // 正确次数
  consecutiveCorrect: number;        // 连续正确次数
  difficulty: number;                // 难度系数 (0-1)
  contextCount: number;              // 遇到该词的上下文数量
}

/**
 * 创建新的 WordMastery 对象
 * Create new WordMastery object
 */
export function createWordMastery(word: string): WordMastery {
  const now = Date.now();
  return {
    word,
    level: MasteryLevel.UNKNOWN,
    firstSeenAt: now,
    lastReviewedAt: now,
    reviewCount: 0,
    correctCount: 0,
    consecutiveCorrect: 0,
    difficulty: 0.5,
    contextCount: 0,
  };
}

/**
 * 词汇掌握度更新数据
 * Word Mastery Update Data
 */
export interface WordMasteryUpdate {
  word: string;
  isCorrect?: boolean;             // 是否理解正确
  context?: string;                  // 上下文
  difficulty?: number;             // 难度评估
}

/**
 * 用户词汇画像
 * User Vocabulary Profile
 */
export interface UserVocabularyProfile {
  userId: string;                    // 用户ID
  totalWords: number;                // 总词汇量
  masteredWords: number;             // 已掌握词汇数
  learningWords: number;             // 学习中词汇数
  estimatedLevel: string;              // 估算水平 (A1, A2, B1, B2, C1, C2)
  lastAssessmentAt: number;          // 上次评估时间
  weakAreas: string[];                 // 薄弱领域
  strongAreas: string[];               // 强项领域
}

/**
 * 学习进度
 * Learning Progress
 */
export interface LearningProgress {
  dailyGoal: number;                 // 每日目标单词数
  todayLearned: number;              // 今日已学
  todayReviewed: number;             // 今日已复习
  streakDays: number;                  // 连续学习天数
  lastStudyDate: string;             // 上次学习日期
  weeklyStats: DailyStat[];            // 周统计
}

/**
 * 每日统计
 * Daily Statistics
 */
export interface DailyStat {
  date: string;
  newWords: number;
  reviewedWords: number;
  studyMinutes: number;
}

/**
 * 词汇本条目
 * Vocabulary Entry
 */
export interface VocabularyEntry {
  word: string;
  mastery: WordMastery;
  addedAt: number;
  notes?: string;
  tags?: string[];
  contexts?: WordContext[];
}

/**
 * 单词上下文
 * Word Context
 */
export interface WordContext {
  sentence: string;
  source?: string;
  url?: string;
  capturedAt: number;
}

/**
 * 翻译策略
 * Translation Strategy
 */
export interface TranslationStrategy {
  minMasteryForTranslation: MasteryLevel;
  useContextualTranslation: boolean;
  prioritizeHighFrequencyWords: boolean;
  adaptiveDifficulty: boolean;
}

/**
 * 升级掌握度等级
 * Upgrade mastery level
 */
export function upgradeMasteryLevel(currentLevel: MasteryLevel): MasteryLevel {
  if (currentLevel < MasteryLevel.MASTERED) {
    return currentLevel + 1;
  }
  return currentLevel;
}

/**
 * 降级掌握度等级
 * Downgrade mastery level
 */
export function downgradeMasteryLevel(currentLevel: MasteryLevel): MasteryLevel {
  if (currentLevel > MasteryLevel.UNKNOWN) {
    return currentLevel - 1;
  }
  return currentLevel;
}

/**
 * 计算掌握度进度百分比
 * Calculate mastery progress percentage
 */
export function calculateMasteryProgress(currentLevel: MasteryLevel): number {
  return (currentLevel / MasteryLevel.MASTERED) * 100;
}

/**
 * 判断单词是否需要翻译
 * Determine if word needs translation
 */
export function needsTranslation(
  mastery: WordMastery,
  strategy: TranslationStrategy
): boolean {
  // 如果掌握度低于阈值，需要翻译
  if (mastery.level < strategy.minMasteryForTranslation) {
    return true;
  }
  // 如果难度高于0.7，可能需要翻译
  if (strategy.adaptiveDifficulty && mastery.difficulty > 0.7) {
    return true;
  }
  return false;
}
