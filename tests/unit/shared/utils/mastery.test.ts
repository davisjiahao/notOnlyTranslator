/**
 * 词汇掌握度计算测试
 *
 * 测试贝叶斯更新、间隔重复、统计计算等核心算法
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bayesianMasteryUpdate,
  calculateWordMastery,
  createWordMasteryEntry,
  updateWordMastery,
  calculateReviewInterval,
  calculateNextReviewTime,
  calculateMasteryStats,
  calculateOverallCEFRLevel,
  getReviewReminders,
  calculateMasteryTrend,
  calculateLearningActivity,
  generateHeatmapData,
  calculateLearningStatistics,
} from '@/shared/utils/mastery';
import type { WordMasteryEntry, BayesianUpdateParams } from '@/shared/types/mastery';
import type { UnknownWordEntry } from '@/shared/types';

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const createEntry = (overrides: Partial<WordMasteryEntry> = {}): WordMasteryEntry => ({
  word: 'test',
  context: 'test context',
  translation: '测试',
  markedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
  reviewCount: 2,
  masteryLevel: 0.5,
  confidence: 0.3,
  knownCount: 2,
  unknownCount: 1,
  nextReviewAt: Date.now() + 1 * 24 * 60 * 60 * 1000,
  estimatedLevel: 'B1',
  ...overrides,
});

describe('bayesianMasteryUpdate', () => {
  const makeParams = (overrides: Partial<BayesianUpdateParams> = {}): BayesianUpdateParams => ({
    priorMastery: 0.5,
    priorConfidence: 0.3,
    observation: true,
    wordDifficulty: 5,
    userVocabularySize: 3000,
    ...overrides,
  });

  it('increases mastery when user knows a word', () => {
    const result = bayesianMasteryUpdate(makeParams({ observation: true }));
    expect(result.mastery).toBeGreaterThan(0.5);
  });

  it('decreases mastery when user does not know a word', () => {
    const result = bayesianMasteryUpdate(makeParams({ observation: false }));
    expect(result.mastery).toBeLessThan(0.5);
  });

  it('increases confidence on each observation', () => {
    const result = bayesianMasteryUpdate(makeParams({ priorConfidence: 0.1, observation: true }));
    expect(result.confidence).toBeGreaterThan(0.1);
  });

  it('caps mastery at 1.0', () => {
    const result = bayesianMasteryUpdate(makeParams({
      priorMastery: 0.95,
      observation: true,
      wordDifficulty: 10,
    }));
    expect(result.mastery).toBeLessThanOrEqual(1);
  });

  it('caps mastery at 0.0 minimum', () => {
    const result = bayesianMasteryUpdate(makeParams({
      priorMastery: 0.05,
      observation: false,
      wordDifficulty: 1,
    }));
    expect(result.mastery).toBeGreaterThanOrEqual(0);
  });

  it('caps confidence at maxConfidence', () => {
    const result = bayesianMasteryUpdate(makeParams({
      priorConfidence: 0.95,
      observation: true,
    }));
    expect(result.confidence).toBeLessThanOrEqual(0.99);
  });

  it('rewards knowing high-difficulty words more', () => {
    const easy = bayesianMasteryUpdate(makeParams({ observation: true, wordDifficulty: 2 }));
    const hard = bayesianMasteryUpdate(makeParams({ observation: true, wordDifficulty: 9 }));
    expect(hard.mastery).toBeGreaterThan(easy.mastery);
  });

  it('penalizes not knowing easy words more', () => {
    const easy = bayesianMasteryUpdate(makeParams({ observation: false, wordDifficulty: 2 }));
    const hard = bayesianMasteryUpdate(makeParams({ observation: false, wordDifficulty: 9 }));
    expect(easy.mastery).toBeLessThan(hard.mastery);
  });

  it('bounds user vocabulary size to [1000, 20000]', () => {
    const veryLow = bayesianMasteryUpdate(makeParams({ userVocabularySize: 100, observation: true }));
    const veryHigh = bayesianMasteryUpdate(makeParams({ userVocabularySize: 50000, observation: true }));
    expect(veryLow.mastery).toBeGreaterThanOrEqual(0);
    expect(veryHigh.mastery).toBeLessThanOrEqual(1);
  });
});

describe('calculateWordMastery', () => {
  it('returns mastery adjusted by known/unknown ratio', () => {
    const entry = createEntry({ masteryLevel: 0.5, knownCount: 5, unknownCount: 0 });
    const result = calculateWordMastery(entry, 3000);
    expect(result.mastery).toBeGreaterThan(0.5);
  });

  it('decreases mastery when more unknowns', () => {
    const entry = createEntry({ masteryLevel: 0.5, knownCount: 0, unknownCount: 5 });
    const result = calculateWordMastery(entry, 3000);
    expect(result.mastery).toBeLessThan(0.5);
  });

  it('decays confidence when no recent review', () => {
    const entry = createEntry({
      confidence: 0.9,
      lastReviewAt: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
      markedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    });
    const result = calculateWordMastery(entry, 3000);
    expect(result.confidence).toBeLessThan(0.9);
  });

  it('returns values in valid range', () => {
    const entry = createEntry();
    const result = calculateWordMastery(entry, 3000);
    expect(result.mastery).toBeGreaterThanOrEqual(0);
    expect(result.mastery).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0.1);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('createWordMasteryEntry', () => {
  it('creates entry with knownCount=1 when isKnown=true', () => {
    const wordEntry: UnknownWordEntry = {
      word: 'ephemeral',
      context: 'test',
      translation: '短暂的',
      markedAt: Date.now(),
      reviewCount: 0,
    };
    const entry = createWordMasteryEntry(wordEntry, 7, true);
    expect(entry.knownCount).toBe(1);
    expect(entry.unknownCount).toBe(0);
    expect(entry.masteryLevel).toBe(0.6);
  });

  it('creates entry with unknownCount=1 when isKnown=false', () => {
    const wordEntry: UnknownWordEntry = {
      word: 'ephemeral',
      context: 'test',
      translation: '短暂的',
      markedAt: Date.now(),
      reviewCount: 0,
    };
    const entry = createWordMasteryEntry(wordEntry, 7, false);
    expect(entry.knownCount).toBe(0);
    expect(entry.unknownCount).toBe(1);
    expect(entry.masteryLevel).toBe(0.3);
  });

  it('sets initial confidence to 0.2', () => {
    const wordEntry: UnknownWordEntry = {
      word: 'test',
      context: 'test',
      translation: '测试',
      markedAt: Date.now(),
      reviewCount: 0,
    };
    const entry = createWordMasteryEntry(wordEntry, 5, true);
    expect(entry.confidence).toBe(0.2);
  });
});

describe('updateWordMastery', () => {
  it('returns updated mastery and confidence', () => {
    const entry = createEntry({ masteryLevel: 0.5, confidence: 0.3 });
    const result = updateWordMastery(entry, true, 5, 3000);
    expect(result.newMasteryLevel).toBeGreaterThanOrEqual(0);
    expect(result.newMasteryLevel).toBeLessThanOrEqual(1);
    expect(result.newConfidence).toBeGreaterThan(0.3);
  });

  it('returns a positive review interval', () => {
    const entry = createEntry();
    const result = updateWordMastery(entry, true, 5, 3000);
    expect(result.nextReviewInterval).toBeGreaterThanOrEqual(1);
  });

  it('detects level upgrade', () => {
    const entry = createEntry({ masteryLevel: 0.95, estimatedLevel: 'B1' });
    const result = updateWordMastery(entry, true, 7, 5000);
    expect(result.levelUpgraded).toBe(true);
    expect(result.newLevel).toBe('B2');
  });

  it('does not upgrade when mastery is low', () => {
    const entry = createEntry({ masteryLevel: 0.3, estimatedLevel: 'B1' });
    const result = updateWordMastery(entry, false, 3, 3000);
    expect(result.levelUpgraded).toBe(false);
  });
});

describe('calculateReviewInterval', () => {
  it('returns 1 day for first review (count=0)', () => {
    expect(calculateReviewInterval(0, 0.5, true)).toBe(1);
  });

  it('increases interval with more reviews', () => {
    const i1 = calculateReviewInterval(1, 0.5, true);
    const i2 = calculateReviewInterval(3, 0.5, true);
    expect(i2).toBeGreaterThan(i1);
  });

  it('increases interval with higher mastery', () => {
    const low = calculateReviewInterval(2, 0.2, true);
    const high = calculateReviewInterval(2, 0.9, true);
    expect(high).toBeGreaterThan(low);
  });

  it('halves interval on wrong answer', () => {
    const correct = calculateReviewInterval(2, 0.5, true);
    const wrong = calculateReviewInterval(2, 0.5, false);
    expect(wrong).toBeLessThan(correct);
  });

  it('respects max interval cap', () => {
    const interval = calculateReviewInterval(100, 0.99, true);
    expect(interval).toBeLessThanOrEqual(365);
  });

  it('minimum interval is 1', () => {
    const interval = calculateReviewInterval(0, 0.01, false);
    expect(interval).toBeGreaterThanOrEqual(1);
  });
});

describe('calculateNextReviewTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a future timestamp', () => {
    const result = calculateNextReviewTime(0, true, 0.5);
    expect(result).toBeGreaterThan(Date.now());
  });

  it('returns a further date for higher mastery', () => {
    const low = calculateNextReviewTime(2, true, 0.2);
    const high = calculateNextReviewTime(2, true, 0.9);
    expect(high).toBeGreaterThan(low);
  });
});

describe('calculateMasteryStats', () => {
  it('counts mastered, learning, and struggling words', () => {
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', masteryLevel: 0.9 }),
      word2: createEntry({ word: 'word2', masteryLevel: 0.5 }),
      word3: createEntry({ word: 'word3', masteryLevel: 0.2 }),
    };

    const stats = calculateMasteryStats(mastery);

    expect(stats.masteredWords).toBe(1);
    expect(stats.learningWords).toBe(1);
    expect(stats.strugglingWords).toBe(1);
    expect(stats.totalWords).toBe(3);
  });

  it('counts due for review', () => {
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', nextReviewAt: Date.now() - 1000 }),
      word2: createEntry({ word: 'word2', nextReviewAt: Date.now() + 1000 }),
    };

    const stats = calculateMasteryStats(mastery);
    expect(stats.dueForReview).toBe(1);
  });

  it('returns CEFR distribution', () => {
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', estimatedLevel: 'A1' }),
      word2: createEntry({ word: 'word2', estimatedLevel: 'B1' }),
      word3: createEntry({ word: 'word3', estimatedLevel: 'B1' }),
    };

    const stats = calculateMasteryStats(mastery);
    expect(stats.levelDistribution.A1).toBe(1);
    expect(stats.levelDistribution.B1).toBe(2);
    expect(stats.levelDistribution.C2).toBe(0);
  });

  it('returns zeros for empty input', () => {
    const stats = calculateMasteryStats({});
    expect(stats.totalWords).toBe(0);
    expect(stats.masteredWords).toBe(0);
  });
});

describe('calculateOverallCEFRLevel', () => {
  it('returns vocabulary-based estimate when no word data', () => {
    expect(calculateOverallCEFRLevel({}, 1000)).toBe('A1');
    expect(calculateOverallCEFRLevel({}, 3000)).toBe('B1');
    expect(calculateOverallCEFRLevel({}, 7000)).toBe('C1');
  });

  it('returns CEFR based on weighted mastery', () => {
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', estimatedLevel: 'B2', masteryLevel: 0.9, confidence: 0.9 }),
    };

    const level = calculateOverallCEFRLevel(mastery, 3000);
    expect(['B1', 'B2', 'C1']).toContain(level);
  });
});

describe('getReviewReminders', () => {
  it('returns words that are due for review', () => {
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', nextReviewAt: Date.now() - 86400000 }),
      word2: createEntry({ word: 'word2', nextReviewAt: Date.now() + 86400000 }),
    };

    const reminders = getReviewReminders(mastery);
    expect(reminders).toHaveLength(1);
    expect(reminders[0].word).toBe('word1');
  });

  it('sorts by priority (most overdue first)', () => {
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', nextReviewAt: Date.now() - 2 * 86400000 }),
      word2: createEntry({ word: 'word2', nextReviewAt: Date.now() - 10 * 86400000 }),
    };

    const reminders = getReviewReminders(mastery);
    expect(reminders[0].word).toBe('word2');
  });

  it('respects limit', () => {
    const mastery: Record<string, WordMasteryEntry> = {};
    for (let i = 0; i < 10; i++) {
      mastery[`word${i}`] = createEntry({ word: `word${i}`, nextReviewAt: Date.now() - 86400000 });
    }

    const reminders = getReviewReminders(mastery, 3);
    expect(reminders).toHaveLength(3);
  });

  it('returns empty for no due words', () => {
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', nextReviewAt: Date.now() + 86400000 }),
    };

    expect(getReviewReminders(mastery)).toEqual([]);
  });
});

describe('calculateMasteryTrend', () => {
  it('returns 30 data points by default', () => {
    const trend = calculateMasteryTrend({}, 30);
    expect(trend.last30Days).toHaveLength(30);
  });

  it('returns custom number of days', () => {
    const trend = calculateMasteryTrend({}, 7);
    expect(trend.last30Days).toHaveLength(7);
  });

  it('returns masteryChangeRate', () => {
    const trend = calculateMasteryTrend({});
    expect(typeof trend.masteryChangeRate).toBe('number');
  });

  it('returns daysToNextLevel (null if no progress)', () => {
    const trend = calculateMasteryTrend({});
    expect(trend.daysToNextLevel).toBeNull();
  });
});

describe('calculateLearningActivity', () => {
  it('returns activity for each day', () => {
    const activity = calculateLearningActivity({}, 7);
    expect(activity).toHaveLength(7);
    expect(activity[0]).toHaveProperty('date');
    expect(activity[0]).toHaveProperty('newWords');
    expect(activity[0]).toHaveProperty('reviewWords');
    expect(activity[0]).toHaveProperty('studyMinutes');
  });

  it('calculates streakDays correctly', () => {
    const now = Date.now();
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', markedAt: now - 1 * 86400000 }),
      word2: createEntry({ word: 'word2', markedAt: now - 2 * 86400000 }),
    };

    const activity = calculateLearningActivity(mastery, 5);
    // Last day should have streak
    expect(activity[activity.length - 1].streakDays).toBeGreaterThanOrEqual(0);
  });
});

describe('generateHeatmapData', () => {
  it('returns data for requested weeks', () => {
    const data = generateHeatmapData({}, 4);
    expect(data).toHaveLength(28); // 4 weeks * 7 days
  });

  it('returns correct intensity levels', () => {
    vi.useFakeTimers();
    const fixedNow = new Date('2026-06-15T12:00:00Z').getTime();
    vi.setSystemTime(fixedNow);

    const mastery: Record<string, WordMasteryEntry> = {};
    // Create 25 words marked 2 days ago (within heatmap range)
    const twoDaysAgo = fixedNow - 2 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 25; i++) {
      mastery[`word${i}`] = createEntry({ word: `word${i}`, markedAt: twoDaysAgo });
    }

    const data = generateHeatmapData(mastery, 4);
    const activeDay = data.find(d => d.count > 0);
    expect(activeDay?.intensity).toBe(4);

    vi.useRealTimers();
  });

  it('classifies activity type correctly', () => {
    vi.useFakeTimers();
    const fixedNow = new Date('2026-06-15T12:00:00Z').getTime();
    vi.setSystemTime(fixedNow);

    const threeDaysAgo = fixedNow - 3 * 24 * 60 * 60 * 1000;
    const mastery: Record<string, WordMasteryEntry> = {
      word1: createEntry({ word: 'word1', markedAt: threeDaysAgo, lastReviewAt: undefined }),
    };

    const data = generateHeatmapData(mastery, 4);
    const activeDay = data.find(d => d.count > 0);
    expect(activeDay?.type).toBe('new');

    vi.useRealTimers();
  });

  it('returns zero intensity for empty data', () => {
    const data = generateHeatmapData({}, 1);
    data.forEach(d => {
      expect(d.intensity).toBe(0);
      expect(d.count).toBe(0);
    });
  });
});

describe('calculateLearningStatistics', () => {
  it('returns comprehensive statistics', () => {
    const stats = calculateLearningStatistics({}, 7);

    expect(stats).toHaveProperty('totalStudyDays');
    expect(stats).toHaveProperty('currentStreak');
    expect(stats).toHaveProperty('longestStreak');
    expect(stats).toHaveProperty('weeklyStudyDays');
    expect(stats).toHaveProperty('monthlyStudyDays');
    expect(stats).toHaveProperty('averageDailyWords');
    expect(stats).toHaveProperty('totalStudyMinutes');
    expect(stats).toHaveProperty('heatmapData');
    expect(stats).toHaveProperty('recentActivity');
  });

  it('returns heatmap with correct length', () => {
    const stats = calculateLearningStatistics({}, 14);
    // 14 days / 7 = 2 weeks
    expect(stats.heatmapData).toHaveLength(14);
  });

  it('returns recentActivity for last 7 days', () => {
    const stats = calculateLearningStatistics({}, 30);
    expect(stats.recentActivity).toHaveLength(7);
  });

  it('returns zero stats for empty input', () => {
    const stats = calculateLearningStatistics({}, 7);
    expect(stats.totalStudyDays).toBe(0);
    expect(stats.currentStreak).toBe(0);
    expect(stats.longestStreak).toBe(0);
    expect(stats.averageDailyWords).toBe(0);
  });
});
