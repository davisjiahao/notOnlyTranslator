import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VocabularySettings from '@/options/components/VocabularySettings';
vi.mock('@/options/components/VocabularyExportImport', () => ({ default: () => <div>导入导出</div> }));
const entries = ['apple', 'book'].map(word => ({ word, translation: word === 'apple' ? '苹果' : '书', context: '示例语境', markedAt: 1000, reviewCount: 0 }));
let data = [...entries];
let sendMessage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  data = [...entries];
  sendMessage = vi.fn(async ({ type, payload }) => {
    if (type === 'GET_VOCABULARY') return { success: true, data: [...data] };
    if (type === 'REMOVE_FROM_VOCABULARY') { data = data.filter(entry => entry.word !== payload.word); return { success: true }; }
    if (type === 'IMPORT_VOCABULARY') {
      if (!payload[0].translation.trim()) return { success: false, error: '数据格式无效' };
      data = [...data, payload[0]];
      return { success: true, data: { imported: 1, skipped: 0 } };
    }
    if (type === 'ADD_TO_VOCABULARY' && payload.skipIfExists === true) {
      const { skipIfExists: _skipIfExists, ...entry } = payload;
      const added = !data.some(word => word.word === entry.word);
      if (added) data = [...data, entry];
      return { success: true, data: { added } };
    }
    return { success: true };
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage, getURL: (path: string) => `chrome-extension://test/${path}` } });
});
afterEach(() => vi.unstubAllGlobals());

describe('生词筛选、移除与手动复习', () => {
  it('仅复习筛选结果，不要求收藏先出现在到期队列；返回后保留筛选', async () => {
    render(<VocabularySettings isSaving={false} />);
    await screen.findByText('apple');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '苹果' } });
    fireEvent.click(screen.getByRole('button', { name: '复习筛选结果（1）' }));
    expect(await screen.findByText('卡片 1 / 1')).toBeInTheDocument();
    expect(screen.getByText('apple')).toBeInTheDocument();
    expect(screen.queryByText('book')).not.toBeInTheDocument();
    expect(sendMessage.mock.calls.some(([message]) => message.type === 'GET_REVIEW_WORDS')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '返回生词本' }));
    expect(await screen.findByRole('textbox')).toHaveValue('苹果');
  });
  it('空筛选说明恢复操作，不启动空复习', async () => {
    render(<VocabularySettings isSaving={false} />);
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'zzzz' } });
    expect(screen.getByText('未找到匹配的词汇')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复习筛选结果（0）' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('apple')).toBeInTheDocument();
  });
  it('删除失败保留词条；成功后可撤销单条移除并保留原数据', async () => {
    render(<VocabularySettings isSaving={false} />);
    await screen.findByText('apple');
    sendMessage.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByRole('button', { name: '移除：apple' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('移除失败');
    expect(screen.getByText('apple')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除：apple' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销移除' }));
    expect(await screen.findByText('apple')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ADD_TO_VOCABULARY', payload: { ...entries[0], skipIfExists: true } });
  });
  it('空释义词条撤销后仍显示暂无释义，而不是伪造导入内容', async () => {
    data = [{ ...entries[0], translation: '' }];
    render(<VocabularySettings isSaving={false} />);
    expect(await screen.findByText('暂无释义')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除：apple' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销移除' }));

    expect(await screen.findByText('已恢复 apple。')).toBeInTheDocument();
    expect(screen.getByText('暂无释义')).toBeInTheDocument();
    expect(data).toEqual([{ ...entries[0], translation: '' }]);
  });
  it('恢复失败保留撤销入口；后端跳过新状态时不宣称恢复成功', async () => {
    render(<VocabularySettings isSaving={false} />);
    fireEvent.click(await screen.findByRole('button', { name: '移除：apple' }));
    await screen.findByRole('button', { name: '撤销移除' });
    sendMessage.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('恢复失败，可再次撤销移除。');
    expect(screen.getByRole('button', { name: '撤销移除' })).toBeEnabled();

    sendMessage.mockResolvedValueOnce({ success: true, data: { added: false } });
    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));
    expect(await screen.findByText('词条已有新状态，未覆盖；请核对当前生词本。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '撤销移除' })).not.toBeInTheDocument();
    expect(screen.queryByText('已恢复 apple。')).not.toBeInTheDocument();
  });
  it.each([undefined, 1, 'true'])('只有明确 added=true 才能宣称恢复成功，不能接受 %j', async added => {
    render(<VocabularySettings isSaving={false} />);
    fireEvent.click(await screen.findByRole('button', { name: '移除：apple' }));
    await screen.findByRole('button', { name: '撤销移除' });
    sendMessage.mockResolvedValueOnce({ success: true, data: { added } });
    fireEvent.click(screen.getByRole('button', { name: '撤销移除' }));
    await screen.findByText('词条已有新状态，未覆盖；请核对当前生词本。');
    expect(screen.queryByText('已恢复 apple。')).not.toBeInTheDocument();
  });
  it('清空中途失败只移除已确认成功的条目，不能把剩余列表清零', async () => {
    render(<VocabularySettings isSaving={false} />);
    await screen.findByText('apple');
    sendMessage.mockImplementation(async ({ type, payload }) => {
      if (type === 'REMOVE_FROM_VOCABULARY') return { success: payload.word === 'apple' };
      return { success: true, data };
    });
    fireEvent.click(screen.getByRole('button', { name: '清空生词本' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('已移除 1 个');
    expect(screen.getByText('book')).toBeInTheDocument();
    expect(screen.queryByText('生词本为空')).not.toBeInTheDocument();
  });
  it('加载失败不伪装为空列表，重试后恢复', async () => {
    sendMessage.mockRejectedValueOnce(new Error('离线'));
    render(<VocabularySettings isSaving={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载生词本失败');
    expect(screen.queryByText('生词本为空')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    await waitFor(() => expect(screen.getByText('apple')).toBeInTheDocument());
  });
});
