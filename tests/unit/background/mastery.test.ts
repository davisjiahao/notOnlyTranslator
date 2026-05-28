/**
 * MasteryManager 测试
 *
 * 覆盖 MasteryManager 所有静态方法
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MasteryManager } from '@/background/mastery';
import { StorageManager } from '@/background/storage';
import type { UnknownWordEntry } from '@/shared/types';
import type { WordMasteryEntry, MasteryProfile } from '@/shared/types/mastery';

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * 创建内存中的 mock chrome storage
 */
function createMockChromeStorage() {
  const syncStore: Record<string, unknown> = {};
  const localStore: Record<string, unknown> = {};

  return {
    storage: {
      sync: {
        get: vi.fn((keys: string | string[] | null) => {
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: syncStore[keys] });
          }
          if (Array.isArray(keys)) {
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              result[key] = syncStore[key];
            }
            return Promise.resolve(result);
          }
          return Promise.resolve({ ...syncStore });
        }),
        set: vi.fn((data: Record<string, unknown>) => {
          Object.assign(syncStore, data);
          return Promise.resolve();
        }),
      },
      local: {
        get: vi.fn((keys: string | string[] | null) => {
          if (typeof keys === 'string') {
            return Promise.resolve({ [keys]: localStore[keys] });
          }
          if (Array.isArray(keys)) {
            const result: Record<string, unknown> = {};
            for (const key of keys) {
              result[key] = localStore[key];
            }
            return Promise.resolve(result);
          }
          return Promise.resolve({ ...localStore });
        }),
        set: vi.fn((data: Record<string, unknown>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((keys: string | string[]) => {
          if (typeof keys === 'string') {
            delete localStore[keys];
          } else if (Array.isArray(keys)) {
            for (const key of keys) {
              delete localStore[key];
            }
          }
          return Promise.resolve();
        }),
      },
    },
    // 暴露 store 以便测试直接操作
    syncStore,
    localStore,
  };
}

const makeWordEntry = (overrides: Partial<UnknownWordEntry> = {}): UnknownWordEntry => ({
  word: 'ephemeral',
  context: 'test context',
  translation: '短暂的',
  markedAt: Date.now(),
  reviewCount: 0,
  ...overrides,
});

const makeMasteryProfile = (overrides: Partial<MasteryProfile> = {}): MasteryProfile => ({
  userId: 'user-1',
  wordMastery: {},
  stats: {
    totalWords: 0,
    masteredWords: 0,
    learningWords: 0,
    strugglingWords: 0,
    dueForReview: 0,
    levelDistribution: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
  },
  estimatedOverallLevel: 'B1',
  lastUpdatedAt: Date.now(),
  ...overrides,
});

