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

      expect(mockStorage.sync.set).toHaveBeenCalledWith({ settings: newSettings });
    });

    it('直接全量保存不自动合并旧值', async () => {
      mockStorage.sync.get.mockResolvedValue({ settings: { enabled: false } });
      await StorageManager.saveSettings({ translationMode: 'bilingual' });
      expect(mockStorage.sync.set).toHaveBeenCalledExactlyOnceWith({ settings: { translationMode: 'bilingual' } });
    });

    it('导入设置增量与消息增量共用读合并写串行队列', async () => {
      let persisted: Record<string, unknown> = {};
      let release: () => void = () => undefined;
      let started: () => void = () => undefined;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      const writing = new Promise<void>(resolve => { started = resolve; });
      mockStorage.sync.get.mockImplementation(async () => ({ settings: persisted.settings }));
      mockStorage.sync.set.mockImplementationOnce(async updates => {
        started();
        await blocked;
        persisted = { ...persisted, ...updates };
      }).mockImplementationOnce(async updates => { persisted = { ...persisted, ...updates }; });

      const first = StorageManager.updateSettings({ enabled: false });
      await writing;
      const imported = StorageManager.importData({ settings: { translationMode: 'bilingual' } });
      try {
        release();
        await Promise.all([first, imported]);
        expect(persisted.settings).toEqual(expect.objectContaining({ enabled: false, translationMode: 'bilingual' }));
      } finally {
        release();
      }
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

  describe('生词导入和并发写入', () => {
    const existing: UnknownWordEntry = {
      word: 'apple', translation: '原有释义', context: '原语境',
      markedAt: 1000, reviewCount: 7, lastReviewAt: 2000,
    };
    const imported: UnknownWordEntry = {
      word: 'book', translation: '书', context: '', markedAt: 3000, reviewCount: 0,
    };

    it('以导入方式加入已有单词时保留原记录并报告跳过', async () => {
      mockStorage.local.get.mockResolvedValue({ knownWords: [], unknownWords: [existing] });

      const inserted = await StorageManager.addUnknownWord(
        { ...existing, word: ' APPLE ', translation: '不应覆盖' },
        { skipIfExists: true }
      );

      expect(inserted).toBe(false);
      expect(mockStorage.local.set).not.toHaveBeenCalled();
      expect(mockStorage.sync.set).not.toHaveBeenCalled();
    });

    it('批量导入以存储中的最新快照去重，只保存一次并保留文件首条', async () => {
      mockStorage.local.get.mockResolvedValue({ knownWords: [], unknownWords: [existing] });
      const result = await StorageManager.importUnknownWords([
        { ...existing, word: ' APPLE ', translation: '覆盖' },
        imported,
        { ...imported, word: 'BOOK', translation: '重复释义' },
      ]);

      expect(result).toEqual({ imported: 1, skipped: 2 });
      expect(mockStorage.local.set).toHaveBeenCalledTimes(1);
      expect(mockStorage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        unknownWords: [existing, imported],
      }));
    });

    it('导入已知词时跳过，保持已知与生词状态互斥', async () => {
      mockStorage.local.get.mockResolvedValue({ knownWords: ['apple'], unknownWords: [] });
      const result = await StorageManager.importUnknownWords([
        { ...existing, word: ' APPLE ' }, imported,
      ]);
      expect(result).toEqual({ imported: 1, skipped: 1 });
      expect(mockStorage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        knownWords: ['apple'], unknownWords: [imported],
      }));
    });

    it('完整备份在后台队列内合并词表且保留较新的学习记录', async () => {
      mockStorage.local.get.mockResolvedValue({ knownWords: ['hello'], unknownWords: [existing] });
      const backup: UserProfile = {
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: ['book'],
        unknownWords: [{ ...existing, translation: '旧释义', markedAt: 500 }],
      };
      const result = await StorageManager.importUserProfile(backup, true);

      expect(result).toEqual({ wordsMerged: 1 });
      expect(mockStorage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        knownWords: ['hello', 'book'],
        unknownWords: [existing],
      }));
    });

    it.each([true, false])('完整备份允许恢复应用产生的空释义，合并模式 %s', async (merge) => {
      const emptyTranslation = { ...existing, translation: '' };
      const backup: UserProfile = {
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [emptyTranslation],
      };
      const result = await StorageManager.importUserProfile(backup, merge);
      expect(result.wordsMerged).toBe(0);
      expect(mockStorage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        unknownWords: [emptyTranslation],
      }));
    });

    it.each([
      { markedAt: Number.NaN },
      { translation: 42 },
      { reviewCount: -1 },
    ])('完整备份拒绝损坏的学习记录 %j', async (invalid) => {
      const backup = {
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [],
        unknownWords: [{ ...existing, ...invalid }],
      } as UserProfile;
      await expect(StorageManager.importUserProfile(backup, true)).rejects.toThrow('数据格式无效');
      expect(mockStorage.local.set).not.toHaveBeenCalled();
    });

    it.each([
      { estimatedVocabulary: 'not-a-number' },
      { levelConfidence: 'bad' },
      { createdAt: Number.NaN },
      { examType: 'invalid' },
    ])('完整备份拒绝无效等级档案 %j', async (invalid) => {
      const backup = {
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [], ...invalid,
      } as UserProfile;
      await expect(StorageManager.importUserProfile(backup, true)).rejects.toThrow('数据格式无效');
      expect(mockStorage.local.set).not.toHaveBeenCalled();
    });

    it.each([
      { examType: ['cet4'] }, { estimatedVocabulary: -1 }, { estimatedVocabulary: 1000001 },
      { levelConfidence: -0.1 }, { levelConfidence: 1.1 },
      { examScore: 'invalid' }, { examScore: Infinity }, { examScore: -1 },
      { updatedAt: Infinity }, { knownWords: [' '] }, { knownWords: [3] },
      { knownWords: ['x'.repeat(201)] }, { unknownWords: null },
    ])('后台直接导入损坏档案 %j 时拒绝且不写入部分记录', async patch => {
      const backup = {
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [], ...patch,
      } as unknown as UserProfile;
      await expect(StorageManager.importUserProfile(backup, true)).rejects.toThrow('数据格式无效');
      expect(mockStorage.local.set).not.toHaveBeenCalled();
      expect(mockStorage.sync.set).not.toHaveBeenCalled();
    });

    it.each([
      { examType: 'invalid' }, { examScore: -1 }, { examScore: 1001 }, { examScore: NaN },
      { estimatedVocabulary: '5000' }, { estimatedVocabulary: -1 }, { estimatedVocabulary: 1000001 },
      { levelConfidence: 'high' }, { levelConfidence: -0.1 }, { levelConfidence: 1.1 },
    ])('后台拒绝非法等级补丁 %j，不覆盖已保存词表', async patch => {
      await expect(StorageManager.updateLevelProfile(patch)).rejects.toThrow('数据格式无效');
      expect(mockStorage.local.set).not.toHaveBeenCalled();
      expect(mockStorage.sync.set).not.toHaveBeenCalled();
    });

    it('合并完整备份时保留当前已知状态，跳过旧备份中的同名生词', async () => {
      mockStorage.local.get.mockResolvedValue({ knownWords: ['apple'], unknownWords: [] });
      const backup: UserProfile = {
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [existing],
      };
      await StorageManager.importUserProfile(backup, true);
      expect(mockStorage.local.set).toHaveBeenCalledWith(expect.objectContaining({
        knownWords: ['apple'], unknownWords: [],
      }));
    });

    it('超出本地安全预算的完整备份在写入前拒绝', async () => {
      const backup: UserProfile = {
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [],
        unknownWords: Array.from({ length: 600 }, (_, index) => ({
          word: `word${index}`, translation: '中'.repeat(10000),
          context: 'x'.repeat(10000), markedAt: 1, reviewCount: 0,
        })),
      };
      await expect(StorageManager.importUserProfile(backup, false)).rejects.toThrow('存储空间');
      expect(mockStorage.sync.set).not.toHaveBeenCalled();
      expect(mockStorage.local.set).not.toHaveBeenCalled();
    });

    it('完整备份本地写入失败时恢复原同步档案', async () => {
      mockStorage.sync.get.mockResolvedValue({ userProfile: { estimatedVocabulary: 4000 } });
      mockStorage.local.get.mockResolvedValue({ knownWords: [], unknownWords: [] });
      mockStorage.local.set.mockRejectedValueOnce(new Error('配额不足')).mockResolvedValue(undefined);
      const backup: UserProfile = {
        examType: 'cet4', estimatedVocabulary: 9000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: ['book'], unknownWords: [],
      };
      await expect(StorageManager.importUserProfile(backup, false)).rejects.toThrow();
      const lastSync = mockStorage.sync.set.mock.calls.at(-1)?.[0].userProfile;
      expect(lastSync.estimatedVocabulary).toBe(4000);
      expect(mockStorage.local.set).toHaveBeenCalledTimes(2);
    });

    it('批量导入拒绝无效记录，不写入任何部分数据', async () => {
      await expect(StorageManager.importUnknownWords([
        imported, { ...imported, markedAt: Number.NaN },
      ])).rejects.toThrow('数据格式无效');
      expect(mockStorage.local.set).not.toHaveBeenCalled();
    });

    it('普通等级更新拒绝携带旧词表快照，保护已导入词汇', async () => {
      await expect(StorageManager.updateLevelProfile({
        estimatedVocabulary: 5000, unknownWords: [],
      })).rejects.toThrow('数据格式无效');
      expect(mockStorage.local.set).not.toHaveBeenCalled();
    });

    it('等级档案更新与导入并发时不覆盖刚写入的生词', async () => {
      let stored = { knownWords: [] as string[], unknownWords: [] as UnknownWordEntry[] };
      mockStorage.local.get.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { knownWords: [...stored.knownWords], unknownWords: [...stored.unknownWords] };
      });
      mockStorage.local.set.mockImplementation(async (changes: Partial<typeof stored>) => {
        stored = { ...stored, ...changes };
      });
      mockStorage.sync.set.mockResolvedValue(undefined);

      await Promise.all([
        StorageManager.importUnknownWords([imported]),
        StorageManager.updateUserProfile({ estimatedVocabulary: 4500 }),
      ]);

      expect(stored.unknownWords).toEqual([imported]);
    });

    it('导入生词与标记已知并发时都保留，不因旧档案覆盖', async () => {
      let stored = { knownWords: [] as string[], unknownWords: [] as UnknownWordEntry[] };
      mockStorage.local.get.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { knownWords: [...stored.knownWords], unknownWords: [...stored.unknownWords] };
      });
      mockStorage.local.set.mockImplementation(async (changes: Partial<typeof stored>) => {
        stored = { ...stored, ...changes };
      });
      mockStorage.sync.set.mockResolvedValue(undefined);

      const [, inserted] = await Promise.all([
        StorageManager.addKnownWord('apple'),
        StorageManager.addUnknownWord(imported, { skipIfExists: true }),
      ]);

      expect(inserted).toBe(true);
      expect(stored.knownWords).toContain('apple');
      expect(stored.unknownWords).toEqual([imported]);
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
    it('提供设置快照时只读取其中的激活密钥，不重新读取已切换的设置', async () => {
      const settings = await StorageManager.getSettings();
      const snapshot = { ...settings, activeApiConfigId: 'a', apiConfigs: [
        { id: 'a', name: 'A', provider: 'custom', apiUrl: 'https://a.example/v1', apiKey: 'KEY_A' } as ApiConfig,
      ] };
      mockStorage.sync.get.mockResolvedValue({ settings: {
        activeApiConfigId: 'b', apiConfigs: [
          { id: 'b', name: 'B', provider: 'custom', apiUrl: 'https://b.example/v1', apiKey: 'KEY_B' },
        ],
      } });
      vi.clearAllMocks();

      expect(await StorageManager.getApiKey(snapshot)).toBe('KEY_A');
      expect(mockStorage.sync.get).not.toHaveBeenCalled();
    });

    it('旧版快照可读取旧密钥，导入新端点快照不能借用旧密钥', async () => {
      mockStorage.sync.get.mockResolvedValue({ apiKey: 'LEGACY_KEY' });
      const settings = await StorageManager.getSettings();
      vi.clearAllMocks();

      expect(await StorageManager.getApiKey(settings)).toBe('LEGACY_KEY');
      expect(await StorageManager.getApiKey({ ...settings, customApiUrl: 'https://new.example/v1' })).toBe('');
      expect(mockStorage.sync.get).toHaveBeenCalledExactlyOnceWith(['settings', 'apiKey', 'legacyApiKeyInvalidated']);
    });

    it.each([
      { apiProvider: 'anthropic' },
      { apiProvider: 'deepl' },
      { apiProvider: 'custom' },
      { apiProvider: 'ollama' },
      { apiProvider: 'free_google_translate' },
      { customApiUrl: 'https://new.example/v1' },
      { activeApiConfigId: 'removed', apiConfigs: [] },
      { apiConfigs: [{ id: 'new', provider: 'openai', apiKey: 'NEW_CONFIG_KEY' }] },
      { apiConfigs: [{ id: 'new', provider: 'custom', apiUrl: 'https://new.example/v1', apiKey: '' }] },
    ])('旧 OpenAI 快照不能读取切换配置后写入的旧字段密钥 %j', async updates => {
      mockStorage.sync.get.mockResolvedValue({ settings: {}, apiKey: 'LEGACY_OPENAI_KEY' });
      const snapshot = await StorageManager.getSettings();
      mockStorage.sync.get.mockResolvedValue({
        settings: { ...snapshot, ...updates },
        apiKey: 'NEW_PROVIDER_KEY',
      });

      expect(await StorageManager.getApiKey(snapshot)).toBe('');
    });

    it('读取旧密钥时必须同时核验其设置归属，不能分两次读取', async () => {
      const snapshot = await StorageManager.getSettings();
      mockStorage.sync.get.mockImplementation(async keys => Array.isArray(keys)
        ? { settings: { apiProvider: 'anthropic' }, apiKey: 'NEW_PROVIDER_KEY' }
        : keys === 'settings' ? { settings: snapshot } : { apiKey: 'NEW_PROVIDER_KEY' });

      expect(await StorageManager.getApiKey(snapshot)).toBe('');
    });

    it('旧 OpenAI 请求没有密钥时不能借用稍后配置的新服务商密钥', async () => {
      const snapshot = await StorageManager.getSettings();
      mockStorage.sync.get.mockResolvedValue({
        settings: { apiProvider: 'custom', customApiUrl: 'https://new.example/v1' },
        apiKey: 'NEW_PROVIDER_KEY',
      });

      expect(await StorageManager.getApiKey(snapshot)).toBe('');
    });

    it('快照含失效激活 ID 时不能使用无归属旧密钥', async () => {
      const snapshot = await StorageManager.getSettings();
      mockStorage.sync.get.mockResolvedValue({ settings: {}, apiKey: 'LEGACY_KEY' });

      expect(await StorageManager.getApiKey({ ...snapshot, activeApiConfigId: 'removed' })).toBe('');
    });

    it.each([undefined, null, '', 123, { secret: 'not-a-string' }])('旧字段不是有效字符串时拒绝使用 %j', async apiKey => {
      const snapshot = await StorageManager.getSettings();
      mockStorage.sync.get.mockResolvedValue({ settings: {}, apiKey });

      expect(await StorageManager.getApiKey(snapshot)).toBe('');
    });

    it('核验旧密钥归属时读取失败应传播错误，不回退到未经验证的密钥', async () => {
      const snapshot = await StorageManager.getSettings();
      mockStorage.sync.get.mockRejectedValueOnce(new Error('读取失败'));

      await expect(StorageManager.getApiKey(snapshot)).rejects.toThrow('读取失败');
    });

    it('仅非凭据设置变化时仍兼容未迁移的默认 OpenAI 密钥', async () => {
      const snapshot = await StorageManager.getSettings();
      mockStorage.sync.get.mockResolvedValue({
        settings: { ...snapshot, enabled: !snapshot.enabled },
        apiKey: 'LEGACY_KEY',
      });

      expect(await StorageManager.getApiKey(snapshot)).toBe('LEGACY_KEY');
    });

    it.each(['anthropic', 'deepl'] as const)('旧版无归属密钥不能借给 %s 服务商', async apiProvider => {
      mockStorage.sync.get.mockResolvedValue({ apiKey: 'LEGACY_KEY' });
      const settings = await StorageManager.getSettings();
      vi.clearAllMocks();

      expect(await StorageManager.getApiKey({ ...settings, apiProvider })).toBe('');
      expect(mockStorage.sync.get).not.toHaveBeenCalled();
    });

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

    it.each([
      { customApiUrl: 'https://attacker.example/v1/chat/completions', apiConfigs: [] },
      { activeApiConfigId: 'imported', apiConfigs: [{ id: 'imported', provider: 'custom', apiKey: '', apiUrl: 'https://attacker.example/v1' }] },
    ])('新端点或空配置不能静默借用旧密钥 %j', async settings => {
      mockStorage.sync.get.mockImplementation(async key => key === 'settings'
        ? { settings } : { apiKey: 'LEGACY_SECRET' });
      expect(await StorageManager.getApiKey()).toBe('');
    });

    it('未填写激活 ID 时首个显式自定义配置仍使用其自身密钥', async () => {
      mockStorage.sync.get.mockImplementation(async key => key === 'settings'
        ? { settings: { apiConfigs: [{ id: 'mine', provider: 'custom', apiKey: 'OWN_KEY', apiUrl: 'https://mine.example/v1' }] } }
        : { apiKey: 'LEGACY_SECRET' });
      expect(await StorageManager.getApiKey()).toBe('OWN_KEY');
    });

    it('显式自定义配置密钥不受旧密钥限制', async () => {
      mockStorage.sync.get.mockImplementation(async key => key === 'settings'
        ? { settings: { activeApiConfigId: 'mine', apiConfigs: [{ id: 'mine', provider: 'custom', apiKey: 'OWN_KEY', apiUrl: 'https://mine.example/v1' }] } }
        : { apiKey: 'LEGACY_SECRET' });
      expect(await StorageManager.getApiKey()).toBe('OWN_KEY');
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
