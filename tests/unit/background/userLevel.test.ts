/**
 * UserLevelManager 测试
 *
 * 覆盖 estimateWordDifficulty 启发式逻辑、shouldReassess 条件、
 * getStats 等级映射。需要 mock StorageManager, MasteryManager, frequencyManager。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserLevelManager } from '@/background/userLevel';

/**
 * Mock chrome.storage.local
 */
function createMockChromeStorage() {
  const store: Record<string, unknown> = {};
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
    },
  };
}

function makeUserProfile(overrides = {}): any {
  return {
    estimatedVocabulary: 4000,
    levelConfidence: 0.6,
    knownWords: ['the', 'and', 'hello'],
    unknownWords: [{ word: 'obfuscate' }],
    examType: 'cet4',
    examScore: undefined,
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000, // 60 days ago
    updatedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

// We need to mock the dependencies BEFORE importing userLevel
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getUserProfile: vi.fn(),
    saveUserProfile: vi.fn(),
  },
}));

vi.mock('@/background/mastery', () => ({
  MasteryManager: {
    getWordMasteryInfo: vi.fn(),
    syncUserVocabulary: vi.fn(),
  },
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    updateVocabularyEstimate: vi.fn((_est, _diff, isKnown, conf) => ({
      newEstimate: isKnown ? 4500 : 3500,
      newConfidence: Math.min(1, conf + 0.1),
    })),
    calculateVocabularySize: vi.fn((_type, _score) => 4000),
  };
});

vi.mock('@/background/frequencyManager', () => ({
  frequencyManager: {
    getDifficulty: vi.fn((_word: string) => 5),
  },
}));

import { StorageManager } from '@/background/storage';
import { MasteryManager } from '@/background/mastery';
import { frequencyManager } from '@/background/frequencyManager';

describe('UserLevelManager — estimateWordDifficulty', () => {
  let savedChrome: unknown;

  beforeEach(() => {
    const mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('returns low difficulty for known words', async () => {
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue(null);

    const profile = makeUserProfile();
    const difficulty = await UserLevelManager.estimateWordDifficulty('the', profile);

    expect(difficulty).toBe(1);
  });

  it('returns high difficulty for unknown words', async () => {
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue(null);

    const profile = makeUserProfile();
    const difficulty = await UserLevelManager.estimateWordDifficulty('obfuscate', profile);

    expect(difficulty).toBe(10);
  });

  it('adjusts difficulty based on mastery level', async () => {
    // masteryLevel 0.8 → adjustment = (0.5 - 0.8) * 10 = -3 → 5 + (-3) = 2
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue({
      masteryLevel: 0.8,
    });

    const profile = makeUserProfile();
    const difficulty = await UserLevelManager.estimateWordDifficulty('word', profile);

    expect(difficulty).toBe(2);
  });

  it('uses frequency manager for unknown new words', async () => {
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue(null);
    vi.mocked(frequencyManager.getDifficulty).mockReturnValue(7);

    const profile = makeUserProfile({ knownWords: [], unknownWords: [] });
    const difficulty = await UserLevelManager.estimateWordDifficulty('testword', profile);

    expect(difficulty).toBe(7);
  });

  it('reduces difficulty for short words', async () => {
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue(null);
    vi.mocked(frequencyManager.getDifficulty).mockReturnValue(5);

    const profile = makeUserProfile({ knownWords: [], unknownWords: [] });
    // "cat" is 3 chars, frequencyDifficulty=5 > 3 → adjustment -= 2 → 3
    const difficulty = await UserLevelManager.estimateWordDifficulty('cat', profile);

    expect(difficulty).toBe(3);
  });

  it('reduces difficulty for long words with simple suffixes', async () => {
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue(null);
    vi.mocked(frequencyManager.getDifficulty).mockReturnValue(6);

    const profile = makeUserProfile({ knownWords: [], unknownWords: [] });
    // "running" is 7 chars — not > 10, so no suffix adjustment
    // Let's use a word > 10 chars
    const difficulty = await UserLevelManager.estimateWordDifficulty('understanding', profile);

    // 13 chars, ends with 'ing' → adjustment -= 1 → 5
    expect(difficulty).toBe(5);
  });

  it('increases difficulty for complex long words', async () => {
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue(null);
    vi.mocked(frequencyManager.getDifficulty).mockReturnValue(6);

    const profile = makeUserProfile({ knownWords: [], unknownWords: [] });
    // "extraordinary" is 13 chars, no simple suffix → +1 → 7
    const difficulty = await UserLevelManager.estimateWordDifficulty('extraordinary', profile);

    expect(difficulty).toBe(7);
  });

  it('clamps difficulty to 1-10 range', async () => {
    vi.mocked(MasteryManager.getWordMasteryInfo).mockResolvedValue(null);
    vi.mocked(frequencyManager.getDifficulty).mockReturnValue(1);

    const profile = makeUserProfile({ knownWords: [], unknownWords: [] });
    // "a" is 1 char, freq=1, freqDifficulty <= 3 so no short-word adjustment → 1
    const difficulty = await UserLevelManager.estimateWordDifficulty('a', profile);

    expect(difficulty).toBeGreaterThanOrEqual(1);
    expect(difficulty).toBeLessThanOrEqual(10);
  });
});

describe('UserLevelManager — shouldReassess', () => {
  let savedChrome: unknown;

  beforeEach(() => {
    const mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('returns true when confidence is low', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({ levelConfidence: 0.2 })
    );

    const result = await UserLevelManager.shouldReassess();
    expect(result).toBe(true);
  });

  it('returns true when many marks and long time since assessment', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({
        knownWords: Array(60).fill('word'),
        unknownWords: Array(50).fill('unk'),
        levelConfidence: 0.5,
        updatedAt: Date.now() - 40 * 24 * 60 * 60 * 1000, // 40 days ago
      })
    );

    const result = await UserLevelManager.shouldReassess();
    expect(result).toBe(true);
  });

  it('returns false when confidence is ok and recent', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({
        knownWords: Array(5).fill('word'),
        unknownWords: [],
        levelConfidence: 0.6,
        updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
      })
    );

    const result = await UserLevelManager.shouldReassess();
    expect(result).toBe(false);
  });
});

