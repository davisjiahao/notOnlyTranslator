import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Message, MessageResponse, UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import HybridTranslationSettings from '@/options/components/HybridTranslationSettings';
import App from '@/options/App';

vi.mock('@/shared/components/welcomeModalUtils', () => ({ shouldShowWelcomeModal: () => false }));
vi.mock('@/options/components/LevelSelector', () => ({ default: () => null }));
vi.mock('@/shared/components/WelcomeModalExperiment', () => ({ default: () => null }));

vi.mock('@/shared/utils', async importOriginal => ({
  ...await importOriginal<typeof import('@/shared/utils')>(),
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  useTheme: vi.fn(),
}));

const OLD_KEY = 'DEEPL_STALE_LOCAL_TEST_KEY';
const initial: UserSettings & { hybridCredentialsRevision?: number } = {
  ...DEFAULT_SETTINGS,
  hybridCredentialsRevision: 7,
  autoHighlight: false,
  vocabHighlightEnabled: false,
  hybridTranslation: {
    ...DEFAULT_SETTINGS.hybridTranslation!, enabled: true, defaultEngine: 'hybrid', traditionalApiKey: OLD_KEY,
  },
};
let syncData: Record<string, unknown>;
let localData: Record<string, unknown>;
let backgroundListener: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let Translator: typeof import('@/content/index').NotOnlyTranslator;
let translator: import('@/content/index').NotOnlyTranslator | undefined;
const sync = {
  get: vi.fn(async () => structuredClone(syncData)),
  set: vi.fn(async (updates: Record<string, unknown>) => { syncData = { ...syncData, ...structuredClone(updates) }; }),
};
const local = {
  get: vi.fn(async () => structuredClone(localData)),
  set: vi.fn(async (updates: Record<string, unknown>) => { localData = { ...localData, ...structuredClone(updates) }; }),
  remove: vi.fn(),
};

function dispatch(message: Message): Promise<MessageResponse<UserSettings>> {
  return new Promise(resolve => {
    expect(backgroundListener(message, {} as chrome.runtime.MessageSender, resolve)).toBe(true);
  });
}

const sendMessage = vi.fn((message: Message, callback?: (response: MessageResponse) => void) => {
  const response = dispatch(message);
  if (callback) void response.then(callback);
  return response;
});

