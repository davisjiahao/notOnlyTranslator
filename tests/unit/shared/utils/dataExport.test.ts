import { describe, it, expect, vi } from 'vitest';
import { validateImportData, DEFAULT_IMPORT_OPTIONS, EXPORT_VERSION, importAllData, importFromJSON } from '@/shared/utils/dataExport';
import { StorageManager } from '@/background/storage';
import type { FullExportData } from '@/shared/utils/dataExport';

const validProfile = {
  examType: 'cet4' as const, estimatedVocabulary: 4000, levelConfidence: 0.5,
  createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [],
};

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
        profile: validProfile,
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
        profile: validProfile,
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
        profile: validProfile,
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

    it('rejects missing settings.enabled', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: validProfile,
        settings: {},
      };
      const result = validateImportData(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some(w => w.includes('启用状态'))).toBe(true);
    });

    it.each([null, false, ''])('选中导入设置时拒绝显式无效值 %j，档案不先写入', async settings => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const backup = { version: EXPORT_VERSION, profile: validProfile, settings };
        const validation = validateImportData(backup);
        expect(validation.valid).toBe(false);
        expect(validation.errors.join('、')).toContain('用户设置');
        const result = await importFromJSON(JSON.stringify(backup), {
          ...DEFAULT_IMPORT_OPTIONS, mergeVocabulary: false,
        });
        expect(result.success).toBe(false);
        expect(result.details.profileImported).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('选中导入设置但备份未提供该字段时仍警告并导入档案', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ success: true, data: { wordsMerged: 0 } });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const backup = { version: EXPORT_VERSION, profile: validProfile };
        expect(validateImportData(backup).warnings).toContain('缺少用户设置数据');
        const result = await importFromJSON(JSON.stringify(backup), DEFAULT_IMPORT_OPTIONS);
        expect(result.success).toBe(true);
        expect(result.warnings).toContain('缺少用户设置数据');
        expect(result.details.profileImported).toBe(true);
        expect(result.details.settingsImported).toBe(false);
        expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'IMPORT_USER_PROFILE' }));
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('warns on missing settings entirely', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: validProfile,
      };
      const result = validateImportData(data);
      expect(result.warnings.some(w => w.includes('用户设置'))).toBe(true);
    });

    it('预览拒绝只有词表、无法通过后台导入的档案', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        profile: { knownWords: [], unknownWords: [] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('用户配置'))).toBe(true);
    });

    it('预览拒绝后台无法导入的生词记录', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        profile: { ...validProfile, unknownWords: [{ word: 'book', translation: 42 }] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('生词'))).toBe(true);
    });

    it('拒绝会破坏设置读取的 API 配置数组', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        settings: { enabled: true, apiConfigs: [null] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('API 配置'))).toBe(true);
    });

    it('拒绝不支持的 API 提供商，避免导入后模型服务崩溃', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        settings: { enabled: true, apiConfigs: [{ id: 'x', provider: 'bogus', apiKey: 'fixture' }] },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('API 配置'))).toBe(true);
    });

    it.each([
      ['缺少置信度', { masteryLevel: 0.5, estimatedLevel: 'A1', nextReviewAt: 1 }],
      ['缺少复习时间', { masteryLevel: 0.5, estimatedLevel: 'A1', confidence: 0.5 }],
      ['无效等级', { masteryLevel: 0.5, estimatedLevel: 'Z9', confidence: 0.5, nextReviewAt: 1 }],
    ])('拒绝%s的掌握度记录', (_label, entry) => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        mastery: { wordMastery: { book: entry } },
      });
      expect(result.valid).toBe(false);
    });

    it('允许来自应用的完整掌握度记录', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        mastery: { wordMastery: { book: {
          word: 'book', translation: '书', context: '', markedAt: 1, reviewCount: 0,
          masteryLevel: 0.5, confidence: 0.8, knownCount: 1, unknownCount: 1,
          nextReviewAt: 10, estimatedLevel: 'A1',
        } } },
      });
      expect(result.valid).toBe(true);
    });

    it('拒绝无法正常导出词表的掌握度记录', () => {
      const result = validateImportData({
        version: EXPORT_VERSION,
        mastery: { wordMastery: { book: {} } },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => error.includes('掌握度'))).toBe(true);
    });

    it('rejects malformed mastery data', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: validProfile,
        settings: { enabled: true },
        mastery: { noWordMastery: true },
      };
      const result = validateImportData(data);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('掌握度'))).toBe(true);
    });

    it('拒绝会破坏读取操作的掌握度结构，不写入任一数据区', async () => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importFromJSON(JSON.stringify({
          version: EXPORT_VERSION,
          profile: validProfile,
          mastery: { wordMastery: null },
        }), DEFAULT_IMPORT_OPTIONS);
        expect(result.success).toBe(false);
        expect(result.errors.some((error) => error.includes('掌握度'))).toBe(true);
        expect(sendMessage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('validates complete valid data without errors', () => {
      const data = {
        version: EXPORT_VERSION,
        exportedAt: Date.now(),
        profile: { ...validProfile, knownWords: ['apple', 'banana'] },
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
        profile: { ...validProfile, examType: 'ielts' },
        settings: { enabled: true },
      };
      const result = validateImportData(data);
      expect(result.valid).toBe(true);
    });
  });

  describe('导入前安全校验', () => {
    it.each([
      { enabled: true, customApiUrl: 'http://evil.example/v1/chat/completions' },
      { enabled: true, customApiUrl: 'javascript:alert(1)' },
      { enabled: true, apiConfigs: [{ id: 'remote', provider: 'custom', apiKey: 'test', apiUrl: 'http://evil.example/v1' }] },
    ])('预览拒绝不安全端点 %j', (settings) => {
      const result = validateImportData({ version: EXPORT_VERSION, settings });
      expect(result.valid).toBe(false);
      expect(result.errors.some(error => error.includes('端点'))).toBe(true);
    });

    it.each([
      { enabled: true, apiProvider: 'ollama', customApiUrl: 'https://outside.example/v1' },
      { enabled: true, apiProvider: 'custom', customApiUrl: 'https://outside.example/v1' },
      { enabled: true, apiConfigs: [{ id: 'mine', provider: 'custom', apiKey: 'own-key', apiUrl: 'https://mine.example/v1' }] },
    ])('备份中的非本机 HTTPS 端点不可直接启用 %j', settings => {
      const result = validateImportData({ version: EXPORT_VERSION, settings });
      expect(result.valid).toBe(false);
      expect(result.errors.join('、')).toContain('端点');
    });

    it.each([
      { enabled: true, apiProvider: 'free_google_translate', customApiUrl: 'http://localhost:7777/delete?text=secret' },
      { enabled: true, apiProvider: 'ollama', customApiUrl: 'http://127.0.0.1:11434/v1' },
      { enabled: true, apiConfigs: [{ id: 'local', provider: 'custom', apiKey: 'own', apiUrl: 'http://[::1]:7777/delete' }] },
    ])('备份中的本机端点也必须拒绝，写入档案前阻断 %j', async settings => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importFromJSON(JSON.stringify({
          version: EXPORT_VERSION, profile: validProfile, settings,
        }), { ...DEFAULT_IMPORT_OPTIONS, mergeVocabulary: false });
        expect(result.success).toBe(false);
        expect(result.errors.join('、')).toContain('端点');
        expect(sendMessage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('保留空 URL、无 URL 和默认 Ollama 配置', () => {
      expect(validateImportData({ version: EXPORT_VERSION, settings: {
        enabled: true, apiProvider: 'ollama', customApiUrl: '',
        apiConfigs: [{ id: 'local', provider: 'ollama', apiKey: '', apiUrl: '' }],
      } }).valid).toBe(true);
      expect(validateImportData({ version: EXPORT_VERSION, settings: { enabled: true, apiProvider: 'ollama' } }).valid).toBe(true);
    });

    it('拒绝非法顶层提供商，档案不先写入', async () => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importFromJSON(JSON.stringify({
          version: EXPORT_VERSION, profile: validProfile, settings: { enabled: true, apiProvider: 'invalid' },
        }), { ...DEFAULT_IMPORT_OPTIONS, mergeVocabulary: false });
        expect(result.success).toBe(false);
        expect(result.errors.join('、')).toContain('提供商');
        expect(sendMessage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('不合并档案时，设置缺少 enabled 必须在任何写入前拒绝', async () => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const backup = { version: EXPORT_VERSION, profile: validProfile, settings: {} };
        expect(validateImportData(backup).valid).toBe(false);
        const result = await importAllData(backup as FullExportData, {
          ...DEFAULT_IMPORT_OPTIONS, mergeVocabulary: false, importMastery: false, importCache: false,
        });
        expect(result.success).toBe(false);
        expect(result.details.profileImported).toBe(false);
        expect(sendMessage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it.each([
      [{ enabled: true, customApiUrl: 'http://evil.example/v1' }, '端点'],
      [{ enabled: true, apiConfigs: [{ id: 'x', provider: 'bogus', apiKey: 'test' }] }, 'API 配置'],
    ])('设置无效时从 JSON 导入不得先覆盖旧档案 %j', async (settings, errorText) => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const backup = { version: EXPORT_VERSION, profile: validProfile, settings };
        const result = await importFromJSON(JSON.stringify(backup), { ...DEFAULT_IMPORT_OPTIONS, mergeVocabulary: false });
        expect(result.success).toBe(false);
        expect(result.errors.join('、')).toContain(errorText);
        expect(sendMessage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('选中损坏的缓存时在档案写入之前拒绝', async () => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importAllData({ version: EXPORT_VERSION, profile: validProfile, translationCache: [] } as unknown as FullExportData, {
          ...DEFAULT_IMPORT_OPTIONS, importSettings: false, importCache: true,
        });
        expect(result.success).toBe(false);
        expect(result.errors.join('、')).toContain('缓存');
        expect(sendMessage).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('从 JSON 导入时未选中的损坏档案和掌握度不阻塞有效设置', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ success: true });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importFromJSON(JSON.stringify({
          version: EXPORT_VERSION, profile: { knownWords: [], unknownWords: [] },
          settings: { enabled: true }, mastery: { wordMastery: null },
        }), { ...DEFAULT_IMPORT_OPTIONS, importProfile: false, importMastery: false, importCache: false });
        expect(result.success).toBe(true);
        expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'REPLACE_SETTINGS', payload: { enabled: true } });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('跳过无效设置时只校验选中的档案并允许导入', async () => {
      const sendMessage = vi.fn().mockResolvedValue({ success: true, data: { wordsMerged: 0 } });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importAllData({ version: EXPORT_VERSION, profile: validProfile, settings: {} } as FullExportData, {
          ...DEFAULT_IMPORT_OPTIONS, importSettings: false, importMastery: false, importCache: false,
        });
        expect(result.success).toBe(true);
        expect(sendMessage).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'IMPORT_USER_PROFILE' }));
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('完整备份的合并导入', () => {
    it('在最新档案内合并，不用导入前读取的旧快照覆盖并发生词', async () => {
      const current = {
        examType: 'cet4' as const, estimatedVocabulary: 4000, knownWords: [],
        unknownWords: [{ word: 'book', context: '', translation: '书', markedAt: 1, reviewCount: 0 }],
        levelConfidence: 0.5, createdAt: 1, updatedAt: 1,
      };
      const backup = { ...current, unknownWords: [], knownWords: ['apple'] };
      const sendMessage = vi.fn().mockResolvedValue({ success: true, data: { wordsMerged: 1 } });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      const save = vi.spyOn(StorageManager, 'saveUserProfile').mockResolvedValue(undefined);
      try {
        const result = await importAllData(
          { version: EXPORT_VERSION, profile: backup } as FullExportData,
          { ...DEFAULT_IMPORT_OPTIONS, importSettings: false, importMastery: false, importCache: false }
        );
        expect(result.success).toBe(true);
        expect(sendMessage).toHaveBeenCalledWith({
          type: 'IMPORT_USER_PROFILE',
          payload: { profile: backup, mergeVocabulary: true },
        });
        expect(result.details.wordsMerged).toBe(1);
        expect(save).not.toHaveBeenCalled();
      } finally {
        save.mockRestore();
        vi.unstubAllGlobals();
      }
    });
  });

  describe('导入异常反馈', () => {
    it('后台回滚失败时向用户说明档案可能部分更改，不回显任意底层错误', async () => {
      const sendMessage = vi.fn().mockResolvedValue({
        success: false, error: '导入失败，部分档案可能已更新，请从备份恢复',
      });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      const backup = {
        examType: 'cet4' as const, estimatedVocabulary: 4000, levelConfidence: 0.5,
        createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [],
      };
      try {
        const result = await importAllData(
          { version: EXPORT_VERSION, profile: backup } as FullExportData,
          { ...DEFAULT_IMPORT_OPTIONS, importSettings: false, importMastery: false, importCache: false }
        );
        expect(result.success).toBe(false);
        expect(result.errors).toContain('导入失败，部分档案可能已更新，请从备份恢复');
        sendMessage.mockResolvedValueOnce({ success: false, error: 'SECRET_SENTINEL' });
        const rejected = await importAllData(
          { version: EXPORT_VERSION, profile: backup } as FullExportData,
          { ...DEFAULT_IMPORT_OPTIONS, importSettings: false, importMastery: false, importCache: false }
        );
        expect(JSON.stringify(rejected.errors)).not.toContain('SECRET_SENTINEL');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('分步导入失败', () => {
    it.each([
      ['档案', { version: EXPORT_VERSION, profile: validProfile }, { importSettings: false }, undefined],
      ['设置', { version: EXPORT_VERSION, settings: { enabled: true } }, { importProfile: false }, new Error('响应丢失 SECRET_SENTINEL')],
    ])('后台写入%s后消息确认丢失时报告状态未知', async (_label, data, flags, reply) => {
      const sendMessage = vi.fn().mockImplementation(async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importAllData(data as FullExportData, {
          ...DEFAULT_IMPORT_OPTIONS, ...flags, importMastery: false, importCache: false,
        });
        expect(sendMessage).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(false);
        expect(result.errors.join('、')).toContain('状态未知');
        expect(result.errors.join('、')).not.toContain('SECRET_SENTINEL');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('档案写入成功后设置失败，报告已导入部分且不泄露底层错误', async () => {
      const sendMessage = vi.fn()
        .mockResolvedValueOnce({ success: true, data: { wordsMerged: 0 } })
        .mockResolvedValueOnce({ success: false, error: 'SECRET_SENTINEL' });
      vi.stubGlobal('chrome', { runtime: { sendMessage } });
      try {
        const result = await importAllData({
          version: EXPORT_VERSION,
          profile: {
            examType: 'cet4', estimatedVocabulary: 4000, levelConfidence: 0.5,
            createdAt: 1, updatedAt: 1, knownWords: [], unknownWords: [],
          },
          settings: { enabled: true },
        } as FullExportData, {
          ...DEFAULT_IMPORT_OPTIONS, importMastery: false, importCache: false,
        });
        expect(result.success).toBe(false);
        expect(result.details.profileImported).toBe(true);
        expect(result.errors.join('、')).toContain('部分数据');
        expect(result.errors.join('、')).toContain('用户配置');
        expect(result.errors.join('、')).not.toContain('SECRET_SENTINEL');
      } finally {
        vi.unstubAllGlobals();
      }
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
