import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateImportData, DEFAULT_IMPORT_OPTIONS, EXPORT_VERSION } from '@/shared/utils/dataExport';

describe('dataExport', () => {
  describe('validateImportData', () => {
    it('rejects non-object data', () => {
      const result = validateImportData(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('无效的数据格式：数据必须是一个对象');
    });

    it('rejects primitive data', () => {
      expect(validateImportData(42).valid).toBe(false);
      expect(validateImportData('hello').valid).toBe(false);
      expect(validateImportData(true).valid).toBe(false);
    });

    it('rejects data without version', () => {
      const result = validateImportData({});
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('缺少版本信息');
    });

    it('warns on major version mismatch', () => {
      const data = {
        version: '2.0.0',
        exportedAt: Date.now(),
        profile: { examType: 'cet4', knownWords: [], unknownWords: [] },
        settings: { enabled: true },
        mastery: { wordMastery: {} },
      };
      const result = validateImportData(data);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('版本不匹配'))).toBe(true);
    });

    it('accepts matching major version without warning', () => {
      const data = {
        version: '1.1.0',
        exportedAt: Date.now(),
        profile: { examType: 'cet4', knownWords: [], unknownWords: [] },
        settings: { enabled: true },
        mastery: { wordMastery: {} },
      };
      const result = validateImportData(data);
      expect(result.valid).toBe(true);
      expect(result.warnings.some(w => w.includes('版本不匹配'))).toBe(false);
    });

    it('warns on missing exportedAt', () => {
      const data = {
        version: EXPORT_VERSION,
        profile: { examType: 'cet4', knownWords: [], unknownWords: [] },
        settings: { enabled: true },
      };
      const result = validateImportData(data);
      expect(result.warnings.some(w => w.includes('导出时间戳'))).toBe(true);
    });

    it('warns on missing profile', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        settings: { enabled: true },
      };
      const result = validateImportData(data);
      expect(result.warnings.some(w => w.includes('用户配置'))).toBe(true);
    });

    it('warns on missing examType in profile', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { knownWords: [], unknownWords: [] },
        settings: { enabled: true },
      };
      const result = validateImportData(data);
      expect(result.warnings.some(w => w.includes('考试类型'))).toBe(true);
    });

    it('errors on missing knownWords array', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { examType: 'cet4', unknownWords: [] },
        settings: { enabled: true },
      };
      const result = validateImportData(data);
      expect(result.errors.some(e => e.includes('已知词汇'))).toBe(true);
    });

    it('errors on missing unknownWords array', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { examType: 'cet4', knownWords: [] },
        settings: { enabled: true },
      };
      const result = validateImportData(data);
      expect(result.errors.some(e => e.includes('生词列表'))).toBe(true);
    });

    it('warns on missing settings.enabled', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { examType: 'cet4', knownWords: [], unknownWords: [] },
        settings: {},
      };
      const result = validateImportData(data);
      expect(result.warnings.some(w => w.includes('启用状态'))).toBe(true);
    });

    it('warns on missing settings entirely', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { examType: 'cet4', knownWords: [], unknownWords: [] },
      };
      const result = validateImportData(data);
      expect(result.warnings.some(w => w.includes('用户设置'))).toBe(true);
    });

    it('warns on malformed mastery data', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { examType: 'cet4', knownWords: [], unknownWords: [] },
        settings: { enabled: true },
        mastery: { noWordMastery: true },
      };
      const result = validateImportData(data);
      expect(result.warnings.some(w => w.includes('掌握度'))).toBe(true);
    });

    it('validates complete valid data without errors', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { examType: 'cet4', knownWords: ['apple', 'banana'], unknownWords: [] },
        settings: { enabled: true },
        mastery: { wordMastery: {} },
      };
      const result = validateImportData(data);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toBeDefined();
      expect(result.data!.profile.knownWords).toEqual(['apple', 'banana']);
    });

    it('accepts data without mastery (mastery is optional)', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { examType: 'ielts', knownWords: [], unknownWords: [] },
        settings: { enabled: true },
      };
      const result = validateImportData(data);
      expect(result.valid).toBe(true);
    });
  });

  describe('DEFAULT_IMPORT_OPTIONS', () => {
    it('has correct default values', () => {
      expect(DEFAULT_IMPORT_OPTIONS.overwrite).toBe(false);
      expect(DEFAULT_IMPORT_OPTIONS.importProfile).toBe(true);
      expect(DEFAULT_IMPORT_OPTIONS.importSettings).toBe(true);
      expect(DEFAULT_IMPORT_OPTIONS.importMastery).toBe(true);
      expect(DEFAULT_IMPORT_OPTIONS.importCache).toBe(false);
      expect(DEFAULT_IMPORT_OPTIONS.mergeVocabulary).toBe(true);
    });
  });

  describe('EXPORT_VERSION', () => {
    it('is a semver string', () => {
      expect(EXPORT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });
});
