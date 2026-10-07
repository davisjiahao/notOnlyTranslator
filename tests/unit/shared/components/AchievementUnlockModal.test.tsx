import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AchievementUnlockModal } from '@/shared/components/AchievementUnlockModal';
import type { Achievement } from '@/shared/types/achievements';

const achievement: Achievement = {
  id: 'first_word', name: '首次学习', description: '记录第一个词', icon: '🌱',
  tier: 'bronze', category: 'vocabulary', points: 10, unlockedAt: 1,
  condition: { type: 'words_marked_total', threshold: 1, description: '标记一个生词' },
};
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('成就解锁详情', () => {
  it('解锁详情展示条件和分享入口，支持分享和关闭', () => {
    const onClose = vi.fn();
    const onShare = vi.fn();
    render(<AchievementUnlockModal achievement={achievement} onClose={onClose} onShare={onShare} />);
    expect(screen.getByRole('dialog', { name: '首次学习' })).toBeInTheDocument();
    expect(screen.getByText('成就解锁！')).toBeInTheDocument();
    expect(screen.getByText('标记一个生词')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分享成就' }));
    expect(onShare).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it.each([true, false])('没有分享回调且解锁状态=%s 时不显示分享按钮', isUnlocked => {
    render(<AchievementUnlockModal achievement={{ ...achievement, unlockedAt: isUnlocked ? 1 : undefined }} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '分享成就' })).not.toBeInTheDocument();
    expect(screen.queryByText('成就解锁！') !== null).toBe(isUnlocked);
  });

  it('未解锁成就即使传入分享回调也不能分享', () => {
    render(<AchievementUnlockModal achievement={{ ...achievement, unlockedAt: undefined }} onClose={vi.fn()} onShare={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '分享成就' })).not.toBeInTheDocument();
  });

  it('五秒后结束装饰动画，详情和关闭入口仍存在', () => {
    vi.useFakeTimers();
    render(<AchievementUnlockModal achievement={achievement} onClose={vi.fn()} />);
    const confetti = screen.getByRole('dialog').querySelector(':scope > [aria-hidden="true"]');
    expect(confetti).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(confetti).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '首次学习' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '知道了' })).toBeEnabled();
  });
});
