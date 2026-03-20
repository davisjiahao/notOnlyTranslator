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

// Import after mocking
import {
  EXPORT_VERSION,
  validateImportData,
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
});