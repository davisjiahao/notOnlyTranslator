/**
 * 智能词汇推荐系统
 * Intelligent Vocabulary Recommendation System
 *
 * 基于用户学习进度和掌握度，智能推荐适合学习的词汇
 * Based on user's learning progress and mastery, intelligently recommend words
 */

import type { CEFRLevel } from '@/shared/types/mastery';
import { CEFR_LEVEL_ORDER } from '@/shared/constants/mastery';
import type { WordMastery } from '@/shared/types/vocabulary';
import { MasteryLevel } from '@/shared/types/vocabulary';
import {
  assessWordDifficulty,
  type WordDifficultyResult,
} from '@/shared/utils/vocabularyService';
import { logger } from '@/shared/utils';

/**
 * 推荐策略类型
 * Recommendation Strategy Types
 */
export enum RecommendationStrategy {
  /** 邻近难度 - 刚好超出当前水平 */
  PROXIMAL = 'proximal',
  /** 间隔重复 - 基于遗忘曲线 */
  SPACED_REPETITION = 'spaced_repetition',
  /** 高频优先 - 常见但未掌握的词 */
  HIGH_FREQUENCY = 'high_frequency',
  /** 弱项强化 - 针对薄弱领域 */
  WEAK_AREA = 'weak_area',
  /** 混合策略 - 综合多种因素 */
  MIXED = 'mixed',
}

/**
 * 推荐权重配置
 * Recommendation Weight Configuration
 */
export interface RecommendationWeights {
  /** 难度匹配权重 */
  difficultyMatch: number;
  /** 遗忘概率权重 */
  forgettingProbability: number;
  /** 频率权重 */
  frequency: number;
  /** 上下文相关性权重 */
  contextRelevance: number;
}

/**
 * 单词推荐结果
 * Word Recommendation Result
 */
export interface WordRecommendation extends WordDifficultyResult {
  /** 推荐分数 0-100 */
  recommendationScore: number;
  /** 推荐原因 */
  reason: string;
  /** 推荐策略 */
  strategy: RecommendationStrategy;
  /** 预估学习时间（秒） */
  estimatedStudyTime: number;
  /** 是否为优先推荐 */
  isPriority: boolean;
  /** 现有掌握度信息（如有） */
  mastery?: WordMastery;
}

/**
 * 用户学习状态
 * User Learning State
 */
export interface UserLearningState {
  /** 用户 CEFR 等级 */
  userLevel: CEFRLevel;
  /** 目标等级 */
  targetLevel?: CEFRLevel;
  /** 最近学习单词数 */
  recentWordsLearned: number;
  /** 平均掌握度 */
  averageMastery: number;
  /** 学习连续天数 */
  streakDays: number;
  /** 今日目标完成度 */
  dailyGoalProgress: number;
}

/**
 * 推荐请求参数
 * Recommendation Request Parameters
 */
export interface RecommendationRequest {
  /** 用户学习状态 */
  userState: UserLearningState;
  /** 用户已掌握词汇（Map<word, WordMastery>） */
  knownWords: Map<string, WordMastery>;
  /** 候选词汇列表（可选，若无则使用词库） */
  candidateWords?: string[];
  /** 当前上下文（如正在阅读的内容） */
  context?: string;
  /** 最大推荐数量 */
  limit?: number;
  /** 推荐策略 */
  strategy?: RecommendationStrategy;
  /** 权重配置 */
  weights?: Partial<RecommendationWeights>;
}

/**
 * 推荐结果
 * Recommendation Result
 */
export interface RecommendationResult {
  /** 推荐词汇列表 */
  recommendations: WordRecommendation[];
  /** 推荐摘要 */
  summary: {
    totalCandidates: number;
    filtered: number;
    strategy: RecommendationStrategy;
    userLevel: CEFRLevel;
  };
  /** 学习建议 */
  learningAdvice: string;
}

/**
 * 默认权重配置
 */
const DEFAULT_WEIGHTS: RecommendationWeights = {
  difficultyMatch: 0.35,
  forgettingProbability: 0.25,
  frequency: 0.25,
  contextRelevance: 0.15,
};

/**
 * 计算单词的推荐分数
 *
 * @param word - 单词
 * @param difficulty - 难度评估结果
 * @param userState - 用户学习状态
 * @param mastery - 现有掌握度（可选）
 * @param weights - 权重配置
 * @returns 推荐分数 0-100
 */
