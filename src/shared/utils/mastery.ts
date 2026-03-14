/**
 * 词汇掌握度计算工具
 *
 * 基于贝叶斯推断的词汇掌握度跟踪算法
 */

import type {
  CEFRLevel,
  WordMasteryEntry,
  MasteryUpdateResult,
  BayesianUpdateParams,
  WordMasteryStats as _WordMasteryStats,
  MasteryTrend,
  MasteryDataPoint,
  ReviewReminder,
} from '../types/mastery';
import type { UnknownWordEntry } from '../types';
import {
  CEFR_LEVEL_ORDER,
  CEFR_DIFFICULTY_RANGES as _CEFR_DIFFICULTY_RANGES,
  MASTERY_THRESHOLDS,
  SPACED_REPETITION_CONFIG,
  BAYESIAN_PARAMS,
  MASTERY_WEIGHTS,
  getCEFRLevelByDifficulty,
  hasLevelUpgraded,
} from '../constants/mastery';

/**
 * 计算贝叶斯更新后的掌握度
 *
 * 核心公式：
 * - 先验掌握度 θ ~ Beta(α, β)
 * - 观察数据 D：用户认识或不认识单词
 * - 后验掌握度 θ|D ~ Beta(α + success, β + failure)
 *
 * 简化实现：使用加权平均方式
 *
 * @param params - 贝叶斯更新参数
 * @returns 更新后的掌握度和置信度
 */
export function bayesianMasteryUpdate(params: BayesianUpdateParams): {
  mastery: number;
  confidence: number;
} {
  const {
    priorMastery,
    priorConfidence,
    observation,
    wordDifficulty,
    userVocabularySize,
  } = params;

  // 基于用户词汇量估算，计算该单词的预期掌握概率
  const estimatedVocabSize = Math.min(20000, Math.max(1000, userVocabularySize));
  // 单词难度对应的词汇量位置（难度1-10映射到0-20000）
  const wordVocabPosition = (wordDifficulty / 10) * 20000;
  // 预期掌握概率
  const expectedP = estimatedVocabSize / (estimatedVocabSize + wordVocabPosition);

  // 置信度权重：基于先验置信度和观察次数
  // 置信度越高，新观察的影响越小（更相信先验）
  const confidenceWeight = priorConfidence;
  const observationWeight = 1 - confidenceWeight * 0.5; // 观察永远有一定权重

  let newMastery: number;

  if (observation) {
    // 用户认识单词：向预期概率方向调整，但给予正向偏向
    // 使用 sigmoid 函数平滑调整
    const positiveBias = 0.1; // 认识的正向偏向
    const targetP = Math.min(1, expectedP + positiveBias);

    // 加权平均：新掌握度 = 旧掌握度 * 置信度权重 + 目标 * 观察权重
    newMastery = priorMastery * confidenceWeight + targetP * observationWeight;

    // 额外增益：如果用户认识了一个难度高于其水平的词，给予额外奖励
    if (wordVocabPosition > estimatedVocabSize) {
      const difficultyBonus = (wordVocabPosition - estimatedVocabSize) / 20000;
      newMastery = Math.min(1, newMastery + difficultyBonus * 0.1);
    }
  } else {
    // 用户不认识单词：降低掌握度估计
    // 惩罚与难度相关：不认识简单词惩罚更大
    const difficultyRatio = estimatedVocabSize / (wordVocabPosition + 1000);
    const penalty = Math.min(0.5, BAYESIAN_PARAMS.unknownDecayFactor * difficultyRatio);

    newMastery = priorMastery * (1 - penalty * observationWeight);
  }

  // 确保掌握度在合理范围内
  newMastery = Math.max(0, Math.min(1, newMastery));

  // 更新置信度：每次观察增加置信度，但有上限
  const confidenceIncrement = observation
    ? BAYESIAN_PARAMS.maxConfidenceIncrement
    : BAYESIAN_PARAMS.minConfidenceIncrement;
  const newConfidence = Math.min(
    BAYESIAN_PARAMS.maxConfidence,
    priorConfidence + confidenceIncrement
  );

  return { mastery: newMastery, confidence: newConfidence };
}

/**
 * 计算单词掌握度
 *
 * 综合考虑：
 * 1. 贝叶斯更新历史
 * 2. 认识/不认识次数
 * 3. 时间衰减
 */
