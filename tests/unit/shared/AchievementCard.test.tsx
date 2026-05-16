import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AchievementCard } from '@/shared/components/AchievementCard';
import type { Achievement, AchievementProgress } from '@/shared/types/achievements';

function createAchievement(overrides?: Partial<Achievement>): Achievement {
  return {
    id: 'first_translate',
    name: 'First Translation',
    description: 'Translate your first text',
    icon: '🌐',
    tier: 'bronze',
    points: 10,
    targetValue: 1,
    isNew: false,
    ...overrides,
  };
}

function createProgress(overrides?: Partial<AchievementProgress>): AchievementProgress {
  return {
    currentValue: 0,
    targetValue: 1,
    percentage: 0,
    isUnlocked: false,
    ...overrides,
  };
}

describe('AchievementCard', () => {
  it('renders achievement name and description', () => {
    const achievement = createAchievement();
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.getByText('First Translation')).toBeInTheDocument();
    expect(screen.getByText('Translate your first text')).toBeInTheDocument();
  });

  it('shows icon', () => {
    const achievement = createAchievement();
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.getByText('🌐')).toBeInTheDocument();
  });

  it('shows progress as fraction when locked', () => {
    const achievement = createAchievement();
    const progress = createProgress({ currentValue: 2, targetValue: 10, percentage: 20 });
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.getByText('2/10')).toBeInTheDocument();
    expect(screen.queryByText('已解锁')).not.toBeInTheDocument();
  });

  it('shows "已解锁" when unlocked', () => {
    const achievement = createAchievement();
    const progress = createProgress({ currentValue: 1, targetValue: 1, percentage: 100, isUnlocked: true });
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.getByText('已解锁')).toBeInTheDocument();
  });

  it('shows points', () => {
    const achievement = createAchievement({ points: 50 });
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.getByText('50 积分')).toBeInTheDocument();
  });

  it('shows tier label', () => {
    const achievement = createAchievement({ tier: 'gold' });
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.getByText('黄金')).toBeInTheDocument();
  });

  it('shows NEW badge when isNew is true', () => {
    const achievement = createAchievement({ isNew: true });
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.getByText('NEW')).toBeInTheDocument();
  });

  it('does not show NEW badge when isNew is false', () => {
    const achievement = createAchievement({ isNew: false });
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    expect(screen.queryByText('NEW')).not.toBeInTheDocument();
  });

  it('shows unlock date when unlocked and unlockedAt is set', () => {
    const achievement = createAchievement({ unlockedAt: new Date('2026-05-15').getTime() });
    const progress = createProgress({ isUnlocked: true });
    render(<AchievementCard achievement={achievement} progress={progress} />);

    // Date formatted in zh-CN locale — Node.js uses 2026/5/15 format
    expect(screen.getByText('2026/5/15')).toBeInTheDocument();
  });

  it('does not show unlock date when not unlocked', () => {
    const achievement = createAchievement();
    const progress = createProgress({ isUnlocked: false });
    render(<AchievementCard achievement={achievement} progress={progress} />);

    // zh-CN date format in Node.js uses 2026/5/15 style
    const dateRegex = /\d{4}\/\d{1,2}\/\d{1,2}/;
    const elements = screen.queryAllByText(dateRegex);
    expect(elements).toHaveLength(0);
  });

  it('renders as a button element', () => {
    const achievement = createAchievement();
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('type', 'button');
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    const achievement = createAchievement();
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} onClick={onClick} />);

    screen.getByRole('button').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has accessible aria-label for locked achievement', () => {
    const achievement = createAchievement();
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'First Translation，未解锁');
  });

  it('has accessible aria-label for unlocked achievement', () => {
    const achievement = createAchievement();
    const progress = createProgress({ isUnlocked: true });
    render(<AchievementCard achievement={achievement} progress={progress} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label', 'First Translation，已解锁');
  });

  it('uses achievement.id in aria-describedby when available', () => {
    const achievement = createAchievement({ id: 'my_id' });
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-describedby', 'achievement-desc-my_id');
  });

  it('falls back to achievement.name in aria-describedby when id is missing', () => {
    const achievement = createAchievement({ id: undefined });
    const progress = createProgress();
    render(<AchievementCard achievement={achievement} progress={progress} />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-describedby', 'achievement-desc-First Translation');
  });

  it('renders progress bar with correct width', () => {
    const achievement = createAchievement();
    const progress = createProgress({ percentage: 75 });
    render(<AchievementCard achievement={achievement} progress={progress} />);

    const progressBar = screen.getByRole('button').querySelector('.h-full.rounded-full');
    expect(progressBar).toHaveStyle({ width: '75%' });
  });
});
