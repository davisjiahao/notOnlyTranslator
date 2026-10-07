import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContextualLearningCard from '@/options/components/ContextualLearningCard';
import type { WordContext } from '@/shared/types/vocabulary';

const contexts: WordContext[] = [
  { sentence: 'Resilient learners stay resilient.', source: '学习笔记', url: 'https://example.test/article', capturedAt: 1 },
  { sentence: 'Practice builds confidence.', source: '复习笔记', capturedAt: 2 },
  { sentence: 'Stay resilient every day.', source: '阅读笔记', capturedAt: 3 },
];

const props = { word: 'resilient', translation: '有韧性的', contexts, showAnswer: false };

afterEach(cleanup);

describe('语境学习卡片', () => {
  it('没有上下文时展示阅读提示，不提供评分或语境导航', () => {
    render(<ContextualLearningCard {...props} contexts={[]} showAnswer onRate={vi.fn()} />);

    expect(screen.getByText('该词汇暂无上下文记录')).toBeInTheDocument();
    expect(screen.getByText('在阅读时会自动捕获生词的上下文')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('保留句子大小写并高亮每次匹配，答案未显示时不允许评分', () => {
    render(<ContextualLearningCard {...props} onRate={vi.fn()} />);

    const sentence = screen.getByText('Resilient').closest('p');
    expect(sentence).toHaveTextContent('Resilient learners stay resilient.');
    expect(sentence?.querySelectorAll('span')).toHaveLength(2);
    expect(screen.getByText('Resilient')).toHaveClass('bg-yellow-200');
    expect(screen.getByText('学习笔记')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /不认识/ })).not.toBeInTheDocument();
  });

  it('没有目标词、来源、链接或翻译时仍正常展示单一语境', () => {
    render(<ContextualLearningCard word="resilient" contexts={[
      { sentence: 'A quiet day.', capturedAt: 1 },
    ]} showAnswer onRate={vi.fn()} />);

    expect(screen.getByText('A quiet day.')).toHaveTextContent('A quiet day.');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一个语境' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('显示答案时呈现释义和安全的新窗口原文链接', () => {
    const onRate = vi.fn();
    const view = render(<ContextualLearningCard {...props} onRate={onRate} />);
    view.rerender(<ContextualLearningCard {...props} showAnswer onRate={onRate} />);

    expect(screen.getByText('有韧性的')).toBeInTheDocument();
    expect(screen.getByText('你认识这个单词吗？')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: '查看原文' });
    expect(link).toHaveAttribute('href', 'https://example.test/article');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it.each([
    [1, '不认识：完全不记得'],
    [2, '模糊：有点印象'],
    [3, '想起来：想了很久'],
    [4, '熟练：基本掌握'],
    [5, '精通：完全掌握'],
  ])('选择评分 %i 只提交该评分', (rating, description) => {
    const onRate = vi.fn();
    render(<ContextualLearningCard {...props} showAnswer onRate={onRate} />);

    fireEvent.click(screen.getByRole('button', { name: `${rating} - ${description}` }));

    expect(onRate).toHaveBeenCalledExactlyOnceWith(rating);
  });

  it('提交期间禁用所有评分，避免重复请求', () => {
    const onRate = vi.fn();
    render(<ContextualLearningCard {...props} showAnswer isSubmitting onRate={onRate} />);

    for (const rating of screen.getAllByRole('button', { name: /^[1-5] - / })) {
      expect(rating).toBeDisabled();
      fireEvent.click(rating);
    }
    expect(onRate).not.toHaveBeenCalled();
  });

  it('上一条和下一条在首尾循环，导航点标明当前语境', () => {
    render(<ContextualLearningCard {...props} onRate={vi.fn()} />);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '上一个语境' }));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(screen.getByText('阅读笔记')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一个语境' }));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一个语境' }));
    expect(screen.getByText('Practice builds confidence.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到第 2 个语境' })).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: '切换到第 1 个语境' })).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: '上一个语境' }));
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
  });

  it('切换到语境更少的下一个单词时不崩溃并显示首条语境', () => {
    const onRate = vi.fn();
    const view = render(<ContextualLearningCard {...props} onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: '切换到第 3 个语境' }));

    expect(() => view.rerender(<ContextualLearningCard
      word="curious"
      translation="好奇的"
      contexts={[{ sentence: 'A curious reader asks questions.', capturedAt: 4 }]}
      showAnswer={false}
      onRate={onRate}
    />)).not.toThrow();

    expect(screen.getByText('curious', { selector: 'span' })).toHaveClass('bg-yellow-200');
    expect(screen.queryByRole('button', { name: '下一个语境' })).not.toBeInTheDocument();
  });

  it('同一个词的语境缩减时回退到首条，并保持导航计数与循环一致', () => {
    const onRate = vi.fn();
    const view = render(<ContextualLearningCard {...props} onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: '切换到第 3 个语境' }));

    view.rerender(<ContextualLearningCard {...props} contexts={contexts.slice(0, 2)} onRate={onRate} />);

    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(screen.getByText('学习笔记')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '切换到第 1 个语境' })).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: '上一个语境' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下一个语境' }));
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
  });

  it('语境被清空后显示空态，重新加载单条语境时不使用旧索引', () => {
    const onRate = vi.fn();
    const view = render(<ContextualLearningCard {...props} onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: '切换到第 3 个语境' }));

    view.rerender(<ContextualLearningCard {...props} contexts={[]} onRate={onRate} />);
    expect(screen.getByText('该词汇暂无上下文记录')).toBeInTheDocument();
    view.rerender(<ContextualLearningCard {...props} contexts={[contexts[0]]} onRate={onRate} />);

    expect(screen.getByText('学习笔记')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下一个语境' })).not.toBeInTheDocument();
  });

  it('可以直接选择语境，换词后回到该词的第一个语境', () => {
    const onRate = vi.fn();
    const view = render(<ContextualLearningCard {...props} onRate={onRate} />);
    fireEvent.click(screen.getByRole('button', { name: '切换到第 3 个语境' }));
    expect(screen.getByText('3 / 3')).toBeInTheDocument();

    view.rerender(<ContextualLearningCard {...props} word="learners" onRate={onRate} />);

    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByText('learners', { selector: 'span' })).toHaveClass('bg-yellow-200');
    expect(onRate).not.toHaveBeenCalled();
  });
});
