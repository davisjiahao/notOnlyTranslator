import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { validateImportedSettings } from '@/shared/utils/dataExport';
import type { UserSettings } from '@/shared/types';

let stored: Record<string, unknown>;
beforeEach(() => {
  stored = { settings: { ...DEFAULT_SETTINGS, vocabularyAssessmentProvider: 'legacy' } };
  vi.stubGlobal('chrome', { storage: {
    sync: {
      get: vi.fn(async () => structuredClone(stored)),
      set: vi.fn(async (updates: Record<string, unknown>) => { stored = { ...stored, ...structuredClone(updates) }; }),
    },
    local: { get: vi.fn(async () => ({})), set: vi.fn() },
  } });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const writers = [
  { name: 'save', write: (fields: Record<string, unknown>) => StorageManager.saveSettings({ ...DEFAULT_SETTINGS, ...fields } as UserSettings) },
  { name: 'update', write: (fields: Record<string, unknown>) => StorageManager.updateSettings(fields) },
  { name: 'replace', write: (fields: Record<string, unknown>) => StorageManager.replaceSettings(fields) },
  { name: 'import', write: (fields: Record<string, unknown>) => StorageManager.importData({ settings: fields }) },
];

const customConfig = { provider: 'custom' as const, apiUrl: 'https://recognition.example/v2/systemone', model: 'custom-jev', threshold: 0.75 };
const invalidConfigs = [null, {}, { ...customConfig, threshold: 1.1 }, { ...customConfig, apiUrl: 'http://bad.example' },
  { ...customConfig, apiKey: 'synthetic-secret' }, { ...customConfig, secret: 'synthetic-secret' }];

describe.each(writers)('Jev设置存储边界：$name', ({ write }) => {
  it.each(invalidConfigs)('拒绝非法Jev配置且不写入：%j', async jevConfig => {
    await expect(write({ jevConfig })).rejects.toThrow('INVALID_JEV_CONFIG');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
  it('写入规范化配置，保留模型和阈值', async () => {
    await write({ jevConfig: { ...customConfig, apiUrl: 'https://RECOGNITION.example:443/v2/systemone' } });
    expect(stored.settings).toMatchObject({ jevConfig: customConfig });
  });
  it.each(['invalid', '', null, 1])('非法识别提供商%j不写入', async value => {
    await expect(write({ vocabularyAssessmentProvider: value })).rejects.toThrow('INVALID_JEV_SETTINGS');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
  it.each(['jevApiKey', 'jevKey', 'jevCredentials'])('拒绝同步设置夹带%s', async field => {
    const error = await write({ [field]: 'synthetic-secret' }).catch(value => value);
    expect(error.message).toBe('INVALID_JEV_SETTINGS');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
  });
});

describe('Jev开关与备份恢复', () => {
  it.each(invalidConfigs)('备份拒绝非法配置及嵌套secret：%j', jevConfig => {
    expect(validateImportedSettings({ enabled: true, jevConfig }).length).toBeGreaterThan(0);
  });
  it('备份允许非敏感自定义配置，恢复后强制legacy且保留配置', async () => {
    expect(validateImportedSettings({ enabled: true, jevConfig: customConfig })).toEqual([]);
    await StorageManager.replaceSettings({ enabled: true, jevConfig: customConfig, vocabularyAssessmentProvider: 'jev' });
    expect(await StorageManager.getSettings()).toMatchObject({ jevConfig: customConfig, vocabularyAssessmentProvider: 'legacy' });
  });
  it('缺配置的旧设置保持可读，存储中损坏配置不会回显secret', async () => {
    expect((await StorageManager.getSettings()).enabled).toBe(true);
    stored = { settings: { ...DEFAULT_SETTINGS, jevConfig: { ...customConfig, secret: 'synthetic-secret' } } };
    await expect(StorageManager.getSettings()).rejects.toThrow('INVALID_JEV_CONFIG');
  });
  it('正常设置更新可启用Jev且后续普通更新不将其关闭', async () => {
    await StorageManager.updateSettings({ vocabularyAssessmentProvider: 'jev' } as Partial<UserSettings>);
    await StorageManager.updateSettings({ enabled: false });
    expect(await StorageManager.getSettings()).toMatchObject({ vocabularyAssessmentProvider: 'jev', enabled: false });
  });
  it.each(['replace', 'import'] as const)('%s强制legacy且保持普通enabled值', async mode => {
    const settings = { enabled: false, vocabularyAssessmentProvider: 'jev' } as Partial<UserSettings>;
    if (mode === 'replace') await StorageManager.replaceSettings(settings);
    else await StorageManager.importData({ settings });
    expect(await StorageManager.getSettings()).toMatchObject({ vocabularyAssessmentProvider: 'legacy', enabled: false });
  });
  it('GET_SETTINGS不暴露历史错误写入的Jev字段且无效旧enum回落legacy', async () => {
    stored = { settings: { ...DEFAULT_SETTINGS, jevApiKey: 'synthetic-secret', jevKey: 'other',
      jevCredentials: { apiKey: 'synthetic-secret' }, vocabularyAssessmentProvider: 'invalid' } };
    const settings = await StorageManager.getSettings();
    expect(JSON.stringify(settings)).not.toContain('synthetic-secret');
    expect(settings).not.toHaveProperty('jevApiKey');
    expect(settings).not.toHaveProperty('jevKey');
    expect(settings).not.toHaveProperty('jevCredentials');
    expect(settings).toHaveProperty('vocabularyAssessmentProvider', 'legacy');
  });
  it.each([
    { vocabularyAssessmentProvider: 'invalid' }, { jevApiKey: 'synthetic-secret' },
    { jevKey: 'synthetic-secret' }, { jevCredentials: {} },
  ])('备份校验拒绝Jev非法字段且不回显内容', fields => {
    const errors = validateImportedSettings({ enabled: true, ...fields });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(' ')).not.toContain('synthetic-secret');
  });
});
