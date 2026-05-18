import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAchievementNotification } from '@/shared/hooks/useAchievementNotification';
import type { Achievement } from '@/shared/types/achievements';

const makeAchievement = (id: string): Achievement => ({
  id,
  name: id,
  description: `Test achievement ${id}`,
  icon: 'star',
  category: 'general',
  criteria: { type: 'count', target: 1 },
});

describe('useAchievementNotification', () => {

  it('starts with empty notifications array', () => {
    const { result } = renderHook(() => useAchievementNotification());
    expect(result.current.notifications).toEqual([]);
  });

  it('adds a notification when showNotification is called', () => {
    const { result } = renderHook(() => useAchievementNotification());
    const achievement = makeAchievement('test_1');

    act(() => {
      result.current.showNotification(achievement);
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0]).toBe(achievement);
  });

  it('does not add duplicate notifications for same achievement ID', () => {
    const { result } = renderHook(() => useAchievementNotification());
    const achievement = makeAchievement('test_1');

    act(() => {
      result.current.showNotification(achievement);
      result.current.showNotification(achievement);
      result.current.showNotification(achievement);
    });

    expect(result.current.notifications).toHaveLength(1);
  });

  it('adds different achievements with different IDs', () => {
    const { result } = renderHook(() => useAchievementNotification());

    act(() => {
      result.current.showNotification(makeAchievement('test_1'));
      result.current.showNotification(makeAchievement('test_2'));
      result.current.showNotification(makeAchievement('test_3'));
    });

    expect(result.current.notifications).toHaveLength(3);
  });

  it('dismisses a notification by achievement ID', () => {
    const { result } = renderHook(() => useAchievementNotification());

    act(() => {
      result.current.showNotification(makeAchievement('test_1'));
      result.current.showNotification(makeAchievement('test_2'));
    });

    act(() => {
      result.current.dismissNotification('test_1');
    });

    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.notifications[0].id).toBe('test_2');
  });

  it('clears all notifications', () => {
    const { result } = renderHook(() => useAchievementNotification());

    act(() => {
      result.current.showNotification(makeAchievement('test_1'));
      result.current.showNotification(makeAchievement('test_2'));
    });

    act(() => {
      result.current.clearAll();
    });

    expect(result.current.notifications).toEqual([]);
  });

  it('handles dismissing non-existent notification gracefully', () => {
    const { result } = renderHook(() => useAchievementNotification());

    act(() => {
      result.current.showNotification(makeAchievement('test_1'));
    });

    act(() => {
      result.current.dismissNotification('non_existent');
    });

    expect(result.current.notifications).toHaveLength(1);
  });

  it('can add notification after dismissing one', () => {
    const { result } = renderHook(() => useAchievementNotification());
    const achievement = makeAchievement('test_1');

    act(() => {
      result.current.showNotification(achievement);
      result.current.dismissNotification('test_1');
    });

    expect(result.current.notifications).toEqual([]);

    act(() => {
      result.current.showNotification(achievement);
    });

    expect(result.current.notifications).toHaveLength(1);
  });
});
