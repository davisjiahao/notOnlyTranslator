import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ErrorDashboard from '@/options/components/ErrorDashboard';
import type { ErrorEntry, ErrorStats } from '@/shared/error-tracking/types';

const sample: ErrorEntry = {
  id: 'error-1', message: '翻译请求失败', category: 'translation', severity: 'error',
  timestamp: 1700000000000, firstOccurredAt: 1700000000000, count: 2, reported: false,
  stack: 'stack trace', context: { component: 'Translator', action: 'translate' },
};
const stats: ErrorStats = {
  totalErrors: 1, unreportedErrors: 1, last24Hours: 1, last7Days: 1,
  byCategory: { runtime: 0, network: 0, storage: 0, translation: 1, api: 0, ui: 0, unknown: 0 },
  bySeverity: { fatal: 0, error: 1, warning: 0 }, topErrors: [],
};
let sendMessage: ReturnType<typeof vi.fn>;
let records: ErrorEntry[];

beforeEach(() => {
  records = [sample];
  sendMessage = vi.fn(async (message: { type: string; payload?: { params?: { category?: string; reported?: boolean }; id?: string; ids?: string[] } }) => {
    switch (message.type) {
      case 'GET_ERROR_STATS': return { success: true, data: { ...stats, totalErrors: records.length, unreportedErrors: records.filter(error => !error.reported).length } };
      case 'QUERY_ERRORS': {
        if (!message.payload?.params) return { success: false, error: '参数无效' };
        const { category, reported } = message.payload.params;
        const errors = records.filter(error => (!category || error.category === category)
          && (reported === undefined || error.reported === reported));
        return { success: true, data: { errors, total: errors.length, hasMore: false } };
      }
      case 'DELETE_ERROR':
        if (!message.payload?.id) return { success: false, error: '缺少 ID' };
        records = records.filter(error => error.id !== message.payload?.id);
        return { success: true };
      case 'MARK_ERRORS_AS_REPORTED':
        if (!message.payload?.ids) return { success: false, error: '缺少 ID 列表' };
        records = records.map(error => message.payload?.ids?.includes(error.id) ? { ...error, reported: true } : error);
        return { success: true };
      case 'REPORT_ERRORS':
        if (!message.payload) return { success: false, error: '缺少载荷' };
        records = records.map(error => ({ ...error, reported: true }));
        return { success: true };
      case 'CLEAR_ALL_ERRORS': records = []; return { success: true };
      default: throw new Error('未知消息');
    }
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sent = (type: string) => sendMessage.mock.calls.filter(([message]) => message.type === type);

async function load() {
  render(<ErrorDashboard />);
  await screen.findByText('翻译请求失败');
}

describe('错误仪表板与后台消息契约', () => {
  it('加载错误、打开详情，并按过滤条件重新查询', async () => {
    await load();
    expect(sent('QUERY_ERRORS')[0][0]).toEqual({ type: 'QUERY_ERRORS', payload: { params: { limit: 100 } } });
    fireEvent.click(screen.getByText('翻译请求失败'));
    expect(within(screen.getByRole('dialog')).getByText('stack trace')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭错误详情' }));
    fireEvent.change(screen.getByLabelText('错误分类过滤'), { target: { value: 'network' } });
    await waitFor(() => expect(screen.getByText('暂无错误记录')).toBeInTheDocument());
    expect(sent('QUERY_ERRORS').at(-1)?.[0]).toEqual({ type: 'QUERY_ERRORS', payload: { params: { limit: 100, category: 'network' } } });
    fireEvent.click(screen.getByRole('button', { name: '重置过滤' }));
    await screen.findByText('翻译请求失败');
  });

  it('标记上报和删除单条错误使用后台载荷，刷新可见状态', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '标记已上报' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '标记已上报' })).toBeNull());
    expect(sent('MARK_ERRORS_AS_REPORTED')[0][0]).toEqual({ type: 'MARK_ERRORS_AS_REPORTED', payload: { ids: ['error-1'] } });
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await screen.findByText('暂无错误记录');
    expect(sent('DELETE_ERROR')[0][0]).toEqual({ type: 'DELETE_ERROR', payload: { id: 'error-1' } });
  });

  it('上报全部待处理错误后更新数量', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '上报未上报错误 (1)' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '上报未上报错误 (0)' })).toBeDisabled());
    expect(sent('REPORT_ERRORS')[0][0]).toEqual({ type: 'REPORT_ERRORS', payload: {} });
  });

  it('旧刷新请求迟到时不能覆盖新分类的错误记录', async () => {
    const original = sendMessage.getMockImplementation()!;
    let delayRefresh = false;
    let finishRefresh!: (value: unknown) => void;
    sendMessage.mockImplementation((message: { type: string; payload?: { params?: { category?: string } } }) =>
      delayRefresh && message.type === 'QUERY_ERRORS' && !message.payload?.params?.category
        ? new Promise(resolve => { finishRefresh = resolve; }) : original(message));
    await load();
    delayRefresh = true;
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(finishRefresh).toBeDefined());
    fireEvent.change(screen.getByLabelText('错误分类过滤'), { target: { value: 'translation' } });
    await waitFor(() => expect(sent('QUERY_ERRORS').at(-1)?.[0].payload.params.category).toBe('translation'));
    await act(async () => { finishRefresh({ success: true, data: { errors: [], total: 0, hasMore: false } }); });
    expect(screen.getByText('翻译请求失败')).toBeInTheDocument();
  });

  it('读取失败时明确显示错误而非声称没有错误，刷新后可重试', async () => {
    const original = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementationOnce(original).mockImplementationOnce(async () => ({ success: false, error: '查询错误列表失败' }));
    render(<ErrorDashboard />);
    await screen.findByRole('alert');
    expect(screen.queryByText('暂无错误记录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await screen.findByText('翻译请求失败');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('上报请求失败时仍显示未上报错误并提示失败', async () => {
    const original = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation((message: { type: string; payload?: unknown }) =>
      message.type === 'REPORT_ERRORS' ? Promise.resolve({ success: false, error: '未配置上报服务' }) : original(message));
    await load();
    fireEvent.click(screen.getByRole('button', { name: '上报未上报错误 (1)' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: '上报未上报错误 (1)' })).toBeEnabled();
  });

  it('旧统计响应迟到时不能覆盖删除后的新统计', async () => {
    const original = sendMessage.getMockImplementation()!;
    let finishStats!: (value: unknown) => void;
    let holdStats = false;
    sendMessage.mockImplementation((message: { type: string }) => {
      if (message.type !== 'GET_ERROR_STATS') return original(message);
      if (holdStats) return new Promise(resolve => { finishStats = resolve; });
      return Promise.resolve({ success: true, data: { ...stats, totalErrors: records.length, unreportedErrors: records.filter(e => !e.reported).length } });
    });
    await load();
    // 上报触发的统计请求被挂起（旧响应），随后删除完成并返回新统计
    holdStats = true;
    fireEvent.click(screen.getByRole('button', { name: '上报未上报错误 (1)' }));
    await waitFor(() => expect(finishStats).toBeDefined());
    holdStats = false;
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    await screen.findByText('暂无错误记录');
    await act(async () => {
      finishStats({ success: true, data: { ...stats, totalErrors: 1, unreportedErrors: 1 } });
    });
    expect(screen.getByText('总错误数').nextElementSibling).toHaveTextContent('0');
  });

  it('详情弹窗内删除失败时保留弹窗并提示失败', async () => {
    const original = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation((message: { type: string }) =>
      message.type === 'DELETE_ERROR' ? Promise.resolve({ success: false, error: '删除错误失败' }) : original(message));
    await load();
    fireEvent.click(screen.getByText('翻译请求失败'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除此错误' }));
    await screen.findByRole('alert');
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('翻译请求失败')).toBeInTheDocument();
  });

  it('清空需要确认，取消不会发送消息，确认后删除记录', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '清除所有错误' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(sent('CLEAR_ALL_ERRORS')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '清除所有错误' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await screen.findByText('暂无错误记录');
    expect(sent('CLEAR_ALL_ERRORS')).toHaveLength(1);
  });
});
