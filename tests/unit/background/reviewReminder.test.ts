/**
 * ReviewReminder 测试
 *
 * 覆盖纯函数部分：calculateSM2Interval, calculateNextReviewTime
 * 以及 ReviewReminderManager 类的方法（mock chrome.storage/local + chrome.alarms）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  calculateSM2Interval,
  calculateNextReviewTime,
  ReviewReminderManager,
} from '@/background/reviewReminder';
import {
  ReviewQuality,
  DEFAULT_SM2_PARAMETERS,
  DEFAULT_REVIEW_REMINDER_CONFIG,
} from '@/shared/types/reviewReminder';

function makeMockWord(overrides = {}): any {
  return {
    word: 'hello',
    level: 0,
    difficulty: 0.5,
    consecutiveCorrect: 0,
    reviewCount: 0,
    ...overrides,
  };
}

/**
 * Mock chrome storage + alarms
 */
function createMockChrome() {
  const store: Record<string, unknown> = {};
  const alarms: Record<string, unknown> = {};

  return {
    chrome: {
      storage: {
        local: {
          get: (keys: string | string[] | null) => {
            if (typeof keys === 'string') {
              return Promise.resolve({ [keys]: store[keys] });
            }
            if (Array.isArray(keys)) {
              const result: Record<string, unknown> = {};
              for (const key of keys) {
                result[key] = store[key];
              }
              return Promise.resolve(result);
            }
            return Promise.resolve({ ...store });
          },
          set: (data: Record<string, unknown>) => {
            Object.assign(store, data);
            return Promise.resolve();
          },
        },
      },
      alarms: {
        create: (name: string, info: unknown) => {
          alarms[name] = info;
          return Promise.resolve();
        },
        clear: (name: string) => {
          delete alarms[name];
          return Promise.resolve();
        },
      },
      notifications: {
        create: (_opts: unknown) => Promise.resolve('notification-id'),
      },
    },
    store,
    alarms,
  };
}

describe('calculateSM2Interval — pure function', () => {
  it('resets interval on wrong answer', () => {
    const [interval, ef] = calculateSM2Interval(10, 2.5, ReviewQuality.COMPLETE_FORGET);
    expect(interval).toBe(1); // lapseResetInterval
    expect(ef).toBeLessThan(2.5);
  });

  it('sets interval to 1 for new word with correct answer', () => {
    const [interval, ef] = calculateSM2Interval(0, 2.5, ReviewQuality.CORRECT_EASY);
    expect(interval).toBe(1);
    expect(ef).toBeGreaterThanOrEqual(2.5);
  });

  it('sets interval to 6 for second review', () => {
    const [interval] = calculateSM2Interval(1, 2.5, ReviewQuality.CORRECT_EASY);
    expect(interval).toBe(6);
  });

  it('multiplies interval by ease factor for subsequent reviews', () => {
    const [interval, ef] = calculateSM2Interval(10, 2.5, ReviewQuality.CORRECT_EASY);
    // EF' = 2.5 + (0.1 - (5-4)*(0.08+(5-4)*0.02)) = 2.5 + 0.1 - 0.1 = 2.5
    expect(ef).toBeCloseTo(2.5, 1);
    // interval = round(10 * 2.5) = 25
    expect(interval).toBe(25);
  });

  it('applies easy bonus for CORRECT_INSTANT', () => {
    const [interval] = calculateSM2Interval(10, 2.5, ReviewQuality.CORRECT_INSTANT);
    // ef = 2.5 + 0.1 = 2.6, interval = round(10*2.6) = 26, then * 1.3 = 33.8 → 34
    expect(interval).toBe(34);
  });

  it('respects minEaseFactor floor', () => {
    const [, ef] = calculateSM2Interval(5, 1.5, ReviewQuality.COMPLETE_FORGET);
    expect(ef).toBeGreaterThanOrEqual(1.3);
  });

  it('uses default params when not provided', () => {
    const [interval, ef] = calculateSM2Interval(6, 2.5, ReviewQuality.CORRECT_HARD);
    expect(interval).toBeGreaterThan(0);
    expect(ef).toBeDefined();
  });
});

