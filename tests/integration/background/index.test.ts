import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, MessageResponse, UserProfile } from '@/shared/types';
import { CONTEXT_MENU_IDS } from '@/shared/constants';
import type { ErrorEntry } from '@/shared/error-tracking';

const importedProfile: UserProfile = {
  examType: 'cet4',
  estimatedVocabulary: 4000,
  levelConfidence: 0.5,
  createdAt: 1,
  updatedAt: 1,
  knownWords: ['book'],
  unknownWords: [],
};

let localData: Record<string, unknown> = {};
let syncData: Record<string, unknown> = {};
let onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let onClicked: Parameters<typeof chrome.contextMenus.onClicked.addListener>[0];
let onAlarm: Parameters<typeof chrome.alarms.onAlarm.addListener>[0];
let onCommand: Parameters<typeof chrome.commands.onCommand.addListener>[0];
let onNotificationClicked: Parameters<typeof chrome.notifications.onClicked.addListener>[0];
const onInstalled: Array<Parameters<typeof chrome.runtime.onInstalled.addListener>[0]> = [];

const local = {
  get: vi.fn(async (_keys: unknown) => localData),
  set: vi.fn(async (updates: Record<string, unknown>) => { localData = { ...localData, ...updates }; }),
  remove: vi.fn(async (keys: string | string[]) => {
    const toRemove = Array.isArray(keys) ? keys : [keys];
    localData = Object.fromEntries(Object.entries(localData).filter(([key]) => !toRemove.includes(key)));
  }),
};
const sync = {
  get: vi.fn(async (_keys: unknown) => syncData),
  set: vi.fn(async (updates: Record<string, unknown>) => { syncData = { ...syncData, ...updates }; }),
};
const sendMessage = vi.fn().mockResolvedValue(undefined);

function dispatch(message: Message): Promise<MessageResponse> {
  return new Promise((resolve, reject) => {
    try {
      expect(onMessage(message, {} as chrome.runtime.MessageSender, resolve)).toBe(true);
    } catch (error) {
      reject(error);
    }
  });
}

