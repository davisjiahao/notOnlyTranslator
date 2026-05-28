/**
 * useAchievements Hook 测试
 *
 * 覆盖成就轮询、标记已查看、追踪活动、批量检查
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAchievements, checkAchievementsBatch } from '@/shared/hooks/useAchievements';

// Mock achievements module
const mockGetNewAchievements = vi.fn();
const mockMarkAchievementAsViewed = vi.fn();
const mockRecordActivityDay = vi.fn();
const mockRecordTranslationCompleted = vi.fn();
const mockRecordWordMarked = vi.fn();
const mockCheckAndUnlockAchievements = vi.fn();

vi.mock('@/shared/analytics/achievements', () => ({
  getNewAchievements: (...args: any[]) => mockGetNewAchievements(...args),
  markAchievementAsViewed: (...args: any[]) => mockMarkAchievementAsViewed(...args),
  recordActivityDay: (...args: any[]) => mockRecordActivityDay(...args),
  recordTranslationCompleted: (...args: any[]) => mockRecordTranslationCompleted(...args),
  recordWordMarked: (...args: any[]) => mockRecordWordMarked(...args),
  checkAndUnlockAchievements: (...args: any[]) => mockCheckAndUnlockAchievements(...args),
}));

// 辅助：刷新所有挂起的 Promise
async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAchievements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('初始成就列表为空', () => {
      mockGetNewAchievements.mockResolvedValue([]);

      const { result } = renderHook(() => useAchievements());

      expect(result.current.newAchievements).toEqual([]);
      expect(result.current.hasNewAchievements).toBe(false);
    });
  });

  describe('成就轮询', () => {
    it('挂载时检查一次新成就', async () => {
      const achievements = [
        { id: 'ach-1', name: 'First Word', description: 'Marked first word' },
      ];
      mockGetNewAchievements.mockResolvedValue(achievements);

      const { result } = renderHook(() => useAchievements());

      // 刷新 useEffect 中的异步调用
      await flushPromises();

      expect(mockGetNewAchievements).toHaveBeenCalledTimes(1);
      expect(result.current.newAchievements).toHaveLength(1);
      expect(result.current.newAchievements[0].id).toBe('ach-1');
      expect(result.current.hasNewAchievements).toBe(true);
    });

    it('每30秒轮询一次', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockGetNewAchievements.mockResolvedValue([]);

      const { result } = renderHook(() => useAchievements());
      await flushPromises();

      expect(mockGetNewAchievements).toHaveBeenCalledTimes(1);

      // 第二次调用返回成就
      mockGetNewAchievements.mockResolvedValue([
        { id: 'ach-2', name: 'Streak', description: '7 days' },
      ]);

      // 推进30秒触发轮询
      act(() => {
        vi.advanceTimersByTime(30000);
      });
      await flushPromises();

      expect(mockGetNewAchievements).toHaveBeenCalledTimes(2);
      expect(result.current.newAchievements).toHaveLength(1);
      vi.useRealTimers();
    });

    it('清理时停止轮询', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      mockGetNewAchievements.mockResolvedValue([]);

      const { unmount } = renderHook(() => useAchievements());
      await flushPromises();

      expect(mockGetNewAchievements).toHaveBeenCalledTimes(1);

      unmount();

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      // 仍然只有1次调用
      expect(mockGetNewAchievements).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('轮询出错时不崩溃', async () => {
      mockGetNewAchievements.mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useAchievements());
      await flushPromises();

      // 状态应保持为空
      expect(result.current.newAchievements).toEqual([]);
      expect(result.current.hasNewAchievements).toBe(false);
    });

    it('并发检查保护', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      let resolveFirst: (value: any[]) => void;
      const firstPromise = new Promise<any[]>((resolve) => {
        resolveFirst = resolve;
      });
      mockGetNewAchievements.mockReturnValueOnce(firstPromise);

      renderHook(() => useAchievements());

      // 在第一次调用完成前等待
      await act(async () => {
        await Promise.resolve();
      });

      // 推进30秒，不应触发第二次调用
      act(() => {
        vi.advanceTimersByTime(30000);
      });

      expect(mockGetNewAchievements).toHaveBeenCalledTimes(1);

      // 完成第一次调用
      act(() => {
        resolveFirst!([{ id: 'ach-1', name: 'Test', description: 'Test' }]);
      });
      await flushPromises();
      vi.useRealTimers();
    });
  });

  describe('markAsViewed', () => {
    it('标记成就已查看并从列表移除', async () => {
      const achievements = [
        { id: 'ach-1', name: 'First', description: 'First' },
        { id: 'ach-2', name: 'Second', description: 'Second' },
      ];
      mockGetNewAchievements.mockResolvedValue(achievements);
      mockMarkAchievementAsViewed.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAchievements());
      await flushPromises();

      expect(result.current.newAchievements).toHaveLength(2);

      await act(async () => {
        await result.current.markAsViewed('ach-1');
      });

      expect(mockMarkAchievementAsViewed).toHaveBeenCalledWith('ach-1');
      expect(result.current.newAchievements).toHaveLength(1);
      expect(result.current.newAchievements[0].id).toBe('ach-2');
      expect(result.current.hasNewAchievements).toBe(true);
    });

    it('标记最后一个成就后 hasNewAchievements 为 false', async () => {
      const achievements = [{ id: 'ach-1', name: 'Only', description: 'Only' }];
      mockGetNewAchievements.mockResolvedValue(achievements);
      mockMarkAchievementAsViewed.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAchievements());
      await flushPromises();

      expect(result.current.hasNewAchievements).toBe(true);

      await act(async () => {
        await result.current.markAsViewed('ach-1');
      });

      expect(result.current.hasNewAchievements).toBe(false);
      expect(result.current.newAchievements).toEqual([]);
    });
  });

  describe('clearAllNotifications', () => {
    it('清除所有新成就通知', async () => {
      const achievements = [
        { id: 'ach-1', name: 'First', description: 'First' },
        { id: 'ach-2', name: 'Second', description: 'Second' },
      ];
      mockGetNewAchievements.mockResolvedValue(achievements);
      mockMarkAchievementAsViewed.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAchievements());
      await flushPromises();

      expect(result.current.newAchievements).toHaveLength(2);

      await act(async () => {
        await result.current.clearAllNotifications();
      });

      expect(mockMarkAchievementAsViewed).toHaveBeenCalledTimes(2);
      expect(mockMarkAchievementAsViewed).toHaveBeenCalledWith('ach-1');
      expect(mockMarkAchievementAsViewed).toHaveBeenCalledWith('ach-2');
      expect(result.current.newAchievements).toEqual([]);
      expect(result.current.hasNewAchievements).toBe(false);
    });

    it('空列表时清除不报错', async () => {
      mockGetNewAchievements.mockResolvedValue([]);

      const { result } = renderHook(() => useAchievements());
      await flushPromises();

      expect(result.current.newAchievements).toEqual([]);

      await act(async () => {
        await result.current.clearAllNotifications();
      });

      expect(mockMarkAchievementAsViewed).not.toHaveBeenCalled();
    });
  });

  describe('trackTranslation', () => {
    it('记录翻译完成', async () => {
      mockGetNewAchievements.mockResolvedValue([]);
      mockRecordTranslationCompleted.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAchievements());

      await act(async () => {
        await result.current.trackTranslation();
      });

      expect(mockRecordTranslationCompleted).toHaveBeenCalledTimes(1);
    });
  });

  describe('trackWordMarked', () => {
    it('记录已知词汇', async () => {
      mockGetNewAchievements.mockResolvedValue([]);
      mockRecordWordMarked.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAchievements());

      await act(async () => {
        await result.current.trackWordMarked(true);
      });

      expect(mockRecordWordMarked).toHaveBeenCalledWith(true);
    });

    it('记录未知词汇', async () => {
      mockGetNewAchievements.mockResolvedValue([]);
      mockRecordWordMarked.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAchievements());

      await act(async () => {
        await result.current.trackWordMarked(false);
      });

      expect(mockRecordWordMarked).toHaveBeenCalledWith(false);
    });
  });

  describe('trackActivity', () => {
    it('记录活跃天数', async () => {
      mockGetNewAchievements.mockResolvedValue([]);
      mockRecordActivityDay.mockResolvedValue(undefined);

      const { result } = renderHook(() => useAchievements());

      await act(async () => {
        await result.current.trackActivity();
      });

      expect(mockRecordActivityDay).toHaveBeenCalledTimes(1);
    });
  });
});

describe('checkAchievementsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('检查单个条件', async () => {
    const unlocked = [{ id: 'ach-1', name: '10 Words', description: 'Marked 10 words' }];
    mockCheckAndUnlockAchievements.mockResolvedValue(unlocked);

    const result = await checkAchievementsBatch({ wordsMarked: 10 });

    expect(mockCheckAndUnlockAchievements).toHaveBeenCalledWith('words_marked_total', 10);
    expect(result).toEqual(unlocked);
  });

  it('检查多个条件', async () => {
    const wordsUnlocked = [{ id: 'ach-1', name: '10 Words', description: '10 words' }];
    const knownUnlocked = [{ id: 'ach-2', name: '5 Known', description: '5 known' }];

    mockCheckAndUnlockAchievements
      .mockResolvedValueOnce(wordsUnlocked)
      .mockResolvedValueOnce(knownUnlocked);

    const result = await checkAchievementsBatch({ wordsMarked: 10, wordsKnown: 5 });

    expect(mockCheckAndUnlockAchievements).toHaveBeenCalledTimes(2);
    expect(mockCheckAndUnlockAchievements).toHaveBeenNthCalledWith(1, 'words_marked_total', 10);
    expect(mockCheckAndUnlockAchievements).toHaveBeenNthCalledWith(2, 'words_known_total', 5);
    expect(result).toEqual([...wordsUnlocked, ...knownUnlocked]);
  });

  it('未提供条件时不检查', async () => {
    mockCheckAndUnlockAchievements.mockResolvedValue([]);

    const result = await checkAchievementsBatch({});

    expect(mockCheckAndUnlockAchievements).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('undefined 值不触发检查', async () => {
    mockCheckAndUnlockAchievements.mockResolvedValue([]);

    const result = await checkAchievementsBatch({ wordsMarked: undefined, wordsKnown: 5 });

    expect(mockCheckAndUnlockAchievements).toHaveBeenCalledTimes(1);
    expect(mockCheckAndUnlockAchievements).toHaveBeenCalledWith('words_known_total', 5);
  });

  it('检查所有四种条件', async () => {
    mockCheckAndUnlockAchievements
      .mockResolvedValueOnce([{ id: 'a1', name: 'Words', description: 'words' }])
      .mockResolvedValueOnce([{ id: 'a2', name: 'Known', description: 'known' }])
      .mockResolvedValueOnce([{ id: 'a3', name: 'Streak', description: 'streak' }])
      .mockResolvedValueOnce([{ id: 'a4', name: 'Translations', description: 'translations' }]);

    const result = await checkAchievementsBatch({
      wordsMarked: 10,
      wordsKnown: 5,
      consecutiveDays: 7,
      totalTranslations: 20,
    });

    expect(mockCheckAndUnlockAchievements).toHaveBeenCalledTimes(4);
    expect(result).toHaveLength(4);
  });
});
