import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig, Message, MessageResponse, UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants';

const configA: ApiConfig = {
  id: 'a', name: '配置 A', provider: 'openai', apiKey: 'TEST_ONLY_KEY_A', tested: false, createdAt: 1,
};
const configB: ApiConfig = { ...configA, id: 'b', name: '配置 B', apiKey: 'TEST_ONLY_KEY_B' };
let syncData: Record<string, unknown>;
let localData: Record<string, unknown> = {};
let onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
const sync = {
  get: vi.fn(async (_keys: unknown) => structuredClone(syncData)),
  set: vi.fn(async (updates: Record<string, unknown>) => { syncData = { ...syncData, ...structuredClone(updates) }; }),
};
const local = {
  get: vi.fn(async (_keys: unknown) => structuredClone(localData)),
  set: vi.fn(async (updates: Record<string, unknown>) => { localData = { ...localData, ...structuredClone(updates) }; }),
  remove: vi.fn(),
};

function dispatch(message: Message): Promise<MessageResponse<UserSettings>> {
  return new Promise(resolve => {
    expect(onMessage(message, {} as chrome.runtime.MessageSender, resolve)).toBe(true);
  });
}

beforeAll(async () => {
  vi.resetModules();
  syncData = {};
  const event = { addListener: vi.fn() };
  vi.stubGlobal('chrome', {
    storage: { sync, local },
    alarms: {
      get: vi.fn((_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => callback()),
      create: vi.fn(), onAlarm: event,
    },
    runtime: {
      onInstalled: event,
      onMessage: { addListener: vi.fn((listener: typeof onMessage) => { onMessage = listener; }) },
      sendMessage: vi.fn((message: Message) => dispatch(message)),
      openOptionsPage: vi.fn(),
    },
    contextMenus: { create: vi.fn(), onClicked: event },
    commands: { onCommand: event },
    notifications: { onClicked: event },
    tabs: { query: vi.fn().mockResolvedValue([{ id: 1 }]), sendMessage: vi.fn().mockResolvedValue(undefined) },
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
  await import('@/background/index');
  await vi.waitFor(() => expect(local.set).toHaveBeenCalledWith(
    expect.objectContaining({ pendingTranslationRequests: { requests: {} } }),
  ));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

beforeEach(() => {
  syncData = {
    settings: { ...DEFAULT_SETTINGS, apiConfigs: [configA, configB], activeApiConfigId: configA.id },
  };
  vi.clearAllMocks();
});

describe('后台设置消息的 API 配置版本契约', () => {
  it('GET_SETTINGS 为旧设置返回版本 0，匹配版本保存后返回完整权威快照和新版本', async () => {
    expect((await dispatch({ type: 'GET_SETTINGS' })).data?.apiConfigsRevision).toBe(0);
    const response = await dispatch({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
      payload: { apiConfigs: [configB], activeApiConfigId: configB.id },
    });

    expect(response).toMatchObject({
      success: true,
      data: { apiConfigs: [configB], activeApiConfigId: configB.id, apiConfigsRevision: 1 },
    });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledExactlyOnceWith(1, { type: 'SETTINGS_UPDATED' });
  });

  it('拒绝旧窗口快照并返回可展示的错误，不通知标签页或复活已删除配置', async () => {
    await dispatch({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
      payload: { apiConfigs: [configB], activeApiConfigId: configB.id },
    });
    vi.clearAllMocks();
    const response = await dispatch({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
      payload: { apiConfigs: [configA, { ...configB, name: '旧窗口编辑' }], activeApiConfigId: configA.id },
    });

    expect(response).toMatchObject({ success: false, error: expect.stringMatching(/刷新|重新加载/) });
    expect(sync.set).not.toHaveBeenCalled();
    expect(chrome.tabs.sendMessage).not.toHaveBeenCalled();
    expect(syncData.settings).toMatchObject({ apiConfigs: [configB], activeApiConfigId: configB.id });
    expect(JSON.stringify(response)).not.toContain(configA.apiKey);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('设置载荷自带版本不能替代消息的预期版本，普通设置仍可无版本更新', async () => {
    const response = await dispatch({
      type: 'UPDATE_SETTINGS', payload: { apiConfigs: [configB], apiConfigsRevision: 0 },
    });
    expect(response).toMatchObject({ success: false, error: expect.any(String) });
    expect(sync.set).not.toHaveBeenCalled();

    expect(await dispatch({ type: 'UPDATE_SETTINGS', payload: { theme: 'dark' } })).toEqual({ success: true });
    expect(syncData.settings).toMatchObject({ apiConfigs: [configA, configB], theme: 'dark' });
  });

  it.each([0, 999])('REPLACE_SETTINGS 明确恢复备份但忽略备份版本 %i，后台版本持续递增', async backupRevision => {
    syncData = { settings: { ...DEFAULT_SETTINGS, apiConfigs: [configB], apiConfigsRevision: 7 } };
    const response = await dispatch({
      type: 'REPLACE_SETTINGS',
      payload: { enabled: false, apiConfigs: [configA], activeApiConfigId: configA.id, apiConfigsRevision: backupRevision },
    });

    expect(response.success).toBe(true);
    expect(syncData.settings).toMatchObject({ enabled: false, apiConfigs: [configA], apiConfigsRevision: 8 });
    const stale = await dispatch({ type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 7, payload: { apiConfigs: [configB] } });
    expect(stale.success).toBe(false);
    const current = await dispatch({ type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 8, payload: { apiConfigs: [configB] } });
    expect(current).toMatchObject({ success: true, data: { apiConfigs: [configB], apiConfigsRevision: 9 } });
  });
});