function calculateRecommendationScore(
  _word: string,
  difficulty: WordDifficultyResult,
  userState: UserLearningState,
  mastery: WordMastery | undefined,
  weights: RecommendationWeights
): number {
  let score = 0;

  // 1. 难度匹配分数 (邻近难度原则)
  const userLevelIndex = CEFR_LEVEL_ORDER.indexOf(userState.userLevel);
  const wordLevelIndex = CEFR_LEVEL_ORDER.indexOf(difficulty.level);
  const levelDiff = wordLevelIndex - userLevelIndex;

  let difficultyScore = 0;
  if (levelDiff === 1) {
    // 刚好高一级 - 最佳学习难度
    difficultyScore = 100;
  } else if (levelDiff === 2) {
    // 高两级 - 有挑战但可学习
    difficultyScore = 70;
  } else if (levelDiff === 0) {
    // 同级 - 巩固学习
    difficultyScore = 60;
  } else if (levelDiff < 0) {
    // 低于用户水平 - 复习
    difficultyScore = 30;
  } else {
    // 高于两级以上 - 太难
    difficultyScore = 10;
  }
  score += difficultyScore * weights.difficultyMatch;

  // 2. 遗忘概率分数 (间隔重复)
  let forgettingScore = 50; // 默认中等
  if (mastery) {
    const daysSinceReview = (Date.now() - mastery.lastReviewedAt) / (1000 * 60 * 60 * 24);
    const stabilityFactor = 1 + mastery.consecutiveCorrect * 0.5;
    const forgettingProbability = 1 - Math.exp(-daysSinceReview / stabilityFactor);
    forgettingScore = forgettingProbability * 100;
  }
  score += forgettingScore * weights.forgettingProbability;

  // 3. 频率分数 (常见词优先)
  const frequencyScore = difficulty.isCommon ? 80 : 40;
  score += frequencyScore * weights.frequency;

  // 4. 难度加权 (中等难度的词更容易学习)
  const difficultyWeightScore = 100 - Math.abs(difficulty.difficulty - 5) * 10;
  score += Math.max(0, difficultyWeightScore) * weights.contextRelevance;

  return Math.min(100, Math.max(0, score));
}

/**
 * 确定推荐原因
 *
 * @param difficulty - 难度评估
 * @param userState - 用户状态
 * @param mastery - 掌握度
 * @param score - 推荐分数
 */
function determineReason(
  difficulty: WordDifficultyResult,
  userState: UserLearningState,
  mastery: WordMastery | undefined,
  _score: number
): string {
  const userLevelIndex = CEFR_LEVEL_ORDER.indexOf(userState.userLevel);
  const wordLevelIndex = CEFR_LEVEL_ORDER.indexOf(difficulty.level);
  const levelDiff = wordLevelIndex - userLevelIndex;

  if (mastery && mastery.level < MasteryLevel.FAMILIAR) {
    const daysSinceReview = Math.floor((Date.now() - mastery.lastReviewedAt) / (1000 * 60 * 60 * 24));
    if (daysSinceReview > 7) {
      return '已有一周未复习，建议巩固';
    }
    return '学习中的词汇，继续巩固';
  }

  if (levelDiff === 1) {
    return '刚好超出当前水平，适合学习';
  }

  if (levelDiff === 2) {
    return '有挑战性的词汇，拓展词汇量';
  }

  if (levelDiff === 0) {
    return '符合当前水平，巩固提升';
  }

  if (difficulty.isCommon) {
    return '常见词汇，建议掌握';
  }

  return '推荐学习';
}

/**
 * 估算学习时间
 *
 * @param difficulty - 难度评估
 * @param mastery - 掌握度
 */
function estimateStudyTime(
  difficulty: WordDifficultyResult,
  mastery: WordMastery | undefined
): number {
  // 基础时间 15-45 秒
  const baseTime = 15 + difficulty.difficulty * 3;

  // 如果已有掌握度，根据掌握度调整
  if (mastery) {
    const masteryAdjustment = 1 - (mastery.level / MasteryLevel.MASTERED) * 0.5;
    return Math.round(baseTime * masteryAdjustment);
  }

  return baseTime;
}

/**
 * 生成学习建议
 *
 * @param recommendations - 推荐列表
 * @param userState - 用户状态
 */
