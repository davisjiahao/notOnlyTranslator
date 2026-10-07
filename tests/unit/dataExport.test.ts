/**
 * 数据导出/导入模块测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Chrome APIs
const mockStorage: Record<string, Record<string, unknown>> = {
  sync: {},
  local: {},
};

vi.stubGlobal('chrome', {
  storage: {
    sync: {
      get: vi.fn((keys) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockStorage.sync[keys] });
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          keys.forEach(k => {
            if (mockStorage.sync[k] !== undefined) {
              result[k] = mockStorage.sync[k];
            }
          });
          return Promise.resolve(result);
        }
        return Promise.resolve(mockStorage.sync);
      }),
      set: vi.fn((data) => {
        Object.assign(mockStorage.sync, data);
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        mockStorage.sync = {};
        return Promise.resolve();
      }),
      QUOTA_BYTES: 102400,
    },
    local: {
      get: vi.fn((keys) => {
        if (typeof keys === 'string') {
          return Promise.resolve({ [keys]: mockStorage.local[keys] });
        }
        if (Array.isArray(keys)) {
          const result: Record<string, unknown> = {};
          keys.forEach(k => {
            if (mockStorage.local[k] !== undefined) {
              result[k] = mockStorage.local[k];
            }
          });
          return Promise.resolve(result);
        }
        return Promise.resolve(mockStorage.local);
      }),
      set: vi.fn((data) => {
        Object.assign(mockStorage.local, data);
        return Promise.resolve();
      }),
      clear: vi.fn(() => {
        mockStorage.local = {};
        return Promise.resolve();
      }),
      QUOTA_BYTES: 5242880,
    },
  },
  runtime: {
    getManifest: vi.fn(() => ({ version: '1.0.0' })),
    sendMessage: vi.fn(() => Promise.resolve({ success: true, data: { wordsMerged: 0 } })),
  },
});

// Mock StorageManager
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getUserProfile: vi.fn(() =>
      Promise.resolve({
        examType: 'cet4',
        estimatedVocabulary: 4000,
        knownWords: ['test', 'word'],
        unknownWords: [],
        levelConfidence: 0.8,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    ),
    getSettings: vi.fn(() =>
      Promise.resolve({
        enabled: true,
        autoHighlight: true,
        translationMode: 'inline-only',
        showDifficulty: true,
        highlightColor: '#FFEB3B',
        fontSize: 14,
        apiProvider: 'openai',
        blacklist: [],
        apiConfigs: [],
        hoverDelay: 500,
        theme: 'system',
      })
    ),
    getMasteryProfile: vi.fn(() => Promise.resolve(null)),
    getTranslationCache: vi.fn(() => Promise.resolve({})),
    saveUserProfile: vi.fn(() => Promise.resolve()),
    updateUserProfile: vi.fn(() => Promise.resolve()),
    saveSettings: vi.fn(() => Promise.resolve()),
    importMasteryData: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocking
import { StorageManager } from '@/background/storage';
import {
  EXPORT_VERSION,
  validateImportData,
  validateImportedSettings,
  importAllData,
  exportAllData,
  exportToJSON,
  importFromJSON,
  clearAllData,
  getStorageStats,
  exportVocabularyToCSV,
  DEFAULT_IMPORT_OPTIONS,
  type FullExportData,
  type ImportOptions,
  type ValidationResult,
} from '@/shared/utils/dataExport';

describe('DataExport', () => {
  beforeEach(() => {
    // Reset mock storage
    mockStorage.sync = {};
    mockStorage.local = {};
  });

  describe('validateImportedSettings', () => {
    it.each(['deep1', '', 42, null])('拒绝非法传统服务商 %j，不能让备份污染密钥归属', traditionalProvider => {
      expect(validateImportedSettings({ enabled: true, hybridTranslation: {
        traditionalProvider, traditionalApiKey: 'TEST_ONLY_KEY',
      } })).toContain('用户设置的传统翻译服务商无效');
    });

    it.each([null, 42, {}, []])('拒绝格式错误的传统密钥 %j', traditionalApiKey => {
      expect(validateImportedSettings({ enabled: true, hybridTranslation: {
        traditionalProvider: 'deepl', traditionalApiKey,
      } })).toContain('用户设置的传统翻译密钥无效');
    });

    it('数组服务商不可凭字符串转换通过，预校验失败前不能先写入用户档案', async () => {
      const backup = await exportAllData();
      const malformed = {
        ...backup,
        settings: { ...backup.settings, hybridTranslation: {
          ...backup.settings.hybridTranslation!, traditionalProvider: ['deepl'] as unknown as 'deepl',
          traditionalApiKey: 'TEST_ONLY_KEY',
        } },
      };
      vi.mocked(chrome.runtime.sendMessage).mockClear();

      const result = await importAllData(malformed, DEFAULT_IMPORT_OPTIONS);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('用户设置的传统翻译服务商无效');
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it.each([
      { enabled: 'yes' }, { defaultEngine: 'other' }, { simpleTextThreshold: { invalid: true } },
      { enableSmartRouting: 1 }, { priority: 'unknown' },
    ])('混合设置非法字段 %j 不可进入页面渲染', invalid => {
      expect(validateImportedSettings({ enabled: true, hybridTranslation: {
        traditionalProvider: 'deepl', ...invalid,
      } })).toContain('用户设置的混合翻译配置无效');
    });

    it.each(['example.com', ['example.com', null], {}])('黑名单格式 %j 不得导入', blacklist => {
      expect(validateImportedSettings({ enabled: true, blacklist })).toContain('用户设置的网站黑名单格式无效');
    });

    it('非法黑名单备份须在用户档案写入前被拒绝', async () => {
      const backup = await exportAllData();
      vi.mocked(chrome.runtime.sendMessage).mockClear();
      const result = await importAllData({ ...backup, settings: {
        ...backup.settings, blacklist: 'example.com' as unknown as string[],
      } }, DEFAULT_IMPORT_OPTIONS);
      expect(result.success).toBe(false);
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    });

    it('配置名称是对象时拒绝导入，避免设置页面渲染崩溃', () => {
      expect(validateImportedSettings({ enabled: true, apiConfigs: [{
        id: 'a', name: { unexpected: true }, provider: 'openai', apiKey: 'TEST_ONLY_KEY', tested: true,
      }] })).toContain('用户设置的 API 配置格式无效');
    });

    it('接受已支持的传统翻译服务商和字符串密钥', () => {
      expect(validateImportedSettings({ enabled: true, hybridTranslation: {
        traditionalProvider: 'deepl', traditionalApiKey: 'TEST_ONLY_KEY',
      } })).toEqual([]);
    });
  });

  describe('validateImportData', () => {
    it.each([
      { word: '', translation: '译文' },
      { word: 'x'.repeat(201), translation: '译文' },
      { word: 1, translation: '译文' },
      { word: 'bank', translation: null },
      { word: 'bank', translation: 'x'.repeat(10001) },
      { word: 'bank', translation: '银行', context: 1 },
      { word: 'bank', translation: '银行', context: 'x'.repeat(10001) },
      { word: 'bank', translation: '银行', markedAt: Infinity },
      { word: 'bank', translation: '银行', lastReviewAt: 'yesterday' },
      { word: 'bank', translation: '银行', reviewCount: -1 },
      { word: 'bank', translation: '银行', reviewCount: 1.5 },
      null,
    ])('在写入前拒绝损坏的生词记录 %j', async entry => {
      const backup = await exportAllData();
      const result = validateImportData({ ...backup, profile: { ...backup.profile, unknownWords: [entry] } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('生词记录格式无效');
    });

    it.each([
      { examType: ['cet4'] }, { examType: 'unknown' },
      { estimatedVocabulary: Infinity }, { estimatedVocabulary: -1 }, { estimatedVocabulary: 1000001 },
      { levelConfidence: -0.1 }, { levelConfidence: 1.1 }, { levelConfidence: 'high' },
      { createdAt: Infinity }, { updatedAt: 'yesterday' },
      { examScore: 1001 }, { examScore: NaN },
      { knownWords: ['   '] }, { knownWords: [2] }, { knownWords: ['x'.repeat(201)] },
    ])('在写入前拒绝损坏的用户档案字段 %j', async patch => {
      const backup = await exportAllData();
      const result = validateImportData({ ...backup, profile: { ...backup.profile, ...patch } });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('用户配置字段无效');
    });

    it('should reject null/undefined data', () => {
      const result = validateImportData(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('无效的数据格式：数据必须是一个对象');
    });

    it('should reject non-object data', () => {
      const result = validateImportData('string');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('无效的数据格式：数据必须是一个对象');
    });

    it('should reject missing version', () => {
      const result = validateImportData({ profile: {}, settings: {} });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少版本信息');
    });

    it('should warn on missing timestamp', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        profile: {
          examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
          createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [],
        },
        settings: { enabled: true },
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('缺少导出时间戳');
    });

    it('should warn on version mismatch', () => {
      const result = validateImportData({
        version: '2.0.0',
        profile: { knownWords: [], unknownWords: [] },
        settings: {},
      });
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('版本不匹配');
    });

    it('should reject missing knownWords array', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        profile: { unknownWords: [] },
        settings: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('用户配置缺少已知词汇列表');
    });

    it('should reject missing unknownWords array', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        profile: { knownWords: [] },
        settings: {},
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('用户配置缺少生词列表');
    });

    it('should validate correct data structure', () => {
      const validData: FullExportData = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        appVersion: '1.0.0',
        profile: {
          examType: 'cet4',
          estimatedVocabulary: 4000,
          knownWords: ['test', 'word'],
          unknownWords: [],
          levelConfidence: 0.8,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        settings: {
          enabled: true,
          autoHighlight: true,
          translationMode: 'inline-only',
          showDifficulty: true,
          highlightColor: '#FFEB3B',
          fontSize: 14,
          apiProvider: 'openai',
          blacklist: [],
          apiConfigs: [],
          hoverDelay: 500,
          theme: 'system',
        },
        mastery: null,
        translationCache: {},
        metadata: {
          knownWordsCount: 2,
          unknownWordsCount: 0,
          masteryWordsCount: 0,
          cacheSize: 0,
        },
      };

      const result = validateImportData(validData);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should warn on missing optional fields', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        profile: {
          knownWords: [],
          unknownWords: [],
        },
        settings: {},
      });
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Import Options', () => {
    it('should have default import options', () => {
      const defaultOptions: ImportOptions = {
        overwrite: false,
        importProfile: true,
        importSettings: true,
        importMastery: true,
        importCache: false,
        mergeVocabulary: true,
      };

      expect(defaultOptions.importProfile).toBe(true);
      expect(defaultOptions.importCache).toBe(false);
      expect(defaultOptions.mergeVocabulary).toBe(true);
    });
  });

  describe('Export Data Structure', () => {
    it('should have correct export version', () => {
      expect(EXPORT_VERSION).toBe('1.0.0');
    });

    it('should define FullExportData interface correctly', () => {
      const exportData: FullExportData = {
        version: '1.0.0',
        exportedAt: Date.now(),
        appVersion: '1.0.0',
        profile: {
          examType: 'cet4',
          estimatedVocabulary: 4000,
          knownWords: [],
          unknownWords: [],
          levelConfidence: 0.8,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        settings: {
          enabled: true,
          autoHighlight: true,
          translationMode: 'inline-only',
          showDifficulty: true,
          highlightColor: '#FFEB3B',
          fontSize: 14,
          apiProvider: 'openai',
          blacklist: [],
          apiConfigs: [],
          hoverDelay: 500,
          theme: 'system',
        },
        mastery: null,
        translationCache: {},
        metadata: {
          knownWordsCount: 0,
          unknownWordsCount: 0,
          masteryWordsCount: 0,
          cacheSize: 0,
        },
      };

      expect(exportData.version).toBeDefined();
      expect(exportData.exportedAt).toBeGreaterThan(0);
      expect(exportData.profile).toBeDefined();
      expect(exportData.settings).toBeDefined();
    });
  });

  describe('Validation Result', () => {
    it('should return correct validation result structure', () => {
      const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: ['test warning'],
        data: undefined,
      };

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toContain('test warning');
    });
  });

  describe('exportAllData', () => {
    it('应该导出完整用户数据', async () => {
      const data = await exportAllData();

      expect(data.version).toBe(EXPORT_VERSION);
      expect(data.exportedAt).toBeGreaterThan(0);
      expect(data.appVersion).toBe('1.0.0');
      expect(data.profile).toBeDefined();
      expect(data.settings).toBeDefined();
      expect(data.metadata.knownWordsCount).toBe(2);
    });

    it('应该包含正确的元数据', async () => {
      const data = await exportAllData();

      expect(data.metadata.knownWordsCount).toBeGreaterThanOrEqual(0);
      expect(data.metadata.unknownWordsCount).toBeGreaterThanOrEqual(0);
      expect(data.metadata.cacheSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('exportToJSON', () => {
    it('应该导出有效的 JSON 字符串', async () => {
      const json = await exportToJSON();

      expect(typeof json).toBe('string');
      expect(() => JSON.parse(json)).not.toThrow();

      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(EXPORT_VERSION);
    });
  });

  describe('importFromJSON', () => {
    it('应该在无效 JSON 时返回失败', async () => {
      const result = await importFromJSON('invalid json', DEFAULT_IMPORT_OPTIONS);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('无效的 JSON 格式');
    });

    it('应该在缺少版本时返回失败', async () => {
      const invalidData = JSON.stringify({
        profile: { knownWords: [], unknownWords: [] },
        settings: {},
      });

      const result = await importFromJSON(invalidData, DEFAULT_IMPORT_OPTIONS);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('缺少版本信息');
    });

    it('应该成功导入有效数据', async () => {
      const validData: FullExportData = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        appVersion: '1.0.0',
        profile: {
          examType: 'cet4',
          estimatedVocabulary: 4000,
          knownWords: ['test'],
          unknownWords: [],
          levelConfidence: 0.8,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        settings: {
          enabled: true,
          autoHighlight: true,
          translationMode: 'inline-only',
          showDifficulty: true,
          highlightColor: '#FFEB3B',
          fontSize: 14,
          apiProvider: 'openai',
          blacklist: [],
          apiConfigs: [],
          hoverDelay: 500,
          theme: 'system',
        },
        mastery: null,
        translationCache: {},
        metadata: {
          knownWordsCount: 1,
          unknownWordsCount: 0,
          masteryWordsCount: 0,
          cacheSize: 0,
        },
      };

      const result = await importFromJSON(JSON.stringify(validData), DEFAULT_IMPORT_OPTIONS);

      expect(result.success).toBe(true);
      expect(result.message).toBe('数据导入成功');
    });
  });

  describe('clearAllData', () => {
    it('应委托后台清空，页面不直接绕过版本墓碑', async () => {
      mockStorage.sync = { testKey: 'testValue' };
      mockStorage.local = { testLocalKey: 'testLocalValue' };
      vi.mocked(chrome.runtime.sendMessage).mockClear();

      await clearAllData();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'CLEAR_ALL_DATA' });
      expect(chrome.storage.sync.clear).not.toHaveBeenCalled();
      expect(chrome.storage.local.clear).not.toHaveBeenCalled();
    });
  });

  describe('getStorageStats', () => {
    it('应该返回存储使用统计', async () => {
      mockStorage.sync = { testKey: 'testValue' };
      mockStorage.local = { testLocalKey: 'testLocalValue' };

      const stats = await getStorageStats();

      expect(stats.syncUsed).toBeGreaterThan(0);
      expect(stats.localUsed).toBeGreaterThan(0);
      expect(stats.syncQuota).toBe(102400);
      expect(stats.localQuota).toBe(5242880);
    });
  });

  describe('exportVocabularyToCSV', () => {
    it('公式释义按文本导出，回车保留在同一 CSV 字段', async () => {
      vi.mocked(StorageManager.getUserProfile).mockResolvedValueOnce({
        examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [],
        unknownWords: [{
          word: 'book', translation: '=1+1', context: 'first\rforged',
          markedAt: 1000, reviewCount: 0,
        }],
      });
      const csv = await exportVocabularyToCSV();
      expect(csv).toContain('"\'=1+1"');
    });

    it('应该导出有效的 CSV 格式', async () => {
      const csv = await exportVocabularyToCSV();

      expect(typeof csv).toBe('string');
      expect(csv).toContain('单词');
      expect(csv).toContain('状态');
      expect(csv).toContain('掌握度');
    });

    it('应该包含已知词汇', async () => {
      const csv = await exportVocabularyToCSV();

      expect(csv).toContain('test');
      expect(csv).toContain('word');
      expect(csv).toContain('已掌握');
    });
  });

  describe('DEFAULT_IMPORT_OPTIONS', () => {
    it('应该有合理的默认值', () => {
      expect(DEFAULT_IMPORT_OPTIONS.overwrite).toBe(false);
      expect(DEFAULT_IMPORT_OPTIONS.importProfile).toBe(true);
      expect(DEFAULT_IMPORT_OPTIONS.importSettings).toBe(true);
      expect(DEFAULT_IMPORT_OPTIONS.importMastery).toBe(true);
      expect(DEFAULT_IMPORT_OPTIONS.importCache).toBe(false);
      expect(DEFAULT_IMPORT_OPTIONS.mergeVocabulary).toBe(true);
    });
  });
});