import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CacheStatsPanel from '@/options/components/CacheStats';

const stats = { totalEntries: 1536, memoryUsage: 2048 };
const metrics = { hitRate: 82.5, totalRequests: 120, hits: 99, misses: 21, avgApiDuration: 325, avgTotalDuration: 75 };
const sendMessage = vi.fn();
const respond = ({ type }: { type: string }) => {
  if (type === 'GET_CACHE_STATS') return Promise.resolve({ success: true, data: stats });
  if (type === 'GET_CACHE_METRICS') return Promise.resolve({ success: true, data: metrics });
  if (type === 'CLEAR_TRANSLATION_CACHE' || type === 'RESET_CACHE_METRICS') return Promise.resolve({ success: true });
  throw new Error(`未知消息 ${type}`);
};
const calls = (type: string) => sendMessage.mock.calls.filter(([message]: [{ type: string }]) => message.type === type);
async function load() { render(<CacheStatsPanel />); await screen.findByText('82.5%'); }

beforeEach(() => { sendMessage.mockReset(); sendMessage.mockImplementation(respond); vi.stubGlobal('chrome', { runtime: { sendMessage } }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('缓存统计面板', () => {
  it('加载后台两类统计，展示格式化后的真实指标', async () => {
    render(<CacheStatsPanel />);
    expect(screen.getByRole('status', { name: '加载缓存统计中' })).toBeInTheDocument();
    expect(await screen.findByText('82.5%')).toBeInTheDocument();
    expect(screen.getByText('75ms')).toBeInTheDocument();
    expect(screen.getByText('1,536')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('325ms')).toBeInTheDocument();
    expect(sendMessage.mock.calls.map(([message]) => message)).toEqual([
      { type: 'GET_CACHE_STATS' }, { type: 'GET_CACHE_METRICS' },
    ]);
  });

  it('后台返回空统计时显示零值，不误触发写入消息', async () => {
    sendMessage.mockImplementation(({ type }: { type: string }) => Promise.resolve({ success: true, data: type === 'GET_CACHE_STATS' ? { totalEntries: 0, memoryUsage: 0 } : { hitRate: 0, totalRequests: 0, hits: 0, misses: 0, avgApiDuration: 0, avgTotalDuration: 0 } }));
    render(<CacheStatsPanel />);
    expect(await screen.findByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('0 B')).toBeInTheDocument();
    expect(screen.getAllByText('0').length).toBeGreaterThan(0);
    expect(calls('CLEAR_TRANSLATION_CACHE')).toHaveLength(0);
  });

  it('任一读取返回失败时显示错误，不伪装成零统计，刷新可以重试', async () => {
    sendMessage.mockImplementation(({ type }: { type: string }) => type === 'GET_CACHE_METRICS'
      ? Promise.resolve({ success: false, error: '指标不可用' }) : respond({ type }));
    render(<CacheStatsPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载缓存统计失败');
    expect(screen.queryByText('0.0%')).not.toBeInTheDocument();
    sendMessage.mockImplementation(respond);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('82.5%')).toBeInTheDocument();
    expect(calls('GET_CACHE_METRICS')).toHaveLength(2);
  });

  it('用户取消清空时不发送删除消息；确认后按后台消息契约清空并刷新', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '清空缓存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('确定要清空所有翻译缓存吗');
    expect(calls('CLEAR_TRANSLATION_CACHE')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '清空缓存' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByText('缓存已清空')).toBeInTheDocument();
    expect(calls('CLEAR_TRANSLATION_CACHE')).toEqual([[{ type: 'CLEAR_TRANSLATION_CACHE' }]]);
    await waitFor(() => expect(calls('GET_CACHE_STATS')).toHaveLength(2));
  });

  it('重置统计发送独立消息并刷新，手动刷新再次读取两类指标', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '重置统计' }));
    expect(screen.getByRole('alert')).toHaveTextContent('确定要重置缓存统计吗');
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByText('统计已重置')).toBeInTheDocument();
    expect(calls('RESET_CACHE_METRICS')).toEqual([[{ type: 'RESET_CACHE_METRICS' }]]);
    await waitFor(() => expect(calls('GET_CACHE_METRICS')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => expect(calls('GET_CACHE_METRICS')).toHaveLength(3));
    expect(screen.getByText('82.5%')).toBeInTheDocument();
  });

  it('清空失败响应不能报告成功，也不应刷新统计', async () => {
    await load();
    sendMessage.mockImplementation(({ type }: { type: string }) => type === 'CLEAR_TRANSLATION_CACHE'
      ? Promise.resolve({ success: false, error: '无法清空' }) : respond({ type }));
    fireEvent.click(screen.getByRole('button', { name: '清空缓存' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByText('清空失败')).toBeInTheDocument();
    expect(calls('GET_CACHE_STATS')).toHaveLength(1);
  });

  it('重置失败响应提示失败且不刷新', async () => {
    await load();
    sendMessage.mockImplementation(({ type }: { type: string }) => type === 'RESET_CACHE_METRICS'
      ? Promise.resolve({ success: false, error: '重置失败' }) : respond({ type }));
    fireEvent.click(screen.getByRole('button', { name: '重置统计' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByText('重置失败')).toBeInTheDocument();
    expect(calls('GET_CACHE_STATS')).toHaveLength(1);
  });

  it('成功操作的提示在三秒后消失，指标仍可读取', async () => {
    await load();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '清空缓存' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('缓存已清空')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByText('缓存已清空')).not.toBeInTheDocument();
    expect(screen.getByText('82.5%')).toBeInTheDocument();
  });

  it('重置抛出异常时提示失败且不刷新', async () => {
    await load();
    sendMessage.mockImplementation(({ type }: { type: string }) => type === 'RESET_CACHE_METRICS'
      ? Promise.reject(new Error('离线')) : respond({ type }));
    fireEvent.click(screen.getByRole('button', { name: '重置统计' }));
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(await screen.findByText('重置失败')).toBeInTheDocument();
    expect(calls('GET_CACHE_METRICS')).toHaveLength(1);
  });

  it('定时刷新每 30 秒重新读取；卸载后停止刷新', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<CacheStatsPanel />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('82.5%')).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(calls('GET_CACHE_STATS')).toHaveLength(2);
    unmount();
    await act(async () => { vi.advanceTimersByTime(30000); });
    expect(calls('GET_CACHE_STATS')).toHaveLength(2);
  });
});