function generateLearningAdvice(
  recommendations: WordRecommendation[],
  userState: UserLearningState
): string {
  if (recommendations.length === 0) {
    return '继续阅读英文内容，系统会自动推荐适合你水平的词汇。';
  }

  const avgScore = recommendations.reduce((sum, r) => sum + r.recommendationScore, 0) / recommendations.length;
  const highPriorityCount = recommendations.filter(r => r.isPriority).length;

  const parts: string[] = [];

  if (userState.dailyGoalProgress < 0.5) {
    parts.push(`今日目标完成 ${Math.round(userState.dailyGoalProgress * 100)}%，建议继续学习。`);
  }

  if (highPriorityCount > 0) {
    parts.push(`有 ${highPriorityCount} 个高优先级词汇需要关注。`);
  }

  if (avgScore > 70) {
    parts.push('推荐的词汇都很适合你当前的水平，抓住机会学习！');
  } else if (avgScore > 50) {
    parts.push('推荐词汇有一定挑战，循序渐进学习效果更好。');
  }

  if (userState.streakDays >= 7) {
    parts.push(`已连续学习 ${userState.streakDays} 天，保持这个势头！`);
  }

  return parts.join(' ') || '每天学习一点，词汇量稳步增长。';
}

/**
 * 获取推荐词汇
 *
 * 核心推荐算法，基于多种因素综合评分
 *
 * @param request - 推荐请求参数
 * @returns 推荐结果
 */
export function getRecommendations(
  request: RecommendationRequest
): RecommendationResult {
  const {
    userState,
    knownWords,
    candidateWords = [],
    context,
    limit = 10,
    strategy = RecommendationStrategy.MIXED,
    weights = {},
  } = request;

  const finalWeights = { ...DEFAULT_WEIGHTS, ...weights };
  const recommendations: WordRecommendation[] = [];

  // 1. 分析候选词汇
  const wordsToAnalyze = candidateWords.length > 0
    ? candidateWords
    : getDefaultCandidateWords(userState.userLevel);

  // 2. 过滤已掌握的词汇
  const filteredWords = wordsToAnalyze.filter(word => {
    const mastery = knownWords.get(word.toLowerCase());
    // 排除已完全掌握的词
    if (mastery && mastery.level === MasteryLevel.MASTERED) {
      return false;
    }
    return true;
  });

  // 3. 评估每个词汇
  for (const word of filteredWords) {
    const normalizedWord = word.toLowerCase().trim();
    const difficulty = assessWordDifficulty(normalizedWord);
    const mastery = knownWords.get(normalizedWord);

    // 根据策略过滤
    if (!matchesStrategy(difficulty, mastery, userState, strategy)) {
      continue;
    }

    const score = calculateRecommendationScore(
      normalizedWord,
      difficulty,
      userState,
      mastery,
      finalWeights
    );

    // 上下文相关性加成
    let contextBonus = 0;
    if (context && context.toLowerCase().includes(normalizedWord)) {
      contextBonus = 20 * finalWeights.contextRelevance;
    }

    const finalScore = Math.min(100, score + contextBonus);

    recommendations.push({
      ...difficulty,
      word: normalizedWord,
      recommendationScore: finalScore,
      reason: determineReason(difficulty, userState, mastery, finalScore),
      strategy,
      estimatedStudyTime: estimateStudyTime(difficulty, mastery),
      isPriority: finalScore >= 75,
      mastery,
    });
  }

  // 4. 排序并限制数量
  recommendations.sort((a, b) => b.recommendationScore - a.recommendationScore);
  const limitedRecommendations = recommendations.slice(0, limit);

  // 5. 生成结果
  const result: RecommendationResult = {
    recommendations: limitedRecommendations,
    summary: {
      totalCandidates: wordsToAnalyze.length,
      filtered: filteredWords.length,
      strategy,
      userLevel: userState.userLevel,
    },
    learningAdvice: generateLearningAdvice(limitedRecommendations, userState),
  };

  logger.info('VocabularyRecommendation: 推荐完成', {
    total: result.summary.totalCandidates,
    filtered: result.summary.filtered,
    returned: limitedRecommendations.length,
    avgScore: limitedRecommendations.length > 0
      ? Math.round(limitedRecommendations.reduce((s, r) => s + r.recommendationScore, 0) / limitedRecommendations.length)
      : 0,
  });

  return result;
}

/**
 * 检查词汇是否匹配推荐策略
 */
