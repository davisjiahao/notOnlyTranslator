import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageManager } from '@/background/storage';
import WelcomeModal from '@/popup/components/WelcomeModal';
import WelcomeModalExperiment from '@/shared/components/WelcomeModalExperiment';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { ApiConfig, Message, UserSettings } from '@/shared/types';

vi.mock('@/shared/analytics/init', () => ({ trackEvent: vi.fn() }));

const existingConfig: ApiConfig = {
  id: 'existing', name: '已有配置', provider: 'openai',
  apiKey: 'sk-existing-local-test-only', tested: false, createdAt: 1,
};
const newerConfig: ApiConfig = { ...existingConfig, id: 'newer', name: '其他窗口的新配置' };
let syncData: Record<string, unknown>;
const sendMessage = vi.fn();
const fetchMock = vi.fn(() => { throw new Error('测试禁止真实网络请求'); });

// 仅替换消息传输与 Chrome 存储，版本校验和保存始终使用真实 StorageManager。
async function dispatch(message: Message) {
  try {
    switch (message.type) {
      case 'GET_SETTINGS':
        return { success: true, data: await StorageManager.getSettings() };
      case 'UPDATE_SETTINGS':
        await StorageManager.updateSettings(message.payload as Partial<UserSettings>, message.expectedApiConfigsRevision);
        return { success: true, data: await StorageManager.getSettings() };
      case 'TEST_API_CONNECTION':
        return { success: true };
      default:
        throw new Error('测试收到未声明的消息');
    }
  } catch {
    return { success: false, error: '保存失败，请重新加载设置后重试' };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  sendMessage.mockImplementation(dispatch);
  syncData = { settings: { ...DEFAULT_SETTINGS, apiConfigs: [], apiConfigsRevision: 0, activeApiConfigId: null } };
  let localData: Record<string, string> = { not_onboarding_experiment_group: 'B' };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => localData[key] ?? null,
    setItem: (key: string, value: string) => { localData = { ...localData, [key]: value }; },
  });
  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    storage: {
      sync: {
        get: vi.fn(async () => structuredClone(syncData)),
        set: vi.fn(async (updates: Record<string, unknown>) => { syncData = { ...syncData, ...structuredClone(updates) }; }),
      },
    },
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Caller = 'popup' | 'experiment';

async function openSetup(caller: Caller) {
  const onComplete = vi.fn();
  if (caller === 'popup') {
    const settings = await StorageManager.getSettings();
    render(<WelcomeModal settings={settings} onComplete={onComplete} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '开始配置' }));
  } else {
    render(<WelcomeModalExperiment isOpen onComplete={onComplete} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '开始设置' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  }
  fireEvent.change(screen.getByLabelText(caller === 'popup' ? 'API Key' : 'API 密钥'), {
    target: { value: '  sk-welcome-local-test-only  ' },
  });
  return onComplete;
}

async function save(caller: Caller) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: caller === 'popup' ? '完成配置' : '测试并保存' }));
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(1200); });
}

describe.each<Caller>(['popup', 'experiment'])('%s 欢迎引导的真实版本校验', caller => {
  it.each([0, 7])('使用版本 %i 的同一快照保存，保留已有配置和并发更新的普通设置', async revision => {
    const configs = revision === 0 ? [] : [existingConfig];
    syncData = { settings: { ...DEFAULT_SETTINGS, apiConfigs: configs, apiConfigsRevision: revision, activeApiConfigId: null } };
    await openSetup(caller);
    await StorageManager.updateSettings({ theme: 'dark' });

    await save(caller);

    const saved = await StorageManager.getSettings();
    expect(saved.apiConfigs).toEqual([
      ...configs,
      expect.objectContaining({ apiKey: 'sk-welcome-local-test-only', tested: true, provider: 'openai' }),
    ]);
    expect(saved.apiConfigsRevision).toBe(revision + 1);
    expect(saved.activeApiConfigId).toBe(saved.apiConfigs?.at(-1)?.id);
    expect(saved.theme).toBe('dark');
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: revision,
      payload: { apiConfigs: saved.apiConfigs, activeApiConfigId: saved.activeApiConfigId, apiProvider: 'openai' },
    });
    expect(screen.getByRole('heading', { name: caller === 'popup' ? '配置成功！' : '设置完成！' })).toBeInTheDocument();
    expect(configs).toEqual(revision === 0 ? [] : [existingConfig]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('加载后配置被其他窗口替换时拒绝旧版本，不复活旧配置也不进入成功页', async () => {
    syncData = { settings: { ...DEFAULT_SETTINGS, apiConfigs: [existingConfig], apiConfigsRevision: 7, activeApiConfigId: null } };
    const onComplete = await openSetup(caller);
    const replaceFromOtherWindow = () => StorageManager.updateSettings({
      apiConfigs: [newerConfig], activeApiConfigId: newerConfig.id,
    }, 7);
    if (caller === 'popup') {
      await replaceFromOtherWindow();
    } else {
      sendMessage.mockImplementation(async (message: Message) => {
        const response = await dispatch(message);
        // 在返回快照后、提交前制造竞争，防止将新版本配给旧数组。
        if (message.type === 'GET_SETTINGS') await replaceFromOtherWindow();
        return response;
      });
    }

    await save(caller);

    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.queryByRole('heading', { name: /配置成功！|设置完成！/ })).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    expect(await StorageManager.getSettings()).toMatchObject({
      apiConfigs: [newerConfig], activeApiConfigId: newerConfig.id, apiConfigsRevision: 8,
    });
    const writes = sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS');
    expect(writes).toHaveLength(1);
    expect(writes[0][0].expectedApiConfigsRevision).toBe(7);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it('免费试用只更新提供商，旧快照不会覆盖其他窗口的新配置或普通设置', async () => {
  syncData = { settings: { ...DEFAULT_SETTINGS, apiConfigs: [existingConfig], apiConfigsRevision: 7, activeApiConfigId: null } };
  const settings = await StorageManager.getSettings();
  render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
  await StorageManager.updateSettings({ apiConfigs: [newerConfig], activeApiConfigId: newerConfig.id, theme: 'dark' }, 7);

  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '无需 API Key，立即体验' })); });

  expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'UPDATE_SETTINGS', payload: { apiProvider: 'free_google_translate' },
  });
  expect(syncData.settings).toMatchObject({
    apiProvider: 'free_google_translate', apiConfigs: [newerConfig], activeApiConfigId: newerConfig.id,
    apiConfigsRevision: 8, theme: 'dark',
  });
  expect(settings.apiConfigs).toEqual([existingConfig]);
  expect(screen.getByRole('heading', { name: '已开启免费翻译' })).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
