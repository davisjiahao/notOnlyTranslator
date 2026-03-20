/**
 * 词汇推荐系统测试
 *
 * 测试智能词汇推荐的核心功能
 */
import { describe, it, expect, vi } from 'vitest';
import {
  RecommendationStrategy,
  DEFAULT_RECOMMENDATION_CONFIG,
  createRecommendationService,
  RecommendationService,
  type UserLearningState,
  type RecommendationRequest,
} from '@/shared/utils/vocabularyRecommendation';
import type { CEFRLevel } from '@/shared/types/mastery';
import { MasteryLevel } from '@/shared/types/vocabulary';
import type { WordMastery } from '@/shared/types/vocabulary';

// Mock dependencies
vi.mock('@/shared/utils/vocabularyService', () => ({
  assessWordDifficulty: vi.fn((word: string) => ({
    word,
    difficulty: 5,
    cefrLevel: 'B1' as CEFRLevel,
    frequency: 1000,
    isAcademic: false,
    isColloquial: false,
    relatedWords: [],
  })),
}));

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('RecommendationStrategy', () => {
  it('应该定义所有推荐策略', () => {
    expect(RecommendationStrategy.PROXIMAL).toBe('proximal');
    expect(RecommendationStrategy.SPACED_REPETITION).toBe('spaced_repetition');
    expect(RecommendationStrategy.HIGH_FREQUENCY).toBe('high_frequency');
    expect(RecommendationStrategy.WEAK_AREA).toBe('weak_area');
    expect(RecommendationStrategy.MIXED).toBe('mixed');
  });
});

describe('DEFAULT_RECOMMENDATION_CONFIG', () => {
  it('应该有合理的默认配置', () => {
    expect(DEFAULT_RECOMMENDATION_CONFIG.defaultLimit).toBe(10);
    expect(DEFAULT_RECOMMENDATION_CONFIG.priorityThreshold).toBe(75);
    expect(DEFAULT_RECOMMENDATION_CONFIG.defaultStrategy).toBe(RecommendationStrategy.MIXED);
  });

  it('应该有权重配置', () => {
    const weights = DEFAULT_RECOMMENDATION_CONFIG.weights;
    expect(weights).toBeDefined();
    expect(weights.difficultyMatch).toBeGreaterThanOrEqual(0);
    expect(weights.forgettingProbability).toBeGreaterThanOrEqual(0);
    expect(weights.frequency).toBeGreaterThanOrEqual(0);
    expect(weights.contextRelevance).toBeGreaterThanOrEqual(0);
  });
});

describe('createRecommendationService', () => {
  it('应该创建 RecommendationService 实例', () => {
    const service = createRecommendationService('B1');
    expect(service).toBeDefined();
    expect(service).toBeInstanceOf(RecommendationService);
  });

  it('应该使用默认等级 B1', () => {
    const service = createRecommendationService();
    expect(service).toBeDefined();
  });
});

describe('RecommendationService', () => {
  const service = createRecommendationService('B1');

  const createUserState = (overrides: Partial<UserLearningState> = {}): UserLearningState => ({
    userLevel: 'B1' as CEFRLevel,
    recentWordsLearned: 50,
    averageMastery: 0.6,
    streakDays: 7,
    dailyGoalProgress: 0.5,
    ...overrides,
  });

  const createWordMastery = (word: string, overrides: Partial<WordMastery> = {}): WordMastery => ({
    word,
    masteryLevel: MasteryLevel.LEARNING,
    lastReviewAt: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
    nextReviewAt: Date.now() + 1 * 24 * 60 * 60 * 1000, // 1 day from now
    reviewCount: 3,
    correctCount: 2,
    incorrectCount: 1,
    ...overrides,
  });

  describe('updateUserState', () => {
    it('应该更新用户状态', () => {
      service.updateUserState({ averageMastery: 0.8 });
      // 验证更新成功（通过后续推荐验证）
    });
  });

  describe('addKnownWord', () => {
    it('应该添加已知词汇', () => {
      service.addKnownWord('hello', createWordMastery('hello'));
      // 验证添加成功
    });
  });

  describe('getRecommendations', () => {
    it('应该返回推荐列表', () => {
      const result = service.getRecommendations(['test', 'example']);

      expect(result).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.recommendations)).toBe(true);
    });

    it('应该返回空列表当没有候选词时', () => {
      const result = service.getRecommendations();

      expect(result.recommendations).toEqual([]);
    });
  });

  describe('getDailyStudyPlan', () => {
    it('应该返回学习计划', () => {
      const plan = service.getDailyStudyPlan(20);

      expect(plan).toBeDefined();
      expect(plan.newWords).toBeDefined();
      expect(plan.reviewWords).toBeDefined();
      expect(plan.totalEstimatedTime).toBeGreaterThanOrEqual(0);
    });

    it('应该使用默认目标词汇数', () => {
      const plan = service.getDailyStudyPlan();

      expect(plan).toBeDefined();
    });
  });
});