beforeAll(async () => {
  vi.resetModules();
  // 先导入内容脚本，避免浏览器 API 就绪后模块自动创建第二个实例。
  vi.stubGlobal('chrome', undefined);
  ({ NotOnlyTranslator: Translator } = await import('@/content/index'));
  syncData = {};
  localData = {};
  const event = { addListener: vi.fn(), removeListener: vi.fn() };
  vi.stubGlobal('chrome', {
    storage: { sync, local, onChanged: event },
    alarms: {
      get: vi.fn((_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => callback()),
      create: vi.fn(), onAlarm: event,
    },
    runtime: {
      lastError: null, onInstalled: event, sendMessage,
      onMessage: {
        addListener: vi.fn((listener: typeof backgroundListener) => { backgroundListener ??= listener; }),
        removeListener: vi.fn(),
      },
    },
    contextMenus: { create: vi.fn(), onClicked: event },
    commands: { onCommand: event }, notifications: { onClicked: event },
    // 模拟尚未收到广播的旧窗口；后台消息处理及存储合并保持真实。
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn() },
  });
  vi.stubGlobal('IntersectionObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
  await import('@/background/index');
  await vi.waitFor(() => expect(local.set).toHaveBeenCalledWith(
    expect.objectContaining({ pendingTranslationRequests: { requests: {} } }),
  ));
});

beforeEach(() => {
  syncData = { settings: structuredClone(initial) };
  localData = {};
  document.documentElement.lang = 'en';
  document.body.innerHTML = `<article><p>${'This English article explains translation settings and stale browser windows. '.repeat(30)}</p></article>`;
  delete document.body.dataset.extensionLoaded;
  vi.clearAllMocks();
});

afterEach(() => {
  translator?.destroy();
  translator = undefined;
  cleanup();
  document.body.innerHTML = '';
  expect(fetch).not.toHaveBeenCalled();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function changeInAnotherWindow(traditionalProvider: 'deepl' | 'google_translate', traditionalApiKey: string) {
  // 另一窗口显式恢复设置；使用既有消息建立权威状态，不在测试中模拟 patch 合并。
  const response = await dispatch({
    type: 'REPLACE_SETTINGS',
    payload: {
      ...initial,
      hybridTranslation: { ...initial.hybridTranslation!, traditionalProvider, traditionalApiKey, simpleTextThreshold: 45 },
    },
  });
  expect(response.success).toBe(true);
  const latest = (await dispatch({ type: 'GET_SETTINGS' })).data!;
  expect(latest.hybridTranslation).toMatchObject({ traditionalProvider, traditionalApiKey, simpleTextThreshold: 45 });
  return latest;
}

const otherWindows = [
  { name: '另一窗口清空同提供商密钥', provider: 'deepl' as const, key: '' },
  { name: '另一窗口切换提供商并保存新密钥', provider: 'google_translate' as const, key: 'GOOGLE_CURRENT_LOCAL_TEST_KEY' },
];

describe('客户端最小 patch 到真实后台和存储的集成', () => {
  it('真实设置页将显式密钥修改的快照版本转发到消息顶层', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: '翻译引擎' }));
    const input = await screen.findByLabelText('DeepL API 密钥');
    sendMessage.mockClear();

    fireEvent.change(input, { target: { value: 'DEEPL_NEW_LOCAL_TEST_KEY' } });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));

    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS').map(([message]) => message)).toEqual([
      {
        type: 'UPDATE_SETTINGS', expectedHybridCredentialsRevision: 7,
        payload: { hybridTranslationPatch: { traditionalApiKey: 'DEEPL_NEW_LOCAL_TEST_KEY' } },
      },
    ]));
    await vi.waitFor(() => expect(syncData.settings).toMatchObject({
      hybridCredentialsRevision: 8,
      hybridTranslation: { ...initial.hybridTranslation, traditionalApiKey: 'DEEPL_NEW_LOCAL_TEST_KEY' },
    }));
  });

  it.each(otherWindows)('$name 后，旧设置窗口连续调整优先级不能恢复旧密钥或配置', async ({ provider, key }) => {
    const snapshot = (await dispatch({ type: 'GET_SETTINGS' })).data!;
    const onUpdate = vi.fn(async (payload: Partial<UserSettings>) => {
      const response = await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', payload });
      expect(response.success).toBe(true);
    });
    render(<HybridTranslationSettings settings={snapshot} onUpdate={onUpdate} isSaving={false} />);
    const latest = await changeInAnotherWindow(provider, key);

    // 维持旧 props，模拟尚未刷新且反复操作的旧窗口。
    fireEvent.click(screen.getByRole('button', { name: /速度优先/ }));
    await waitFor(() => expect(onUpdate).toHaveResolvedTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /质量优先/ }));
    await waitFor(() => expect(onUpdate).toHaveResolvedTimes(2));

    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'UPDATE_SETTINGS', payload: { hybridTranslationPatch: { priority: 'speed' } } },
      { type: 'UPDATE_SETTINGS', payload: { hybridTranslationPatch: { priority: 'quality' } } },
    ]);
    const saved = (await dispatch({ type: 'GET_SETTINGS' })).data!;
    expect(saved.hybridTranslation).toEqual({ ...latest.hybridTranslation, priority: 'quality' });
    expect(saved).not.toHaveProperty('hybridTranslationPatch');
    expect(JSON.stringify(saved.hybridTranslation)).not.toContain(OLD_KEY);
    expect(snapshot.hybridTranslation?.traditionalApiKey).toBe(OLD_KEY);
  });

  it.each(otherWindows)('$name 后，旧内容脚本通过真实浮动按钮只保存引擎', async ({ provider, key }) => {
    translator = new Translator();
    await vi.waitFor(() => expect(document.body.dataset.extensionLoaded).toBe('true'));
    const latest = await changeInAnotherWindow(provider, key);
    sendMessage.mockClear();
    const button = document.querySelector<HTMLButtonElement>('[data-engine="traditional"]');
    expect(button).not.toBeNull();

    fireEvent.click(button!);

    await vi.waitFor(async () => {
      const saved = (await dispatch({ type: 'GET_SETTINGS' })).data!;
      expect(saved.hybridTranslation).toEqual({ ...latest.hybridTranslation, defaultEngine: 'traditional' });
      expect(saved).not.toHaveProperty('hybridTranslationPatch');
    });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS').map(([message]) => message)).toEqual([
      { type: 'UPDATE_SETTINGS', payload: { hybridTranslationPatch: { defaultEngine: 'traditional' } } },
    ]);
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });
});
