import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ApiConfig, Message, MessageResponse, UserSettings } from '@/shared/types';
import { CONTEXT_MENU_IDS, DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import { clearAllData } from '@/shared/utils/dataExport';
import { StorageManager } from '@/background/storage';
import DataManager from '@/options/components/DataManager';
import GeneralSettings from '@/options/components/GeneralSettings';

const configA: ApiConfig = {
  id: 'a', name: '配置 A', provider: 'openai', apiKey: 'TEST_ONLY_A_SECRET', tested: false, createdAt: 1,
};
const configB: ApiConfig = { ...configA, id: 'b', apiKey: 'TEST_ONLY_B_SECRET' };
let syncData: Record<string, unknown> = {};
let localData: Record<string, unknown> = {};
let historyData: unknown[] = [];
const clearHistory = vi.fn(async () => { historyData = []; });
let onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let onAlarm: Parameters<typeof chrome.alarms.onAlarm.addListener>[0];
let onContextMenu: Parameters<typeof chrome.contextMenus.onClicked.addListener>[0];
const sync = {
  get: vi.fn(async (_keys: unknown) => structuredClone(syncData)),
  set: vi.fn(async (updates: Record<string, unknown>) => { syncData = { ...syncData, ...structuredClone(updates) }; }),
  clear: vi.fn(async () => { syncData = {}; }),
  remove: vi.fn(async (keys: string | string[]) => {
    const removed = Array.isArray(keys) ? keys : [keys];
    syncData = Object.fromEntries(Object.entries(syncData).filter(([key]) => !removed.includes(key)));
  }),
};
const local = {
  get: vi.fn(async (_keys: unknown) => structuredClone(localData)),
  set: vi.fn(async (updates: Record<string, unknown>) => { localData = { ...localData, ...structuredClone(updates) }; }),
  clear: vi.fn(async () => { localData = {}; }),
  remove: vi.fn(async (keys: string | string[]) => {
    const removed = Array.isArray(keys) ? keys : [keys];
    localData = Object.fromEntries(Object.entries(localData).filter(([key]) => !removed.includes(key)));
  }),
};

function dispatch(message: Message): Promise<MessageResponse<UserSettings>> {
  return new Promise(resolve => {
    expect(onMessage(message, {} as chrome.runtime.MessageSender, resolve)).toBe(true);
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function assertDeleted() {
  const settings = (await dispatch({ type: 'GET_SETTINGS' })).data!;
  expect(settings.apiConfigs).toEqual([]);
  expect(settings.activeApiConfigId).toBeFalsy();
  expect(settings.hybridTranslation?.traditionalApiKey).toBeFalsy();
  expect(await StorageManager.getApiKey()).toBe('');
  // 只允许留下不可回退的版本墓碑，不能以保留设置为名留下密钥或其他用户数据。
  expect(syncData).toEqual({ settings: {
    apiConfigsRevision: settings.apiConfigsRevision, hybridCredentialsRevision: settings.hybridCredentialsRevision,
  } });
  expect(localData).toEqual({});
  expect(historyData).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
}

beforeAll(async () => {
  const event = { addListener: vi.fn() };
  vi.stubGlobal('chrome', {
    storage: { sync, local },
    alarms: {
      get: vi.fn((_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => callback()),
      create: vi.fn(), onAlarm: { addListener: vi.fn((listener: typeof onAlarm) => { onAlarm = listener; }) },
    },
    runtime: {
      id: 'offline-test-extension',
      getURL: (path: string) => `chrome-extension://offline-test-extension/${path}`,
      onInstalled: event,
      onMessage: { addListener: vi.fn((listener: typeof onMessage) => { onMessage = listener; }) },
      sendMessage: vi.fn((message: Message) => dispatch(message)),
      openOptionsPage: vi.fn(),
    },
    contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn((listener: typeof onContextMenu) => { onContextMenu = listener; }) } },
    commands: { onCommand: event },
    notifications: { onClicked: event },
    tabs: {
      query: vi.fn((_query: unknown, callback?: (tabs: chrome.tabs.Tab[]) => void) => {
        callback?.([]);
        return Promise.resolve([]);
      }),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    },
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
  // 仅替换浏览器数据库 API，保留真实 clearAllHistory 的事务完成/失败语义。
  const database = {
    transaction: vi.fn(() => {
      const transaction = { oncomplete: () => {}, onerror: () => {}, objectStore: () => ({
        clear: () => {
          void Promise.resolve().then(clearHistory).then(() => transaction.oncomplete(), () => transaction.onerror());
          return {};
        },
      }) };
      return transaction;
    }),
  };
  vi.stubGlobal('indexedDB', { open: vi.fn(() => {
    const request = { result: database, onsuccess: () => {} };
    queueMicrotask(() => request.onsuccess());
    return request;
  }) });
  await import('@/background/index');
  await vi.waitFor(() => expect(local.set).toHaveBeenCalledWith(
    expect.objectContaining({ pendingTranslationRequests: { requests: {} } }),
  ));
});

beforeEach(() => {
  historyData = [{ originalText: '私人正文', translation: '私人译文' }];
  syncData = {
    settings: {
      ...DEFAULT_SETTINGS, apiConfigs: [configA, configB], activeApiConfigId: configA.id,
      hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation, traditionalApiKey: 'TEST_ONLY_TRADITIONAL_SECRET' },
    },
    apiKey: 'TEST_ONLY_LEGACY_SECRET', userProfile: { ...DEFAULT_USER_PROFILE },
    legacyApiKeyInvalidated: true, anotherUserSetting: '测试个人数据',
  };
  localData = {
    knownWords: ['private'], unknownWords: [{ word: 'secret' }], masteryProfile: { private: true },
    translationCache: { private: '私人译文' }, pendingTranslationRequests: { private: '旧请求' },
    translationHistory: ['私人历史'], arbitraryUserData: '需要删除',
  };
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
afterAll(() => vi.unstubAllGlobals());

describe('真实清空入口 → 后台消息 → 持久版本及写入队列', () => {
  it.each([0, 8])('清空版本 %i 后拒绝旧窗口恢复 [A,B]，只留下非敏感版本墓碑', async revision => {
    syncData = { ...syncData, settings: { ...(syncData.settings as UserSettings), apiConfigsRevision: revision } };
    const stale = (await dispatch({ type: 'GET_SETTINGS' })).data!;
    await clearAllData();
    const response = await dispatch({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: stale.apiConfigsRevision,
      payload: { apiConfigs: stale.apiConfigs, activeApiConfigId: configA.id },
    });
    expect(response).toMatchObject({ success: false, error: expect.stringMatching(/刷新|重新加载/) });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_ALL_DATA' });
    expect((await StorageManager.getSettings()).apiConfigsRevision).toBeGreaterThan(revision);
    await assertDeleted();
  });

  it('DataManager 的双重确认按钮走真实清空消息链', async () => {
    await act(async () => { render(<DataManager />); });
    await act(async () => { fireEvent.click(screen.getByRole('tab', { name: '高级选项' })); });
    fireEvent.click(screen.getByRole('button', { name: '清除所有数据' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '确定清除' }));
    await screen.findByText('数据已清除，请刷新页面');
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_ALL_DATA' });
    await assertDeleted();
  });

  it('GeneralSettings 的 DELETE 确认不能绕过后台清空', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const settings = await StorageManager.getSettings();
    await act(async () => { render(<GeneralSettings settings={settings} onUpdate={vi.fn()} isSaving={false} />); });
    fireEvent.click(screen.getByRole('button', { name: '清除所有数据' }));
    fireEvent.change(screen.getByLabelText('输入 DELETE 确认删除'), { target: { value: 'DELETE' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确定删除' })); });
    expect(screen.getByText('所有数据已清除，页面即将刷新')).toBeInTheDocument();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'CLEAR_ALL_DATA' });
    await assertDeleted();
  });

  it('清空等待已开始及已排队的设置写入，返回后旧密钥不能回填', async () => {
    const entered = deferred();
    const blocked = deferred();
    const write = sync.set.getMockImplementation()!;
    sync.set.mockImplementationOnce(async updates => {
      entered.resolve();
      await blocked.promise;
      await write(updates);
    });
    const saving = dispatch({ type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0, payload: { apiConfigs: [configA] } });
    await entered.promise;
    const queued = dispatch({ type: 'REPLACE_SETTINGS', payload: { apiConfigs: [configA, configB] } });
    let cleared = false;
    const clearing = clearAllData().then(() => { cleared = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      expect.soft(cleared).toBe(false);
    } finally {
      blocked.resolve();
      await Promise.all([saving, queued, clearing]);
    }
    await assertDeleted();
  });

  it('清空等待档案消息的延迟写入，词表和用户档案不能回填', async () => {
    const entered = deferred();
    const blocked = deferred();
    const write = local.set.getMockImplementation()!;
    local.set.mockImplementationOnce(async updates => {
      entered.resolve();
      await blocked.promise;
      await write(updates);
    });
    const saving = dispatch({ type: 'UPDATE_USER_PROFILE', payload: { estimatedVocabulary: 3210 } });
    await entered.promise;
    const clearing = clearAllData();
    await new Promise(resolve => setTimeout(resolve, 20));
    blocked.resolve();
    await Promise.all([saving, clearing]);
    await assertDeleted();
  });

  it('存储队列中不经过消息的在途设置写入也必须先于清空完成', async () => {
    const entered = deferred();
    const blocked = deferred();
    const write = sync.set.getMockImplementation()!;
    sync.set.mockImplementationOnce(async updates => {
      entered.resolve();
      await blocked.promise;
      await write(updates);
    });
    const saving = StorageManager.replaceSettings({ apiConfigs: [configA] });
    await entered.promise;
    const clearing = clearAllData();
    await new Promise(resolve => setTimeout(resolve, 20));
    blocked.resolve();
    await Promise.all([saving, clearing]);
    await assertDeleted();
  });

  it('清空同步废弃段落与词义内存缓存，并取消旧段落的防抖持久化', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { enhancedCache } = await import('@/background/enhancedCache');
    const { storeWordSense, lookupWord } = await import('@/background/localWordLookup');
    const result = { words: [], sentences: [], fullText: '私人译文', cached: false };
    const generation = enhancedCache.getGeneration();
    await enhancedCache.set('private-paragraph', result, 'bilingual', 'https://private.invalid');
    storeWordSense('bank', '私人语境', '私人词义');
    expect((await lookupWord('bank', { context: '私人语境' }))?.source).toBe('sense_cache');
    await clearAllData();
    await enhancedCache.set('private-paragraph', result, 'bilingual', 'https://private.invalid', 'llm', generation);
    await vi.advanceTimersByTimeAsync(1100);
    await assertDeleted();
    expect(await enhancedCache.get('private-paragraph', 'bilingual')).toBeNull();
    expect((await lookupWord('bank', { context: '私人语境' }))?.source).not.toBe('sense_cache');
  });

  it('清空进行时拒绝新写入消息，重复清空共用同一个屏障', async () => {
    const entered = deferred();
    const blocked = deferred();
    const clear = local.clear.getMockImplementation()!;
    local.clear.mockImplementationOnce(async () => {
      entered.resolve();
      await blocked.promise;
      await clear();
    });
    const first = clearAllData();
    await entered.promise;
    const second = clearAllData();
    try {
      expect(await dispatch({ type: 'REPLACE_SETTINGS', payload: { apiConfigs: [configA] } }))
        .toMatchObject({ success: false, error: expect.stringMatching(/清除/) });
    } finally {
      blocked.resolve();
      await Promise.all([first, second]);
    }
    expect(local.clear).toHaveBeenCalledOnce();
    await assertDeleted();
  });

  it('清空等待闹钟触发的在途请求队列写入，不能回填未过期请求的正文', async () => {
    localData = { ...localData, pendingTranslationRequests: { requests: {
      expired: { id: 'expired', createdAt: 1 },
      active: { id: 'active', createdAt: Date.now(), text: '私人请求正文' },
    } } };
    const entered = deferred();
    const blocked = deferred();
    const write = local.set.getMockImplementation()!;
    local.set.mockImplementationOnce(async updates => {
      entered.resolve();
      await blocked.promise;
      await write(updates);
    });
    onAlarm({ name: 'keep-alive', scheduledTime: Date.now() });
    await entered.promise;
    let done = false;
    const clearing = clearAllData().then(() => { done = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      expect.soft(done).toBe(false);
    } finally {
      blocked.resolve();
      await clearing;
    }
    await assertDeleted();
  });

  it('清空等待取消批量翻译后的迟到队列写入，不能回填旧请求正文', async () => {
    localData = { ...localData, pendingTranslationRequests: { requests: {
      active: { id: 'active', createdAt: Date.now(), text: '私人请求正文' },
    } } };
    const entered = deferred();
    const blocked = deferred();
    const write = local.set.getMockImplementation()!;
    local.set.mockImplementationOnce(async updates => {
      entered.resolve();
      await blocked.promise;
      await write(updates);
    });
    const translating = dispatch({
      type: 'BATCH_TRANSLATE_TEXT', requestId: 'victim-batch',
      payload: { mode: 'bilingual', paragraphs: [{ id: 'p1', text: 'private body' }], pageUrl: 'https://private.invalid/' },
    });
    await entered.promise;
    // 取消后消息 Promise 立即返回，但队列写入与后续清理仍在途。
    const cancelled = await dispatch({ type: 'CANCEL_TRANSLATION', payload: { requestId: 'victim-batch' } });
    expect(cancelled).toMatchObject({ success: true, data: true });
    const clearing = clearAllData();
    await new Promise(resolve => setTimeout(resolve, 20));
    blocked.resolve();
    await Promise.all([translating, clearing]);
    await assertDeleted();
  });

  it('清空等待右键加入词表的在途翻译，不能在清空后保存私人词条', async () => {
    const { TranslationService } = await import('@/background/translation');
    const entered = deferred();
    const blocked = deferred();
    vi.spyOn(TranslationService, 'quickTranslate').mockImplementationOnce(async () => {
      entered.resolve();
      await blocked.promise;
      return '私人译文';
    });
    const task = onContextMenu({ menuItemId: CONTEXT_MENU_IDS.ADD_TO_VOCABULARY, selectionText: 'private', editable: false }, { id: 1 } as chrome.tabs.Tab);
    await entered.promise;
    let done = false;
    const clearing = clearAllData().then(() => { done = true; });
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      expect.soft(done).toBe(false);
    } finally {
      blocked.resolve();
      await Promise.all([task, clearing]);
    }
    await assertDeleted();
  });

  it('连续清空递增版本，刷新后新配置仍可正常保存', async () => {
    await clearAllData();
    const first = (await StorageManager.getSettings()).apiConfigsRevision!;
    await clearAllData();
    const second = (await StorageManager.getSettings()).apiConfigsRevision!;
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(await dispatch({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: second, payload: { apiConfigs: [configB] },
    })).toMatchObject({ success: true, data: { apiConfigs: [configB], apiConfigsRevision: second + 1 } });
  });

  it('后台清空失败时生产入口必须抛错，不得假报成功或丢失版本墓碑', async () => {
    local.clear.mockRejectedValueOnce(new Error('测试清空失败'));
    await expect(clearAllData()).rejects.toThrow('测试清空失败');
    const response = await dispatch({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0, payload: { apiConfigs: [configA] },
    });
    expect(response.success).toBe(false);
    await clearAllData();
    await assertDeleted();
  });

  it('GeneralSettings 清空失败不能展示成功或刷新页面', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const settings = await StorageManager.getSettings();
    await act(async () => { render(<GeneralSettings settings={settings} onUpdate={vi.fn()} isSaving={false} />); });
    local.clear.mockRejectedValueOnce(new Error('测试清空失败'));
    fireEvent.click(screen.getByRole('button', { name: '清除所有数据' }));
    fireEvent.change(screen.getByLabelText('输入 DELETE 确认删除'), { target: { value: 'DELETE' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '确定删除' })); });
    expect(screen.getByText(/清除失败/)).toBeInTheDocument();
    expect(screen.queryByText('所有数据已清除，页面即将刷新')).not.toBeInTheDocument();
    expect(timeout.mock.calls.some(([, delay]) => delay === 1500)).toBe(false);
  });

  it('IndexedDB 历史事务失败时不能假报全部清空成功', async () => {
    clearHistory.mockRejectedValueOnce(new Error('测试事务失败'));
    await expect(clearAllData()).rejects.toThrow(/历史/);
    expect(historyData).not.toEqual([]);
    await clearAllData();
    await assertDeleted();
  });

  it('任一清理失败时仍等待其他清理结束，不能提前解除写入屏障', async () => {
    const entered = deferred();
    const blocked = deferred();
    const remove = local.remove.getMockImplementation()!;
    local.remove.mockImplementationOnce(async keys => {
      entered.resolve();
      await blocked.promise;
      await remove(keys);
    });
    clearHistory.mockRejectedValueOnce(new Error('测试事务失败'));
    let settled = false;
    const clearing = clearAllData().catch(error => { settled = true; return error; });
    await entered.promise;
    try {
      await new Promise(resolve => setTimeout(resolve, 20));
      expect.soft(settled).toBe(false);
    } finally {
      blocked.resolve();
      expect(await clearing).toBeInstanceOf(Error);
    }
  });

  it('内容脚本来源的清空与全量替换消息被拒绝，管理页面来源不受影响', async () => {
    const contentSender = { tab: { id: 9 }, url: 'https://private.invalid/' } as chrome.runtime.MessageSender;
    const fromContent = (message: Message) => new Promise<MessageResponse>(resolve => {
      expect(onMessage(message, contentSender, resolve)).toBe(true);
    });
    // 全量替换：内容脚本被拒，旧设置与密钥不能被页面侧覆盖。
    await expect(fromContent({ type: 'REPLACE_SETTINGS', payload: { apiConfigs: [configA] } }))
      .resolves.toMatchObject({ success: false, error: expect.stringMatching(/管理页面/) });
    // 清空所有数据：内容脚本被拒，不得真正触发清空。
    await expect(fromContent({ type: 'CLEAR_ALL_DATA' }))
      .resolves.toMatchObject({ success: false, error: expect.stringMatching(/管理页面/) });
    expect(local.clear).not.toHaveBeenCalled();
    expect(syncData).toMatchObject({ apiKey: 'TEST_ONLY_LEGACY_SECRET', userProfile: { estimatedVocabulary: expect.anything() } });
    expect(localData).toMatchObject({ knownWords: ['private'] });
    // 管理页面（popup/options，无 sender.tab）的全量替换仍然放行。
    await expect(dispatch({ type: 'REPLACE_SETTINGS', payload: { enabled: true, apiConfigs: [configB] } }))
      .resolves.toMatchObject({ success: true });
  });

  it('管理页在浏览器标签内打开时仍允许清空或导入，其他扩展页不能冒用', async () => {
    const fromTab = (message: Message, url: string) => new Promise<MessageResponse>(resolve => {
      expect(onMessage(message, { tab: { id: 9 }, url } as chrome.runtime.MessageSender, resolve)).toBe(true);
    });
    await expect(fromTab({ type: 'REPLACE_SETTINGS', payload: { enabled: true, apiConfigs: [configA] } },
      chrome.runtime.getURL('src/options/index.html?tab=general'))).resolves.toMatchObject({ success: true });
    await expect(fromTab({ type: 'CLEAR_ALL_DATA' },
      chrome.runtime.getURL('src/options/index.html?tab=general'))).resolves.toMatchObject({ success: true });
    await expect(fromTab({ type: 'REPLACE_SETTINGS', payload: { enabled: true } },
      chrome.runtime.getURL('src/content/index.html'))).resolves.toMatchObject({ success: false });
  });

  it('消息无响应或失败时不得退回前台直接清空', async () => {
    for (const response of [undefined, { success: false, error: '测试后台拒绝' }]) {
      vi.mocked(chrome.runtime.sendMessage).mockResolvedValueOnce(response);
      await expect.soft(clearAllData()).rejects.toThrow();
    }
    expect(sync.clear).not.toHaveBeenCalled();
    expect(local.clear).not.toHaveBeenCalled();
  });
});
