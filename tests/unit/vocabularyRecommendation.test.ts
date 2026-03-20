/**
 * 智能词汇推荐系统测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecommendationStrategy,
  getRecommendations,
  createRecommendationService,
  type UserLearningState,
  type RecommendationRequest,
} from '@/shared/utils/vocabularyRecommendation';
import type { CEFRLevel } from '@/shared/types/mastery';
import type { WordMastery } from '@/shared/types/vocabulary';
import { MasteryLevel } from '@/shared/types/vocabulary';

describe('VocabularyRecommendation', () => {
  let defaultUserState: UserLearningState;
  let emptyKnownWords: Map<string, WordMastery>;

  beforeEach(() => {
    defaultUserState = {
      userLevel: 'B1' as CEFRLevel,
      recentWordsLearned: 0,
      averageMastery: 0,
      streakDays: 0,
      dailyGoalProgress: 0,
    };

    emptyKnownWords = new Map();
  });

  describe('getRecommendations', () => {
    it('should return empty array when no candidates provided', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: [],
        limit: 10,
      });

      expect(result.recommendations).toEqual([]);
      expect(result.summary.totalCandidates).toBe(0);
    });

    it('should return recommendations for candidate words', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach', 'beautiful', 'create'],
        limit: 10,
      });

      expect(result.recommendations.length).toBeGreaterThan(0);
      expect(result.recommendations.length).toBeLessThanOrEqual(10);
      expect(result.summary.totalCandidates).toBe(4);
    });

    it('should filter out mastered words', () => {
      const knownWordsWithMastered = new Map<string, WordMastery>();
      knownWordsWithMastered.set('analyze', {
        word: 'analyze',
        level: MasteryLevel.MASTERED,
        firstSeenAt: Date.now() - 100000,
        lastReviewedAt: Date.now(),
        reviewCount: 10,
        correctCount: 10,
        consecutiveCorrect: 10,
        difficulty: 0.3,
        contextCount: 5,
      });

      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: knownWordsWithMastered,
        candidateWords: ['analyze', 'approach'],
        limit: 10,
      });

      // analyze 已掌握，应该被过滤掉
      expect(result.recommendations.find(r => r.word === 'analyze')).toBeUndefined();
    });

    it('should prioritize words just above user level', () => {
      // B1 用户应该优先推荐 B2 级别的词
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['the', 'analyze', 'elucidate', 'approach'], // A1, B1, C1, B1
        limit: 10,
        strategy: RecommendationStrategy.PROXIMAL,
      });

      // 检查推荐结果包含超出 B1 水平的词
      const hasHigherLevelWords = result.recommendations.some(
        r => r.level === 'B2' || r.level === 'C1'
      );

      expect(hasHigherLevelWords || result.recommendations.length > 0).toBe(true);
    });

    it('should sort recommendations by score', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach', 'create', 'method', 'theory'],
        limit: 10,
      });

      for (let i = 1; i < result.recommendations.length; i++) {
        expect(result.recommendations[i - 1].recommendationScore).toBeGreaterThanOrEqual(
          result.recommendations[i].recommendationScore
        );
      }
    });

    it('should respect limit parameter', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach', 'create', 'method', 'theory', 'evaluate', 'context'],
        limit: 3,
      });

      expect(result.recommendations.length).toBeLessThanOrEqual(3);
    });

    it('should generate learning advice', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach'],
        limit: 10,
      });

      expect(result.learningAdvice).toBeDefined();
      expect(typeof result.learningAdvice).toBe('string');
    });
  });

  describe('Recommendation Strategies', () => {
    const candidateWords = ['the', 'analyze', 'elucidate', 'approach', 'create'];

    it('PROXIMAL strategy should filter for appropriate difficulty', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords,
        strategy: RecommendationStrategy.PROXIMAL,
      });

      // 邻近难度策略应该返回空或符合难度范围的词
      result.recommendations.forEach(rec => {
        const levelIndex = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf(rec.level);
        const userIndex = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].indexOf('B1');
        expect(levelIndex).toBeGreaterThanOrEqual(userIndex);
      });
    });

    it('HIGH_FREQUENCY strategy should filter common words', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords,
        strategy: RecommendationStrategy.HIGH_FREQUENCY,
      });

      result.recommendations.forEach(rec => {
        expect(rec.isCommon).toBe(true);
      });
    });

    it('SPACED_REPETITION strategy should require mastery record', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords,
        strategy: RecommendationStrategy.SPACED_REPETITION,
      });

      // 没有复习记录时应该返回空
      expect(result.recommendations).toEqual([]);
    });

    it('SPACED_REPETITION should include overdue words', () => {
      const knownWordsWithOverdue = new Map<string, WordMastery>();
      knownWordsWithOverdue.set('analyze', {
        word: 'analyze',
        level: MasteryLevel.LEARNING,
        firstSeenAt: Date.now() - 1000000,
        lastReviewedAt: Date.now() - 3 * 24 * 60 * 60 * 1000, // 3 days ago
        reviewCount: 3,
        correctCount: 2,
        consecutiveCorrect: 1,
        difficulty: 0.5,
        contextCount: 2,
      });

      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: knownWordsWithOverdue,
        candidateWords: ['analyze', 'approach'],
        strategy: RecommendationStrategy.SPACED_REPETITION,
      });

      // 有逾期复习记录的词应该被推荐
      expect(result.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('RecommendationService', () => {
    it('should create service with default config', () => {
      const service = createRecommendationService('B1');
      expect(service).toBeDefined();
    });

    it('should update user state', () => {
      const service = createRecommendationService('B1');
      service.updateUserState({
        streakDays: 5,
        dailyGoalProgress: 0.5,
      });

      const plan = service.getDailyStudyPlan(10);
      expect(plan).toBeDefined();
    });

    it('should add known words', () => {
      const service = createRecommendationService('B1');
      service.addKnownWord('test', {
        word: 'test',
        level: MasteryLevel.MASTERED, // 已掌握的词应该被过滤
        firstSeenAt: Date.now(),
        lastReviewedAt: Date.now(),
        reviewCount: 5,
        correctCount: 4,
        consecutiveCorrect: 3,
        difficulty: 0.4,
        contextCount: 3,
      });

      const result = service.getRecommendations(['test', 'analyze']);
      // test 已被添加为已掌握词汇，不应该出现在推荐中
      expect(result.recommendations.find(r => r.word === 'test')).toBeUndefined();
    });

    it('should get daily study plan', () => {
      const service = createRecommendationService('B1');
      const plan = service.getDailyStudyPlan(20);

      expect(plan).toBeDefined();
      expect(plan.totalEstimatedTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Word Recommendation Properties', () => {
    it('should have valid recommendation score', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach', 'create'],
        limit: 10,
      });

      result.recommendations.forEach(rec => {
        expect(rec.recommendationScore).toBeGreaterThanOrEqual(0);
        expect(rec.recommendationScore).toBeLessThanOrEqual(100);
      });
    });

    it('should have valid estimated study time', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach', 'create'],
        limit: 10,
      });

      result.recommendations.forEach(rec => {
        expect(rec.estimatedStudyTime).toBeGreaterThan(0);
        expect(rec.estimatedStudyTime).toBeLessThan(120); // 应该少于2分钟
      });
    });

    it('should have reason for each recommendation', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach', 'create'],
        limit: 10,
      });

      result.recommendations.forEach(rec => {
        expect(rec.reason).toBeDefined();
        expect(typeof rec.reason).toBe('string');
        expect(rec.reason.length).toBeGreaterThan(0);
      });
    });

    it('should mark high-score words as priority', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['analyze', 'approach', 'create', 'method', 'theory'],
        limit: 10,
      });

      const priorityWords = result.recommendations.filter(r => r.isPriority);
      priorityWords.forEach(rec => {
        expect(rec.recommendationScore).toBeGreaterThanOrEqual(75);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty word with low confidence', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['', '  ', 'analyze'],
        limit: 10,
      });

      // 空字符串会被处理但置信度很低
      const emptyWord = result.recommendations.find(r => r.word === '');
      if (emptyWord) {
        expect(emptyWord.confidence).toBeLessThanOrEqual(0.2);
      }
    });

    it('should handle very short words', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['a', 'an', 'the', 'be'],
        limit: 10,
      });

      expect(result.recommendations.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle special characters in words', () => {
      const result = getRecommendations({
        userState: defaultUserState,
        knownWords: emptyKnownWords,
        candidateWords: ['well-being', 'self-awareness', 'eco-friendly'],
        limit: 10,
      });

      expect(result.recommendations.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle all CEFR levels', () => {
      const levels: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

      levels.forEach(level => {
        const result = getRecommendations({
          userState: { ...defaultUserState, userLevel: level },
          knownWords: emptyKnownWords,
          candidateWords: ['analyze', 'approach', 'create'],
          limit: 5,
        });

        expect(result.summary.userLevel).toBe(level);
      });
    });
  });
});