/**
 * mastery.ts 工具函数测试
 *
 * 测试词汇掌握度计算的核心算法
 */
import { describe, it, expect } from 'vitest';
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

// Helper to create a basic word mastery entry
function createTestEntry(overrides: Partial<WordMasteryEntry> = {}): WordMasteryEntry {
  return {
    word: 'test',
    translation: '测试',
    context: 'This is a test',
    markedAt: Date.now() - 86400000,
    reviewCount: 0,
    masteryLevel: 0.5,
    confidence: 0.5,
    knownCount: 1,
    unknownCount: 0,
    lastReviewAt: Date.now() - 86400000,
    nextReviewAt: Date.now() + 86400000,
    estimatedLevel: 'B1',
    ...overrides,
  };
}

describe('bayesianMasteryUpdate', () => {
  it('应该在用户认识单词时增加掌握度', () => {
    const params: BayesianUpdateParams = {
      priorMastery: 0.5,
      priorConfidence: 0.3,
      observation: true,
      wordDifficulty: 5,
      userVocabularySize: 4000,
    };

    const result = bayesianMasteryUpdate(params);

    expect(result.mastery).toBeGreaterThan(0.5);
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('应该在用户不认识单词时降低掌握度', () => {
    const params: BayesianUpdateParams = {
      priorMastery: 0.5,
      priorConfidence: 0.3,
      observation: false,
      wordDifficulty: 5,
      userVocabularySize: 4000,
    };

    const result = bayesianMasteryUpdate(params);

    expect(result.mastery).toBeLessThan(0.5);
  });

  it('应该在用户认识高难度单词时影响掌握度', () => {
    const paramsLowDifficulty: BayesianUpdateParams = {
      priorMastery: 0.5,
      priorConfidence: 0.3,
      observation: true,
      wordDifficulty: 3, // 低难度
      userVocabularySize: 4000,
    };

    const paramsHighDifficulty: BayesianUpdateParams = {
      ...paramsLowDifficulty,
      wordDifficulty: 8, // 高难度
    };

    const lowResult = bayesianMasteryUpdate(paramsLowDifficulty);
    const highResult = bayesianMasteryUpdate(paramsHighDifficulty);

    // 两种情况都应该更新掌握度
    expect(lowResult.mastery).not.toBe(0.5);
    expect(highResult.mastery).not.toBe(0.5);
  });

  it('应该确保掌握度在 0-1 范围内', () => {
    const extremeParams: BayesianUpdateParams = {
      priorMastery: 0.99,
      priorConfidence: 0.99,
      observation: true,
      wordDifficulty: 1,
      userVocabularySize: 20000,
    };

    const result = bayesianMasteryUpdate(extremeParams);

    expect(result.mastery).toBeLessThanOrEqual(1);
    expect(result.mastery).toBeGreaterThanOrEqual(0);
  });

  it('应该确保置信度有上限', () => {
    const params: BayesianUpdateParams = {
      priorMastery: 0.5,
      priorConfidence: 0.95,
      observation: true,
      wordDifficulty: 5,
      userVocabularySize: 4000,
    };

    const result = bayesianMasteryUpdate(params);

    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe('calculateWordMastery', () => {
  it('应该计算基于观察比例的掌握度', () => {
    const entry = createTestEntry({
      masteryLevel: 0.5,
      knownCount: 8,
      unknownCount: 2,
    });

    const result = calculateWordMastery(entry, 4000);

    // 80% 的认识率应该提高掌握度
    expect(result.mastery).toBeGreaterThan(0.5);
  });

  it('应该在很久没复习时降低置信度', () => {
    const entry = createTestEntry({
      confidence: 0.8,
      lastReviewAt: Date.now() - 90 * 24 * 60 * 60 * 1000, // 90 天前
    });

    const result = calculateWordMastery(entry, 4000);

    expect(result.confidence).toBeLessThan(0.8);
  });

  it('应该在最近复习过时保持高置信度', () => {
    const entry = createTestEntry({
      confidence: 0.8,
      lastReviewAt: Date.now() - 1 * 24 * 60 * 60 * 1000, // 1 天前
    });

    const result = calculateWordMastery(entry, 4000);

    expect(result.confidence).toBe(0.8);
  });
});

describe('createWordMasteryEntry', () => {
  it('应该为认识的单词创建高初始掌握度', () => {
    const wordEntry: UnknownWordEntry = {
      word: 'hello',
      context: 'Hello world',
      translation: '你好',
      markedAt: Date.now(),
      reviewCount: 0,
    };

    const entry = createWordMasteryEntry(wordEntry, 5, true);

    expect(entry.masteryLevel).toBe(0.6);
    expect(entry.knownCount).toBe(1);
    expect(entry.unknownCount).toBe(0);
    expect(entry.estimatedLevel).toBeDefined();
  });

  it('应该为不认识的单词创建低初始掌握度', () => {
    const wordEntry: UnknownWordEntry = {
      word: 'complicated',
      context: 'A complicated issue',
      translation: '复杂的',
      markedAt: Date.now(),
      reviewCount: 0,
    };

    const entry = createWordMasteryEntry(wordEntry, 8, false);

    expect(entry.masteryLevel).toBe(0.3);
    expect(entry.knownCount).toBe(0);
    expect(entry.unknownCount).toBe(1);
  });
});

describe('updateWordMastery', () => {
  it('应该正确更新掌握度', () => {
    const entry = createTestEntry();

    const result = updateWordMastery(entry, true, 5, 4000);

    expect(result.newMasteryLevel).toBeGreaterThan(entry.masteryLevel);
    expect(result.nextReviewInterval).toBeGreaterThan(0);
  });

  it('应该在掌握度高时延长复习间隔', () => {
    const highMasteryEntry = createTestEntry({ masteryLevel: 0.9 });
    const lowMasteryEntry = createTestEntry({ masteryLevel: 0.3 });

    const highResult = updateWordMastery(highMasteryEntry, true, 5, 4000);
    const lowResult = updateWordMastery(lowMasteryEntry, true, 5, 4000);

    expect(highResult.nextReviewInterval).toBeGreaterThan(lowResult.nextReviewInterval);
  });

  it('应该在答错时缩短复习间隔', () => {
    const entry = createTestEntry();

    const correctResult = updateWordMastery(entry, true, 5, 4000);
    const wrongResult = updateWordMastery(entry, false, 5, 4000);

    expect(correctResult.nextReviewInterval).toBeGreaterThan(wrongResult.nextReviewInterval);
  });
});

describe('calculateReviewInterval', () => {
  it('应该根据复习次数增加间隔', () => {
    const interval1 = calculateReviewInterval(1, 0.5, true);
    const interval5 = calculateReviewInterval(5, 0.5, true);

    expect(interval5).toBeGreaterThan(interval1);
  });

  it('应该根据掌握度调整间隔', () => {
    const lowMasteryInterval = calculateReviewInterval(3, 0.3, true);
    const highMasteryInterval = calculateReviewInterval(3, 0.9, true);

    expect(highMasteryInterval).toBeGreaterThan(lowMasteryInterval);
  });

  it('应该在答错时缩短间隔', () => {
    const entry = createTestEntry();

    const correctResult = updateWordMastery(entry, true, 5, 4000);
    const wrongResult = updateWordMastery(entry, false, 5, 4000);

    // 答错应该导致更短的复习间隔
    expect(correctResult.nextReviewInterval).toBeGreaterThan(wrongResult.nextReviewInterval);
  });

  it('应该限制最大间隔', () => {
    const interval = calculateReviewInterval(100, 1.0, true);

    expect(interval).toBeLessThanOrEqual(180); // maxIntervalDays
  });

  it('应该确保最小间隔为 1 天', () => {
    const interval = calculateReviewInterval(0, 0.1, false);

    expect(interval).toBeGreaterThanOrEqual(1);
  });
});

describe('calculateNextReviewTime', () => {
  it('应该返回未来的时间戳', () => {
    const now = Date.now();
    const nextReview = calculateNextReviewTime(1, true, 0.5);

    expect(nextReview).toBeGreaterThan(now);
  });

  it('应该基于间隔计算正确的时间', () => {
    const interval = calculateReviewInterval(1, 0.5, true);
    const nextReview = calculateNextReviewTime(1, true, 0.5);

    const expectedTime = Date.now() + interval * 24 * 60 * 60 * 1000;
    // 允许 1 秒误差
    expect(Math.abs(nextReview - expectedTime)).toBeLessThan(1000);
  });
});

describe('calculateMasteryStats', () => {
  it('应该正确统计各类单词数量', () => {
    const wordMastery: Record<string, WordMasteryEntry> = {
      'mastered1': createTestEntry({ word: 'mastered1', masteryLevel: 0.9 }),
      'mastered2': createTestEntry({ word: 'mastered2', masteryLevel: 0.85 }),
      'learning1': createTestEntry({ word: 'learning1', masteryLevel: 0.5 }),
      'struggling1': createTestEntry({ word: 'struggling1', masteryLevel: 0.2 }),
    };

    const stats = calculateMasteryStats(wordMastery);

    expect(stats.totalWords).toBe(4);
    expect(stats.masteredWords).toBe(2);
    expect(stats.learningWords).toBe(1);
    expect(stats.strugglingWords).toBe(1);
  });

  it('应该统计需要复习的单词', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {
      'due1': createTestEntry({ word: 'due1', nextReviewAt: now - 86400000 }),
      'due2': createTestEntry({ word: 'due2', nextReviewAt: now - 1000 }),
      'future': createTestEntry({ word: 'future', nextReviewAt: now + 86400000 }),
    };

    const stats = calculateMasteryStats(wordMastery);

    expect(stats.dueForReview).toBe(2);
  });

  it('应该正确计算 CEFR 等级分布', () => {
    const wordMastery: Record<string, WordMasteryEntry> = {
      'a1': createTestEntry({ word: 'a1', estimatedLevel: 'A1' }),
      'b1': createTestEntry({ word: 'b1', estimatedLevel: 'B1' }),
      'b2': createTestEntry({ word: 'b2', estimatedLevel: 'B2' }),
    };

    const stats = calculateMasteryStats(wordMastery);

    expect(stats.levelDistribution.A1).toBe(1);
    expect(stats.levelDistribution.B1).toBe(1);
    expect(stats.levelDistribution.B2).toBe(1);
    expect(stats.levelDistribution.A2).toBe(0);
  });
});

describe('calculateOverallCEFRLevel', () => {
  it('应该在没有数据时根据词汇量估算', () => {
    // 词汇量 4000 对应 B2
    const level = calculateOverallCEFRLevel({}, 4000);

    expect(['B1', 'B2']).toContain(level);
  });

  it('应该根据掌握度加权计算等级', () => {
    const wordMastery: Record<string, WordMasteryEntry> = {
      'c1': createTestEntry({
        word: 'c1',
        estimatedLevel: 'C1',
        masteryLevel: 0.9,
        confidence: 0.8,
      }),
      'a1': createTestEntry({
        word: 'a1',
        estimatedLevel: 'A1',
        masteryLevel: 0.3,
        confidence: 0.5,
      }),
    };

    const level = calculateOverallCEFRLevel(wordMastery, 4000);

    // C1 单词掌握度高，应该拉高整体等级
    expect(['B2', 'C1']).toContain(level);
  });
});

describe('getReviewReminders', () => {
  it('应该返回需要复习的单词列表', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {
      'due1': createTestEntry({
        word: 'due1',
        nextReviewAt: now - 86400000,
        masteryLevel: 0.5,
      }),
      'due2': createTestEntry({
        word: 'due2',
        nextReviewAt: now - 172800000, // 2 天前
        masteryLevel: 0.3,
      }),
      'future': createTestEntry({
        word: 'future',
        nextReviewAt: now + 86400000,
      }),
    };

    const reminders = getReviewReminders(wordMastery, 10);

    expect(reminders.length).toBe(2);
    expect(reminders.map(r => r.word)).toContain('due1');
    expect(reminders.map(r => r.word)).toContain('due2');
  });

  it('应该按优先级排序', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {
      'lowPriority': createTestEntry({
        word: 'lowPriority',
        nextReviewAt: now - 86400000,
        masteryLevel: 0.9,
      }),
      'highPriority': createTestEntry({
        word: 'highPriority',
        nextReviewAt: now - 172800000,
        masteryLevel: 0.3,
      }),
    };

    const reminders = getReviewReminders(wordMastery);

    // 高优先级（逾期久 + 掌握度低）应该排在前面
    expect(reminders[0].word).toBe('highPriority');
  });

  it('应该限制返回数量', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {};

    for (let i = 0; i < 50; i++) {
      wordMastery[`word${i}`] = createTestEntry({
        word: `word${i}`,
        nextReviewAt: now - 86400000,
      });
    }

    const reminders = getReviewReminders(wordMastery, 10);

    expect(reminders.length).toBe(10);
  });
});

describe('calculateMasteryTrend', () => {
  it('应该生成 30 天的趋势数据', () => {
    const wordMastery: Record<string, WordMasteryEntry> = {
      'word1': createTestEntry({ word: 'word1', masteryLevel: 0.8 }),
    };

    const trend = calculateMasteryTrend(wordMastery, 30);

    expect(trend.last30Days.length).toBe(30);
    expect(trend.last30Days[0]).toHaveProperty('date');
    expect(trend.last30Days[0]).toHaveProperty('masteredCount');
  });

  it('应该计算掌握度变化率', () => {
    const wordMastery: Record<string, WordMasteryEntry> = {};

    // 创建有增长的数据
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      wordMastery[`word${i}`] = createTestEntry({
        word: `word${i}`,
        masteryLevel: 0.8 + i * 0.01,
        markedAt: now - (30 - i) * 24 * 60 * 60 * 1000,
      });
    }

    const trend = calculateMasteryTrend(wordMastery);

    expect(trend.masteryChangeRate).toBeDefined();
  });
});

describe('calculateLearningActivity', () => {
  it('应该生成每日活动记录', () => {
    const wordMastery: Record<string, WordMasteryEntry> = {
      'word1': createTestEntry({
        word: 'word1',
        markedAt: Date.now() - 86400000,
      }),
    };

    const activities = calculateLearningActivity(wordMastery, 7);

    expect(activities.length).toBe(7);
    expect(activities[0]).toHaveProperty('date');
    expect(activities[0]).toHaveProperty('newWords');
    expect(activities[0]).toHaveProperty('studyMinutes');
  });

  it('应该计算连续学习天数', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {};

    // 创建 3 天连续学习记录
    for (let i = 0; i < 3; i++) {
      wordMastery[`word${i}`] = createTestEntry({
        word: `word${i}`,
        markedAt: now - i * 24 * 60 * 60 * 1000,
      });
    }

    const activities = calculateLearningActivity(wordMastery, 7);

    // 最后一天应该有连续学习天数
    const lastActivity = activities[activities.length - 1];
    expect(lastActivity.streakDays).toBeGreaterThan(0);
  });
});