describe('UserLevelManager — getStats', () => {
  let savedChrome: unknown;

  beforeEach(() => {
    const mock = createMockChromeStorage();
    savedChrome = (globalThis as unknown as Record<string, unknown>).chrome;
    (globalThis as unknown as Record<string, unknown>).chrome = mock.chrome;
    vi.clearAllMocks();
  });

  afterEach(() => {
    (globalThis as unknown as Record<string, unknown>).chrome = savedChrome;
  });

  it('returns correct level for 初级 (< 3000)', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({ estimatedVocabulary: 2000 })
    );

    const stats = await UserLevelManager.getStats();
    expect(stats.level).toBe('初级');
  });

  it('returns correct level for 中级 (3000-4999)', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({ estimatedVocabulary: 4000 })
    );

    const stats = await UserLevelManager.getStats();
    expect(stats.level).toBe('中级');
  });

  it('returns correct level for 中高级 (5000-7999)', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({ estimatedVocabulary: 6000 })
    );

    const stats = await UserLevelManager.getStats();
    expect(stats.level).toBe('中高级');
  });

  it('returns correct level for 高级 (8000-11999)', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({ estimatedVocabulary: 10000 })
    );

    const stats = await UserLevelManager.getStats();
    expect(stats.level).toBe('高级');
  });

  it('returns correct level for 专家级 (>= 12000)', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({ estimatedVocabulary: 15000 })
    );

    const stats = await UserLevelManager.getStats();
    expect(stats.level).toBe('专家级');
  });

  it('returns correct word counts', async () => {
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(
      makeUserProfile({
        knownWords: ['a', 'b', 'c'],
        unknownWords: [{ word: 'x' }, { word: 'y' }],
        levelConfidence: 0.7,
        estimatedVocabulary: 5000,
      })
    );

    const stats = await UserLevelManager.getStats();
    expect(stats.knownWordsCount).toBe(3);
    expect(stats.unknownWordsCount).toBe(2);
    expect(stats.confidence).toBe(0.7);
    expect(stats.estimatedVocabulary).toBe(5000);
  });
});