beforeAll(async () => {
  vi.resetModules();
  vi.stubGlobal('chrome', {
    storage: { local, sync },
    alarms: {
      get: vi.fn((_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => callback()),
      create: vi.fn(),
      onAlarm: { addListener: vi.fn((listener: typeof onAlarm) => { onAlarm = listener; }) },
    },
    runtime: {
      onInstalled: { addListener: vi.fn((listener: typeof onInstalled[number]) => { onInstalled.push(listener); }) },
      onMessage: { addListener: vi.fn((listener: typeof onMessage) => { onMessage = listener; }) },
      sendMessage: vi.fn((message: Message) => dispatch(message)),
      openOptionsPage: vi.fn(),
    },
    contextMenus: {
      create: vi.fn(),
      onClicked: { addListener: vi.fn((listener: typeof onClicked) => { onClicked = listener; }) },
    },
    notifications: { onClicked: { addListener: vi.fn((listener: typeof onNotificationClicked) => { onNotificationClicked = listener; }) } },
    commands: { onCommand: { addListener: vi.fn((listener: typeof onCommand) => { onCommand = listener; }) } },
    tabs: { query: vi.fn().mockResolvedValue([]), sendMessage },
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试不得访问网络'); }));
  await import('@/background/index');
  expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  expect(chrome.contextMenus.onClicked.addListener).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(local.set).toHaveBeenCalledWith(
    expect.objectContaining({ pendingTranslationRequests: { requests: {} } })
  ));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

beforeEach(() => {
  localData = { knownWords: ['hello'], unknownWords: [] };
  syncData = {};
  vi.clearAllMocks();
  sync.set.mockImplementation(async updates => { syncData = { ...syncData, ...updates }; });
});

describe('后台注册的消息监听器', () => {
  it.each([null, [], {}, { enabled: 'true' }, { enabled: true, apiConfigs: null }])(
    '拒绝无效备份设置 %j 且不写入同步存储', async payload => {
      expect(await dispatch({ type: 'REPLACE_SETTINGS', payload }))
        .toEqual({ success: false, error: '数据格式无效' });
      expect(sync.set).not.toHaveBeenCalled();
    }
  );

  it.each([
    { enabled: true, customApiUrl: 'http://evil.example/v1' },
    { enabled: true, apiProvider: 'ollama', customApiUrl: 'https://outside.example/v1' },
    { enabled: true, apiProvider: 'free_google_translate', customApiUrl: 'http://localhost:7777/delete' },
    { enabled: true, apiConfigs: [{ id: 'local', provider: 'custom', apiKey: 'key', apiUrl: 'http://127.0.0.1:7777/read' }] },
    { enabled: true, apiProvider: 'invalid' },
    { enabled: true, apiConfigs: [{ id: 'x', provider: 'custom', apiKey: 'key', apiUrl: 'javascript:alert(1)' }] },
    { enabled: true, apiConfigs: [{ id: 'x', provider: 'custom', apiKey: 'key', apiUrl: 'https://outside.example/v1' }] },
  ])('后台直接拒绝不安全备份端点且不持久化 %j', async payload => {
    expect(await dispatch({ type: 'REPLACE_SETTINGS', payload })).toEqual({ success: false, error: '数据格式无效' });
    expect(sync.set).not.toHaveBeenCalled();
  });

  it('用户在设置页主动更新 HTTPS 自定义端点仍可保存', async () => {
    const customApiUrl = 'https://mine.example/v1';
    expect(await dispatch({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'custom', customApiUrl } }))
      .toEqual({ success: true });
    expect(syncData.settings).toEqual(expect.objectContaining({ apiProvider: 'custom', customApiUrl }));
  });

  it('备份设置恢复与进行中的增量更新共用队列，后提交的完整备份最终生效', async () => {
    const { importAllData, DEFAULT_IMPORT_OPTIONS, EXPORT_VERSION } = await import('@/shared/utils/dataExport');
    let writing: () => void = () => undefined;
    const firstWriting = new Promise<void>(resolve => { writing = resolve; });
    let release: () => void = () => undefined;
    const canWrite = new Promise<void>(resolve => { release = resolve; });
    sync.set.mockImplementationOnce(async updates => {
      writing();
      await canWrite;
      syncData = { ...syncData, ...updates };
    });
    const delta = dispatch({ type: 'UPDATE_SETTINGS', payload: { enabled: false, translationMode: 'bilingual' } });
    await firstWriting;
    const backup = { enabled: true, translationMode: 'full-translate' as const };
    const restored = importAllData({ version: EXPORT_VERSION, settings: backup } as import('@/shared/utils/dataExport').FullExportData, {
      ...DEFAULT_IMPORT_OPTIONS, importProfile: false, importMastery: false, importCache: false,
    });
    try {
      expect(sync.get).toHaveBeenCalledTimes(1);
      release();
      expect(await delta).toEqual({ success: true });
      expect((await restored).details.settingsImported).toBe(true);
      expect(syncData.settings).toEqual(expect.objectContaining(backup));
      expect(vi.mocked(chrome.runtime.sendMessage)).toHaveBeenCalledWith({ type: 'REPLACE_SETTINGS', payload: backup });
    } finally {
      release();
    }
  });

  it('恢复备份设置写入失败时不误报导入成功，后续增量仍可提交', async () => {
    const { importAllData, DEFAULT_IMPORT_OPTIONS, EXPORT_VERSION } = await import('@/shared/utils/dataExport');
    sync.set.mockRejectedValueOnce(new Error('持久化暂不可用'));
    const result = await importAllData({ version: EXPORT_VERSION, settings: { enabled: false } } as import('@/shared/utils/dataExport').FullExportData, {
      ...DEFAULT_IMPORT_OPTIONS, importProfile: false, importMastery: false, importCache: false,
    });
    expect(result.success).toBe(false);
    expect(result.details.settingsImported).toBe(false);
    expect(result.errors.join(' ')).not.toContain('持久化暂不可用');
    expect(await dispatch({ type: 'UPDATE_SETTINGS', payload: { enabled: true } })).toEqual({ success: true });
    expect(syncData.settings).toEqual(expect.objectContaining({ enabled: true }));
  });

  it('两个窗口同时提交不同设置增量，后一个必须读取前一个已保存的结果', async () => {
    let signalFirstWrite: () => void = () => undefined;
    const firstWriteStarted = new Promise<void>(resolve => { signalFirstWrite = resolve; });
    let releaseFirstWrite: () => void = () => undefined;
    const firstWriteCanFinish = new Promise<void>(resolve => { releaseFirstWrite = resolve; });
    sync.set.mockImplementationOnce(async updates => {
      signalFirstWrite();
      await firstWriteCanFinish;
      syncData = { ...syncData, ...updates };
    });

    const first = dispatch({ type: 'UPDATE_SETTINGS', payload: { enabled: false } });
    await firstWriteStarted;
    const second = dispatch({ type: 'UPDATE_SETTINGS', payload: { translationMode: 'bilingual' } });
    try {
      expect(sync.get).toHaveBeenCalledTimes(1);
      releaseFirstWrite();
      expect(await Promise.all([first, second])).toEqual([{ success: true }, { success: true }]);
      expect(syncData.settings).toEqual(expect.objectContaining({ enabled: false, translationMode: 'bilingual' }));
    } finally {
      releaseFirstWrite();
    }
  });

  it('首次设置保存失败后，后续窗口仍能提交增量', async () => {
    sync.set.mockRejectedValueOnce(new Error('存储暂时不可用'));
    const first = dispatch({ type: 'UPDATE_SETTINGS', payload: { enabled: false } });
    const second = dispatch({ type: 'UPDATE_SETTINGS', payload: { translationMode: 'bilingual' } });
    expect((await first).success).toBe(false);
    expect(await second).toEqual({ success: true });
    expect(syncData.settings).toEqual(expect.objectContaining({ enabled: true, translationMode: 'bilingual' }));
  });

  it.each([
    { name: '缺失', value: undefined },
    { name: 'null', value: null },
    { name: '字符串', value: 'true' },
    { name: '数字', value: 1 },
    { name: '对象', value: {} },
    { name: '数组', value: [] },
  ])('拒绝无效的 mergeVocabulary $name 且不写入档案', async ({ value: mergeVocabulary }) => {
    const response = await dispatch({
      type: 'IMPORT_USER_PROFILE', payload: { profile: importedProfile, mergeVocabulary },
    });

    expect(response).toEqual({ success: false, error: '数据格式无效' });
    expect(local.set).not.toHaveBeenCalled();
    expect(sync.set).not.toHaveBeenCalled();
  });

  it('合并有效档案并返回结果，保留原有词汇', async () => {
    const response = await dispatch({
      type: 'IMPORT_USER_PROFILE', payload: { profile: importedProfile, mergeVocabulary: true },
    });

    expect(response).toEqual({ success: true, data: { wordsMerged: 1 } });
    expect(local.set).toHaveBeenCalledWith({ knownWords: ['hello', 'book'], unknownWords: [] });
    expect(sync.set).toHaveBeenCalledWith({ userProfile: expect.objectContaining({ estimatedVocabulary: 4000 }) });
  });
});

describe('后台注册的右键菜单监听器', () => {
  it.each([undefined, '', '   '])('translatePage 无选中文字 %j 仍向标签页发送全文翻译', async selectionText => {
    await onClicked({ menuItemId: 'translatePage', selectionText }, { id: 42 } as chrome.tabs.Tab);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42, { type: 'TRANSLATE_PAGE' });
  });

  it('整页翻译发送失败时捕获拒绝并记录错误', async () => {
    const error = new Error('SECRET_SENTINEL：测试标签页不可用');
    const errorSpy = vi.spyOn((await import('@/shared/utils/logger')).logger, 'error')
      .mockImplementation(() => undefined);
    const rejected = Promise.reject(error);
    void rejected.catch(() => undefined);
    sendMessage.mockReturnValueOnce(rejected);

    try {
      await onClicked({ menuItemId: 'translatePage' }, { id: 42 } as chrome.tabs.Tab);
      expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42, { type: 'TRANSLATE_PAGE' });
      await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith('Failed to send TRANSLATE_PAGE'));
      expect(errorSpy.mock.calls.flat().map(String).join(' ')).not.toContain('SECRET_SENTINEL');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('整页翻译返回部分失败时记录受控告警', async () => {
    const warning = vi.spyOn((await import('@/shared/utils/logger')).logger, 'warn')
      .mockImplementation(() => undefined);
    sendMessage.mockResolvedValueOnce({ success: false, data: { translated: 1, failed: 14 } });

    try {
      await onClicked({ menuItemId: 'translatePage' }, { id: 42 } as chrome.tabs.Tab);
      await vi.waitFor(() => expect(warning).toHaveBeenCalledWith('页面翻译未全部完成'));
    } finally {
      warning.mockRestore();
    }
  });

  it('选中文字菜单发送失败时不会泄漏未处理拒绝', async () => {
    const errorSpy = vi.spyOn((await import('@/shared/utils/logger')).logger, 'error')
      .mockImplementation(() => undefined);
    sendMessage.mockRejectedValueOnce(new Error('标签页已关闭'));

    try {
      await expect(onClicked({ menuItemId: 'translateSelection', selectionText: 'hello' }, { id: 42 } as chrome.tabs.Tab))
        .resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledWith('右键菜单操作失败');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('没有标签页 ID 时不发送消息', async () => {
    await onClicked({ menuItemId: 'translatePage' }, {} as chrome.tabs.Tab);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('选中文字菜单仍要求非空文本', async () => {
    await onClicked({ menuItemId: 'translateSelection', selectionText: '   ' }, { id: 42 } as chrome.tabs.Tab);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('选中文字菜单仍发送修剪后的文本', async () => {
    await onClicked({ menuItemId: 'translateSelection', selectionText: '  hello  ' }, { id: 42 } as chrome.tabs.Tab);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(42, {
      type: 'CONTEXT_MENU_TRANSLATE', payload: { text: 'hello' },
    });
  });
});

describe('错误上报真实入口', () => {
  const pending: ErrorEntry = {
    id: 'unsent', message: '翻译失败', category: 'translation', severity: 'error',
    timestamp: Date.now(), firstOccurredAt: Date.now(), count: 1, reported: false,
  };

  it('无服务器上报能力时不得谎称成功或清除未上报状态', async () => {
    localData = { ...localData, errorTracking: [pending] };

    const response = await dispatch({ type: 'REPORT_ERRORS', payload: { ids: ['unsent'] } });

    expect(response).toEqual({ success: false, error: '错误上报服务未配置' });
    expect(localData.errorTracking).toEqual([pending]);
    expect(local.set).not.toHaveBeenCalledWith(expect.objectContaining({
      errorTracking: [expect.objectContaining({ reported: true })],
    }));
  });

  it('未指定 ID 时保留所有未上报记录；无待上报记录时不伪称已发送', async () => {
    localData = { ...localData, errorTracking: [pending] };
    expect(await dispatch({ type: 'REPORT_ERRORS', payload: {} }))
      .toEqual({ success: false, error: '错误上报服务未配置' });
    expect((await dispatch({ type: 'QUERY_ERRORS', payload: { params: { reported: false } } })).data)
      .toEqual(expect.objectContaining({ errors: [pending], total: 1 }));
    localData = { ...localData, errorTracking: [] };
    expect(await dispatch({ type: 'REPORT_ERRORS', payload: {} }))
      .toEqual({ success: true, data: { message: '没有需要上报的错误' } });
  });

  it('错误列表查询、标记及删除持久化到浏览器存储', async () => {
    const other: ErrorEntry = { ...pending, id: 'other', message: '另一个错误' };
    localData = { ...localData, errorTracking: [pending, other] };
    expect((await dispatch({ type: 'GET_ERROR_STATS' })).data)
      .toEqual(expect.objectContaining({ totalErrors: 2, unreportedErrors: 2 }));
    expect((await dispatch({ type: 'QUERY_ERRORS', payload: { params: { ids: ['unsent'] } } })).data)
      .toEqual(expect.objectContaining({ errors: expect.arrayContaining([pending]) }));
    expect(await dispatch({ type: 'MARK_ERRORS_AS_REPORTED', payload: { ids: ['unsent'] } }))
      .toEqual({ success: true });
    expect(localData.errorTracking).toEqual([
      expect.objectContaining({ id: 'unsent', reported: true }),
      expect.objectContaining({ id: 'other', reported: false }),
    ]);
    expect(await dispatch({ type: 'DELETE_ERROR', payload: { id: 'other' } })).toEqual({ success: true });
    expect(localData.errorTracking).toEqual([expect.objectContaining({ id: 'unsent' })]);
    expect(await dispatch({ type: 'DELETE_ERRORS', payload: { ids: ['unsent'] } })).toEqual({ success: true });
    expect(localData.errorTracking).toEqual([]);
    expect(await dispatch({ type: 'CLEAR_ALL_ERRORS' })).toEqual({ success: true });
    expect(localData).not.toHaveProperty('errorTracking');
  });

  it('写入失败时返回受控错误且保留未上报记录', async () => {
    localData = { ...localData, errorTracking: [pending] };
    local.set.mockRejectedValueOnce(new Error('磁盘已满'));
    expect(await dispatch({ type: 'MARK_ERRORS_AS_REPORTED', payload: { ids: ['unsent'] } }))
      .toEqual({ success: false, error: '标记错误已上报失败' });
    expect(localData.errorTracking).toEqual([pending]);
  });
});

describe('后台生命周期、菜单和快捷键', () => {
  it('安装时创建保活闹钟及全部五个可点击菜单', () => {
    expect(onInstalled).toHaveLength(2);
    for (const listener of onInstalled) listener({ reason: 'install' } as chrome.runtime.InstalledDetails);
    expect(chrome.alarms.create).toHaveBeenCalledWith('keep-alive', { periodInMinutes: 0.5 });
    expect(chrome.contextMenus.create).toHaveBeenCalledTimes(5);
    expect(vi.mocked(chrome.contextMenus.create).mock.calls.map(([item]) => item.id))
      .toEqual(Object.values(CONTEXT_MENU_IDS));
  });

  it('点击通知打开选项页；非保活闹钟不触发队列清理', async () => {
    onNotificationClicked('review-1');
    expect(chrome.runtime.openOptionsPage).toHaveBeenCalledOnce();
    onAlarm({ name: 'unrelated' } as chrome.alarms.Alarm);
    expect(local.get).not.toHaveBeenCalled();
  });

  it('保活闹钟清理过期请求但保留有效请求', async () => {
    const fresh = { id: 'fresh', text: '', mode: 'bilingual', createdAt: Date.now(), retries: 0 };
    const expired = { ...fresh, id: 'expired', createdAt: Date.now() - 6 * 60_000 };
    localData = { ...localData, pendingTranslationRequests: { requests: { fresh, expired } } };
    onAlarm({ name: 'keep-alive' } as chrome.alarms.Alarm);
    await vi.waitFor(() => expect(localData.pendingTranslationRequests).toEqual({ requests: { fresh } }));
  });

  it.each([
    ['translate-paragraph', 'TRANSLATE_PARAGRAPH'],
    ['toggle-translation', 'TOGGLE_TRANSLATION'],
    ['translate-full-page', 'TRANSLATE_PAGE'],
    ['toggle-mode', 'TOGGLE_MODE'],
  ])('快捷键 %s 向活动标签页发送 %s', async (command, type) => {
    await onCommand(command, { id: 9 } as chrome.tabs.Tab);
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith(9, { type });
  });

  it('快捷键没有标签页或未识别时不发送；发送失败已捕获', async () => {
    await onCommand('translate-paragraph', undefined);
    await onCommand('unknown', { id: 9 } as chrome.tabs.Tab);
    expect(sendMessage).not.toHaveBeenCalled();
    sendMessage.mockRejectedValueOnce(new Error('标签页关闭'));
    await onCommand('toggle-mode', { id: 9 } as chrome.tabs.Tab);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(9, { type: 'TOGGLE_MODE' }));
  });

  it('菜单标记已知词与未知词时真实持久化并通知对应标签页', async () => {
    await onClicked({ menuItemId: CONTEXT_MENU_IDS.MARK_KNOWN, selectionText: '  Hello  ' }, { id: 3 } as chrome.tabs.Tab);
    expect(localData.knownWords).toContain('hello');
    expect(sendMessage).toHaveBeenCalledWith(3, { type: 'WORD_MARKED', payload: { word: 'Hello', isKnown: true } });
    await onClicked({ menuItemId: CONTEXT_MENU_IDS.MARK_UNKNOWN, selectionText: ' Hello ' }, { id: 3 } as chrome.tabs.Tab);
    expect(localData.knownWords).not.toContain('hello');
    expect(localData.unknownWords).toEqual([expect.objectContaining({ word: 'hello', reviewCount: 0 })]);
    expect(sendMessage).toHaveBeenCalledWith(3, { type: 'WORD_MARKED', payload: { word: 'Hello', isKnown: false } });
  });

  it('加入生词菜单使用真实配置/存储，仅模拟外部翻译边界', async () => {
    const { TranslationService } = await import('@/background/translation');
    const quick = vi.spyOn(TranslationService, 'quickTranslate').mockResolvedValue('你好');
    try {
      await onClicked({ menuItemId: CONTEXT_MENU_IDS.ADD_TO_VOCABULARY, selectionText: ' Hello ' }, { id: 3 } as chrome.tabs.Tab);
      expect(quick).toHaveBeenCalledWith('Hello', '', expect.objectContaining({ enabled: true }));
      expect(localData.unknownWords).toEqual([expect.objectContaining({ word: 'hello', translation: '你好' })]);
      expect(sendMessage).toHaveBeenCalledWith(3, { type: 'ADDED_TO_VOCABULARY', payload: { word: 'Hello', translation: '你好' } });
    } finally {
      quick.mockRestore();
    }
  });

  it('加入生词菜单翻译失败不保存不通知', async () => {
    const { TranslationService } = await import('@/background/translation');
    const quick = vi.spyOn(TranslationService, 'quickTranslate').mockRejectedValue(new Error('服务不可用'));
    try {
      await onClicked({ menuItemId: CONTEXT_MENU_IDS.ADD_TO_VOCABULARY, selectionText: 'Hello' }, { id: 3 } as chrome.tabs.Tab);
      expect(localData.unknownWords).toEqual([]);
      expect(sendMessage).not.toHaveBeenCalled();
    } finally {
      quick.mockRestore();
    }
  });
});

describe('消息监听器真实存储行为', () => {
  const word = { word: 'river', context: 'by the river', translation: '河流', markedAt: 1, reviewCount: 0 };

  it('读取档案和设置；更新档案时保留已有本地词汇', async () => {
    expect((await dispatch({ type: 'GET_USER_PROFILE' })).data)
      .toEqual(expect.objectContaining({ knownWords: ['hello'] }));
    expect((await dispatch({ type: 'GET_SETTINGS' })).data)
      .toEqual(expect.objectContaining({ enabled: true }));
    expect((await dispatch({ type: 'UPDATE_USER_PROFILE', payload: { estimatedVocabulary: 5000 } })).data)
      .toEqual(expect.objectContaining({ estimatedVocabulary: 5000, knownWords: ['hello'] }));
    expect((await dispatch({ type: 'GET_USER_PROFILE' })).data)
      .toEqual(expect.objectContaining({ estimatedVocabulary: 5000, knownWords: ['hello'] }));
  });

  it('更新档案遇无效字段从异步监听器返回失败，原档案保持不变', async () => {
    const response = await dispatch({ type: 'UPDATE_USER_PROFILE', payload: { unknownWords: [] } });
    expect(response).toEqual({ success: false, error: '数据格式无效' });
    expect(sync.set).not.toHaveBeenCalled();
  });

  it('API 连接检测向翻译服务传递原参数，返回其真实结果与错误', async () => {
    const { TranslationService } = await import('@/background/translation');
    const test = vi.spyOn(TranslationService, 'testConnection').mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('本地模型未启动'));
    const payload = { provider: 'custom', apiKey: 'test-key', apiUrl: 'http://localhost:1234' };
    try {
      expect(await dispatch({ type: 'TEST_API_CONNECTION', payload })).toEqual({ success: true });
      expect(await dispatch({ type: 'TEST_API_CONNECTION', payload })).toEqual({ success: false });
      expect(await dispatch({ type: 'TEST_API_CONNECTION', payload }))
        .toEqual({ success: false, error: '本地模型未启动' });
      expect(test).toHaveBeenCalledWith('custom', 'test-key', 'http://localhost:1234');
    } finally {
      test.mockRestore();
    }
  });

  it('新设置通知有效标签页，忽略受限页失败且不影响保存结果', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([{ id: 3 }, { id: 0 }, { id: 4 }] as chrome.tabs.Tab[]);
    sendMessage.mockRejectedValueOnce(new Error('chrome:// 受限页面'));
    expect(await dispatch({ type: 'UPDATE_SETTINGS', payload: { enabled: false } })).toEqual({ success: true });
    expect(syncData.settings).toEqual(expect.objectContaining({ enabled: false }));
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith(3, { type: 'SETTINGS_UPDATED' });
    expect(sendMessage).toHaveBeenCalledWith(4, { type: 'SETTINGS_UPDATED' });
  });

  it('标签页查询失败不回滚已保存设置', async () => {
    vi.mocked(chrome.tabs.query).mockRejectedValueOnce(new Error('标签页不可用'));
    expect(await dispatch({ type: 'UPDATE_SETTINGS', payload: { enabled: false } })).toEqual({ success: true });
    expect(syncData.settings).toEqual(expect.objectContaining({ enabled: false }));
  });

  it('添加、读取、导入和删除生词经由真实本地存储', async () => {
    expect(await dispatch({ type: 'ADD_TO_VOCABULARY', payload: word })).toEqual({ success: true });
    expect((await dispatch({ type: 'GET_VOCABULARY' })).data).toEqual([word]);
    expect((await dispatch({ type: 'IMPORT_VOCABULARY', payload: [
      { ...word, word: '海豚', translation: 'dolphin' }, word,
    ] })).data).toEqual({ imported: 1, skipped: 1 });
    expect((await dispatch({ type: 'GET_VOCABULARY' })).data)
      .toEqual([word, expect.objectContaining({ word: '海豚' })]);
    expect(await dispatch({ type: 'REMOVE_FROM_VOCABULARY', payload: { word: 'river' } }))
      .toEqual({ success: true });
    expect((await dispatch({ type: 'GET_VOCABULARY' })).data)
      .toEqual([expect.objectContaining({ word: '海豚' })]);
  });

  it('未知词标记同时更新生词表、等级及掌握度；撤销再移除词', async () => {
    const response = await dispatch({ type: 'MARK_WORD_UNKNOWN', payload: word });
    expect(response.success).toBe(true);
    expect(localData.unknownWords).toEqual([word]);
    expect(localData).toHaveProperty('masteryProfile.wordMastery.river');
    expect(await dispatch({ type: 'REMOVE_MARK', payload: { word: 'river', originalAction: 'unknown' } }))
      .toEqual({ success: true });
    expect(localData.unknownWords).toEqual([]);
  });

  it('已知词标记兼容复习用 isKnown=false，不误写已知列表', async () => {
    const response = await dispatch({ type: 'MARK_WORD_KNOWN', payload: {
      word: 'River', isKnown: false, wordDifficulty: 7, context: 'by the river', translation: '河流',
    } });
    expect(response).toEqual({ success: true, data: {
      profile: expect.objectContaining({ estimatedVocabulary: expect.any(Number) }),
      masteryResult: expect.objectContaining({ newMasteryLevel: expect.any(Number) }),
    } });
    expect(localData.knownWords).not.toContain('river');
    expect(await dispatch({ type: 'MARK_WORD_KNOWN', payload: { word: 'River' } })).toEqual({
      success: true, data: expect.objectContaining({ masteryResult: expect.any(Object) }),
    });
    expect(localData.knownWords).toContain('river');
    expect(await dispatch({ type: 'REMOVE_MARK', payload: { word: 'river', originalAction: 'known' } }))
      .toEqual({ success: true });
    expect(localData.knownWords).not.toContain('river');
  });

  it('撤销添加与未知 action 均移除对应生词', async () => {
    await dispatch({ type: 'ADD_TO_VOCABULARY', payload: word });
    expect(await dispatch({ type: 'REMOVE_MARK', payload: { word: 'river', originalAction: 'add' } }))
      .toEqual({ success: true });
    expect(localData.unknownWords).toEqual([]);
  });

  it('翻译消息走真实输入校验，拒绝空正文及不存在的取消 ID', async () => {
    expect(await dispatch({ type: 'TRANSLATE_TEXT', payload: { text: '', mode: 'bilingual' } }))
      .toEqual({ success: false, error: '翻译输入无效或超出长度限制' });
    expect(await dispatch({ type: 'BATCH_TRANSLATE_TEXT', payload: { paragraphs: [], mode: 'bilingual', pageUrl: 'https://example.org' } }))
      .toEqual({ success: false, error: '翻译输入无效或超出长度限制' });
    expect(await dispatch({ type: 'CANCEL_TRANSLATION', payload: { requestId: 42 } }))
      .toEqual({ success: false, error: '取消请求 ID 无效' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('未知消息得到明确错误而非静默成功', async () => {
    expect(await dispatch({ type: 'NOT_A_REAL_TYPE' as Message['type'] }))
      .toEqual({ success: false, error: 'Unknown message type: NOT_A_REAL_TYPE' });
  });
});

describe('掌握度、语境和缓存监听分支', () => {
  it('语境捕获后按 limit 返回真实保存的词句', async () => {
    const payload = { word: 'Café', sentence: 'We visited a café yesterday.', source: '阅读', url: 'https://example.org' };
    expect(await dispatch({ type: 'CAPTURE_CONTEXT', payload })).toEqual({ success: true });
    expect(localData).toHaveProperty('vocabularyWithContexts');
    expect((await dispatch({ type: 'GET_CONTEXTUAL_WORDS', payload: { limit: 1 } })).data)
      .toEqual([expect.objectContaining({ word: 'café', contexts: [expect.objectContaining({ sentence: payload.sentence })] })]);
    expect((await dispatch({ type: 'GET_CONTEXTUAL_WORDS', payload: { limit: 0 } })).data).toEqual([]);
  });

  it('空词和过短句子不能捕获，语境存储失败不返回成功', async () => {
    expect(await dispatch({ type: 'CAPTURE_CONTEXT', payload: { word: ' ', sentence: 'hi' } }))
      .toEqual({ success: false });
    expect(local.set).not.toHaveBeenCalledWith(expect.objectContaining({ vocabularyWithContexts: expect.anything() }));
  });

  it('掌握度概览、等级、待复习和趋势从真实档案产生', async () => {
    expect((await dispatch({ type: 'GET_MASTERY_OVERVIEW' })).data)
      .toEqual({ profile: null, stats: null });
    expect((await dispatch({ type: 'GET_CEFR_LEVEL' })).data).toBeDefined();
    expect((await dispatch({ type: 'GET_REVIEW_WORDS', payload: {} })).data).toEqual([]);
    expect((await dispatch({ type: 'GET_MASTERY_TREND', payload: { days: 7 } })).success).toBe(true);
    expect((await dispatch({ type: 'GET_LEARNING_STATISTICS', payload: { days: 7 } })).success).toBe(true);
    expect((await dispatch({ type: 'GET_WORD_MASTERY_INFO', payload: { word: 'missing' } })).data).toBeNull();
  });

  it('同步、导出及导入掌握度通过真实本地存储', async () => {
    expect(await dispatch({ type: 'SYNC_USER_VOCABULARY' })).toEqual({ success: true });
    const exported = await dispatch({ type: 'EXPORT_MASTERY_DATA' });
    expect(exported.success).toBe(true);
    expect(await dispatch({ type: 'IMPORT_MASTERY_DATA', payload: exported.data })).toEqual({ success: true });
    expect(localData).toHaveProperty('masteryProfile');
  });

  it('掌握度读取失败返回受控响应而非丢失消息', async () => {
    local.get.mockRejectedValueOnce(new Error('掌握度不可用'));
    expect(await dispatch({ type: 'GET_MASTERY_OVERVIEW' }))
      .toEqual({ success: false, error: '掌握度不可用' });
  });

  it('缓存读取、指标重置和清除执行真实缓存操作', async () => {
    expect((await dispatch({ type: 'GET_CACHE_STATS' })).success).toBe(true);
    expect((await dispatch({ type: 'GET_CACHE_METRICS' })).data).toBeDefined();
    expect(await dispatch({ type: 'RESET_CACHE_METRICS' })).toEqual({ success: true });
    expect(await dispatch({ type: 'CLEAR_TRANSLATION_CACHE' })).toEqual({ success: true });
    expect(local.remove).toHaveBeenCalledWith('paragraphCache');
  });
});

describe('历史与分析消息的失败隔离', () => {
  it.each([
    ['SAVE_TRANSLATION_HISTORY', { originalText: 'hello', translation: { translatedText: '你好' }, pageUrl: 'https://example.org', mode: 'bilingual' }],
    ['QUERY_TRANSLATION_HISTORY', { params: {} }],
    ['GET_HISTORY_BY_ID', { id: 'missing' }],
    ['DELETE_HISTORY_ENTRY', { id: 'missing' }],
    ['DELETE_HISTORY_ENTRIES', { ids: ['missing'] }],
    ['CLEAR_ALL_HISTORY', {}],
    ['GET_HISTORY_STATS', {}],
    ['EXPORT_HISTORY_DATA', {}],
    ['IMPORT_HISTORY_DATA', { entries: [] }],
  ] as const)('%s 在 IndexedDB 不可用时明确失败且不会假称成功', async (type, payload) => {
    const response = await dispatch({ type, payload });
    expect(response.success).toBe(false);
    expect(response.error).toEqual(expect.any(String));
    expect(response.error).not.toBe('');
  });

  it('分析事件成功持久化设备 ID 和同步时间，空批次不破坏先前事件', async () => {
    const event = { event: 'page_view', properties: { title: '英文' }, timestamp: 10, user_id: 'u', session_id: 's', device_id: 'd' };
    expect(await dispatch({ type: 'FLUSH_ANALYTICS_EVENTS', payload: { events: [event], deviceId: 'd' } }))
      .toEqual({ success: true, data: { flushedCount: 1 } });
    expect(localData).toEqual(expect.objectContaining({
      analytics_sent_events: [event], analytics_last_sync: expect.any(Number), analytics_device_id: 'd',
    }));
    expect(await dispatch({ type: 'FLUSH_ANALYTICS_EVENTS', payload: { events: [], deviceId: 'd' } }))
      .toEqual({ success: true, data: { flushedCount: 0 } });
    expect(localData.analytics_sent_events).toEqual([event]);
  });

  it('分析事件持久化失败不回报刷新成功', async () => {
    local.set.mockRejectedValueOnce(new Error('磁盘不可写'));
    expect(await dispatch({ type: 'FLUSH_ANALYTICS_EVENTS', payload: { events: [], deviceId: 'd' } }))
      .toEqual({ success: false, error: '磁盘不可写' });
  });

  it('冻结的已有事件集合仍能追加并限制至最近 5000 条，不篡改旧快照', async () => {
    const previous = Object.freeze(Array.from({ length: 5000 }, (_, i) => ({ event: `event-${i}` })));
    const incoming = { event: 'latest' };
    localData = { ...localData, analytics_sent_events: previous };
    expect(await dispatch({ type: 'FLUSH_ANALYTICS_EVENTS', payload: { events: [incoming], deviceId: 'd' } }))
      .toEqual({ success: true, data: { flushedCount: 1 } });
    expect(previous).toHaveLength(5000);
    expect((localData.analytics_sent_events as unknown[])).toHaveLength(5000);
    expect((localData.analytics_sent_events as unknown[])[0]).toEqual({ event: 'event-1' });
    expect((localData.analytics_sent_events as unknown[])[4999]).toEqual(incoming);
  });
});