describe('generateHeatmapData', () => {
  it('应该生成指定周数的热力图数据', () => {
    const wordMastery: Record<string, WordMasteryEntry> = {};

    const heatmap = generateHeatmapData(wordMastery, 4);

    expect(heatmap.length).toBe(4 * 7); // 4 周 = 28 天
    // 每个数据点应该有正确的结构
    expect(heatmap[0]).toHaveProperty('date');
    expect(heatmap[0]).toHaveProperty('intensity');
    expect(heatmap[0]).toHaveProperty('count');
    expect(heatmap[0]).toHaveProperty('type');
  });

  it('应该确定活动类型 - 新单词类型为 new', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {
      'new1': createTestEntry({
        word: 'new1',
        markedAt: now,
        lastReviewAt: undefined,
      }),
    };

    const heatmap = generateHeatmapData(wordMastery, 1);

    // 应该有至少一个 new 类型的数据点
    const hasNewType = heatmap.some(d => d.type === 'new' || d.type === 'mixed');
    expect(hasNewType).toBe(true);
  });
});

describe('calculateLearningStatistics', () => {
  it('应该计算综合学习统计', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {};

    for (let i = 0; i < 10; i++) {
      wordMastery[`word${i}`] = createTestEntry({
        word: `word${i}`,
        markedAt: now - i * 24 * 60 * 60 * 1000,
        lastReviewAt: now - i * 24 * 60 * 60 * 1000,
      });
    }

    const stats = calculateLearningStatistics(wordMastery, 30);

    expect(stats.totalStudyDays).toBeGreaterThan(0);
    expect(stats.heatmapData).toBeDefined();
    expect(stats.recentActivity.length).toBe(7);
  });

  it('应该计算连续学习天数', () => {
    const now = Date.now();
    const wordMastery: Record<string, WordMasteryEntry> = {};

    for (let i = 0; i < 5; i++) {
      wordMastery[`word${i}`] = createTestEntry({
        word: `word${i}`,
        markedAt: now - i * 24 * 60 * 60 * 1000,
      });
    }

    const stats = calculateLearningStatistics(wordMastery, 7);

    expect(stats.currentStreak).toBeGreaterThan(0);
  });
});