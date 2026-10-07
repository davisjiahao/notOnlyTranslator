import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import LevelSelector from '@/options/components/LevelSelector';
import { DEFAULT_USER_PROFILE } from '@/shared/constants';

vi.mock('@/options/components/StatsCharts', () => ({ StatsCharts: () => null }));

describe('英语水平键盘选择', () => {
  it('方向键选择并移动焦点，只有当前选项进入 Tab 顺序', () => {
    render(<LevelSelector profile={{ ...DEFAULT_USER_PROFILE, knownWords: [], unknownWords: [], createdAt: 0, updatedAt: 0 }} onUpdate={vi.fn()} isSaving={false} />);
    const options = screen.getAllByRole('radio');
    options[0].focus();
    fireEvent.keyDown(options[0], { key: 'ArrowRight' });
    expect(options[1]).toHaveAttribute('aria-checked', 'true');
    expect(options[1]).toHaveFocus();
    expect(options[0]).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(options[1], { key: 'End' });
    expect(options[5]).toHaveFocus();
    expect(options[5]).toHaveAttribute('aria-checked', 'true');
  });
});