export function calculateWordMastery(
  entry: WordMasteryEntry,
  _userVocabularySize: number
): { mastery: number; confidence: number } {
  const now = Date.now();

  // 基础掌握度
  let mastery = entry.masteryLevel;
  let confidence = entry.confidence;

  // 考虑认识/不认识次数的修正
  const totalMarks = entry.knownCount + entry.unknownCount;
  if (totalMarks > 0) {
    const observedRatio = entry.knownCount / totalMarks;
    // 使用加权平均融合观察比例和估计掌握度
    const observationWeight = Math.min(0.5, totalMarks * 0.1); // 最多50%权重
    mastery = mastery * (1 - observationWeight) + observedRatio * observationWeight;
  }

  // 时间衰减：如果很久没复习，降低置信度
  const daysSinceLastReview = entry.lastReviewAt
    ? (now - entry.lastReviewAt) / (1000 * 60 * 60 * 24)
    : (now - entry.markedAt) / (1000 * 60 * 60 * 24);

  if (daysSinceLastReview > MASTERY_WEIGHTS.timeDecayDays) {
    const decayFactor = Math.exp(-(daysSinceLastReview - MASTERY_WEIGHTS.timeDecayDays) / 60);
    confidence = Math.max(0.1, confidence * decayFactor);
  }

  return {
    mastery: Math.max(0, Math.min(1, mastery)),
    confidence: Math.max(0.1, Math.min(1, confidence)),
  };
}

/**
 * 创建新的单词掌握度条目
 */
export function createWordMasteryEntry(
  wordEntry: UnknownWordEntry,
  wordDifficulty: number,
  isKnown: boolean
): WordMasteryEntry {
  const estimatedLevel = getCEFRLevelByDifficulty(wordDifficulty);

  // 根据初始标记设置掌握度
  const initialMastery = isKnown ? 0.6 : 0.3;
  const initialConfidence = 0.2;

  return {
    ...wordEntry,
    masteryLevel: initialMastery,
    confidence: initialConfidence,
    knownCount: isKnown ? 1 : 0,
    unknownCount: isKnown ? 0 : 1,
    nextReviewAt: calculateNextReviewTime(0, isKnown, initialMastery),
    estimatedLevel,
  };
}

/**
 * 更新单词掌握度
 *
 * @param entry - 现有掌握度条目
 * @param isKnown - 用户是否认识
 * @param wordDifficulty - 单词难度 1-10
 * @param userVocabularySize - 用户估计词汇量
 * @returns 更新结果
 */
export function updateWordMastery(
  entry: WordMasteryEntry,
  isKnown: boolean,
  wordDifficulty: number,
  userVocabularySize: number
): MasteryUpdateResult {
  const bayesianResult = bayesianMasteryUpdate({
    priorMastery: entry.masteryLevel,
    priorConfidence: entry.confidence,
    observation: isKnown,
    wordDifficulty,
    userVocabularySize,
  });

  // 计算新的复习间隔
  const reviewCount = entry.knownCount + entry.unknownCount;
  const nextReviewInterval = calculateReviewInterval(
    reviewCount + 1,
    bayesianResult.mastery,
    isKnown
  );

  // 检测是否升级了 CEFR 等级
  const newLevel = getCEFRLevelByMastery(bayesianResult.mastery, entry.estimatedLevel);
  const levelUpgraded = hasLevelUpgraded(entry.estimatedLevel, newLevel);

  return {
    newMasteryLevel: bayesianResult.mastery,
    newConfidence: bayesianResult.confidence,
    nextReviewInterval,
    levelUpgraded,
    newLevel,
  };
}

/**
 * 计算复习间隔（天数）
 *
 * 基于间隔重复算法，考虑：
 * - 复习次数
 * - 当前掌握度
 * - 上次回答是否正确
 */
export function calculateReviewInterval(
  reviewCount: number,
  masteryLevel: number,
  lastAnswerCorrect: boolean
): number {
  const { intervals } = SPACED_REPETITION_CONFIG;

  // 基础间隔
  let baseInterval: number;
  if (reviewCount <= 0) {
    baseInterval = 1;
  } else if (reviewCount > intervals.length) {
    baseInterval = intervals[intervals.length - 1];
  } else {
    baseInterval = intervals[reviewCount - 1];
  }

  // 根据掌握度调整：掌握度越高，间隔越长
  const masteryMultiplier = 0.5 + masteryLevel * 1.5; // 0.5x - 2x

  // 根据上次回答调整：答错缩短间隔
  const correctnessMultiplier = lastAnswerCorrect ? 1 : 0.5;

  const interval = Math.round(baseInterval * masteryMultiplier * correctnessMultiplier);

  return Math.max(1, Math.min(SPACED_REPETITION_CONFIG.maxIntervalDays, interval));
}

