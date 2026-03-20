import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import type { UserProfile, UserSettings, UnknownWordEntry, ApiConfig } from '@/shared/types';
import type { MasteryProfile, WordMasteryEntry } from '@/shared/types/mastery';

// Mock chrome.storage
const mockStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
  sync: {
    get: vi.fn(),
    set: vi.fn(),
  },
};

Object.defineProperty(global, 'chrome', {
  value: {
    storage: mockStorage,
  },
  writable: true,
});

describe('StorageManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认模拟返回空数据
    mockStorage.local.get.mockResolvedValue({});
    mockStorage.sync.get.mockResolvedValue({});
  });

  describe('getUserProfile', () => {
    it('应该返回用户配置数据', async () => {
      const mockProfile: UserProfile = {
        examType: 'cet4',
        estimatedVocabulary: 4500,
        knownWords: ['hello'],
        unknownWords: [],
        levelConfidence: 0.5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockStorage.sync.get.mockResolvedValue({ userProfile: mockProfile });

      const profile = await StorageManager.getUserProfile();
      expect(profile.examType).toBe('cet4');
    });
  });

  describe('saveUserProfile', () => {
    it('应该保存用户配置到 sync storage', async () => {
      const mockProfile: UserProfile = {
        examType: 'cet6',
        estimatedVocabulary: 6000,
        knownWords: [],
        unknownWords: [],
        levelConfidence: 0.6,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await StorageManager.saveUserProfile(mockProfile);

      expect(mockStorage.sync.set).toHaveBeenCalled();
    });
  });

  describe('getSettings', () => {
    it('应该返回默认设置', async () => {
      mockStorage.sync.get.mockResolvedValue({});

      const settings = await StorageManager.getSettings();
      expect(settings).toBeDefined();
      expect(settings.enabled).toBe(true);
    });
  });

  describe('saveSettings', () => {
    it('应该保存设置到 sync storage', async () => {
      const newSettings: Partial<UserSettings> = {
        enabled: false,
        translationMode: 'bilingual',
      };

      await StorageManager.saveSettings(newSettings);

      expect(mockStorage.sync.set).toHaveBeenCalled();
    });
  });

  describe('addKnownWord', () => {
    it('应该将单词添加到已知词汇列表', async () => {
      const mockKnownWords = ['hello', 'world'];
      mockStorage.local.get.mockResolvedValue({ knownWords: mockKnownWords });

      await StorageManager.addKnownWord('test');

      // 验证 set 被调用，包含了新单词
      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  describe('addUnknownWord', () => {
    it('应该将单词添加到未知词汇列表', async () => {
      const mockUnknownWords: UnknownWordEntry[] = [
        { word: 'hello', context: '', translation: '你好', markedAt: Date.now(), reviewCount: 0 },
      ];
      mockStorage.local.get.mockResolvedValue({ unknownWords: mockUnknownWords });

      const newWord: UnknownWordEntry = {
        word: 'test',
        context: '',
        translation: '测试',
        markedAt: Date.now(),
        reviewCount: 0,
      };

      await StorageManager.addUnknownWord(newWord);

      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  describe('getCachedTranslation', () => {
    it('应该返回缓存的翻译结果', async () => {
      const mockCache = {
        'test_key': {
          words: [],
          sentences: [],
        },
      };
      mockStorage.local.get.mockResolvedValue({ translationCache: mockCache });

      const cached = await StorageManager.getCachedTranslation('test_key');
      expect(cached).toBeDefined();
    });
  });

  describe('cacheTranslation', () => {
    it('应该缓存翻译结果', async () => {
      const mockCache = {};
      mockStorage.local.get.mockResolvedValue({ translationCache: mockCache });

      await StorageManager.cacheTranslation('test_key', {
        words: [],
        sentences: [],
      });

      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  describe('removeFromVocabulary', () => {
    it('应该从词汇表中移除指定单词', async () => {
      const mockUnknownWords: UnknownWordEntry[] = [
        { word: 'hello', context: '', translation: '你好', markedAt: Date.now(), reviewCount: 0 },
        { word: 'test', context: '', translation: '测试', markedAt: Date.now(), reviewCount: 0 },
      ];
      mockStorage.local.get.mockResolvedValue({ unknownWords: mockUnknownWords });

      await StorageManager.removeFromVocabulary('hello');

      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  // ========== API Key 测试 ==========
  describe('getApiKey', () => {
    it('应该从激活的 API 配置中获取 API Key', async () => {
      const mockSettings = {
        activeApiConfigId: 'config-1',
        apiConfigs: [
          { id: 'config-1', name: 'Test Config', provider: 'openai', apiKey: 'test-api-key' } as ApiConfig,
        ],
      };
      mockStorage.sync.get.mockResolvedValue({ settings: mockSettings });

      const apiKey = await StorageManager.getApiKey();

      expect(apiKey).toBe('test-api-key');
    });

    it('当没有激活配置时应该回退到旧版 apiKey 字段', async () => {
      mockStorage.sync.get.mockResolvedValueOnce({ settings: {} });
      mockStorage.sync.get.mockResolvedValueOnce({ apiKey: 'legacy-key' });

      const apiKey = await StorageManager.getApiKey();

      expect(apiKey).toBe('legacy-key');
    });

    it('当没有任何 API Key 时应该返回空字符串', async () => {
      mockStorage.sync.get.mockResolvedValue({});

      const apiKey = await StorageManager.getApiKey();

      expect(apiKey).toBe('');
    });
  });

  describe('saveApiKey', () => {
    it('应该保存 API Key 到 sync storage', async () => {
      await StorageManager.saveApiKey('new-api-key');

      expect(mockStorage.sync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'new-api-key',
        })
      );
    });
  });

  // ========== 翻译缓存测试 ==========
  describe('getTranslationCache', () => {
    it('应该返回翻译缓存', async () => {
      const mockCache = {
        'key1': { words: [{ word: 'hello', translation: '你好' }], sentences: [], cached: true },
      };
      mockStorage.local.get.mockResolvedValue({ translationCache: mockCache });

      const cache = await StorageManager.getTranslationCache();

      expect(cache).toEqual(mockCache);
    });

    it('当缓存为空时应该返回空对象', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const cache = await StorageManager.getTranslationCache();

      expect(cache).toEqual({});
    });
  });

  describe('clearTranslationCache', () => {
    it('应该清空翻译缓存', async () => {
      await StorageManager.clearTranslationCache();

      expect(mockStorage.local.set).toHaveBeenCalledWith({
        translationCache: {},
      });
    });
  });

  // ========== 数据导入导出测试 ==========
  describe('exportData', () => {
    it('应该导出用户配置和设置', async () => {
      const mockProfile: UserProfile = {
        examType: 'cet4',
        estimatedVocabulary: 4000,
        knownWords: ['hello'],
        unknownWords: [],
        levelConfidence: 0.5,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const mockSettings: UserSettings = {
        enabled: true,
        theme: 'light',
        translationMode: 'inline',
        apiProvider: 'openai',
      } as UserSettings;

      mockStorage.sync.get.mockImplementation(async (key: string) => {
        if (key === 'userProfile') return { userProfile: mockProfile };
        if (key === 'settings') return { settings: mockSettings };
        return {};
      });
      mockStorage.local.get.mockResolvedValue({});

      const data = await StorageManager.exportData();

      expect(data.profile).toBeDefined();
      expect(data.settings).toBeDefined();
    });
  });

  describe('importData', () => {
    it('应该导入用户配置数据', async () => {
      mockStorage.sync.get.mockResolvedValue({});
      mockStorage.local.get.mockResolvedValue({});

      await StorageManager.importData({
        profile: {
          examType: 'ielts',
          estimatedVocabulary: 7000,
        },
      });

      expect(mockStorage.sync.set).toHaveBeenCalled();
    });

    it('应该导入设置数据', async () => {
      mockStorage.sync.get.mockResolvedValue({ settings: { enabled: true } });

      await StorageManager.importData({
        settings: {
          theme: 'dark',
        },
      });

      expect(mockStorage.sync.set).toHaveBeenCalled();
    });
  });

  // ========== 掌握度系统测试 ==========
  describe('getMasteryProfile', () => {
    it('应该返回掌握度档案', async () => {
      const mockMastery: MasteryProfile = {
        userId: 'default',
        wordMastery: {
          'hello': {
            word: 'hello',
            masteryLevel: 0.8,
            estimatedLevel: 'B1',
            nextReviewAt: Date.now() + 86400000,
            reviewCount: 5,
            correctCount: 4,
            lastReviewAt: Date.now(),
            addedAt: Date.now() - 86400000 * 7,
          },
        },
        stats: {
          totalWords: 1,
          masteredWords: 1,
          learningWords: 0,
          strugglingWords: 0,
          dueForReview: 0,
          levelDistribution: { A1: 0, A2: 0, B1: 1, B2: 0, C1: 0, C2: 0 },
        },
        estimatedOverallLevel: 'B1',
        lastUpdatedAt: Date.now(),
      };

      mockStorage.local.get.mockResolvedValue({ masteryProfile: mockMastery });

      const profile = await StorageManager.getMasteryProfile();

      expect(profile).not.toBeNull();
      expect(profile?.userId).toBe('default');
      expect(profile?.wordMastery['hello']).toBeDefined();
    });

    it('当没有掌握度档案时应该返回 null', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const profile = await StorageManager.getMasteryProfile();

      expect(profile).toBeNull();
    });
  });

  describe('saveMasteryProfile', () => {
    it('应该保存掌握度档案', async () => {
      const mockMastery: MasteryProfile = {
        userId: 'test-user',
        wordMastery: {},
        stats: {
          totalWords: 0,
          masteredWords: 0,
          learningWords: 0,
          strugglingWords: 0,
          dueForReview: 0,
          levelDistribution: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
        },
        estimatedOverallLevel: 'A1',
        lastUpdatedAt: Date.now(),
      };

      await StorageManager.saveMasteryProfile(mockMastery);

      expect(mockStorage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          masteryProfile: expect.objectContaining({
            userId: 'test-user',
          }),
        })
      );
    });
  });

  describe('getWordMastery', () => {
    it('应该返回单个单词的掌握度', async () => {
      const mockEntry: WordMasteryEntry = {
        word: 'hello',
        masteryLevel: 0.7,
        estimatedLevel: 'B1',
        nextReviewAt: Date.now() + 86400000,
        reviewCount: 3,
        correctCount: 2,
        lastReviewAt: Date.now(),
        addedAt: Date.now() - 86400000,
      };

      const mockMastery: MasteryProfile = {
        userId: 'default',
        wordMastery: { 'hello': mockEntry },
        stats: {
          totalWords: 1,
          masteredWords: 0,
          learningWords: 1,
          strugglingWords: 0,
          dueForReview: 0,
          levelDistribution: { A1: 0, A2: 0, B1: 1, B2: 0, C1: 0, C2: 0 },
        },
        estimatedOverallLevel: 'B1',
        lastUpdatedAt: Date.now(),
      };

      mockStorage.local.get.mockResolvedValue({ masteryProfile: mockMastery });

      const entry = await StorageManager.getWordMastery('hello');

      expect(entry).not.toBeNull();
      expect(entry?.masteryLevel).toBe(0.7);
    });

    it('单词不存在时应该返回 null', async () => {
      mockStorage.local.get.mockResolvedValue({ masteryProfile: { wordMastery: {} } });

      const entry = await StorageManager.getWordMastery('nonexistent');

      expect(entry).toBeNull();
    });
  });

  describe('updateWordMastery', () => {
    it('应该更新单词掌握度', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const entry: WordMasteryEntry = {
        word: 'test',
        masteryLevel: 0.5,
        estimatedLevel: 'A2',
        nextReviewAt: Date.now() + 86400000,
        reviewCount: 1,
        correctCount: 1,
        lastReviewAt: Date.now(),
        addedAt: Date.now(),
      };

      await StorageManager.updateWordMastery(entry);

      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  describe('batchUpdateWordMastery', () => {
    it('应该批量更新单词掌握度', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const entries: WordMasteryEntry[] = [
        {
          word: 'hello',
          masteryLevel: 0.8,
          estimatedLevel: 'B1',
          nextReviewAt: Date.now() + 86400000,
          reviewCount: 5,
          correctCount: 4,
          lastReviewAt: Date.now(),
          addedAt: Date.now(),
        },
        {
          word: 'world',
          masteryLevel: 0.6,
          estimatedLevel: 'A2',
          nextReviewAt: Date.now() + 86400000,
          reviewCount: 3,
          correctCount: 2,
          lastReviewAt: Date.now(),
          addedAt: Date.now(),
        },
      ];

      await StorageManager.batchUpdateWordMastery(entries);

      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  describe('deleteWordMastery', () => {
    it('应该删除单词掌握度记录', async () => {
      const mockMastery: MasteryProfile = {
        userId: 'default',
        wordMastery: {
          'hello': {
            word: 'hello',
            masteryLevel: 0.8,
            estimatedLevel: 'B1',
            nextReviewAt: Date.now(),
            reviewCount: 5,
            correctCount: 4,
            lastReviewAt: Date.now(),
            addedAt: Date.now(),
          },
        },
        stats: {
          totalWords: 1,
          masteredWords: 1,
          learningWords: 0,
          strugglingWords: 0,
          dueForReview: 0,
          levelDistribution: { A1: 0, A2: 0, B1: 1, B2: 0, C1: 0, C2: 0 },
        },
        estimatedOverallLevel: 'B1',
        lastUpdatedAt: Date.now(),
      };

      mockStorage.local.get.mockResolvedValue({ masteryProfile: mockMastery });

      await StorageManager.deleteWordMastery('hello');

      expect(mockStorage.local.set).toHaveBeenCalled();
    });

    it('档案不存在时应该直接返回', async () => {
      mockStorage.local.get.mockResolvedValue({});

      await StorageManager.deleteWordMastery('hello');

      // 不应该抛错，应该正常完成
      expect(mockStorage.local.set).not.toHaveBeenCalled();
    });
  });

  describe('updateOverallCEFRLevel', () => {
    it('应该更新整体 CEFR 等级', async () => {
      const mockMastery: MasteryProfile = {
        userId: 'default',
        wordMastery: {},
        stats: {
          totalWords: 0,
          masteredWords: 0,
          learningWords: 0,
          strugglingWords: 0,
          dueForReview: 0,
          levelDistribution: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
        },
        estimatedOverallLevel: 'A1',
        lastUpdatedAt: Date.now(),
      };

      mockStorage.local.get.mockResolvedValue({ masteryProfile: mockMastery });

      await StorageManager.updateOverallCEFRLevel('B2');

      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  describe('getDueForReview', () => {
    it('应该返回需要复习的单词列表', async () => {
      const now = Date.now();
      const mockMastery: MasteryProfile = {
        userId: 'default',
        wordMastery: {
          'overdue1': {
            word: 'overdue1',
            masteryLevel: 0.5,
            estimatedLevel: 'A2',
            nextReviewAt: now - 86400000, // 1 天前
            reviewCount: 3,
            correctCount: 2,
            lastReviewAt: now - 172800000,
            addedAt: now - 604800000,
          },
          'overdue2': {
            word: 'overdue2',
            masteryLevel: 0.3,
            estimatedLevel: 'A1',
            nextReviewAt: now - 172800000, // 2 天前
            reviewCount: 2,
            correctCount: 1,
            lastReviewAt: now - 259200000,
            addedAt: now - 1209600000,
          },
          'future': {
            word: 'future',
            masteryLevel: 0.9,
            estimatedLevel: 'C1',
            nextReviewAt: now + 86400000, // 1 天后
            reviewCount: 10,
            correctCount: 9,
            lastReviewAt: now,
            addedAt: now - 2592000000,
          },
        },
        stats: {
          totalWords: 3,
          masteredWords: 1,
          learningWords: 1,
          strugglingWords: 1,
          dueForReview: 2,
          levelDistribution: { A1: 1, A2: 1, B1: 0, B2: 0, C1: 1, C2: 0 },
        },
        estimatedOverallLevel: 'A2',
        lastUpdatedAt: now,
      };

      mockStorage.local.get.mockResolvedValue({ masteryProfile: mockMastery });

      const dueWords = await StorageManager.getDueForReview(10);

      expect(dueWords.length).toBe(2);
      expect(dueWords.map(w => w.word)).toContain('overdue1');
      expect(dueWords.map(w => w.word)).toContain('overdue2');
      expect(dueWords.map(w => w.word)).not.toContain('future');
    });

    it('档案不存在时应该返回空数组', async () => {
      mockStorage.local.get.mockResolvedValue({});

      const dueWords = await StorageManager.getDueForReview();

      expect(dueWords).toEqual([]);
    });
  });

  describe('exportMasteryData', () => {
    it('应该导出掌握度数据', async () => {
      const mockMastery: MasteryProfile = {
        userId: 'default',
        wordMastery: {},
        stats: {
          totalWords: 0,
          masteredWords: 0,
          learningWords: 0,
          strugglingWords: 0,
          dueForReview: 0,
          levelDistribution: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
        },
        estimatedOverallLevel: 'A1',
        lastUpdatedAt: Date.now(),
      };

      mockStorage.local.get.mockResolvedValue({ masteryProfile: mockMastery });

      const data = await StorageManager.exportMasteryData();

      expect(data).not.toBeNull();
      expect(data?.userId).toBe('default');
    });
  });

  describe('importMasteryData', () => {
    it('应该导入掌握度数据', async () => {
      mockStorage.local.get.mockResolvedValue({});

      await StorageManager.importMasteryData({
        estimatedOverallLevel: 'B1',
      });

      expect(mockStorage.local.set).toHaveBeenCalled();
    });
  });

  describe('clearMasteryData', () => {
    it('应该清除所有掌握度数据', async () => {
      await StorageManager.clearMasteryData();

      expect(mockStorage.local.remove).toHaveBeenCalledWith('masteryProfile');
    });
  });

  // ========== 用户研究数据导出测试 ==========
  describe('getNewUsers', () => {
    it('应该返回近期新用户数据', async () => {
      const recentTime = Date.now() - 86400000; // 1 天前
      const mockProfile: UserProfile = {
        examType: 'cet4',
        estimatedVocabulary: 4000,
        knownWords: ['hello', 'world'],
        unknownWords: [{ word: 'test', context: '', translation: '测试', markedAt: Date.now(), reviewCount: 0 }],
        levelConfidence: 0.5,
        createdAt: recentTime,
        updatedAt: Date.now(),
      };

      mockStorage.sync.get.mockResolvedValue({ userProfile: mockProfile });
      mockStorage.local.get.mockResolvedValue({
        knownWords: mockProfile.knownWords,
        unknownWords: mockProfile.unknownWords,
      });

      const result = await StorageManager.getNewUsers(7);

      expect(result.totalUsers).toBe(1);
      expect(result.recentUsers.length).toBe(1);
      expect(result.recentUsers[0].examType).toBe('cet4');
    });

    it('用户创建时间超过指定天数时不应该包含在结果中', async () => {
      const oldTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 天前
      const mockProfile: UserProfile = {
        examType: 'cet4',
        estimatedVocabulary: 4000,
        knownWords: [],
        unknownWords: [],
        levelConfidence: 0.5,
        createdAt: oldTime,
        updatedAt: Date.now(),
      };

      mockStorage.sync.get.mockResolvedValue({ userProfile: mockProfile });
      mockStorage.local.get.mockResolvedValue({
        knownWords: [],
        unknownWords: [],
      });

      const result = await StorageManager.getNewUsers(7);

      expect(result.recentUsers.length).toBe(0);
    });
  });

  describe('exportUserDataForResearch', () => {
    it('应该导出 CSV 和 JSON 格式的用户数据', async () => {
      const mockProfile: UserProfile = {
        examType: 'ielts',
        estimatedVocabulary: 6000,
        knownWords: ['hello', 'world', 'test'],
        unknownWords: [{ word: 'vocabulary', context: '', translation: '词汇', markedAt: Date.now(), reviewCount: 0 }],
        levelConfidence: 0.7,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      mockStorage.sync.get.mockImplementation(async (key: string) => {
        if (key === 'userProfile') return { userProfile: mockProfile };
        if (key === 'settings') return { settings: { theme: 'dark' } };
        return {};
      });
      mockStorage.local.get.mockResolvedValue({
        knownWords: mockProfile.knownWords,
        unknownWords: mockProfile.unknownWords,
      });

      const result = await StorageManager.exportUserDataForResearch();

      expect(result.csv).toContain('ielts');
      expect(result.json).toContain('ielts');
      expect(result.stats.totalUsers).toBe(1);
      expect(result.stats.avgVocabulary).toBe(6000);
    });
  });
});
