import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import TranslationHistory from '@/options/components/TranslationHistory';
import type { HistoryQueryResult, TranslationHistoryEntry } from '@/background/translationHistory';
import { logger } from '@/shared/utils';

vi.mock('@/shared/utils', () => ({ logger: { error: vi.fn() } }));

const stats = { totalEntries: 2, totalCharacters: 42, uniquePages: 1, last7Days: 2, last30Days: 2 };
const first: TranslationHistoryEntry = {
  id: 'one', originalText: 'Private original', pageUrl: 'https://example.com/', pageTitle: 'Example',
  translation: { fullText: '保密译文', words: [{ original: 'Private', translation: '私密' }] } as TranslationHistoryEntry['translation'],
  mode: 'bilingual', timestamp: 1700000000000, charCount: 16,
  userLevel: { level: 'B2', estimatedVocabulary: 5000 },
};
const second: TranslationHistoryEntry = {
  ...first, id: 'two', originalText: 'Another original', translation: { fullText: '另一条译文', words: [] } as TranslationHistoryEntry['translation'],
  mode: 'full-translate',
};
const page = (entries: TranslationHistoryEntry[], hasMore = false): HistoryQueryResult => ({
  entries, hasMore, total: entries.length,
});
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
    if (message.type === 'GET_HISTORY_STATS') return { success: true, data: stats };
    if (message.type === 'QUERY_TRANSLATION_HISTORY') return { success: true, data: page([first]) };
    return { success: true };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const messages = (type: string) => sendMessage.mock.calls.filter(([message]) => message.type === type);

async function load() {
  render(<TranslationHistory />);
  await screen.findByText('Private original');
}