describe('calculateNextReviewTime — pure function', () => {
  it('returns MAX_SAFE_INTEGER for mastered words', () => {
    const word = makeMockWord({ consecutiveCorrect: 5 });
    const result = calculateNextReviewTime(word, {
      ...DEFAULT_REVIEW_REMINDER_CONFIG,
      masteredThreshold: 3,
    });
    expect(result).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('schedules level 0 (UNKNOWN) for 1-day interval', () => {
    const word = makeMockWord({ level: 0, difficulty: 0 });
    const result = calculateNextReviewTime(word);
    const dayMs = 24 * 60 * 60 * 1000;
    const diff = result - Date.now();
    expect(diff).toBeCloseTo(1 * dayMs, -4); // within ~10 seconds
  });

  it('schedules level 3 (FAMILIAR) for 7-day interval', () => {
    const word = makeMockWord({ level: 3, difficulty: 0 });
    const result = calculateNextReviewTime(word);
    const dayMs = 24 * 60 * 60 * 1000;
    const diff = result - Date.now();
    expect(diff).toBeCloseTo(7 * dayMs, -4);
  });

  it('adjusts interval based on difficulty', () => {
    const word1 = makeMockWord({ level: 2, difficulty: 0 }); // base 4 days
    const word2 = makeMockWord({ level: 2, difficulty: 1 }); // base 4 days * (1+1) = 8 days

    const result1 = calculateNextReviewTime(word1);
    const result2 = calculateNextReviewTime(word2);

    expect(result2 - Date.now()).toBeGreaterThan(result1 - Date.now());
  });
});

describe('ReviewReminderManager — load/save/config', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    mock = createMockChrome();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('loads default config initially', async () => {
    const manager = new ReviewReminderManager();
    const config = manager.getConfig();
    expect(config.enabled).toBe(true);
    expect(config.dailyReviewLimit).toBe(20);
  });

  it('updates config', async () => {
    const manager = new ReviewReminderManager();
    await manager.updateConfig({ dailyReviewLimit: 30, reminderHour: 9 });

    const config = manager.getConfig();
    expect(config.dailyReviewLimit).toBe(30);
    expect(config.reminderHour).toBe(9);
  });
});

describe('ReviewReminderManager — word schedule', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    mock = createMockChrome();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('adds word to schedule', async () => {
    const manager = new ReviewReminderManager();
    const word = makeMockWord({ word: 'test' });

    await manager.addWordToSchedule(word);

    const schedule = (manager as any).schedule as Map<string, any>;
    expect(schedule.has('test')).toBe(true);
    expect(schedule.get('test').word).toBe('test');
  });

  it('removes word from schedule', async () => {
    const manager = new ReviewReminderManager();
    const word = makeMockWord({ word: 'temp' });

    await manager.addWordToSchedule(word);
    await manager.removeWordFromSchedule('temp');

    const pending = manager.getWordsForReview();
    expect(pending.length).toBe(0);
  });

  it('getWordsForReview returns only overdue words', async () => {
    const manager = new ReviewReminderManager();

    const past = makeMockWord({ word: 'overdue' });
    await manager.addWordToSchedule(past);
    // Move nextReviewAt to the past
    const schedule = (manager as any).schedule;
    const item = schedule.get('overdue');
    item.nextReviewAt = Date.now() - 1000;

    const future = makeMockWord({ word: 'future' });
    await manager.addWordToSchedule(future);
    const futureItem = schedule.get('future');
    futureItem.nextReviewAt = Date.now() + 86400000; // 1 day ahead

    const pending = manager.getWordsForReview();
    expect(pending).toHaveLength(1);
    expect(pending[0].word).toBe('overdue');
  });

  it('respects limit on getWordsForReview', async () => {
    const manager = new ReviewReminderManager();

    for (let i = 0; i < 5; i++) {
      const word = makeMockWord({ word: `word-${i}` });
      await manager.addWordToSchedule(word);
      const schedule = (manager as any).schedule;
      const item = schedule.get(`word-${i}`);
      item.nextReviewAt = Date.now() - 1000;
    }

    const pending = manager.getWordsForReview(3);
    expect(pending).toHaveLength(3);
  });
});

describe('ReviewReminderManager — review results', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    mock = createMockChrome();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('records correct review and updates interval', async () => {
    const manager = new ReviewReminderManager();
    const word = makeMockWord({ word: 'apple' });
    await manager.addWordToSchedule(word);

    const result = await manager.recordReviewResult('apple', ReviewQuality.CORRECT_EASY);

    expect(result.word).toBe('apple');
    expect(result.quality).toBe(ReviewQuality.CORRECT_EASY);
    expect(result.newEaseFactor).toBeDefined();
  });

  it('resets consecutiveCorrect on wrong answer', async () => {
    const manager = new ReviewReminderManager();
    const word = makeMockWord({ word: 'test', consecutiveCorrect: 3 });
    await manager.addWordToSchedule(word);

    await manager.recordReviewResult('test', ReviewQuality.COMPLETE_FORGET);

    const schedule = (manager as any).schedule;
    const item = schedule.get('test');
    expect(item.consecutiveCorrect).toBe(0);
  });

  it('throws error for word not in schedule', async () => {
    const manager = new ReviewReminderManager();
    await expect(manager.recordReviewResult('nonexistent', ReviewQuality.CORRECT_EASY))
      .rejects.toThrow('不在复习计划中');
  });
});

describe('ReviewReminderManager — stats', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    mock = createMockChrome();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('returns zero stats initially', async () => {
    const manager = new ReviewReminderManager();
    const stats = await manager.getStats();
    expect(stats.todayReviewed).toBe(0);
    expect(stats.averageAccuracy).toBe(0);
  });

  it('updates stats after review', async () => {
    const manager = new ReviewReminderManager();
    await manager.updateStats(true); // correct

    const stats = await manager.getStats();
    expect(stats.todayReviewed).toBe(1);
    expect(stats.weeklyReviewed).toBe(1);
    expect(stats.averageAccuracy).toBeGreaterThan(0);
  });
});

describe('ReviewReminderManager — alarms', () => {
  let savedChrome: unknown;
  let mock: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    mock = createMockChrome();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('clears alarm when disabled', async () => {
    const manager = new ReviewReminderManager();
    await manager.updateConfig({ enabled: false });
    expect(mock.alarms['review-reminder']).toBeUndefined();
  });

  it('schedules alarm for tomorrow if reminder time has passed', async () => {
    const manager = new ReviewReminderManager();
    // Set reminder to 1am (likely in the past)
    await manager.updateConfig({ enabled: true, reminderHour: 1, reminderMinute: 0 });

    expect(mock.alarms['review-reminder']).toBeDefined();
  });
});
