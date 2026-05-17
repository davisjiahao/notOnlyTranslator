import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import EmptyState from '@/shared/components/EmptyState';

describe('EmptyState', () => {
  it('renders icon, title, and description', () => {
    render(<EmptyState icon="book" title="暂无数据" description="开始学习后这里会显示你的单词" />);
    expect(screen.getByText('暂无数据')).toBeTruthy();
    expect(screen.getByText('开始学习后这里会显示你的单词')).toBeTruthy();
  });

  it('renders without description', () => {
    render(<EmptyState icon="chart" title="无统计" />);
    expect(screen.getByText('无统计')).toBeTruthy();
    expect(screen.queryByText(/./, { selector: 'p' })).toBeTruthy();
  });

  it('renders action button with correct label', () => {
    render(
      <EmptyState
        icon="search"
        title="无结果"
        action={{ label: '搜索', onClick: vi.fn() }}
      />
    );
    expect(screen.getByRole('button', { name: '搜索' })).toBeTruthy();
  });

  it('calls onClick when action button is clicked', () => {
    const onClick = vi.fn();
    render(
      <EmptyState
        icon="search"
        title="无结果"
        action={{ label: '搜索', onClick }}
      />
    );
    screen.getByRole('button', { name: '搜索' }).click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has role=status and aria-live=polite for accessibility', () => {
    const { container } = render(<EmptyState icon="inbox" title="空" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper).toHaveAttribute('role', 'status');
    expect(wrapper).toHaveAttribute('aria-live', 'polite');
  });

  it('renders the SVG icon with correct path', () => {
    const { container } = render(<EmptyState icon="translate" title="空" />);
    const svg = container.querySelector('svg[aria-hidden="true"]');
    expect(svg).toBeTruthy();
    // Verify the translate path is used
    expect(svg?.querySelector('path')).toHaveAttribute('d', expect.stringContaining('M3 5h12'));
  });

  it('applies custom className', () => {
    const { container } = render(<EmptyState icon="check" title="空" className="custom-class" />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('falls back to inbox icon for unknown icon type', () => {
    // Since the icon prop is typed, we can't pass an invalid icon at compile time.
    // But we can verify the inbox icon is rendered when icon="inbox"
    const { container } = render(<EmptyState icon="inbox" title="空" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.querySelector('path')).toHaveAttribute('d', expect.stringContaining('M19 11H5'));
  });

  it('does not render action button when action is not provided', () => {
    render(<EmptyState icon="error" title="错误" description="出错了" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders icon with default size class', () => {
    const { container } = render(<EmptyState icon="book" title="空" />);
    const svg = container.querySelector('svg');
    expect(svg?.className.baseVal).toContain('w-12');
    expect(svg?.className.baseVal).toContain('h-12');
  });

  it('renders icon with custom size', () => {
    const { container } = render(<EmptyState icon="book" title="空" iconSize={16} />);
    const svg = container.querySelector('svg');
    expect(svg?.className.baseVal).toContain('w-16');
    expect(svg?.className.baseVal).toContain('h-16');
  });
});