function matchesStrategy(
  difficulty: WordDifficultyResult,
  mastery: WordMastery | undefined,
  userState: UserLearningState,
  strategy: RecommendationStrategy
): boolean {
  const userLevelIndex = CEFR_LEVEL_ORDER.indexOf(userState.userLevel);
  const wordLevelIndex = CEFR_LEVEL_ORDER.indexOf(difficulty.level);

  switch (strategy) {
    case RecommendationStrategy.PROXIMAL:
      // 邻近难度：刚好高一级或同级别
      return (wordLevelIndex - userLevelIndex) >= 0 && (wordLevelIndex - userLevelIndex) <= 2;

    case RecommendationStrategy.SPACED_REPETITION: {
      // 间隔重复：需要有复习记录且逾期
      if (!mastery) return false;
      const daysSinceReview = (Date.now() - mastery.lastReviewedAt) / (1000 * 60 * 60 * 24);
      return daysSinceReview > 1;
    }

    case RecommendationStrategy.HIGH_FREQUENCY:
      // 高频优先：常见词
      return difficulty.isCommon;

    case RecommendationStrategy.WEAK_AREA:
      // 弱项强化：学习中但未掌握的词
      return mastery !== undefined && mastery.level < MasteryLevel.FAMILIAR;

    case RecommendationStrategy.MIXED:
    default:
      // 混合策略：不过滤
      return true;
  }
}

/**
 * 获取默认候选词汇
 *
 * 根据用户等级返回适合的词汇池
 */
function getDefaultCandidateWords(userLevel: CEFRLevel): string[] {
  // 这里应该从词库获取，暂时返回空数组
  // 实际实现中应该根据 userLevel 从词库中选取合适的词汇
  const levelIndex = CEFR_LEVEL_ORDER.indexOf(userLevel);

  // 返回目标等级范围的词汇
  const targetLevels = CEFR_LEVEL_ORDER.slice(
    Math.max(0, levelIndex),
    Math.min(CEFR_LEVEL_ORDER.length, levelIndex + 2)
  );

  logger.debug('getDefaultCandidateWords: 目标等级范围', { targetLevels });

  // 返回空数组，实际使用时应该从词库加载
  return [];
}

/**
 * 导出默认配置
 */
export const DEFAULT_RECOMMENDATION_CONFIG = {
  defaultLimit: 10,
  defaultStrategy: RecommendationStrategy.MIXED,
  priorityThreshold: 75,
  weights: DEFAULT_WEIGHTS,
};

/**
 * 推荐服务类
 * 提供面向对象的推荐 API
 */
export class RecommendationService {
  private userState: UserLearningState;
  private knownWords: Map<string, WordMastery>;

  constructor(
    userState: UserLearningState,
    knownWords: Map<string, WordMastery> = new Map()
  ) {
    this.userState = userState;
    this.knownWords = knownWords;
  }

  /**
   * 更新用户状态
   */
  updateUserState(state: Partial<UserLearningState>): void {
    this.userState = { ...this.userState, ...state };
  }

  /**
   * 添加已知词汇
   */
  addKnownWord(word: string, mastery: WordMastery): void {
    this.knownWords.set(word.toLowerCase(), mastery);
  }

  /**
   * 获取推荐
   */
  getRecommendations(
    candidateWords?: string[],
    options?: {
      limit?: number;
      strategy?: RecommendationStrategy;
      context?: string;
    }
  ): RecommendationResult {
    return getRecommendations({
      userState: this.userState,
      knownWords: this.knownWords,
      candidateWords,
      limit: options?.limit,
      strategy: options?.strategy,
      context: options?.context,
    });
  }

  /**
   * 获取今日学习计划
   */
  getDailyStudyPlan(targetWords: number = 20): {
    newWords: WordRecommendation[];
    reviewWords: WordRecommendation[];
    totalEstimatedTime: number;
  } {
    // 获取新词推荐
    const newWordResult = this.getRecommendations(undefined, {
      limit: Math.ceil(targetWords * 0.6),
      strategy: RecommendationStrategy.PROXIMAL,
    });

    // 获取复习推荐
    const reviewResult = this.getRecommendations(undefined, {
      limit: Math.ceil(targetWords * 0.4),
      strategy: RecommendationStrategy.SPACED_REPETITION,
    });

    const totalEstimatedTime =
      newWordResult.recommendations.reduce((s, r) => s + r.estimatedStudyTime, 0) +
      reviewResult.recommendations.reduce((s, r) => s + r.estimatedStudyTime, 0);

    return {
      newWords: newWordResult.recommendations,
      reviewWords: reviewResult.recommendations,
      totalEstimatedTime,
    };
  }
}

// 导出默认实例创建函数
export function createRecommendationService(
  userLevel: CEFRLevel = 'B1'
): RecommendationService {
  return new RecommendationService({
    userLevel,
    recentWordsLearned: 0,
    averageMastery: 0,
    streakDays: 0,
    dailyGoalProgress: 0,
  });
}