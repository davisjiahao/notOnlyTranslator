import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AchievementNotification } from '@/shared/components/AchievementNotification';
import type { Achievement } from '@/shared/types/achievements';

const first: Achievement = {
  id: 'first', name: '第一成就', description: '第一个学习目标', icon: '🌱',
  tier: 'bronze', category: 'vocabulary', points: 10, unlockedAt: 1,
  condition: { type: 'words_marked_total', threshold: 1, description: '标记一个词' },
};
const second: Achievement = { ...first, id: 'second', name: '第二成就' };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('新成就通知的关闭与更新', () => {
  it('空成就不显示通知', () => {
    render(<AchievementNotification achievements={[]} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('父组件重复传同一成就时不重复通知，新成就追加到列表', () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<AchievementNotification achievements={[first]} onDismiss={onDismiss} />);
    rerender(<AchievementNotification achievements={[{ ...first }, second]} onDismiss={onDismiss} />);
    expect(screen.getAllByRole('heading', { name: '第一成就' })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: '第二成就' })).toBeInTheDocument();
  });

  it('仅第一条通知提供查看全部入口，没有回调时隐藏入口', () => {
    const onViewAll = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(<AchievementNotification achievements={[first, second]} onDismiss={onDismiss} onViewAll={onViewAll} />);
    expect(screen.getAllByRole('button', { name: /查看全部成就/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /查看全部成就/ }));
    expect(onViewAll).toHaveBeenCalledOnce();
    rerender(<AchievementNotification achievements={[first, second]} onDismiss={onDismiss} />);
    expect(screen.queryByRole('button', { name: /查看全部成就/ })).not.toBeInTheDocument();
  });

  it('手动关闭等待动画完成后通知父组件', () => {
    const onDismiss = vi.fn();
    render(<AchievementNotification achievements={[first]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    act(() => { vi.advanceTimersByTime(299); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('first');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('自动关闭按配置延迟加动画时长逐一处理成就', () => {
    const onDismiss = vi.fn();
    render(<AchievementNotification achievements={[first, second]} onDismiss={onDismiss} autoHideDelay={1000} />);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss).toHaveBeenCalledWith('first');
    expect(screen.getByRole('heading', { name: '第二成就' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss).toHaveBeenCalledWith('second');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('同时关闭多条通知时使用成就身份，不因列表索引变化遗漏第二条', () => {
    const onDismiss = vi.fn();
    render(<AchievementNotification achievements={[first, second]} onDismiss={onDismiss} />);
    const buttons = screen.getAllByRole('button', { name: '关闭' });
    fireEvent.click(buttons[0]);
    fireEvent.click(buttons[1]);
    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss.mock.calls).toEqual([['first'], ['second']]);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it.each(['自动关闭', '手动关闭'])('%s 后卸载的动画计时器不得继续通知父组件', action => {
    const onDismiss = vi.fn();
    const { unmount } = render(<AchievementNotification achievements={[first]} onDismiss={onDismiss} autoHideDelay={1000} />);
    if (action === '自动关闭') act(() => { vi.advanceTimersByTime(1000); });
    else fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    unmount();
    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('严格模式重跑状态更新时不能重复通知父组件', () => {
    const onDismiss = vi.fn();
    render(<StrictMode><AchievementNotification achievements={[first]} onDismiss={onDismiss} /></StrictMode>);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    act(() => { vi.advanceTimersByTime(300); });
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith('first');
  });
});
