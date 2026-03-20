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
import {
  EXPORT_VERSION,
  validateImportData,
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

  describe('validateImportData', () => {
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
        profile: { knownWords: [], unknownWords: [] },
        settings: {},
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
    it('应该清除所有存储数据', async () => {
      mockStorage.sync = { testKey: 'testValue' };
      mockStorage.local = { testLocalKey: 'testLocalValue' };

      await clearAllData();

      // 清除后存储应该为空
      expect(Object.keys(mockStorage.sync).length).toBe(0);
      expect(Object.keys(mockStorage.local).length).toBe(0);
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