import { useEffect, useState, useCallback } from 'react';
import type { TranslationHistoryEntry, HistoryQueryResult, HistoryStats } from '@/background/translationHistory';
import { logger } from '@/shared/utils';

interface TranslationHistoryProps {
  // 组件不需要外部props
}

export default function TranslationHistory({}: TranslationHistoryProps) {
  const [entries, setEntries] = useState<TranslationHistoryEntry[]>([]);
  const [stats, setStats] = useState<HistoryStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<TranslationHistoryEntry | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const LIMIT = 20;

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_HISTORY_STATS' });
      if (response.success && response.data) {
        setStats(response.data);
      }
    } catch (error) {
      logger.error('Failed to load history stats:', error);
    }
  }, []);

  const loadHistory = useCallback(async (reset = false) => {
    setIsLoading(true);
    try {
      const newOffset = reset ? 0 : offset;
      const params = {
        keyword: searchTerm || undefined,
        limit: LIMIT,
        offset: newOffset,
      };

      const response = await chrome.runtime.sendMessage({
        type: 'QUERY_TRANSLATION_HISTORY',
        payload: params,
      });

      if (response.success && response.data) {
        const result = response.data as HistoryQueryResult;
        if (reset) {
          setEntries(result.entries);
        } else {
          setEntries((prev) => [...prev, ...result.entries]);
        }
        setHasMore(result.hasMore);
        setOffset(newOffset + result.entries.length);
      }
    } catch (error) {
      logger.error('Failed to load history:', error);
      showToast('加载失败', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [offset, searchTerm, showToast]);

  useEffect(() => {
    loadStats();
    loadHistory(true);
  }, []);

  const handleSearch = () => {
    loadHistory(true);
  };

  const handleLoadMore = () => {
    loadHistory(false);
  };

  const handleDeleteEntry = async (id: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_HISTORY_ENTRY',
        payload: { id },
      });

      if (response.success) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        showToast('已删除');
        loadStats();
      } else {
        showToast('删除失败', 'error');
      }
    } catch (error) {
      logger.error('Failed to delete entry:', error);
      showToast('删除失败', 'error');
    }
    setShowDeleteModal(false);
    setEntryToDelete(null);
  };

  const handleClearAll = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_HISTORY' });

      if (response.success) {
        setEntries([]);
        showToast('已清空所有历史');
        loadStats();
      } else {
        showToast('清空失败', 'error');
      }
    } catch (error) {
      logger.error('Failed to clear history:', error);
      showToast('清空失败', 'error');
    }
    setShowDeleteModal(false);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'EXPORT_HISTORY_DATA' });

      if (response.success && response.data) {
        const data = response.data;
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `translation-history-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('导出成功');
      } else {
        showToast('导出失败', 'error');
      }
    } catch (error) {
      logger.error('Failed to export history:', error);
      showToast('导出失败', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncateText = (text: string, maxLength: number) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  const getModeLabel = (mode: string) => {
    const labels: Record<string, string> = {
      'inline-only': '生词高亮',
      'bilingual': '双语对照',
      'full-translate': '全文翻译',
    };
    return labels[mode] || mode;
  };

  return (
    <div className="space-y-6">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 px-4 py-2 rounded-lg shadow-lg z-50 ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">翻译历史</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={isExporting || entries.length === 0}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            {isExporting ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                导出中...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                导出
              </>
            )}
          </button>
          <button
            onClick={() => {
              setEntryToDelete('all');
              setShowDeleteModal(true);
            }}
            disabled={entries.length === 0}
            className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-2-2L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            清空
          </button>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalEntries}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">总记录</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-primary-600">{stats.totalCharacters.toLocaleString()}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">总字符数</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-green-600">{stats.last7Days}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">近7天</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-blue-600">{stats.uniquePages}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400">不同页面</div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索原文、译文或页面标题..."
            className="w-full px-4 py-2 pl-10 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:text-white"
          />
          <svg
            className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-primary-600 text-white text-sm rounded-lg hover:bg-primary-700 transition-colors"
        >
          搜索
        </button>
      </div>

      {/* History List */}
      <div className="space-y-3">
        {isLoading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 text-gray-500 dark:text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <p>暂无翻译记录</p>
            <p className="text-sm mt-1">浏览网页时自动保存翻译历史</p>
          </div>
        ) : (
          <>
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors cursor-pointer group"
                onClick={() => setSelectedEntry(entry)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                        {getModeLabel(entry.mode)}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(entry.timestamp)}</span>
                      {entry.userLevel && (
                        <span className="text-xs text-primary-600 dark:text-primary-400">
                          {entry.userLevel.level}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900 dark:text-gray-100 mb-1 line-clamp-2">
                      {truncateText(entry.originalText, 150)}
                    </p>
                    {entry.translation.fullText && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1">
                        {truncateText(entry.translation.fullText, 100)}
                      </p>
                    )}
                    {entry.pageTitle && (
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 truncate">
                        来自: {entry.pageTitle}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEntryToDelete(entry.id);
                      setShowDeleteModal(true);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all"
                    title="删除"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-2-2L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}

            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={isLoading}
                className="w-full py-3 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
              >
                {isLoading ? '加载中...' : '加载更多'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Detail Modal */}
      {selectedEntry && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedEntry(null)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                    {getModeLabel(selectedEntry.mode)}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {formatDate(selectedEntry.timestamp)}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedEntry(null)}
                  className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">原文</h3>
                  <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                    {selectedEntry.originalText}
                  </p>
                </div>

                {selectedEntry.translation.fullText && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">译文</h3>
                    <p className="text-sm text-gray-900 dark:text-gray-100 whitespace-pre-wrap">
                      {selectedEntry.translation.fullText}
                    </p>
                  </div>
                )}

                {selectedEntry.translation.words.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">生词</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedEntry.translation.words.map((word, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 text-xs bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400 rounded border border-yellow-200 dark:border-yellow-700"
                        >
                          {word.original} → {word.translation}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedEntry.pageTitle && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">来源页面</h3>
                    <a
                      href={selectedEntry.pageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 underline"
                    >
                      {selectedEntry.pageTitle}
                    </a>
                  </div>
                )}

                {selectedEntry.userLevel && (
                  <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400 pt-2 border-t border-gray-100 dark:border-gray-700">
                    <span>词汇量: {selectedEntry.userLevel.estimatedVocabulary.toLocaleString()}</span>
                    <span>等级: {selectedEntry.userLevel.level}</span>
                    <span>字符数: {selectedEntry.charCount}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-xl max-w-sm w-full p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">确认删除</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              {entryToDelete === 'all'
                ? '确定要清空所有翻译历史记录吗？此操作不可恢复。'
                : '确定要删除这条翻译记录吗？此操作不可恢复。'}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (entryToDelete === 'all') {
                    handleClearAll();
                  } else if (entryToDelete) {
                    handleDeleteEntry(entryToDelete);
                  }
                }}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
