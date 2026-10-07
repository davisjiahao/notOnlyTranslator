import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import HybridTranslationSettings from '@/options/components/HybridTranslationSettings';
import { StorageManager } from '@/background/storage';
import { HybridTranslationService } from '@/background/hybridTranslation';

vi.mock('@/background/enhancedCache', () => ({ enhancedCache: {
  generateHash: vi.fn(() => 'test-cache-key'),
  get: vi.fn(async () => null),
  getGeneration: vi.fn(() => 0),
  set: vi.fn(async () => undefined),
} }));
vi.mock('@/shared/performance', () => ({
  MetricType: { API_RESPONSE_TIME: 'api', TRANSLATION_TOTAL_TIME: 'total' },
  recordMetric: vi.fn(),
}));
vi.mock('@/shared/utils', async () => ({
  ...await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils'),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const DEEPL_KEY = 'DEEPL_ONLY_LOCAL_TEST_KEY';
const GOOGLE_KEY = 'GOOGLE_ONLY_LOCAL_TEST_KEY';
const initial: UserSettings = {
  ...DEFAULT_SETTINGS,
  apiConfigs: [],
  hybridTranslation: {
    ...DEFAULT_SETTINGS.hybridTranslation!,
    enabled: true,
    defaultEngine: 'traditional',
    traditionalProvider: 'deepl',
    traditionalApiKey: DEEPL_KEY,
  },
};
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  let stored: Record<string, unknown> = { settings: initial };
  const get = vi.fn(async (keys: string | string[]) => Object.fromEntries(
    (Array.isArray(keys) ? keys : [keys]).map(key => [key, stored[key]]),
  ));
  const set = vi.fn(async (updates: Record<string, unknown>) => { stored = { ...stored, ...updates }; });
  vi.stubGlobal('chrome', { storage: { sync: { get, set }, local: { get: vi.fn(async () => ({})) } } });
  // 保留真实翻译服务、请求构造及传输层，仅替换最终 fetch，绝不接触真实 API。
  fetchMock.mockImplementation(async input => {
    const host = new URL(String(input)).hostname;
    if (host === 'translation.googleapis.com') {
      return new Response(JSON.stringify({ data: { translations: [{ translatedText: '本地谷歌译文' }] } }));
    }
    if (host === 'api-free.deepl.com' || host === 'api.deepl.com') {
      return new Response(JSON.stringify({ translations: [{ text: '本地 DeepL 译文' }] }));
    }
    throw new Error('本地测试禁止未声明的网络请求');
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const flows = [
  { name: '快速翻译', run: () => HybridTranslationService.quickTranslate('Hello world') },
  { name: '传统翻译', run: async () => (await HybridTranslationService.translate({
    text: 'Hello world', mode: 'bilingual', userLevel: DEFAULT_USER_PROFILE,
  })).fullText },
];

async function switchViaUI() {
  const current = await StorageManager.getSettings();
  const onUpdate = vi.fn(async (
    updates: Partial<UserSettings> & { hybridTranslationPatch?: Partial<NonNullable<UserSettings['hybridTranslation']>> },
    expectedHybridCredentialsRevision?: number,
  ) => {
    await StorageManager.updateSettings(updates, undefined, expectedHybridCredentialsRevision);
  });
  const view = render(<HybridTranslationSettings settings={current} onUpdate={onUpdate} isSaving={false} />);
  fireEvent.click(screen.getByRole('button', { name: /Google Translate/ }));
  await waitFor(() => expect(onUpdate).toHaveResolved());
  const saved = await StorageManager.getSettings();
  view.rerender(<HybridTranslationSettings settings={saved} onUpdate={onUpdate} isSaving={false} />);
  return onUpdate;
}

function expectGoogleKeyOnly() {
  expect(fetchMock).toHaveBeenCalledOnce();
  const [url, init] = fetchMock.mock.calls[0];
  expect(new URL(String(url)).hostname).toBe('translation.googleapis.com');
  expect(new URL(String(url)).searchParams.get('key')).toBe(GOOGLE_KEY);
  expect(JSON.stringify([String(url), init])).not.toContain(DEEPL_KEY);
}

describe.each(flows)('真实 UI/存储/传输链路：$name', ({ run }) => {
  it('真实切换 Google 后没有 Google 密钥时，不能外发 DeepL 密钥', async () => {
    await switchViaUI();
    const result = await run().catch(error => error);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Error);
    expect(screen.getByLabelText('Google Translate API 密钥')).toHaveValue('');
    expect(screen.getByRole('button', { name: /Google Translate/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('切换后用户输入新的 Google 密钥，真实传输仅使用新密钥', async () => {
    const onUpdate = await switchViaUI();
    fireEvent.change(screen.getByLabelText('Google Translate API 密钥'), { target: { value: GOOGLE_KEY } });
    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));
    await waitFor(() => expect(onUpdate).toHaveResolvedTimes(2));

    expect(await run()).toBe('本地谷歌译文');
    expectGoogleKeyOnly();
  });

  it('切换后可使用 Google 显式配置，但不得让旧独立密钥遮蔽它', async () => {
    await StorageManager.updateSettings({
      // 激活的 LLM 配置无密钥，避免传统翻译完成后额外发出词汇分析请求。
      activeApiConfigId: 'llm',
      apiConfigs: [
        { id: 'llm', name: 'LLM', provider: 'openai', apiKey: '', tested: false, createdAt: 0 },
        { id: 'google', name: 'Google', provider: 'google_translate', apiKey: GOOGLE_KEY, tested: false, createdAt: 0 },
      ],
    }, 0);
    await switchViaUI();

    expect(await run()).toBe('本地谷歌译文');
    expectGoogleKeyOnly();
  });

  it.each(['saveSettings', 'updateSettings', 'importData'] as const)('绕过 UI，通过 %s 切换并复制旧键也不能外发', async writer => {
    const next: UserSettings = {
      ...initial,
      hybridTranslation: { ...initial.hybridTranslation!, traditionalProvider: 'google_translate' },
    };
    if (writer === 'importData') await StorageManager.importData({ settings: next });
    else if (writer === 'updateSettings') await StorageManager.updateSettings(next, 0, 0);
    else await StorageManager.saveSettings(next);

    const result = await run().catch(error => error);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBeInstanceOf(Error);
  });

  it('旧版 DeepL 配对与同提供商密钥编辑仍发往 DeepL，不改变请求协议', async () => {
    await StorageManager.updateSettings({
      hybridTranslationPatch: { traditionalApiKey: 'DEEPL_EDITED_LOCAL_KEY' },
    }, undefined, 0);

    expect(await run()).toBe('本地 DeepL 译文');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(new URL(String(url)).hostname).toMatch(/^api(-free)?\.deepl\.com$/);
    expect(new Headers(init?.headers).get('Authorization')).toBe('DeepL-Auth-Key DEEPL_EDITED_LOCAL_KEY');
    expect(new URL(String(url)).searchParams.has('key')).toBe(false);
  });

  it('旧格式导入明确的新 Google 密钥仍然可用', async () => {
    await StorageManager.importData({ settings: {
      hybridTranslation: {
        ...initial.hybridTranslation!, traditionalProvider: 'google_translate', traditionalApiKey: GOOGLE_KEY,
      },
    } });

    expect(await run()).toBe('本地谷歌译文');
    expectGoogleKeyOnly();
  });
});
