import { useState, useCallback, useRef } from 'react';
import type { UnknownWordEntry } from '@/shared/types';
import { formatDate } from '@/shared/utils';
import EmptyState from '@/shared/components/EmptyState';

interface VocabularyListProps {
  words: UnknownWordEntry[];
  onRemove: (word: string) => void;
}

export default function VocabularyList({ words, onRemove }: VocabularyListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'alpha'>('recent');
  /** 待删除的词（点击删除后显示撤销提示，2 秒后真正删除） */
  const [pendingDelete, setPendingDelete] = useState<{ word: string; entry: UnknownWordEntry } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRequestDelete = useCallback((word: string, entry: UnknownWordEntry) => {
    // 先标记待删除，显示撤销提示
    setPendingDelete({ word, entry });
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      onRemove(word);
      setPendingDelete(null);
    }, 2000);
  }, [onRemove]);

  const handleUndo = useCallback(() => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
    setPendingDelete(null);
  }, []);

  // Filter and sort words
  const filteredWords = words
    .filter((w) =>
      w.word.toLowerCase().includes(searchTerm.toLowerCase()) ||
      w.translation.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => {
      if (sortBy === 'recent') {
        return b.markedAt - a.markedAt;
      }
      return a.word.localeCompare(b.word);
    });

  if (words.length === 0) {
    return (
      <EmptyState
        icon="book"
        title="生词本为空"
        description="阅读时标记不认识的词汇，它们会出现在这里"
      />
    );
  }

  return (
    <div>
      {/* Search and sort */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <label htmlFor="vocabulary-search" className="sr-only">搜索生词本</label>
          <input
            id="vocabulary-search"
            type="text"
            placeholder="搜索..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
          />
          <svg aria-hidden="true"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <label htmlFor="vocabulary-sort" className="sr-only">排序方式</label>
        <select
          id="vocabulary-sort"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'recent' | 'alpha')}
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-800 dark:text-white"
        >
          <option value="recent">最近添加</option>
          <option value="alpha">字母排序</option>
        </select>
      </div>

      {/* Word list */}
      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        {filteredWords.map((entry) => (
          pendingDelete?.word === entry.word ? (
            /* 删除确认 + 撤销栏 */
            <div
              key={entry.word}
              className="bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-800 p-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-red-700 dark:text-red-300">
                    已删除：{entry.word}
                  </div>
                  <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">点击「撤销」恢复</p>
                </div>
                <button
                  onClick={handleUndo}
                  className="ml-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                  aria-label="撤销删除"
                >
                  撤销
                </button>
              </div>
            </div>
          ) : (
            <div
              key={entry.word}
              className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{entry.word}</span>
                    {entry.reviewCount > 0 && (
                      <span className="text-xs text-gray-500 dark:text-gray-300">
                        复习 {entry.reviewCount} 次
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{entry.translation}</p>
                  {entry.context && (
                    <p className="text-xs text-gray-500 dark:text-gray-300 mt-1 truncate">
                      "{entry.context}"
                    </p>
                  )}
                  <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">
                    {formatDate(entry.markedAt)}
                  </p>
                </div>
                <button
                  onClick={() => handleRequestDelete(entry.word, entry)}
                  className="ml-2 p-1 text-gray-500 dark:text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
                  aria-label={`移除词汇 ${entry.word}`}
                >
                  <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          )
        ))}

        {filteredWords.length === 0 && searchTerm && (
          <EmptyState
            icon="search"
            title="未找到匹配的词汇"
            description="尝试使用其他关键词搜索"
          />
        )}
      </div>
    </div>
  );
}
