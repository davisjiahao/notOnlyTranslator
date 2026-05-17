import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock formatDate before importing the component
vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    formatDate: () => '2026-05-26',
  };
});

import VocabularyList from '@/popup/components/VocabularyList';

function createWord(overrides: Record<string, unknown> = {}) {
  return {
    word: 'hello',
    translation: '你好',
    markedAt: Date.now(),
    reviewCount: 0,
    context: '',
    ...overrides,
  };
}

describe('VocabularyList', () => {
  // --- Empty state ---

  it('shows empty state when no words', () => {
    render(<VocabularyList words={[]} onRemove={vi.fn()} />);
    expect(screen.getByText('生词本为空')).toBeInTheDocument();
    expect(screen.getByText('阅读时标记不认识的词汇，它们会出现在这里')).toBeInTheDocument();
  });

  it('does not show search/sort when list is empty', () => {
    render(<VocabularyList words={[]} onRemove={vi.fn()} />);
    expect(screen.queryByPlaceholderText('搜索...')).not.toBeInTheDocument();
  });

  // --- Word display ---

  it('renders word and translation', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('你好')).toBeInTheDocument();
  });

  it('shows review count when greater than zero', () => {
    const words = [createWord({ reviewCount: 5 })];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.getByText('复习 5 次')).toBeInTheDocument();
  });

  it('does not show review count when zero', () => {
    const words = [createWord({ reviewCount: 0 })];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.queryByText('复习 0 次')).not.toBeInTheDocument();
  });

  it('shows context when available', () => {
    const words = [createWord({ context: 'Hello world example' })];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.getByText('"Hello world example"')).toBeInTheDocument();
  });

  it('shows formatted date', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.getByText('2026-05-26')).toBeInTheDocument();
  });

  // --- Search ---

  it('shows search input when words exist', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.getByPlaceholderText('搜索...')).toBeInTheDocument();
  });

  it('filters words by word text', () => {
    const words = [
      createWord({ word: 'apple', translation: '苹果' }),
      createWord({ word: 'banana', translation: '香蕉' }),
    ];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: 'app' } });
    expect(screen.getByText('apple')).toBeInTheDocument();
    expect(screen.queryByText('banana')).not.toBeInTheDocument();
  });

  it('filters words by translation', () => {
    const words = [
      createWord({ word: 'apple', translation: '苹果' }),
      createWord({ word: 'banana', translation: '香蕉' }),
    ];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: '香' } });
    expect(screen.getByText('banana')).toBeInTheDocument();
    expect(screen.queryByText('apple')).not.toBeInTheDocument();
  });

  it('is case-insensitive when searching', () => {
    const words = [createWord({ word: 'Hello', translation: '你好' })];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: 'hello' } });
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('shows "no results" when search has no matches', () => {
    const words = [createWord({ word: 'hello' })];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('搜索...'), { target: { value: 'xyz' } });
    expect(screen.getByText('未找到匹配的词汇')).toBeInTheDocument();
    expect(screen.getByText('尝试使用其他关键词搜索')).toBeInTheDocument();
  });

  // --- Sort ---

  it('shows sort select', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.getByLabelText('排序方式')).toBeInTheDocument();
  });

  it('sorts by recent (default)', () => {
    const words = [
      createWord({ word: 'old', markedAt: 1000 }),
      createWord({ word: 'new', markedAt: 2000 }),
    ];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    // In "recent" sort, newest should appear first
    const wordElements = screen.getAllByRole('generic').filter(el =>
      el.className?.includes('font-medium') && el.className?.includes('text-gray-900')
    );
    expect(wordElements).toHaveLength(2);
    expect(wordElements[0].textContent).toContain('new');
    expect(wordElements[1].textContent).toContain('old');
  });

  it('sorts alphabetically when selected', () => {
    const words = [
      createWord({ word: 'zebra' }),
      createWord({ word: 'apple' }),
      createWord({ word: 'banana' }),
    ];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('排序方式'), { target: { value: 'alpha' } });
    const wordElements = screen.getAllByRole('generic').filter(el =>
      el.className?.includes('font-medium') && el.className?.includes('text-gray-900')
    );
    expect(wordElements).toHaveLength(3);
    expect(wordElements[0].textContent).toContain('apple');
    expect(wordElements[1].textContent).toContain('banana');
    expect(wordElements[2].textContent).toContain('zebra');
  });

  // --- Delete and undo ---

  it('shows delete button for each word', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    const deleteBtn = screen.getByRole('button', { name: '移除词汇 hello' });
    expect(deleteBtn).toBeInTheDocument();
  });

  it('shows pending delete UI when delete clicked', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '移除词汇 hello' }));
    expect(screen.getByText('已删除：hello')).toBeInTheDocument();
    expect(screen.getByText('点击「撤销」恢复')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '撤销删除' })).toBeInTheDocument();
  });

  it('does NOT call onRemove immediately when delete clicked (2s undo window)', () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: '移除词汇 hello' }));
    expect(onRemove).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(onRemove).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onRemove).toHaveBeenCalledWith('hello');
    vi.useRealTimers();
  });

  it('calls onRemove after 2 second delay', () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: '移除词汇 hello' }));
    vi.advanceTimersByTime(2000);
    expect(onRemove).toHaveBeenCalledWith('hello');
    vi.useRealTimers();
  });

  it('undoes delete when undo button clicked', () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: '移除词汇 hello' }));
    fireEvent.click(screen.getByRole('button', { name: '撤销删除' }));
    vi.advanceTimersByTime(2000);
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByText('已删除：hello')).not.toBeInTheDocument();
    expect(screen.getByText('hello')).toBeInTheDocument();
    vi.useRealTimers();
  });

  // --- Accessibility ---

  it('search input has sr-only label', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    const searchInput = screen.getByPlaceholderText('搜索...');
    expect(searchInput.id).toBe('vocabulary-search');
    expect(screen.getByText('搜索生词本')).toHaveClass('sr-only');
  });

  it('sort select has sr-only label', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    const sortSelect = screen.getByLabelText('排序方式');
    expect(sortSelect.id).toBe('vocabulary-sort');
  });

  it('undo button has aria-label', () => {
    const words = [createWord()];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '移除词汇 hello' }));
    expect(screen.getByRole('button', { name: '撤销删除' })).toBeInTheDocument();
  });

  // --- Multiple words ---

  it('renders multiple words', () => {
    const words = [
      createWord({ word: 'apple', translation: '苹果' }),
      createWord({ word: 'banana', translation: '香蕉' }),
      createWord({ word: 'cherry', translation: '樱桃' }),
    ];
    render(<VocabularyList words={words} onRemove={vi.fn()} />);
    expect(screen.getByText('apple')).toBeInTheDocument();
    expect(screen.getByText('banana')).toBeInTheDocument();
    expect(screen.getByText('cherry')).toBeInTheDocument();
  });
});