/**
 * 计算下次复习时间
 */
export function calculateNextReviewTime(
  reviewCount: number,
  lastAnswerCorrect: boolean,
  masteryLevel: number
): number {
  const interval = calculateReviewInterval(reviewCount, masteryLevel, lastAnswerCorrect);
  return Date.now() + interval * 24 * 60 * 60 * 1000;
}

/**
 * 根据掌握度估算 CEFR 等级
 */
function getCEFRLevelByMastery(
  masteryLevel: number,
  estimatedLevel: CEFRLevel
): CEFRLevel {
  const levelIndex = CEFR_LEVEL_ORDER.indexOf(estimatedLevel);

  // 掌握度 > 0.9：可以升级到下一级
  if (masteryLevel >= 0.9 && levelIndex < CEFR_LEVEL_ORDER.length - 1) {
    return CEFR_LEVEL_ORDER[levelIndex + 1];
  }

  // 掌握度 < 0.3：可能需要降级
  if (masteryLevel < 0.3 && levelIndex > 0) {
    return CEFR_LEVEL_ORDER[levelIndex - 1];
  }

  return estimatedLevel;
}

/**
 * 计算掌握度统计
 */
export function calculateMasteryStats(
  wordMastery: Record<string, WordMasteryEntry>
): _WordMasteryStats {
  const entries = Object.values(wordMastery);

  const totalWords = entries.length;
  const masteredWords = entries.filter(
    e => e.masteryLevel >= MASTERY_THRESHOLDS.MASTERED
  ).length;
  const learningWords = entries.filter(
    e => e.masteryLevel >= MASTERY_THRESHOLDS.LEARNING && e.masteryLevel < MASTERY_THRESHOLDS.MASTERED
  ).length;
  const strugglingWords = entries.filter(
    e => e.masteryLevel < MASTERY_THRESHOLDS.LEARNING
  ).length;

  const now = Date.now();
  const dueForReview = entries.filter(e => e.nextReviewAt <= now).length;

  // CEFR 等级分布
  const levelDistribution: Record<CEFRLevel, number> = {
    A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0,
  };
  entries.forEach(e => {
    levelDistribution[e.estimatedLevel]++;
  });

  return {
    totalWords,
    masteredWords,
    learningWords,
    strugglingWords,
    dueForReview,
    levelDistribution,
  };
}

/**
 * 计算整体 CEFR 水平估计
 *
 * 基于用户已掌握的单词分布和平均掌握度
 */
export function calculateOverallCEFRLevel(
  wordMastery: Record<string, WordMasteryEntry>,
  estimatedVocabulary: number
): CEFRLevel {
  const entries = Object.values(wordMastery);

  if (entries.length === 0) {
    // 没有数据时，根据词汇量估算
    return getCEFRLevelByVocabulary(estimatedVocabulary);
  }

  // 计算加权平均掌握度（按 CEFR 等级加权）
  let totalWeight = 0;
  let weightedSum = 0;

  entries.forEach(entry => {
    const levelIndex = CEFR_LEVEL_ORDER.indexOf(entry.estimatedLevel);
    const levelValue = levelIndex + 1; // 1-6
    const masteryWeight = entry.masteryLevel * entry.confidence;

    weightedSum += levelValue * masteryWeight;
    totalWeight += masteryWeight;
  });

  if (totalWeight === 0) {
    return getCEFRLevelByVocabulary(estimatedVocabulary);
  }

  const averageLevelValue = weightedSum / totalWeight;
  const levelIndex = Math.round(averageLevelValue) - 1;

  return CEFR_LEVEL_ORDER[Math.max(0, Math.min(5, levelIndex))];
}

/**
 * 获取待复习的单词列表
 *
 * @param wordMastery - 单词掌握度映射
 * @param limit - 最大返回数量
 * @returns 按优先级排序的复习提醒列表
 */
