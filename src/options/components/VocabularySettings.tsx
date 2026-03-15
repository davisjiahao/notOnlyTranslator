import { useState, useEffect } from 'react';
import type { UnknownWordEntry } from '@/shared/types';
import { formatDate, logger } from '@/shared/utils';
import VocabularyExportImport from './VocabularyExportImport';

interface VocabularySettingsProps {
  isSaving: boolean;
}

export default function VocabularySettings({ isSaving }: VocabularySettingsProps) {
  const [words, setWords] = useState<UnknownWordEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'alpha'>('recent');

  useEffect(() => {
    loadVocabulary();
  }, []);

  const loadVocabulary = async () => {
    setIsLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_VOCABULARY' });
      if (response.success && response.data) {
        setWords(response.data);
      }
    } catch (error) {
      logger.error('Failed to load vocabulary:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const removeWord = async (word: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REMOVE_FROM_VOCABULARY',
        payload: { word }
      });
      if (response.success) {
        setWords(words.filter(w => w.word !== word));
      }
    } catch (error) {
      logger.error('Failed to remove word:', error);
    }
  };

  const clearAllWords = async () => {
    if (!confirm('确定要清空生词本吗？此操作不可恢复。')) return;

    try {
      // 逐个删除所有单词
      for (const word of words) {
        await chrome.runtime.sendMessage({
          type: 'REMOVE_FROM_VOCABULARY',
          payload: { word: word.word }
        });
      }
      setWords([]);
    } catch (error) {
      logger.error('Failed to clear vocabulary:', error);
    }
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 统计信息 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">生词本</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{words.length}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">总词汇</div>
          </div>
          <div className="text-center p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {words.filter(w => w.reviewCount > 0).length}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">已复习</div>
          </div>
          <div className="text-center p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {words.filter(w => Date.now() - w.markedAt < 7 * 24 * 60 * 60 * 1000).length}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">本周新增</div>
          </div>
        </div>
      </div>

      {/* 数据导入导出 */}
      <VocabularyExportImport words={words} onImportComplete={loadVocabulary} />

      {/* 词汇列表 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        {/* Search and sort */}
        <div className="flex gap-3 mb-4">
          <div className="flex-1 relative">
            <input
              type="text"
              placeholder="搜索单词或翻译..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 dark:text-gray-500"
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
            className="px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-gray-800 dark:text-white"
          >
            <option value="recent">最近添加</option>
            <option value="alpha">字母排序</option>
          </select>
        </div>

        {/* Word list */}
        {words.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 dark:text-gray-500 mb-3">
              <svg className="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <p className="text-gray-500 dark:text-gray-400 mb-1">生词本为空</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              阅读时标记不认识的词汇，它们会出现在这里
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2 max-h-[400px] overflow-y-auto mb-4">
              {filteredWords.map((entry) => (
                <div
                  key={entry.word}
                  className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-white">{entry.word}</span>
                        {entry.reviewCount > 0 && (
                          <span className="px-2 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-full">
                            复习 {entry.reviewCount} 次
                          </span>
                        )}
                      </div>
                      <p className="text-gray-600 dark:text-gray-300 mt-1">{entry.translation}</p>
                      {entry.context && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2 italic truncate">
                          "{entry.context}"
                        </p>
                      )}
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                        {formatDate(entry.markedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => removeWord(entry.word)}
                      disabled={isSaving}
                      className="ml-3 p-2 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                      title="移除"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}

              {filteredWords.length === 0 && searchTerm && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  未找到匹配的词汇
                </div>
              )}
            </div>

            {/* 底部操作 */}
            <div className="flex items-center justify-between pt-4 border-t border-gray-200 dark:border-gray-700">
              <span className="text-sm text-gray-500 dark:text-gray-400">
                共 {filteredWords.length} 个词汇
                {searchTerm && ` (筛选自 ${words.length} 个)`}
              </span>
              {words.length > 0 && (
                <button
                  onClick={clearAllWords}
                  disabled={isSaving}
                  className="px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-50"
                >
                  清空生词本
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