describe('MasteryManager', () => {
  let mockChrome: ReturnType<typeof createMockChromeStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));

    mockChrome = createMockChromeStorage();
    vi.stubGlobal('chrome', { storage: mockChrome.storage });

    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('markWord', () => {
    it('首次标记单词时创建新条目', async () => {
      const wordEntry = makeWordEntry();
      const result = await MasteryManager.markWord(wordEntry, true, 7);

      expect(result.newMasteryLevel).toBe(0.6);
      expect(result.newConfidence).toBe(0.2);
      expect(result.levelUpgraded).toBe(false);
      expect(result.nextReviewInterval).toBeGreaterThanOrEqual(1);
    });

    it('首次标记不认识时创建 unknownCount=1 的条目', async () => {
      const wordEntry = makeWordEntry();
      const result = await MasteryManager.markWord(wordEntry, false, 7);

      expect(result.newMasteryLevel).toBe(0.3);
      expect(result.newConfidence).toBe(0.2);
      expect(result.levelUpgraded).toBe(false);
    });

    it('重复标记同一单词时更新现有条目', async () => {
      const wordEntry = makeWordEntry();

      // 首次标记
      await MasteryManager.markWord(wordEntry, true, 5);

      // 再次标记
      const result = await MasteryManager.markWord(wordEntry, true, 5);

      expect(result.newMasteryLevel).toBeGreaterThan(0.6);
      expect(result.newConfidence).toBeGreaterThan(0.2);
    });

    it('答错时降低掌握度', async () => {
      const wordEntry = makeWordEntry();

      // 先标记为认识
      await MasteryManager.markWord(wordEntry, true, 5);

      // 再标记为不认识
      const result = await MasteryManager.markWord(wordEntry, false, 5);

      expect(result.newMasteryLevel).toBeLessThan(0.6);
    });

    it('高难度单词答对时给予更多奖励', async () => {
      // 先标记一次创建条目，再更新看难度差异
      const wordEntry1 = makeWordEntry({ word: 'easyword' });
      await MasteryManager.markWord(wordEntry1, true, 2);
      const easy = await MasteryManager.markWord(wordEntry1, true, 2);

      const wordEntry2 = makeWordEntry({ word: 'hardword' });
      await MasteryManager.markWord(wordEntry2, true, 9);
      const hard = await MasteryManager.markWord(wordEntry2, true, 9);

      expect(hard.newMasteryLevel).toBeGreaterThan(easy.newMasteryLevel);
    });

    it('返回的复习间隔为正整数', async () => {
      const wordEntry = makeWordEntry();
      const result = await MasteryManager.markWord(wordEntry, true, 5);

      expect(Number.isInteger(result.nextReviewInterval)).toBe(true);
      expect(result.nextReviewInterval).toBeGreaterThanOrEqual(1);
    });

    it('答错时缩短复习间隔', async () => {
      const wordEntry = makeWordEntry();

      const correct = await MasteryManager.markWord(wordEntry, true, 5);
      const wordEntry2 = makeWordEntry({ word: 'abstruse' });
      const wrong = await MasteryManager.markWord(wordEntry2, false, 5);

      // 首次标记，答错的基础间隔为1天
      expect(wrong.nextReviewInterval).toBeLessThanOrEqual(correct.nextReviewInterval);
    });

    it('单词转为小写存储', async () => {
      const wordEntry = makeWordEntry({ word: 'HELLO' });
      await MasteryManager.markWord(wordEntry, true, 5);

      // 用小写查询能找到（验证存储键是小写）
      const info = await MasteryManager.getWordMasteryInfo('hello');
      expect(info).not.toBeNull();
      // 存储的条目保持原始大小写
      expect(info!.word).toBe('HELLO');
    });
  });

  describe('batchMarkWords', () => {
    it('批量标记多个单词', async () => {
      const entries = [
        { wordEntry: makeWordEntry({ word: 'word1' }), isKnown: true, wordDifficulty: 5 },
        { wordEntry: makeWordEntry({ word: 'word2' }), isKnown: false, wordDifficulty: 3 },
        { wordEntry: makeWordEntry({ word: 'word3' }), isKnown: true, wordDifficulty: 8 },
      ];

      const results = await MasteryManager.batchMarkWords(entries);

      expect(results).toHaveLength(3);
      expect(results[0].newMasteryLevel).toBe(0.6);
      expect(results[1].newMasteryLevel).toBe(0.3);
      expect(results[2].newMasteryLevel).toBe(0.6);
    });

    it('批量更新已存在的条目', async () => {
      // 先创建条目
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);

      const entries = [
        { wordEntry: makeWordEntry({ word: 'word1' }), isKnown: true, wordDifficulty: 5 },
      ];

      const results = await MasteryManager.batchMarkWords(entries);

      expect(results[0].newMasteryLevel).toBeGreaterThan(0.6);
    });

    it('空数组返回空结果', async () => {
      const results = await MasteryManager.batchMarkWords([]);
      expect(results).toEqual([]);
    });
  });

  describe('getMasteryOverview', () => {
    it('无数据时返回 null', async () => {
      const overview = await MasteryManager.getMasteryOverview();
      expect(overview.profile).toBeNull();
      expect(overview.stats).toBeNull();
    });

    it('有数据时返回档案和统计', async () => {
      // 先标记一些单词创建数据
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);
      await MasteryManager.markWord(makeWordEntry({ word: 'word2' }), false, 3);
      await MasteryManager.markWord(makeWordEntry({ word: 'word3' }), true, 9);

      const overview = await MasteryManager.getMasteryOverview();

      expect(overview.profile).not.toBeNull();
      expect(overview.stats).not.toBeNull();
      expect(overview.stats!.totalWords).toBe(3);
    });
  });

  describe('getUserCEFRLevel', () => {
    it('无掌握度数据时基于词汇量返回等级', async () => {
      const result = await MasteryManager.getUserCEFRLevel();

      expect(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).toContain(result.level);
      expect(result.confidence).toBe(0.3);
      expect(result.vocabularyEstimate).toBeGreaterThan(0);
    });

    it('有数据时计算加权 CEFR 等级', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);

      const result = await MasteryManager.getUserCEFRLevel();

      expect(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).toContain(result.level);
      expect(result.confidence).toBeGreaterThan(0);
    });
  });

  describe('getReviewWords', () => {
    it('无数据时返回空数组', async () => {
      const words = await MasteryManager.getReviewWords();
      expect(words).toEqual([]);
    });

    it('返回逾期的单词', async () => {
      const wordEntry = makeWordEntry({ word: 'overdue' });
      await MasteryManager.markWord(wordEntry, false, 5);

      // 快进时间使单词逾期
      vi.advanceTimersByTime(10 * 24 * 60 * 60 * 1000);

      const words = await MasteryManager.getReviewWords();
      expect(words.length).toBeGreaterThanOrEqual(1);
      expect(words[0].word).toBe('overdue');
    });

    it('限制返回数量', async () => {
      for (let i = 0; i < 5; i++) {
        await MasteryManager.markWord(makeWordEntry({ word: `word${i}` }), false, 5);
      }

      vi.advanceTimersByTime(10 * 24 * 60 * 60 * 1000);

      const words = await MasteryManager.getReviewWords(2);
      expect(words.length).toBeLessThanOrEqual(2);
    });
  });

  describe('getMasteryTrend', () => {
    it('无数据时返回 null', async () => {
      const trend = await MasteryManager.getMasteryTrend();
      expect(trend).toBeNull();
    });

    it('返回指定天数的趋势数据', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);

      const trend = await MasteryManager.getMasteryTrend(7);

      expect(trend).not.toBeNull();
      expect(trend!.last30Days).toHaveLength(7);
    });
  });

  describe('getWordMasteryInfo', () => {
    it('返回单词掌握度信息和剩余天数', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'testword' }), true, 5);

      const info = await MasteryManager.getWordMasteryInfo('testword');

      expect(info).not.toBeNull();
      expect(info!.word).toBe('testword');
      expect(info!.daysUntilReview).toBeGreaterThanOrEqual(0);
    });

    it('不存在的单词返回 null', async () => {
      const info = await MasteryManager.getWordMasteryInfo('nonexistent');
      expect(info).toBeNull();
    });

    it('查询时单词转为小写', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'TestWord' }), true, 5);

      const info = await MasteryManager.getWordMasteryInfo('TESTWORD');
      expect(info).not.toBeNull();
    });
  });

  describe('getLearningStatistics', () => {
    it('无数据时返回 null', async () => {
      const stats = await MasteryManager.getLearningStatistics();
      expect(stats).toBeNull();
    });

    it('返回综合学习统计', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);

      const stats = await MasteryManager.getLearningStatistics(30);

      expect(stats).not.toBeNull();
      expect(stats!).toHaveProperty('totalStudyDays');
      expect(stats!).toHaveProperty('currentStreak');
      expect(stats!).toHaveProperty('longestStreak');
      expect(stats!).toHaveProperty('heatmapData');
    });
  });

  describe('syncUserVocabulary', () => {
    it('无掌握度数据时静默返回', async () => {
      await expect(MasteryManager.syncUserVocabulary()).resolves.not.toThrow();
    });

    it('有数据时更新整体 CEFR 等级', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);

      await MasteryManager.syncUserVocabulary();

      const overview = await MasteryManager.getMasteryOverview();
      expect(overview.profile).not.toBeNull();
    });
  });

  describe('exportData / importData', () => {
    it('导出掌握度数据', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);

      const data = await MasteryManager.exportData();

      expect(data.masteryProfile).not.toBeNull();
      expect(data.stats).not.toBeNull();
      expect(data.stats!.totalWords).toBeGreaterThanOrEqual(1);
    });

    it('导入掌握度数据', async () => {
      const profile = makeMasteryProfile({
        wordMastery: {
          imported: {
            word: 'imported',
            context: 'test',
            translation: '导入的',
            markedAt: Date.now(),
            reviewCount: 0,
            masteryLevel: 0.8,
            confidence: 0.5,
            knownCount: 2,
            unknownCount: 0,
            nextReviewAt: Date.now() + 86400000,
            estimatedLevel: 'B2',
          },
        },
      });

      await MasteryManager.importData(profile);

      const info = await MasteryManager.getWordMasteryInfo('imported');
      expect(info).not.toBeNull();
      expect(info!.masteryLevel).toBe(0.8);
    });

    it('导出空数据返回 null', async () => {
      const data = await MasteryManager.exportData();
      expect(data.masteryProfile).toBeNull();
      expect(data.stats).toBeNull();
    });
  });

  describe('resetData', () => {
    it('清空所有掌握度数据', async () => {
      await MasteryManager.markWord(makeWordEntry({ word: 'word1' }), true, 5);

      await MasteryManager.resetData();

      const overview = await MasteryManager.getMasteryOverview();
      expect(overview.profile).toBeNull();
      expect(overview.stats).toBeNull();
    });
  });
});
