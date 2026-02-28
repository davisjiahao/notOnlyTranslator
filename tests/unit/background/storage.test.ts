import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import type { UserProfile, UserSettings, UnknownWordEntry } from '@/shared/types';

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
});
