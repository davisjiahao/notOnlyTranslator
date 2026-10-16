import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/shared/types';
import { handleJevMessage, invalidateJevOperations } from '@/background/jevMessages';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { DEFAULT_JEV_CONFIG } from '@/shared/utils/jevConfig';

vi.mock('@/background/storage', () => ({ StorageManager: { getSettings: vi.fn() } }));
const customConfig = { provider: 'custom' as const, apiUrl: 'https://recognition.example/v2/systemone', model: 'custom-jev', threshold: 0.75 };
import { getJevApiKey, saveJevApiKey, clearJevApiKey } from '@/background/jevCredentials';
import { assessJevCandidates, resetJevRecognition } from '@/background/jevRecognition';
import { getLastJevAssessment } from '@/background/jevTranslation';

vi.mock('@/background/jevTranslation', () => ({ getLastJevAssessment: vi.fn() }));

vi.mock('@/background/jevCredentials', async importOriginal => ({
  ...await importOriginal<typeof import('@/background/jevCredentials')>(),
  getJevApiKey: vi.fn(), saveJevApiKey: vi.fn(), clearJevApiKey: vi.fn(),
}));
vi.mock('@/background/jevRecognition', async importOriginal => ({
  ...await importOriginal<typeof import('@/background/jevRecognition')>(),
  assessJevCandidates: vi.fn(), resetJevRecognition: vi.fn(),
}));
const key = 'synthetic-jev-secret';
const sender = { id: 'jev-test', url: 'chrome-extension://jev-test/src/options/index.html' };
const dispatch = (type: Message['type'], payload?: unknown, from = sender) => handleJevMessage({ type, payload }, from);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(StorageManager.getSettings).mockResolvedValue(DEFAULT_SETTINGS);
  vi.stubGlobal('chrome', { runtime: { id: 'jev-test', getURL: (path: string) => `chrome-extension://jev-test/${path}` },
    permissions: { contains: vi.fn().mockResolvedValue(true) } });
  vi.mocked(getJevApiKey).mockResolvedValue(key);
  vi.mocked(saveJevApiKey).mockResolvedValue(undefined);
  vi.mocked(clearJevApiKey).mockResolvedValue(undefined);
  vi.mocked(assessJevCandidates).mockResolvedValue([]);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Jev凭据消息', () => {
  it('状态与测试均使用当前配置的端点权限、密钥和模型', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, jevConfig: customConfig });
    expect(await dispatch('GET_JEV_STATUS')).toEqual({ success: true, data: { hasKey: true, model: customConfig.model } });
    expect(getJevApiKey).toHaveBeenCalledWith(customConfig);
    expect(await dispatch('TEST_JEV_CONNECTION')).toEqual({ success: true, data: { connected: true, model: customConfig.model } });
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://recognition.example/*'] });
    expect(assessJevCandidates).toHaveBeenCalledWith(expect.any(Array), key, expect.objectContaining({ config: customConfig }));
  });

  it('保存显式配置必须匹配当前快照', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, jevConfig: customConfig });
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key, config: customConfig })).toMatchObject({ success: true });
    expect(saveJevApiKey).toHaveBeenLastCalledWith(key, customConfig);
    vi.mocked(saveJevApiKey).mockClear();
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key, config: { ...customConfig, apiUrl: 'https://other.example/systemone' } }))
      .toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
    expect(saveJevApiKey).not.toHaveBeenCalled();
  });

  it.each([
    customConfig,
    { ...DEFAULT_JEV_CONFIG, provider: 'custom' as const },
    { ...DEFAULT_JEV_CONFIG, apiUrl: 'https://other.example/v1/systemone' },
    { ...DEFAULT_JEV_CONFIG, apiUrl: 'https://api.typesafe.ai/other/systemone' },
  ])('旧无config消息不能将密钥绑定到不同provider或完整端点：%j', async config => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, jevConfig: config });
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key }))
      .toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
    expect(saveJevApiKey).not.toHaveBeenCalled();
    expect(resetJevRecognition).not.toHaveBeenCalled();
  });

  it('默认归属只修改model和threshold仍兼容旧无config消息', async () => {
    const config = { ...DEFAULT_JEV_CONFIG, model: 'another-jev', threshold: 0.9 };
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, jevConfig: config });
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key })).toMatchObject({ success: true });
    expect(saveJevApiKey).toHaveBeenCalledWith(key, config);
  });

  it('非法显式配置返回固定错误且不保存密钥', async () => {
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key, config: { ...customConfig, secret: key } }))
      .toEqual({ success: false, error: 'INVALID_JEV_CONFIG' });
    expect(saveJevApiKey).not.toHaveBeenCalled();
  });

  it.each(['GET_JEV_STATUS', 'SET_JEV_API_KEY', 'TEST_JEV_CONNECTION'] as const)(
    '%s等待配置期间发生ABA切换不继续使用旧配置', async type => {
      let release!: (settings: typeof DEFAULT_SETTINGS) => void;
      vi.mocked(StorageManager.getSettings).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
      const pending = dispatch(type, { apiKey: key });
      await vi.waitFor(() => expect(StorageManager.getSettings).toHaveBeenCalledOnce());
      invalidateJevOperations();
      release(DEFAULT_SETTINGS);
      expect(await pending).toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
      expect(getJevApiKey).not.toHaveBeenCalled();
      expect(saveJevApiKey).not.toHaveBeenCalled();
      expect(assessJevCandidates).not.toHaveBeenCalled();
    },
  );

  it('权限等待期间配置变化：不再读取密钥或调用识别', async () => {
    vi.mocked(chrome.permissions.contains).mockImplementationOnce(async () => {
      invalidateJevOperations();
      return true;
    });
    expect(await dispatch('TEST_JEV_CONNECTION')).toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
    expect(getJevApiKey).not.toHaveBeenCalled();
    expect(assessJevCandidates).not.toHaveBeenCalled();
  });

  it('状态读取凭据期间配置变化：不得返回旧模型状态', async () => {
    vi.mocked(getJevApiKey).mockImplementationOnce(async () => { invalidateJevOperations(); return key; });
    expect(await dispatch('GET_JEV_STATUS')).toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
  });

  it('保存等待完成期间配置变化：不能报告当前配置已有密钥', async () => {
    vi.mocked(saveJevApiKey).mockImplementationOnce(async () => { invalidateJevOperations(); });
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key })).toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
  });
  it.each(['GET_JEV_STATUS', 'SET_JEV_API_KEY', 'DELETE_JEV_API_KEY', 'TEST_JEV_CONNECTION'] as const)(
    '%s拒绝内容页且不触碰凭据', async type => {
      expect(await dispatch(type, { apiKey: key }, { ...sender, url: 'https://example.test/' }))
        .toEqual({ success: false, error: 'JEV_UNTRUSTED_SENDER' });
      expect(getJevApiKey).not.toHaveBeenCalled();
      expect(saveJevApiKey).not.toHaveBeenCalled();
      expect(clearJevApiKey).not.toHaveBeenCalled();
      expect(assessJevCandidates).not.toHaveBeenCalled();
    },
  );
  it('状态只返回hasKey/model，不返回密钥', async () => {
    expect(await dispatch('GET_JEV_STATUS')).toEqual({ success: true, data: { hasKey: true, model: 'jev-1.13.0' } });
    vi.mocked(getJevApiKey).mockResolvedValue(null);
    expect(await dispatch('GET_JEV_STATUS')).toEqual({ success: true, data: { hasKey: false, model: 'jev-1.13.0' } });
  });
  it('状态仅投影最近实际识别的固定字段，未知reason不回显', async () => {
    vi.mocked(getLastJevAssessment).mockReturnValue({ provider: 'legacy', reason: 'missing-key', at: 123, secret: key } as never);
    expect(await dispatch('GET_JEV_STATUS')).toEqual({ success: true, data: {
      hasKey: true, model: 'jev-1.13.0', lastAssessment: { provider: 'legacy', reason: 'missing-key', at: 123 },
    } });
    vi.mocked(getLastJevAssessment).mockReturnValue({ provider: 'legacy', reason: key, at: 123 } as never);
    expect(await dispatch('GET_JEV_STATUS')).toEqual({ success: true, data: {
      hasKey: true, model: 'jev-1.13.0', lastAssessment: { provider: 'legacy', reason: 'unavailable', at: 123 },
    } });
  });
  it('非法最近识别状态不透传，TEST不读取或改写最近实际状态', async () => {
    vi.mocked(getLastJevAssessment).mockReturnValue({ provider: key, reason: key, at: 'invalid' } as never);
    expect(await dispatch('GET_JEV_STATUS')).toEqual({ success: true, data: { hasKey: true, model: 'jev-1.13.0' } });
    vi.mocked(getLastJevAssessment).mockClear();
    await dispatch('TEST_JEV_CONNECTION');
    expect(getLastJevAssessment).not.toHaveBeenCalled();
  });
  it.each([null, {}, { apiKey: 1 }, { apiKey: key, extra: true }, ['key']])('保存拒绝额外或非法字段%j', async payload => {
    expect(await dispatch('SET_JEV_API_KEY', payload)).toEqual({ success: false, error: 'INVALID_JEV_API_KEY' });
    expect(saveJevApiKey).not.toHaveBeenCalled();
  });
  it('保存与删除等待完成并重置识别状态，回包仅为存在状态', async () => {
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key })).toEqual({ success: true, data: { hasKey: true } });
    expect(saveJevApiKey).toHaveBeenCalledWith(key, DEFAULT_JEV_CONFIG);
    expect(resetJevRecognition).toHaveBeenCalled();
    vi.mocked(resetJevRecognition).mockClear();
    expect(await dispatch('DELETE_JEV_API_KEY')).toEqual({ success: true, data: { hasKey: false } });
    expect(clearJevApiKey).toHaveBeenCalledOnce();
    expect(resetJevRecognition).toHaveBeenCalled();
  });
  it('权限缺失时TEST不调用模型', async () => {
    vi.mocked(chrome.permissions.contains as (permissions: chrome.permissions.Permissions) => Promise<boolean>).mockResolvedValue(false);
    expect(await dispatch('TEST_JEV_CONNECTION')).toEqual({ success: false, error: 'JEV_HOST_PERMISSION_REQUIRED' });
    expect(assessJevCandidates).not.toHaveBeenCalled();
  });
  it('无凭据时TEST不调用模型', async () => {
    vi.mocked(getJevApiKey).mockResolvedValue(null);
    expect(await dispatch('TEST_JEV_CONNECTION')).toEqual({ success: false, error: 'JEV_KEY_REQUIRED' });
    expect(assessJevCandidates).not.toHaveBeenCalled();
  });
  it('TEST使用固定book样本真实collect，强制重置且不回传模型原文', async () => {
    vi.mocked(assessJevCandidates).mockResolvedValue([{ secret: key }] as never);
    expect(await dispatch('TEST_JEV_CONNECTION')).toEqual({ success: true, data: { connected: true, model: 'jev-1.13.0' } });
    expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://api.typesafe.ai/*'] });
    const [candidates, supplied] = vi.mocked(assessJevCandidates).mock.calls[0];
    expect(supplied).toBe(key);
    expect(candidates.map(item => item.target)).toEqual(['She', 'bought', 'a', 'book']);
    expect(candidates[candidates.length - 1]).toMatchObject({ sentence: 'She bought a book.', target: 'book', forced: false });
    expect(vi.mocked(resetJevRecognition).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(assessJevCandidates).mock.invocationCallOrder[0]);
  });
  it('TEST返回前密钥变化则拒绝旧结果', async () => {
    vi.mocked(getJevApiKey).mockResolvedValueOnce(key).mockResolvedValueOnce('replacement');
    expect(await dispatch('TEST_JEV_CONNECTION')).toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
  });
  it('迟到密钥读取在相同密钥重新保存后不得再发出识别请求', async () => {
    let release!: (value: string) => void;
    vi.mocked(getJevApiKey).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const testing = dispatch('TEST_JEV_CONNECTION');
    await vi.waitFor(() => expect(getJevApiKey).toHaveBeenCalledOnce());
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key })).toMatchObject({ success: true });
    release(key);
    expect(await testing).toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
    expect(assessJevCandidates).not.toHaveBeenCalled();
  });
  it('删除和同key重设不等待慢TEST，迟到结果仍被拒绝', async () => {
    let release!: () => void;
    vi.mocked(assessJevCandidates).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]); }));
    const testing = dispatch('TEST_JEV_CONNECTION');
    await vi.waitFor(() => expect(assessJevCandidates).toHaveBeenCalledOnce());
    expect(await dispatch('DELETE_JEV_API_KEY')).toMatchObject({ success: true });
    expect(await dispatch('SET_JEV_API_KEY', { apiKey: key })).toMatchObject({ success: true });
    release();
    expect(await testing).toEqual({ success: false, error: 'JEV_CREDENTIALS_CHANGED' });
  });
  it.each(['GET_JEV_STATUS', 'SET_JEV_API_KEY', 'DELETE_JEV_API_KEY', 'TEST_JEV_CONNECTION'] as const)(
    '%s异常不回显secret', async type => {
      vi.mocked(getJevApiKey).mockRejectedValue(new Error(key));
      vi.mocked(saveJevApiKey).mockRejectedValue(new Error(key));
      vi.mocked(clearJevApiKey).mockRejectedValue(new Error(key));
      const response = await dispatch(type, { apiKey: key });
      expect(response).toMatchObject({ success: false });
      expect(JSON.stringify(response)).not.toContain(key);
    },
  );
});
