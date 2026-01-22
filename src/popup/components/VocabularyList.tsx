import { useState } from 'react';
import type { UnknownWordEntry } from '@/shared/types';
import { formatDate } from '@/shared/utils';

interface VocabularyListProps {
  words: UnknownWordEntry[];
  onRemove: (word: string) => void;
}

export default function VocabularyList({ words, onRemove }: VocabularyListProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'alpha'>('recent');

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
      <div className="text-center py-8">
        <div className="text-gray-400 mb-2">
          <svg className="w-12 h-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </div>
        <p className="text-sm text-gray-500">生词本为空</p>
        <p className="text-xs text-gray-400 mt-1">
          阅读时标记不认识的词汇，它们会出现在这里
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Search and sort */}
      <div className="flex gap-2 mb-3">
        <div className="flex-1 relative">
          <input
            type="text"
            placeholder="搜索..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'recent' | 'alpha')}
          className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          <option value="recent">最近添加</option>
          <option value="alpha">字母排序</option>
        </select>
      </div>

      {/* Word list */}
      <div className="space-y-2 max-h-[280px] overflow-y-auto">
        {filteredWords.map((entry) => (
          <div
            key={entry.word}
            className="bg-white rounded-lg border border-gray-200 p-3"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{entry.word}</span>
                  {entry.reviewCount > 0 && (
                    <span className="text-xs text-gray-400">
                      复习 {entry.reviewCount} 次
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-0.5">{entry.translation}</p>
                {entry.context && (
                  <p className="text-xs text-gray-400 mt-1 truncate">
                    "{entry.context}"
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {formatDate(entry.markedAt)}
                </p>
              </div>
              <button
                onClick={() => onRemove(entry.word)}
                className="ml-2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                title="移除"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        ))}

        {filteredWords.length === 0 && searchTerm && (
          <div className="text-center py-4 text-sm text-gray-500">
            未找到匹配的词汇
          </div>
        )}
      </div>
    </div>
  );
}
