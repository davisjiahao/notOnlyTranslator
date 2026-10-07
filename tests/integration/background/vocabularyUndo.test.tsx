import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { Message, MessageResponse, UnknownWordEntry } from '@/shared/types';
import { CONTEXT_MENU_IDS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import { StorageManager } from '@/background/storage';
import { MasteryManager } from '@/background/mastery';
import { UserLevelManager } from '@/background/userLevel';
import VocabularySettings from '@/options/components/VocabularySettings';

let syncData: Record<string, unknown> = {};
let localData: Record<string, unknown> = {};
let onMessage: Parameters<typeof chrome.runtime.onMessage.addListener>[0];
let onContextMenu: Parameters<typeof chrome.contextMenus.onClicked.addListener>[0];
const sync = {
  get: vi.fn(async (_keys: unknown) => structuredClone(syncData)),
  set: vi.fn(async (updates: Record<string, unknown>) => { syncData = { ...syncData, ...structuredClone(updates) }; }),
};
const writeLocal = async (updates: Record<string, unknown>) => {
  localData = { ...localData, ...structuredClone(updates) };
};
const local = {
  get: vi.fn(async (_keys: unknown) => structuredClone(localData)),
  set: vi.fn(writeLocal),
  remove: vi.fn(async (keys: string | string[]) => {
    const removed = Array.isArray(keys) ? keys : [keys];
    localData = Object.fromEntries(Object.entries(localData).filter(([key]) => !removed.includes(key)));
  }),
};
const original: UnknownWordEntry = {
  word: 'unfamiliar', translation: '', context: 'An unfamiliar word in its original context.',
  markedAt: 1700000000000, reviewCount: 3, lastReviewAt: 1700100000000,
};

function dispatch(message: Message): Promise<MessageResponse> {
  return new Promise(resolve => {
    expect(onMessage(message, {}, resolve)).toBe(true);
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function removeFromSettings(word: string) {
  render(<VocabularySettings isSaving={false} />);
  fireEvent.click(await screen.findByRole('button', { name: `移除：${word}` }));
  await screen.findByRole('button', { name: '撤销移除' });
  expect((await StorageManager.getUserProfile()).unknownWords).toEqual([]);
}

async function learningState() {
  const profile = await StorageManager.getUserProfile();
  return {
    estimatedVocabulary: profile.estimatedVocabulary,
    levelConfidence: profile.levelConfidence,
    mastery: await StorageManager.getMasteryProfile(),
  };
}

beforeAll(async () => {
  const event = { addListener: vi.fn() };
  vi.stubGlobal('chrome', {
    storage: { sync, local },
    alarms: {
      get: vi.fn((_name: string, callback: (alarm?: chrome.alarms.Alarm) => void) => callback()),
      create: vi.fn(), onAlarm: event,
    },
    runtime: {
      getURL: (path: string) => `chrome-extension://offline-test-extension/${path}`,
      onInstalled: event,
      onMessage: { addListener: vi.fn((listener: typeof onMessage) => { onMessage = listener; }) },
      sendMessage: vi.fn((message: Message) => dispatch(message)),
    },
    contextMenus: { create: vi.fn(), onClicked: { addListener: vi.fn((listener: typeof onContextMenu) => { onContextMenu = listener; }) } },
    commands: { onCommand: event },
    notifications: { onClicked: event },
    tabs: { query: vi.fn().mockResolvedValue([]), sendMessage: vi.fn().mockResolvedValue(undefined) },
  });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试禁止真实网络请求'); }));
  // 仅替换浏览器边界，组件、后台消息、词表队列及学习系统均使用真实实现。
  await import('@/background/index');
  await vi.waitFor(() => expect(local.set).toHaveBeenCalledWith(
    expect.objectContaining({ pendingTranslationRequests: { requests: {} } }),
  ));
}, 60000);

beforeEach(() => {
  syncData = { userProfile: { ...DEFAULT_USER_PROFILE, createdAt: 1, updatedAt: 1 } };
  localData = { knownWords: [], unknownWords: [] };
  local.set.mockReset().mockImplementation(writeLocal);
  vi.clearAllMocks();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
afterAll(() => vi.unstubAllGlobals());

describe('生词本撤销移除 → 真实后台消息与存储', () => {
  it('右键标记生成的空释义词条可以原样撤销，不改变学习记录', async () => {
    await onContextMenu({
      menuItemId: CONTEXT_MENU_IDS.MARK_UNKNOWN, selectionText: ' Unfamiliar ', editable: false,
    }, { id: 1 } as chrome.tabs.Tab);
    const [saved] = (await StorageManager.getUserProfile()).unknownWords;
    expect(saved).toEqual({ word: 'unfamiliar', translation: '', context: '', markedAt: expect.any(Number), reviewCount: 0 });
    const before = await learningState();
    const mark = vi.spyOn(MasteryManager, 'markWord');
    const estimate = vi.spyOn(UserLevelManager, 'updateFromMarking');

    await removeFromSettings(saved.word);
    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));

    expect(await screen.findByText('已恢复 unfamiliar。')).toBeInTheDocument();
    expect(screen.getByText('暂无释义')).toBeInTheDocument();
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual([saved]);
    expect(await learningState()).toEqual(before);
    expect(mark).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('消息标记的空释义词条撤销后保留首次时间、语境和复习次数', async () => {
    expect((await dispatch({ type: 'MARK_WORD_UNKNOWN', payload: original })).success).toBe(true);
    const before = await learningState();
    const mark = vi.spyOn(MasteryManager, 'markWord');
    const estimate = vi.spyOn(UserLevelManager, 'updateFromMarking');

    await removeFromSettings(original.word);
    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));

    await screen.findByText('已恢复 unfamiliar。');
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual([original]);
    expect(screen.getByText(original.context)).toBeInTheDocument();
    expect(await learningState()).toEqual(before);
    expect(mark).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  });

  it.each(['', '   ', null])('外来导入仍拒绝空或非法释义 %j，不写入存储', async translation => {
    const before = structuredClone({ syncData, localData });
    expect(await dispatch({ type: 'IMPORT_VOCABULARY', payload: [{ ...original, translation }] }))
      .toMatchObject({ success: false, error: '数据格式无效' });
    expect({ syncData, localData }).toEqual(before);
  });

  it('恢复模式只保存合法词条字段，控制字段和额外字段不会入库', async () => {
    const before = await learningState();
    expect(await dispatch({ type: 'ADD_TO_VOCABULARY', payload: {
      ...original, word: ' Unfamiliar ', skipIfExists: true, unrelated: '不应保存',
    } })).toEqual({ success: true, data: { added: true } });
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual([original]);
    expect(await learningState()).toEqual(before);
  });

  it.each([
    { translation: null }, { word: null }, { word: '   ' }, { word: 'x'.repeat(201) },
    { context: 1 }, { markedAt: Number.NaN }, { reviewCount: -1 },
  ])('恢复模式拒绝非法字段 %j，且不写入部分数据', async invalid => {
    const before = structuredClone({ syncData, localData });
    expect(await dispatch({ type: 'ADD_TO_VOCABULARY', payload: {
      ...original, ...invalid, skipIfExists: true,
    } })).toMatchObject({ success: false, error: '数据格式无效' });
    expect({ syncData, localData }).toEqual(before);
    expect(sync.set).not.toHaveBeenCalled();
    expect(local.set).not.toHaveBeenCalled();
  });

  it.each(['true', 'false', 1, null])('非布尔恢复选项 %j 不得误入普通覆盖路径', async skipIfExists => {
    localData = { ...localData, knownWords: [original.word] };
    const before = structuredClone({ syncData, localData });
    expect(await dispatch({ type: 'ADD_TO_VOCABULARY', payload: { ...original, skipIfExists } }))
      .toMatchObject({ success: false, error: '数据格式无效' });
    expect({ syncData, localData }).toEqual(before);
  });

  it.each([undefined, false])('未启用恢复选项 %j 时保留普通添加响应与更新语义', async skipIfExists => {
    localData = { ...localData, knownWords: [original.word] };
    expect(await dispatch({ type: 'ADD_TO_VOCABULARY', payload: { ...original, skipIfExists } }))
      .toEqual({ success: true });
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual([original]);
    expect((await StorageManager.getUserProfile()).knownWords).toEqual([]);
  });

  it.each(['known', 'unknown'] as const)('撤销不能覆盖另一页面稍后标记的 %s 状态', async state => {
    await dispatch({ type: 'MARK_WORD_UNKNOWN', payload: original });
    await removeFromSettings(original.word);
    const latest = { ...original, translation: '新的释义', context: '新的语境', markedAt: original.markedAt + 1 };
    const message: Message = state === 'known'
      ? { type: 'MARK_WORD_KNOWN', payload: { word: original.word } }
      : { type: 'MARK_WORD_UNKNOWN', payload: latest };
    expect((await dispatch(message)).success).toBe(true);
    const before = structuredClone({ syncData, localData });
    const mark = vi.spyOn(MasteryManager, 'markWord');
    const estimate = vi.spyOn(UserLevelManager, 'updateFromMarking');

    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));

    await screen.findByText('词条已有新状态，未覆盖；请核对当前生词本。');
    const profile = await StorageManager.getUserProfile();
    expect(profile.unknownWords).toEqual(state === 'known' ? [] : [latest]);
    expect(profile.knownWords).toEqual(state === 'known' ? [original.word] : []);
    expect({ syncData, localData }).toEqual(before);
    expect(mark).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '撤销移除' })).not.toBeInTheDocument();
  });

  it.each(['known', 'unknown'] as const)('另一个页面的 %s 标记尚在写入时，撤销在同一队列内检查最新状态', async state => {
    await dispatch({ type: 'MARK_WORD_UNKNOWN', payload: original });
    await removeFromSettings(original.word);
    const latest = { ...original, context: '并发写入的新语境' };
    const entered = deferred();
    const release = deferred();
    local.set.mockImplementationOnce(async updates => {
      entered.resolve();
      await release.promise;
      await writeLocal(updates);
    });
    const marking = dispatch(state === 'known'
      ? { type: 'MARK_WORD_KNOWN', payload: { word: original.word } }
      : { type: 'MARK_WORD_UNKNOWN', payload: latest });
    await entered.promise;
    try {
      fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));
      await waitFor(() => expect(screen.getByRole('button', { name: '撤销移除' })).toBeDisabled());
    } finally {
      release.resolve();
      expect((await marking).success).toBe(true);
    }

    await screen.findByText('词条已有新状态，未覆盖；请核对当前生词本。');
    expect((await StorageManager.getUserProfile()).knownWords).toEqual(state === 'known' ? [original.word] : []);
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual(state === 'unknown' ? [latest] : []);
  });

  it('同时恢复同一空释义词时只插入一次，后续恢复不能改写语境', async () => {
    const later = { ...original, context: '迟到的旧语境' };
    const responses = await Promise.all([
      dispatch({ type: 'ADD_TO_VOCABULARY', payload: { ...original, skipIfExists: true } }),
      dispatch({ type: 'ADD_TO_VOCABULARY', payload: { ...later, skipIfExists: true } }),
    ]);
    expect(responses).toEqual([
      { success: true, data: { added: true } }, { success: true, data: { added: false } },
    ]);
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual([original]);
    expect(local.set).toHaveBeenCalledTimes(1);
  });

  it('撤销持久化失败后保留操作入口，重试恢复原记录', async () => {
    await dispatch({ type: 'MARK_WORD_UNKNOWN', payload: original });
    await removeFromSettings(original.word);
    const before = await learningState();
    local.set.mockRejectedValueOnce(new Error('存储暂不可用'));

    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('恢复失败，可再次撤销移除。');
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));

    await screen.findByText('已恢复 unfamiliar。');
    expect((await StorageManager.getUserProfile()).unknownWords).toEqual([original]);
    expect(await learningState()).toEqual(before);
  });
});