export function getReviewReminders(
  wordMastery: Record<string, WordMasteryEntry>,
  limit: number = 20
): ReviewReminder[] {
  const now = Date.now();
  const entries = Object.values(wordMastery);

  // 筛选出需要复习的单词
  const dueEntries = entries
    .filter(e => e.nextReviewAt <= now)
    .map(e => {
      const daysOverdue = Math.floor((now - e.nextReviewAt) / (1000 * 60 * 60 * 24));
      // 优先级 = 逾期天数 + (1 - 掌握度) * 5
      const priority = daysOverdue + (1 - e.masteryLevel) * 5;
      return { entry: e, daysOverdue, priority };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);

  return dueEntries.map(({ entry, daysOverdue }) => ({
    word: entry.word,
    masteryLevel: entry.masteryLevel,
    daysOverdue,
    context: entry.context,
    translation: entry.translation,
  }));
}

/**
 * 计算掌握度趋势数据
 *
 * @param wordMastery - 单词掌握度映射
 * @param days - 统计天数（默认30天）
 * @returns 趋势数据
 */
export function calculateMasteryTrend(
  wordMastery: Record<string, WordMasteryEntry>,
  days: number = 30
): MasteryTrend {
  const entries = Object.values(wordMastery);
  const now = Date.now();

  // 生成过去 days 天的数据点
  const last30Days: MasteryDataPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = date.toISOString().split('T')[0];
    const timestamp = date.getTime();

    // 统计该日期为止的状态
    const entriesUpToDate = entries.filter(e => e.markedAt <= timestamp);

    const masteredCount = entriesUpToDate.filter(
      e => e.masteryLevel >= MASTERY_THRESHOLDS.MASTERED
    ).length;
    const learningCount = entriesUpToDate.filter(
      e => e.masteryLevel >= MASTERY_THRESHOLDS.LEARNING && e.masteryLevel < MASTERY_THRESHOLDS.MASTERED
    ).length;
    const newWordsCount = entries.filter(
      e => {
        const entryDate = new Date(e.markedAt).toISOString().split('T')[0];
        return entryDate === dateStr;
      }
    ).length;

    // 估算词汇量（基于已掌握单词数和平均掌握度）
    const avgMastery = entriesUpToDate.length > 0
      ? entriesUpToDate.reduce((sum, e) => sum + e.masteryLevel, 0) / entriesUpToDate.length
      : 0;
    const estimatedVocabulary = Math.round(1000 + masteredCount * 50 * avgMastery);

    last30Days.push({
      date: dateStr,
      masteredCount,
      learningCount,
      newWordsCount,
      estimatedVocabulary,
    });
  }

  // 计算掌握度变化率
  const firstWeek = last30Days.slice(0, 7);
  const lastWeek = last30Days.slice(-7);

  const firstAvg = firstWeek.length > 0
    ? firstWeek.reduce((sum, d) => sum + d.masteredCount, 0) / firstWeek.length
    : 0;
  const lastAvg = lastWeek.length > 0
    ? lastWeek.reduce((sum, d) => sum + d.masteredCount, 0) / lastWeek.length
    : 0;

  const masteryChangeRate = firstAvg > 0
    ? (lastAvg - firstAvg) / firstAvg
    : 0;

  // 估算达到下一级所需天数
  const currentLevel = calculateOverallCEFRLevel(wordMastery, 3000);
  const currentLevelIndex = CEFR_LEVEL_ORDER.indexOf(currentLevel);
  let daysToNextLevel: number | null = null;

  if (currentLevelIndex < CEFR_LEVEL_ORDER.length - 1) {
    // 假设每升一级需要掌握 100 个新单词
    const wordsNeeded = 100;
    const dailyGain = masteryChangeRate > 0
      ? (lastAvg - firstAvg) / 7 // 每天平均新增掌握单词数
      : 0;

    if (dailyGain > 0) {
      daysToNextLevel = Math.ceil(wordsNeeded / dailyGain);
    }
  }

  return {
    last30Days,
    masteryChangeRate,
    daysToNextLevel,
  };
}

/**
 * 辅助函数：根据词汇量获取 CEFR 等级
 */
function getCEFRLevelByVocabulary(vocabularySize: number): CEFRLevel {
  if (vocabularySize < 1500) return 'A1';
  if (vocabularySize < 2500) return 'A2';
  if (vocabularySize < 4000) return 'B1';
  if (vocabularySize < 6000) return 'B2';
  if (vocabularySize < 9000) return 'C1';
  return 'C2';
}
