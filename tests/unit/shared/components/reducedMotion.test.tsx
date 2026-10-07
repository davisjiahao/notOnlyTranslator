import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { useReducedMotion, prefersReducedMotion } from '@/shared/hooks/useReducedMotion';
import { AchievementUnlockModal } from '@/shared/components/AchievementUnlockModal';
import { AchievementNotification } from '@/shared/components/AchievementNotification';
import type { Achievement } from '@/shared/types/achievements';

const achievement = { id: 'first', name: '初次阅读', description: '完成首次阅读', icon: '★', tier: 'bronze', points: 10, unlockedAt: 1, condition: { description: '阅读一篇文章' } } as Achievement;
let reduced: boolean;
let listeners: Set<() => void>;
const remove = vi.fn();
beforeEach(() => {
  reduced = true;
  listeners = new Set();
  remove.mockClear();
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return reduced; },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); remove(); },
  })));
});
afterEach(() => vi.unstubAllGlobals());

describe('减少动态效果', () => {
  it('初始读取、动态更新并在卸载后退订', () => {
    expect(prefersReducedMotion()).toBe(true);
    const { result, unmount } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
    act(() => { reduced = false; listeners.forEach(listener => listener()); });
    expect(result.current).toBe(false);
    unmount();
    expect(remove).toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('不支持 matchMedia 时安全回退', () => {
    vi.stubGlobal('matchMedia', undefined);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it('减少动画时保留成就内容和操作，但不生成纸屑、闪光或弹跳', () => {
    const close = vi.fn();
    const { container } = render(<><AchievementUnlockModal achievement={achievement} onClose={close} /><AchievementNotification achievements={[achievement]} onDismiss={vi.fn()} /></>);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('初次阅读');
    expect(container.querySelector('.animate-confetti')).toBeNull();
    expect(container.querySelector('.animate-shimmer')).toBeNull();
    expect(container.querySelector('.animate-bounce')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('运行时开启减少动画立即移除装饰，默认模式也不持续弹跳', () => {
    reduced = false;
    const { container } = render(<AchievementUnlockModal achievement={achievement} onClose={vi.fn()} />);
    expect(container.querySelectorAll('.animate-confetti')).toHaveLength(50);
    expect(container.querySelector('.animate-bounce')).toBeNull();
    act(() => { reduced = true; listeners.forEach(listener => listener()); });
    expect(container.querySelector('.animate-confetti')).toBeNull();
  });
});
