import { useState, useRef } from 'react';
import type { UnknownWordEntry } from '@/shared/types';
import type { MasteryProfile } from '@/shared/types/mastery';
import { logger } from '@/shared/utils';

interface VocabularyExportImportProps {
  words: UnknownWordEntry[];
  onImportComplete: () => void;
}

type ExportFormat = 'json' | 'csv';
type ExportFilter = 'all' | 'date' | 'mastery';

interface ExportOptions {
  format: ExportFormat;
  filter: ExportFilter;
  startDate?: string;
  endDate?: string;
  minMasteryLevel?: number;
  maxMasteryLevel?: number;
}

/**
 * 词汇数据导出导入组件
 */
export default function VocabularyExportImport({
  words,
  onImportComplete,
}: VocabularyExportImportProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: 'json',
    filter: 'all',
  });
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * 获取掌握度档案
   */
  const getMasteryProfile = async (): Promise<MasteryProfile | null> => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_MASTERY_OVERVIEW' });
      if (response.success && response.data) {
        return response.data;
      }
    } catch (error) {
      logger.error('Failed to get mastery profile:', error);
    }
    return null;
  };

  /**
   * 根据筛选条件过滤词汇
   */
  const filterWords = (
    allWords: UnknownWordEntry[],
    masteryProfile: MasteryProfile | null,
    options: ExportOptions
  ): UnknownWordEntry[] => {
    let filtered = [...allWords];

    if (options.filter === 'date' && options.startDate && options.endDate) {
      const start = new Date(options.startDate).getTime();
      const end = new Date(options.endDate).getTime() + 24 * 60 * 60 * 1000 - 1; // 包含结束日期
      filtered = filtered.filter((w) => w.markedAt >= start && w.markedAt <= end);
    }

    if (options.filter === 'mastery' && masteryProfile) {
      filtered = filtered.filter((w) => {
        const mastery = masteryProfile.wordMastery[w.word.toLowerCase()];
        if (!mastery) return false;
        const min = options.minMasteryLevel ?? 0;
        const max = options.maxMasteryLevel ?? 1;
        return mastery.masteryLevel >= min && mastery.masteryLevel <= max;
      });
    }

    return filtered;
  };

  /**
   * 将词汇转换为 CSV 格式
   */
  const convertToCSV = (
    data: UnknownWordEntry[],
    masteryProfile: MasteryProfile | null
  ): string => {
    const headers = [
      'word',
      'translation',
      'context',
      'markedAt',
      'reviewCount',
      'lastReviewAt',
      'masteryLevel',
      'estimatedLevel',
    ];

    const rows = data.map((entry) => {
      const mastery = masteryProfile?.wordMastery[entry.word.toLowerCase()];
      return [
        entry.word,
        entry.translation,
        entry.context || '',
        new Date(entry.markedAt).toISOString(),
        entry.reviewCount,
        entry.lastReviewAt ? new Date(entry.lastReviewAt).toISOString() : '',
        mastery ? mastery.masteryLevel.toFixed(2) : '',
        mastery ? mastery.estimatedLevel : '',
      ];
    });

    // 转义 CSV 字段
    const escapeCSV = (value: string | number): string => {
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    return [headers.join(','), ...rows.map((row) => row.map(escapeCSV).join(','))].join('\n');
  };

  /**
   * 解析 CSV 数据
   */
  const parseCSV = (csv: string): Partial<UnknownWordEntry>[] => {
    const lines = csv.split('\n').filter((line) => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim());
    const result: Partial<UnknownWordEntry>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          if (line[j + 1] === '"') {
            current += '"';
            j++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const entry: Partial<UnknownWordEntry> = {};
      headers.forEach((header, index) => {
        const value = values[index];
        switch (header) {
          case 'word':
            entry.word = value;
            break;
          case 'translation':
            entry.translation = value;
            break;
          case 'context':
            entry.context = value || undefined;
            break;
          case 'markedAt':
            entry.markedAt = value ? new Date(value).getTime() : Date.now();
            break;
          case 'reviewCount':
            entry.reviewCount = value ? parseInt(value, 10) : 0;
            break;
          case 'lastReviewAt':
            entry.lastReviewAt = value ? new Date(value).getTime() : undefined;
            break;
        }
      });

      if (entry.word && entry.translation) {
        result.push(entry);
      }
    }

    return result;
  };

  /**
   * 验证导入数据格式
   */
  const validateImportData = (data: unknown): data is UnknownWordEntry[] => {
    if (!Array.isArray(data)) {
      return false;
    }

    for (const item of data) {
      if (typeof item !== 'object' || item === null) {
        return false;
      }
      const entry = item as Record<string, unknown>;

      // 必需字段
      if (typeof entry.word !== 'string' || !entry.word.trim()) {
        return false;
      }
      if (typeof entry.translation !== 'string') {
        return false;
      }

      // 可选字段类型检查
      if (entry.context !== undefined && typeof entry.context !== 'string') {
        return false;
      }
      if (entry.markedAt !== undefined && typeof entry.markedAt !== 'number') {
        return false;
      }
      if (entry.reviewCount !== undefined && typeof entry.reviewCount !== 'number') {
        return false;
      }
    }

    return true;
  };

  /**
   * 导出词汇数据
   */
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const masteryProfile = await getMasteryProfile();
      const filtered = filterWords(words, masteryProfile, exportOptions);

      if (filtered.length === 0) {
        alert('没有符合条件的词汇可导出');
        setIsExporting(false);
        return;
      }

      let content: string;
      let mimeType: string;
      let extension: string;

      if (exportOptions.format === 'json') {
        // 构建导出数据结构
        const exportData = {
          version: '1.0',
          exportAt: Date.now(),
          totalWords: filtered.length,
          words: filtered,
          masteryData:
            masteryProfile
              ? Object.fromEntries(
                  filtered
                    .map((w) => [w.word.toLowerCase(), masteryProfile.wordMastery[w.word.toLowerCase()]])
                    .filter(([, v]) => v !== undefined)
                )
              : {},
        };
        content = JSON.stringify(exportData, null, 2);
        mimeType = 'application/json';
        extension = 'json';
      } else {
        content = convertToCSV(filtered, masteryProfile);
        mimeType = 'text/csv';
        extension = 'csv';
      }

      // 创建下载
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `vocabulary-export-${new Date().toISOString().split('T')[0]}.${extension}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setShowExportModal(false);
    } catch (error) {
      logger.error('Export failed:', error);
      alert('导出失败：' + (error as Error).message);
    } finally {
      setIsExporting(false);
    }
  };

  /**
   * 处理文件选择
   */
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const content = await file.text();
      let data: unknown;

      if (file.name.endsWith('.json')) {
        data = JSON.parse(content);
        // 处理包装结构
        if (data && typeof data === 'object' && 'words' in data) {
          data = (data as { words: unknown }).words;
        }
      } else if (file.name.endsWith('.csv')) {
        data = parseCSV(content);
      } else {
        throw new Error('不支持的文件格式，请使用 JSON 或 CSV 文件');
      }

      if (!validateImportData(data)) {
        throw new Error('数据格式无效，请检查文件内容');
      }

      // 导入词汇
      let imported = 0;
      let skipped = 0;

      for (const entry of data as UnknownWordEntry[]) {
        const wordEntry: UnknownWordEntry = {
          word: entry.word.toLowerCase().trim(),
          translation: entry.translation,
          context: entry.context,
          markedAt: entry.markedAt || Date.now(),
          reviewCount: entry.reviewCount || 0,
          lastReviewAt: entry.lastReviewAt,
        };

        try {
          const response = await chrome.runtime.sendMessage({
            type: 'ADD_TO_VOCABULARY',
            payload: wordEntry,
          });

          if (response.success) {
            imported++;
          } else {
            skipped++;
          }
        } catch {
          skipped++;
        }
      }

      setImportSuccess(`成功导入 ${imported} 个词汇${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`);
      onImportComplete();

      // 3 秒后关闭弹窗
      setTimeout(() => {
        setShowImportModal(false);
        setImportSuccess(null);
      }, 3000);
    } catch (error) {
      logger.error('Import failed:', error);
      setImportError((error as Error).message);
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">数据导入导出</h3>

      <div className="flex gap-4">
        <button
          onClick={() => setShowExportModal(true)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          导出词汇
        </button>

        <button
          onClick={() => setShowImportModal(true)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          导入词汇
        </button>
      </div>

      {/* 导出弹窗 */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">导出词汇</h4>

            {/* 格式选择 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                导出格式
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setExportOptions({ ...exportOptions, format: 'json' })}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    exportOptions.format === 'json'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  JSON
                </button>
                <button
                  onClick={() => setExportOptions({ ...exportOptions, format: 'csv' })}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors ${
                    exportOptions.format === 'csv'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  CSV
                </button>
              </div>
            </div>

            {/* 筛选条件 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                筛选条件
              </label>
              <select
                value={exportOptions.filter}
                onChange={(e) =>
                  setExportOptions({
                    ...exportOptions,
                    filter: e.target.value as ExportFilter,
                  })
                }
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              >
                <option value="all">全部词汇</option>
                <option value="date">按日期筛选</option>
                <option value="mastery">按掌握度筛选</option>
              </select>
            </div>

            {/* 日期筛选 */}
            {exportOptions.filter === 'date' && (
              <div className="mb-4 space-y-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    开始日期
                  </label>
                  <input
                    type="date"
                    value={exportOptions.startDate || ''}
                    onChange={(e) =>
                      setExportOptions({ ...exportOptions, startDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    结束日期
                  </label>
                  <input
                    type="date"
                    value={exportOptions.endDate || ''}
                    onChange={(e) =>
                      setExportOptions({ ...exportOptions, endDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* 掌握度筛选 */}
            {exportOptions.filter === 'mastery' && (
              <div className="mb-4 space-y-2">
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    最小掌握度: {Math.round((exportOptions.minMasteryLevel || 0) * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round((exportOptions.minMasteryLevel || 0) * 100)}
                    onChange={(e) =>
                      setExportOptions({
                        ...exportOptions,
                        minMasteryLevel: Number(e.target.value) / 100,
                      })
                    }
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    最大掌握度: {Math.round((exportOptions.maxMasteryLevel || 1) * 100)}%
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round((exportOptions.maxMasteryLevel || 1) * 100)}
                    onChange={(e) =>
                      setExportOptions({
                        ...exportOptions,
                        maxMasteryLevel: Number(e.target.value) / 100,
                      })
                    }
                    className="w-full"
                  />
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowExportModal(false)}
                className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isExporting && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                )}
                导出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入弹窗 */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">导入词汇</h4>

            <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
              <p className="text-sm text-blue-700 dark:text-blue-300">
                支持 JSON 和 CSV 格式。导入时会自动跳过重复的词汇。
              </p>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,.csv"
              onChange={handleFileSelect}
              disabled={isImporting}
              className="w-full mb-4 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            />

            {isImporting && (
              <div className="mb-4 flex items-center justify-center gap-2 text-gray-600 dark:text-gray-400">
                <div className="w-5 h-5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                <span className="text-sm">正在导入...</span>
              </div>
            )}

            {importError && (
              <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
                {importError}
              </div>
            )}

            {importSuccess && (
              <div className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm">
                {importSuccess}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowImportModal(false)}
                disabled={isImporting}
                className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
