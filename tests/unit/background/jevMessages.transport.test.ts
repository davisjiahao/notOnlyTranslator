import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleJevMessage } from '@/background/jevMessages';
import { getJevApiKey } from '@/background/jevCredentials';
import { resetJevRecognition } from '@/background/jevRecognition';
import { StorageManager } from '@/background/storage';
import { DEFAULT_SETTINGS } from '@/shared/constants';

vi.mock('@/background/storage', () => ({ StorageManager: { getSettings: vi.fn() } }));

vi.mock('@/background/jevCredentials', async importOriginal => ({
  ...await importOriginal<typeof import('@/background/jevCredentials')>(),
  getJevApiKey: vi.fn(),
}));

const key = 'jev-transport-synthetic-secret';
const sender = { id: 'jev-test', url: 'chrome-extension://jev-test/src/options/index.html' };
beforeEach(() => {
  resetJevRecognition();
  vi.mocked(StorageManager.getSettings).mockResolvedValue(DEFAULT_SETTINGS);
  vi.mocked(getJevApiKey).mockResolvedValue(key);
  vi.stubGlobal('chrome', {
    runtime: { id: 'jev-test', getURL: (path: string) => `chrome-extension://jev-test/${path}` },
    permissions: { contains: vi.fn().mockResolvedValue(true) },
  });
});
afterEach(() => { resetJevRecognition(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('连接测试通过真实识别与transport向固定目标发送合成B1样本，每次测试不复用缓存', async () => {
  const fetch = vi.fn(async (_url: string, _options: RequestInit) => {
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: Object.fromEntries(
      ['j0', 'j4', 'j11', 'j13'].map(id => [id, { type: 'noul', noul: 0.05 }]),
    ), usage: { input_tokens: 10, output_tokens: 1 }, reflected: key }));
  });
  vi.stubGlobal('fetch', fetch);
  for (let i = 0; i < 2; i++) {
    expect(await handleJevMessage({ type: 'TEST_JEV_CONNECTION' }, sender))
      .toEqual({ success: true, data: { connected: true, model: 'jev-1.13.0' } });
  }
  expect(fetch).toHaveBeenCalledTimes(2);
  for (const [url, options] of fetch.mock.calls) {
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(options.headers).toMatchObject({ Authorization: `Bearer ${key}` });
    expect(options.redirect).toBe('error');
    const request = JSON.parse(options.body as string);
    expect(JSON.parse(request.state)).toEqual({ items: [
      { id: 'j0', sentence: 'She bought a book.', target: 'She', start: 0, end: 3, learnerLevel: 'B1' },
      { id: 'j4', sentence: 'She bought a book.', target: 'bought', start: 4, end: 10, learnerLevel: 'B1' },
      { id: 'j11', sentence: 'She bought a book.', target: 'a', start: 11, end: 12, learnerLevel: 'B1' },
      { id: 'j13', sentence: 'She bought a book.', target: 'book', start: 13, end: 17, learnerLevel: 'B1' },
    ] });
  }
});

it('自定义配置经真实识别transport使用实际endpoint和model，主机权限保持对应', async () => {
  const config = { provider: 'custom' as const, apiUrl: 'https://recognition.example/v2/systemone', model: 'custom-jev', threshold: 0.7 };
  vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...DEFAULT_SETTINGS, jevConfig: config });
  const fetch = vi.fn(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string);
    return new Response(JSON.stringify({ model: request.model, answers: Object.fromEntries(
      ['j0', 'j4', 'j11', 'j13'].map(id => [id, { type: 'noul', noul: 0.1 }]),
    ) }));
  });
  vi.stubGlobal('fetch', fetch);
  expect(await handleJevMessage({ type: 'TEST_JEV_CONNECTION' }, sender))
    .toEqual({ success: true, data: { connected: true, model: config.model } });
  expect(chrome.permissions.contains).toHaveBeenCalledWith({ origins: ['https://recognition.example/*'] });
  expect(getJevApiKey).toHaveBeenCalledWith(config);
  expect(fetch).toHaveBeenCalledOnce();
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(config.apiUrl);
  expect(JSON.parse(options.body as string).model).toBe(config.model);
  expect(options.redirect).toBe('error');
});

it('真实transport的HTTP错误与响应正文不能进入连接测试回包', async () => {
  const fetch = vi.fn(async () => new Response(key, { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  const response = await handleJevMessage({ type: 'TEST_JEV_CONNECTION' }, sender);
  expect(response).toEqual({ success: false, error: 'JEV_OPERATION_FAILED' });
  expect(JSON.stringify(response)).not.toContain(key);
  expect(fetch).toHaveBeenCalledOnce();
});