describe('设置页翻译历史', () => {
  it('首次加载仅查询第一页和统计数据，详情仅在打开时展示完整内容', async () => {
    await load();
    await waitFor(() => expect(messages('QUERY_TRANSLATION_HISTORY')).toHaveLength(1));
    expect(messages('QUERY_TRANSLATION_HISTORY')[0][0]).toEqual({
      type: 'QUERY_TRANSLATION_HISTORY', payload: { params: { keyword: undefined, limit: 20, offset: 0 } },
    });
    expect(messages('GET_HISTORY_STATS')).toHaveLength(1);
    expect(screen.getByText('总记录').previousElementSibling).toHaveTextContent('2');
    fireEvent.click(screen.getByText('Private original'));
    const detail = screen.getByRole('dialog', { name: '翻译详情' });
    expect(within(detail).getByText('保密译文')).toBeInTheDocument();
    expect(within(detail).getByText('Private → 私密')).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Example' })).toHaveAttribute('href', 'https://example.com/');
    fireEvent.click(within(detail).getByRole('button', { name: '关闭详情' }));
    expect(screen.queryByRole('dialog', { name: '翻译详情' })).toBeNull();
  });

  it('输入关键词前不查询；提交搜索后重置分页，再按实际返回量加载更多', async () => {
    sendMessage.mockImplementation(async (message: { type: string; payload?: { params?: { keyword?: string; offset: number } } }) => {
      if (message.type === 'GET_HISTORY_STATS') return { success: true, data: stats };
      const { keyword, offset } = message.payload?.params ?? { offset: 0 };
      return { success: true, data: keyword ? (offset === 0 ? page([second], true) : page([first])) : page([first]) };
    });
    await load();
    fireEvent.change(screen.getByRole('textbox', { name: '搜索翻译历史' }), { target: { value: '你好 👋' } });
    expect(messages('QUERY_TRANSLATION_HISTORY')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '搜索翻译历史' }), { key: 'Enter' });
    await screen.findByText('Another original');
    expect(screen.queryByText('Private original')).toBeNull();
    expect(messages('QUERY_TRANSLATION_HISTORY')[1][0].payload.params).toEqual({ keyword: '你好 👋', limit: 20, offset: 0 });
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await screen.findByText('Private original');
    expect(messages('QUERY_TRANSLATION_HISTORY')[2][0].payload.params).toEqual({ keyword: '你好 👋', limit: 20, offset: 1 });
    expect(messages('QUERY_TRANSLATION_HISTORY')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('旧搜索结果迟到时不可覆盖新的搜索结果', async () => {
    let finishOld!: (value: unknown) => void;
    sendMessage.mockImplementation((message: { type: string; payload?: { params?: { keyword?: string } } }) => {
      if (message.type === 'GET_HISTORY_STATS') return Promise.resolve({ success: true, data: stats });
      if (message.payload?.params?.keyword === 'old') return new Promise((resolve) => { finishOld = resolve; });
      return Promise.resolve({ success: true, data: message.payload?.params?.keyword === 'new' ? page([second]) : page([first]) });
    });
    await load();
    const input = screen.getByRole('textbox', { name: '搜索翻译历史' });
    fireEvent.change(input, { target: { value: 'old' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(finishOld).toBeDefined());
    fireEvent.change(input, { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await screen.findByText('Another original');
    await act(async () => { finishOld({ success: true, data: page([first]) }); });
    expect(screen.queryByText('Private original')).toBeNull();
  });

  it('搜索在途时删除旧列表单条记录，仍呈现新搜索且不会恢复已删除记录', async () => {
    const oldRemainder = { ...first, id: 'old-remainder', originalText: 'Old remainder' };
    let finishSearch!: (value: unknown) => void;
    sendMessage.mockImplementation((message: { type: string; payload?: { params?: { keyword?: string } } }) => {
      if (message.type === 'GET_HISTORY_STATS') return Promise.resolve({ success: true, data: stats });
      if (message.type === 'DELETE_HISTORY_ENTRY') return Promise.resolve({ success: true });
      if (message.payload?.params?.keyword === 'new') return new Promise((resolve) => { finishSearch = resolve; });
      return Promise.resolve({ success: true, data: page([first, oldRemainder]) });
    });
    await load();
    await screen.findByText('Old remainder');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索翻译历史' }), { target: { value: 'new' } });
    fireEvent.click(screen.getByRole('button', { name: '搜索' }));
    await waitFor(() => expect(finishSearch).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: /删除翻译记录：Private original/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(screen.queryByText('Private original')).toBeNull());
    await act(async () => { finishSearch({ success: true, data: page([first, second]) }); });
    expect(screen.getByText('Another original')).toBeInTheDocument();
    expect(screen.queryByText('Private original')).toBeNull();
    expect(screen.queryByText('Old remainder')).toBeNull();
  });

  it('取消删除不发送消息；确认单条删除后刷新统计', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: /删除翻译记录/ }));
    expect(messages('DELETE_HISTORY_ENTRY')).toHaveLength(0);
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '取消' }));
    expect(messages('DELETE_HISTORY_ENTRY')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /删除翻译记录/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(messages('DELETE_HISTORY_ENTRY')).toHaveLength(1));
    expect(messages('DELETE_HISTORY_ENTRY')[0][0].payload).toEqual({ id: 'one' });
    await screen.findByText('暂无翻译记录');
    expect(messages('GET_HISTORY_STATS')).toHaveLength(2);
    expect(screen.getByText('已删除')).toBeInTheDocument();
  });

  it('清空所有记录必须确认；成功后隐藏历史与操作按钮', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(messages('CLEAR_ALL_HISTORY')).toHaveLength(0);
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '删除' }));
    await screen.findByText('暂无翻译记录');
    expect(messages('CLEAR_ALL_HISTORY')).toHaveLength(1);
    expect(screen.getByRole('button', { name: '导出' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '清空' })).toBeDisabled();
  });

  it('清空历史后忽略仍在途的分页响应，避免已删除记录回流', async () => {
    let finishPage!: (value: unknown) => void;
    sendMessage.mockImplementation((message: { type: string; payload?: { params?: { offset: number } } }) => {
      if (message.type === 'GET_HISTORY_STATS') return Promise.resolve({ success: true, data: stats });
      if (message.type === 'CLEAR_ALL_HISTORY') return Promise.resolve({ success: true });
      if (message.payload?.params?.offset === 1) return new Promise((resolve) => { finishPage = resolve; });
      return Promise.resolve({ success: true, data: page([first], true) });
    });
    await load();
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }));
    await waitFor(() => expect(finishPage).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '删除' }));
    await screen.findByText('暂无翻译记录');
    await act(async () => { finishPage({ success: true, data: page([second]) }); });
    expect(screen.queryByText('Another original')).toBeNull();
    expect(screen.queryByRole('button', { name: '加载更多' })).toBeNull();
  });

  it('导出完整历史快照并释放临时 URL；空列表不能导出', async () => {
    const create = vi.fn(() => 'blob:test');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_HISTORY_STATS') return { success: true, data: stats };
      if (message.type === 'EXPORT_HISTORY_DATA') return { success: true, data: { entries: [first, second] } };
      return { success: true, data: page([first]) };
    });
    await load();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(revoke).toHaveBeenCalledWith('blob:test');
    expect(screen.getByRole('status')).toHaveTextContent('导出成功');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('导出等待中清空历史后，迟到的旧快照不得创建下载', async () => {
    let finishExport!: (value: unknown) => void;
    const create = vi.fn(() => 'blob:stale');
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    sendMessage.mockImplementation((message: { type: string }) => {
      if (message.type === 'GET_HISTORY_STATS') return Promise.resolve({ success: true, data: stats });
      if (message.type === 'EXPORT_HISTORY_DATA') return new Promise((resolve) => { finishExport = resolve; });
      if (message.type === 'CLEAR_ALL_HISTORY') return Promise.resolve({ success: true });
      return Promise.resolve({ success: true, data: page([first]) });
    });
    await load();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await waitFor(() => expect(finishExport).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '删除' }));
    await screen.findByText('暂无翻译记录');
    await act(async () => { finishExport({ success: true, data: { entries: [first] } }); });
    expect(create).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(screen.queryByText('导出成功')).toBeNull();
  });

  it('下载启动失败时撤销包含隐私数据的临时链接并给出安全提示', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:private'), revokeObjectURL: revoke });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw new Error('SECRET_DOWNLOAD_ERROR'); });
    sendMessage.mockImplementation(async (message: { type: string }) => message.type === 'GET_HISTORY_STATS'
      ? { success: true, data: stats }
      : message.type === 'EXPORT_HISTORY_DATA'
        ? { success: true, data: { entries: [first] } }
        : { success: true, data: page([first]) });
    await load();
    fireEvent.click(screen.getByRole('button', { name: '导出' }));
    await screen.findByText('导出失败');
    expect(revoke).toHaveBeenCalledWith('blob:private');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(document.body).not.toHaveTextContent('SECRET_DOWNLOAD_ERROR');
    expect(vi.mocked(logger.error).mock.calls.flat().join(' ')).not.toContain('SECRET_DOWNLOAD_ERROR');
  });

  it.each(['查询', '删除', '清空', '导出'] as const)('%s响应失败时显示通用提示且不泄漏后台敏感错误', async (action) => {
    const secret = 'SECRET_PRIVATE_TEXT_TOKEN';
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_HISTORY_STATS') return { success: true, data: stats };
      if (message.type === 'QUERY_TRANSLATION_HISTORY') return action === '查询'
        ? { success: false, error: secret } : { success: true, data: page([first]) };
      return { success: false, error: secret };
    });
    render(<TranslationHistory />);
    if (action === '查询') {
      await screen.findByText('加载失败');
    } else {
      await screen.findByText('Private original');
      if (action === '删除') fireEvent.click(screen.getByRole('button', { name: /删除翻译记录/ }));
      if (action === '清空') fireEvent.click(screen.getByRole('button', { name: '清空' }));
      if (action === '导出') fireEvent.click(screen.getByRole('button', { name: '导出' }));
      else fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '删除' }));
      await screen.findByText(`${action}失败`);
      expect(screen.getByText('Private original')).toBeInTheDocument();
    }
    expect(document.body).not.toHaveTextContent(secret);
  });

  it('历史记录中不可信的页面地址不能作为可点击的脚本链接', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) => message.type === 'GET_HISTORY_STATS'
      ? { success: true, data: stats }
      : { success: true, data: page([{ ...first, pageUrl: 'javascript:alert(1)' }]) });
    await load();
    fireEvent.click(screen.getByText('Private original'));
    expect(within(screen.getByRole('dialog', { name: '翻译详情' })).queryByRole('link')).toBeNull();
  });

  it('发送消息抛错时给出安全失败提示，历史记录不丢失', async () => {
    sendMessage.mockImplementation(async (message: { type: string }) => {
      if (message.type === 'GET_HISTORY_STATS') throw new Error('private stats');
      if (message.type === 'DELETE_HISTORY_ENTRY') throw new Error('private delete');
      return { success: true, data: page([first]) };
    });
    await load();
    fireEvent.click(screen.getByRole('button', { name: /删除翻译记录/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '确认删除' })).getByRole('button', { name: '删除' }));
    await screen.findByText('删除失败');
    expect(screen.getByText('Private original')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('private delete');
    expect(vi.mocked(logger.error).mock.calls.flat().join(' ')).not.toContain('private delete');
    expect(vi.mocked(logger.error).mock.calls.flat().join(' ')).not.toContain('private stats');
  });
});
