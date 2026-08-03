import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtimeListener: undefined as ((message: any, sender: any, sendResponse: (response: any) => void) => boolean) | undefined,
  contextMenuListener: undefined as ((info: any, tab?: any) => Promise<void>) | undefined,
  sendMessage: vi.fn(),
  queue: {
    initialize: vi.fn().mockResolvedValue([]),
    cleanupExpired: vi.fn().mockResolvedValue(undefined),
    add: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  },
  translateBatch: vi.fn(),
}));

vi.mock('@/shared/utils', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/background/storage', () => ({
  StorageManager: {
    getUserProfile: vi.fn().mockResolvedValue({ estimatedVocabulary: 4000 }),
    getSettings: vi.fn(),
    getApiKey: vi.fn(),
    addKnownWord: vi.fn(),
    addUnknownWord: vi.fn(),
  },
}));

vi.mock('@/background/translation', () => ({
  TranslationService: { translate: vi.fn(), quickTranslate: vi.fn(), testConnection: vi.fn() },
}));

vi.mock('@/background/userLevel', () => ({ UserLevelManager: {} }));
vi.mock('@/background/batchTranslation', () => ({
  BatchTranslationService: { translateBatch: mocks.translateBatch },
}));
vi.mock('@/background/mastery', () => ({ MasteryManager: {} }));
vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: { initialize: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/background/frequencyManager', () => ({
  frequencyManager: { initialize: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/background/cacheMetrics', () => ({ CacheMetrics: {} }));
vi.mock('@/background/reviewReminder', () => ({
  reviewReminderManager: {
    load: vi.fn().mockResolvedValue(undefined),
    scheduleReminderAlarm: vi.fn().mockResolvedValue(undefined),
    checkAndSendReminder: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/background/contextCapture', () => ({
  contextCaptureManager: { load: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/background/pendingRequestQueue', () => ({ pendingRequestQueue: mocks.queue }));
vi.mock('@/shared/error-tracking', () => ({
  getErrorStats: vi.fn(),
  queryErrors: vi.fn(),
  deleteError: vi.fn(),
  deleteErrors: vi.fn(),
  clearAllErrors: vi.fn(),
  markErrorsAsReported: vi.fn(),
  getUnreportedErrors: vi.fn(),
}));
vi.mock('@/background/translationHistory', () => ({
  saveTranslationHistory: vi.fn(),
  queryTranslationHistory: vi.fn(),
  getHistoryById: vi.fn(),
  deleteHistoryEntry: vi.fn(),
  deleteHistoryEntries: vi.fn(),
  clearAllHistory: vi.fn(),
  getHistoryStats: vi.fn(),
  exportHistoryData: vi.fn(),
  importHistoryData: vi.fn(),
}));

const chromeMock = {
  alarms: {
    get: vi.fn((_name: string, callback: (alarm: object) => void) => callback({ name: 'keep-alive' })),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn() },
  },
  runtime: {
    onInstalled: { addListener: vi.fn() },
    onMessage: {
      addListener: vi.fn((listener) => {
        mocks.runtimeListener = listener;
      }),
    },
    openOptionsPage: vi.fn(),
  },
  contextMenus: {
    create: vi.fn(),
    onClicked: {
      addListener: vi.fn((listener) => {
        mocks.contextMenuListener = listener;
      }),
    },
  },
  notifications: { onClicked: { addListener: vi.fn() } },
  commands: { onCommand: { addListener: vi.fn() } },
  tabs: { sendMessage: mocks.sendMessage },
};

Object.defineProperty(globalThis, 'chrome', { value: chromeMock, configurable: true });

async function invokeMessage(message: unknown, sender: unknown = {}): Promise<any> {
  return new Promise((resolve) => {
    mocks.runtimeListener?.(message, sender, resolve);
  });
}

describe('background 消息与菜单集成', () => {
  beforeAll(async () => {
    await import('@/background/index');
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('没有选中文本时仍应该触发全页翻译菜单', async () => {
    await mocks.contextMenuListener?.({ menuItemId: 'translatePage' }, { id: 42 });

    expect(mocks.sendMessage).toHaveBeenCalledWith(42, { type: 'TRANSLATE_PAGE' });
  });

  it('异常批量负载应该返回明确错误且不入队', async () => {
    const response = await invokeMessage({
      type: 'BATCH_TRANSLATE_TEXT',
      payload: { paragraphs: ['invalid paragraph'] },
    });

    expect(response).toEqual({ success: false, error: '批量翻译请求格式无效' });
    expect(mocks.queue.add).not.toHaveBeenCalled();
  });

  it('缺少翻译模式或页面地址的批量请求应该被拒绝', async () => {
    const response = await invokeMessage({
      type: 'BATCH_TRANSLATE_TEXT',
      payload: {
        paragraphs: [{ id: 'p1', text: 'Hello world', elementPath: '#p1' }],
      },
    });

    expect(response).toEqual({ success: false, error: '批量翻译请求格式无效' });
    expect(mocks.queue.add).not.toHaveBeenCalled();
  });

  it('批量翻译失败时应该使用真实请求 ID 更新队列', async () => {
    mocks.translateBatch.mockRejectedValueOnce(new Error('服务不可用'));

    const response = await invokeMessage({
      type: 'BATCH_TRANSLATE_TEXT',
      payload: {
        paragraphs: [{ id: 'p1', text: 'Hello world', elementPath: '#p1' }],
        mode: 'bilingual',
        pageUrl: 'https://example.com',
      },
    }, { tab: { id: 42 } });

    const requestId = mocks.queue.add.mock.calls[0][0].id;
    expect(response).toEqual({ success: false, error: '服务不可用' });
    expect(mocks.queue.fail).toHaveBeenCalledWith(requestId);
  });
});
