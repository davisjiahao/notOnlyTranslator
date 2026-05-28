/**
 * useQuota Hook 测试
 *
 * 覆盖配额状态、消耗、刷新、初始化、警告
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQuota, useQuotaCheck, useQuotaAlert } from '@/shared/hooks/useQuota';

// Mock quota module
const mockGetQuotaStatus = vi.fn();
const mockConsumeQuota = vi.fn();
const mockHasEnoughQuota = vi.fn();
const mockInitializeNewUserQuota = vi.fn();

vi.mock('@/shared/analytics/quota', () => ({
  getQuotaStatus: (...args: any[]) => mockGetQuotaStatus(...args),
  consumeQuota: (...args: any[]) => mockConsumeQuota(...args),
  hasEnoughQuota: (...args: any[]) => mockHasEnoughQuota(...args),
  initializeNewUserQuota: (...args: any[]) => mockInitializeNewUserQuota(...args),
}));

// 辅助：刷新所有挂起的 Promise
async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始状态为加载中', () => {
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 0,
      remaining: 100,
      alert: undefined,
    });

    const { result } = renderHook(() => useQuota());

    expect(result.current.loading).toBe(true);
    expect(result.current.total).toBe(0);
    expect(result.current.used).toBe(0);
    expect(result.current.remaining).toBe(0);
    expect(result.current.hasQuota).toBe(false);
  });

  it('挂载后加载配额状态', async () => {
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 30,
      remaining: 70,
      alert: undefined,
    });

    const { result } = renderHook(() => useQuota());
    await flushPromises();

    expect(result.current.loading).toBe(false);
    expect(result.current.total).toBe(100);
    expect(result.current.used).toBe(30);
    expect(result.current.remaining).toBe(70);
    expect(result.current.hasQuota).toBe(true);
  });

  it('配额为0时 hasQuota 为 false', async () => {
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 100,
      remaining: 0,
      alert: { level: 'exhausted', message: '配额已用完', remaining: 0 },
    });

    const { result } = renderHook(() => useQuota());
    await flushPromises();

    expect(result.current.hasQuota).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it('加载失败时不崩溃', async () => {
    mockGetQuotaStatus.mockRejectedValue(new Error('Storage error'));

    const { result } = renderHook(() => useQuota());
    await flushPromises();

    expect(result.current.loading).toBe(false);
    expect(result.current.total).toBe(0);
  });

  describe('consume', () => {
    it('成功消耗配额', async () => {
      mockGetQuotaStatus.mockResolvedValue({
        total: 100,
        used: 10,
        remaining: 90,
        alert: undefined,
      });
      mockConsumeQuota.mockResolvedValue({
        success: true,
        remaining: 89,
        alert: undefined,
      });

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      expect(result.current.remaining).toBe(90);

      let success: boolean;
      await act(async () => {
        success = await result.current.consume('translation');
      });

      expect(mockConsumeQuota).toHaveBeenCalledWith('translation');
      expect(success!).toBe(true);
      expect(result.current.remaining).toBe(89);
      expect(result.current.used).toBe(11);
    });

    it('消耗失败时返回 false', async () => {
      mockGetQuotaStatus.mockResolvedValue({
        total: 100,
        used: 100,
        remaining: 0,
        alert: { level: 'exhausted', message: '已用完', remaining: 0 },
      });
      mockConsumeQuota.mockResolvedValue({
        success: false,
        remaining: 0,
        alert: { level: 'exhausted', message: '已用完', remaining: 0 },
      });

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      let success: boolean;
      await act(async () => {
        success = await result.current.consume();
      });

      expect(success!).toBe(false);
      expect(mockConsumeQuota).toHaveBeenCalledWith('translation');
    });

    it('消耗出错时返回 false', async () => {
      mockGetQuotaStatus.mockResolvedValue({
        total: 100,
        used: 10,
        remaining: 90,
        alert: undefined,
      });
      mockConsumeQuota.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      let success: boolean;
      await act(async () => {
        success = await result.current.consume('test');
      });

      expect(success!).toBe(false);
    });

    it('低配额警告', async () => {
      mockGetQuotaStatus.mockResolvedValue({
        total: 100,
        used: 85,
        remaining: 15,
        alert: { level: 'low', message: '配额不足', remaining: 15 },
      });
      mockConsumeQuota.mockResolvedValue({
        success: true,
        remaining: 14,
        alert: { level: 'low', message: '配额不足', remaining: 14 },
      });

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      expect(result.current.alert?.level).toBe('low');

      await act(async () => {
        await result.current.consume();
      });

      expect(result.current.alert?.remaining).toBe(14);
    });
  });

  describe('refresh', () => {
    it('手动刷新配额状态', async () => {
      mockGetQuotaStatus
        .mockResolvedValueOnce({
          total: 100,
          used: 10,
          remaining: 90,
          alert: undefined,
        })
        .mockResolvedValueOnce({
          total: 100,
          used: 50,
          remaining: 50,
          alert: { level: 'low', message: '一半用完', remaining: 50 },
        });

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      expect(result.current.used).toBe(10);

      await act(async () => {
        await result.current.refresh();
      });

      expect(mockGetQuotaStatus).toHaveBeenCalledTimes(2);
      expect(result.current.used).toBe(50);
      expect(result.current.alert?.level).toBe('low');
    });

    it('刷新失败时不崩溃', async () => {
      mockGetQuotaStatus
        .mockResolvedValueOnce({
          total: 100,
          used: 10,
          remaining: 90,
          alert: undefined,
        })
        .mockRejectedValueOnce(new Error('Storage error'));

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      await act(async () => {
        await result.current.refresh();
      });

      // 状态保持上次成功值
      expect(result.current.used).toBe(10);
    });
  });

  describe('initializeQuota', () => {
    it('首次初始化配额', async () => {
      mockGetQuotaStatus.mockResolvedValue({
        total: 100,
        used: 0,
        remaining: 100,
        alert: undefined,
      });
      mockInitializeNewUserQuota.mockResolvedValue(undefined);

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      await act(async () => {
        await result.current.initializeQuota();
      });

      expect(mockInitializeNewUserQuota).toHaveBeenCalledTimes(1);
      expect(mockGetQuotaStatus).toHaveBeenCalledTimes(2); // 初始 + refresh
    });

    it('重复初始化只执行一次', async () => {
      mockGetQuotaStatus.mockResolvedValue({
        total: 100,
        used: 0,
        remaining: 100,
        alert: undefined,
      });
      mockInitializeNewUserQuota.mockResolvedValue(undefined);

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      await act(async () => {
        await result.current.initializeQuota();
        await result.current.initializeQuota();
      });

      expect(mockInitializeNewUserQuota).toHaveBeenCalledTimes(1);
    });

    it('初始化失败时不崩溃', async () => {
      mockGetQuotaStatus.mockResolvedValue({
        total: 100,
        used: 0,
        remaining: 100,
        alert: undefined,
      });
      mockInitializeNewUserQuota.mockRejectedValue(new Error('Init failed'));

      const { result } = renderHook(() => useQuota());
      await flushPromises();

      await act(async () => {
        await result.current.initializeQuota();
      });

      expect(result.current.total).toBe(100);
    });
  });
});

describe('useQuotaCheck', () => {
  it('返回配额检查函数', async () => {
    mockHasEnoughQuota.mockResolvedValue(true);

    const { result } = renderHook(() => useQuotaCheck());

    const hasQuota = await act(async () => {
      return await result.current();
    });

    expect(hasQuota).toBe(true);
    expect(mockHasEnoughQuota).toHaveBeenCalledTimes(1);
  });

  it('配额不足时返回 false', async () => {
    mockHasEnoughQuota.mockResolvedValue(false);

    const { result } = renderHook(() => useQuotaCheck());

    const hasQuota = await act(async () => {
      return await result.current();
    });

    expect(hasQuota).toBe(false);
  });
});

describe('useQuotaAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始加载警告状态', async () => {
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 90,
      remaining: 10,
      alert: { level: 'critical', message: '即将用完', remaining: 10 },
    });

    const { result } = renderHook(() => useQuotaAlert());
    await flushPromises();

    expect(result.current?.level).toBe('critical');
    expect(result.current?.remaining).toBe(10);
  });

  it('无警告时返回 undefined', async () => {
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 10,
      remaining: 90,
      alert: undefined,
    });

    const { result } = renderHook(() => useQuotaAlert());
    await flushPromises();

    expect(result.current).toBeUndefined();
  });

  it('每30秒检查一次', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 10,
      remaining: 90,
      alert: undefined,
    });

    renderHook(() => useQuotaAlert());
    await flushPromises();

    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(1);

    // 第二次返回警告
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 95,
      remaining: 5,
      alert: { level: 'critical', message: '快用完了', remaining: 5 },
    });

    act(() => {
      vi.advanceTimersByTime(30000);
    });
    await flushPromises();

    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('清理时停止轮询', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockGetQuotaStatus.mockResolvedValue({
      total: 100,
      used: 10,
      remaining: 90,
      alert: undefined,
    });

    const { unmount } = renderHook(() => useQuotaAlert());
    await flushPromises();

    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(1);

    unmount();

    act(() => {
      vi.advanceTimersByTime(60000);
    });

    expect(mockGetQuotaStatus).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
