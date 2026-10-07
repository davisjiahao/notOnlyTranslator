import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import RatingStars from '@/popup/components/Feedback/RatingStars';

afterEach(cleanup);

describe('RatingStars', () => {
  it('未评分时显示五颗空星且无评分标签', () => {
    render(<RatingStars rating={0} onChange={vi.fn()} />);
    const stars = within(screen.getByRole('group', { name: '评分' })).getAllByRole('button');
    expect(stars).toHaveLength(5);
    for (const star of stars) {
      expect(star).toHaveAttribute('aria-pressed', 'false');
      expect(star).toHaveClass('text-gray-300');
    }
    expect(screen.queryByText(/满意|一般/)).not.toBeInTheDocument();
  });

  it.each([
    [1, '非常不满意'], [2, '不满意'], [3, '一般'], [4, '满意'], [5, '非常满意'],
  ])('选择 %i 星回调对应评分，更新后呈现标签“%s”', (rating, label) => {
    const onChange = vi.fn();
    const { rerender } = render(<RatingStars rating={0} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: `${rating}星` }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(rating);
    rerender(<RatingStars rating={rating} onChange={onChange} />);
    expect(screen.getByRole('button', { name: `${rating}星` })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(label)).toBeInTheDocument();
    for (let value = 1; value <= 5; value += 1) {
      expect(screen.getByRole('button', { name: `${value}星` })).toHaveClass(
        value <= rating ? 'text-yellow-400' : 'text-gray-300',
      );
    }
  });

  it('悬停预览不提交评分，移出后恢复已选评分', () => {
    const onChange = vi.fn();
    render(<RatingStars rating={2} onChange={onChange} />);
    const fourthStar = screen.getByRole('button', { name: '4星' });
    fireEvent.mouseEnter(fourthStar);
    expect(fourthStar).toHaveClass('text-yellow-300');
    expect(fourthStar).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '5星' })).toHaveClass('text-gray-300');
    expect(screen.getByText('不满意')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.mouseLeave(screen.getByRole('group', { name: '评分' }));
    expect(fourthStar).toHaveClass('text-gray-300');
    expect(fourthStar).not.toHaveClass('text-yellow-300');
    expect(screen.getByRole('button', { name: '2星' })).toHaveClass('text-yellow-400');
  });

  it.each([
    ['ArrowRight', 3, 4], ['ArrowUp', 3, 4],
    ['ArrowLeft', 3, 2], ['ArrowDown', 3, 2],
    ['Home', 3, 1], ['End', 3, 5],
  ])('%s 将 %i 星调整为 %i 星', (key, rating, expected) => {
    const onChange = vi.fn();
    render(<RatingStars rating={rating} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('button', { name: `${rating}星` }), { key });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each([
    ['ArrowLeft', 1], ['ArrowDown', 1], ['ArrowRight', 5], ['ArrowUp', 5], ['a', 3],
  ])('%s 在 %i 星时不越界也不响应无关按键', (key, rating) => {
    const onChange = vi.fn();
    render(<RatingStars rating={rating} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('button', { name: `${rating}星` }), { key });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('禁用后保留当前评分，鼠标交互不能更改或预览', () => {
    const onChange = vi.fn();
    render(<RatingStars rating={2} onChange={onChange} disabled />);
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled();
    const fifthStar = screen.getByRole('button', { name: '5星' });
    fireEvent.mouseEnter(fifthStar);
    fireEvent.click(fifthStar);
    expect(onChange).not.toHaveBeenCalled();
    expect(fifthStar).toHaveClass('text-gray-300');
    expect(screen.getByText('不满意')).toBeInTheDocument();
  });

  it('可隐藏评分标签而保留选中状态', () => {
    render(<RatingStars rating={5} onChange={vi.fn()} showLabel={false} />);
    expect(screen.queryByText('非常满意')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5星' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['sm', 'w-4', 'gap-1'], ['md', 'w-6', 'gap-1.5'], ['lg', 'w-8', 'gap-2'],
  ] as const)('%s 尺寸提供对应星形大小和间距', (size, width, gap) => {
    render(<RatingStars rating={1} onChange={vi.fn()} size={size} />);
    expect(screen.getByRole('button', { name: '1星' })).toHaveClass(width);
    expect(screen.getByRole('group', { name: '评分' })).toHaveClass(gap);
  });
});
