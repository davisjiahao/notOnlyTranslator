import { useState, useRef } from 'react';
import type { UnknownWordEntry } from '@/shared/types';
import type { MasteryProfile } from '@/shared/types/mastery';
import { logger } from '@/shared/utils';
import { SAFE_CSV_ENCODING, decodeRoundTripCSVCell, escapeRoundTripCSVCell } from '@/shared/utils/csv';
import { PARTIAL_PROFILE_IMPORT_ERROR } from '@/shared/utils/importErrors';

const MAX_IMPORT_ENTRIES = 5000;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_CSV_COLUMNS = 32;
const MAX_CSV_FIELD_CHARS = 10000;

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
  const [exportError, setExportError] = useState<string | null>(null);
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
      'csvEncoding',
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
        SAFE_CSV_ENCODING,
      ];
    });

    return [headers.join(','), ...rows.map((row) => row.map(escapeRoundTripCSVCell).join(','))].join('\n');
  };

  /**
   * 解析 CSV 数据
   */
  const parseCSV = (csv: string): Partial<UnknownWordEntry>[] => {
    const records: string[][] = [];
    let values: string[] = [];
    let current = '';
    let inQuotes = false;
    let quotedClosed = false;
    const text = csv;

    for (let i = 0; i < text.length; i++) {
      const char = !inQuotes && text[i] === '\r' ? '\n' : text[i];
      if (!inQuotes && text[i] === '\r' && text[i + 1] === '\n') i++;
      if (quotedClosed && char !== ',' && char !== '\n') {
        throw new Error('数据格式无效：CSV 引号后存在多余字符');
      }
      if (char === '"') {
        if (inQuotes && text[i + 1] === '"') {
          if (current.length >= MAX_CSV_FIELD_CHARS + 1) throw new Error('数据格式无效：CSV 字段过长');
          current += '"';
          i++;
        } else if (inQuotes) {
          inQuotes = false;
          quotedClosed = true;
        } else if (current.length === 0) {
          inQuotes = true;
        } else {
          throw new Error('数据格式无效：CSV 引号不匹配');
        }
      } else if (!inQuotes && (char === ',' || char === '\n')) {
        if (values.length >= MAX_CSV_COLUMNS) throw new Error('数据格式无效：CSV 列数过多');
        values.push(current);
        current = '';
        quotedClosed = false;
        if (char === '\n') {
          if (values.some((value) => value.trim())) {
            if (records.length > MAX_IMPORT_ENTRIES) throw new Error('数据格式无效：词条数量超出限制');
            records.push(values);
          }
          values = [];
        }
      } else {
        if (current.length >= MAX_CSV_FIELD_CHARS + 1) throw new Error('数据格式无效：CSV 字段过长');
        current += char;
      }
    }
    if (inQuotes) throw new Error('数据格式无效：CSV 引号不匹配');
    if (values.length >= MAX_CSV_COLUMNS) throw new Error('数据格式无效：CSV 列数过多');
    values.push(current);
    if (values.some((value) => value.trim())) {
      if (records.length > MAX_IMPORT_ENTRIES) throw new Error('数据格式无效：词条数量超出限制');
      records.push(values);
    }

    const headers = records[0]?.map((header) => header.trim());
    if (!headers?.includes('word') || !headers.includes('translation')
      || new Set(headers).size !== headers.length) {
      throw new Error('数据格式无效：CSV 缺少必需列');
    }

    return records.slice(1).map((row) => {
      if (row.length !== headers.length) throw new Error('数据格式无效：CSV 列数不匹配');
      const encoded = headers.includes('csvEncoding');
      if (encoded && row[headers.indexOf('csvEncoding')] !== SAFE_CSV_ENCODING) {
        throw new Error('数据格式无效：CSV 编码标记不匹配');
      }
      const fields = Object.fromEntries(headers.map((header, index) => {
        const value = encoded && header !== 'csvEncoding'
          ? decodeRoundTripCSVCell(row[index]) : row[index].trim();
        if (value.length > MAX_CSV_FIELD_CHARS) throw new Error('数据格式无效：CSV 字段过长');
        return [header, value];
      }));
      return {
        word: fields.word,
        translation: fields.translation,
        context: fields.context || undefined,
        markedAt: fields.markedAt ? new Date(fields.markedAt).getTime() : Date.now(),
        reviewCount: fields.reviewCount ? Number(fields.reviewCount) : 0,
        lastReviewAt: fields.lastReviewAt ? new Date(fields.lastReviewAt).getTime() : undefined,
      };
    });
  };

  /**
   * 验证导入数据格式
   */
  const validateImportData = (data: unknown): data is Partial<UnknownWordEntry>[] => {
    if (!Array.isArray(data) || data.length === 0 || data.length > MAX_IMPORT_ENTRIES) {
      return false;
    }

    for (const item of data) {
      if (typeof item !== 'object' || item === null) {
        return false;
      }
      const entry = item as Record<string, unknown>;

      // 必需字段
      if (typeof entry.word !== 'string' || !entry.word.trim() || entry.word.length > 200
        || typeof entry.translation !== 'string' || !entry.translation.trim()
        || entry.translation.length > 10000) {
        return false;
      }

      if (entry.context !== undefined && (typeof entry.context !== 'string' || entry.context.length > 10000)) {
        return false;
      }
      for (const date of [entry.markedAt, entry.lastReviewAt]) {
        if (date !== undefined && (typeof date !== 'number' || !Number.isFinite(date)
          || Math.abs(date) > 8.64e15)) return false;
      }
      if (entry.reviewCount !== undefined && (typeof entry.reviewCount !== 'number'
        || !Number.isSafeInteger(entry.reviewCount) || entry.reviewCount < 0)) {
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
        setExportError('没有符合条件的词汇可导出');
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
      setExportError(null);
      setExportError(null);
    } catch (error) {
      logger.error('Export failed:', error);
      setExportError('导出失败：' + (error as Error).message);
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
      if (file.size > MAX_IMPORT_FILE_BYTES) throw new Error('文件过大，最多支持 10 MB');
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

      const entries = data.map((entry) => ({
        word: entry.word!.toLowerCase().trim(),
        translation: entry.translation!,
        context: entry.context ?? '',
        markedAt: entry.markedAt ?? Date.now(),
        reviewCount: entry.reviewCount ?? 0,
        lastReviewAt: entry.lastReviewAt,
      }));
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_VOCABULARY',
        payload: entries,
      });
      if (!response?.success || !response.data
        || !Number.isInteger(response.data.imported) || !Number.isInteger(response.data.skipped)
        || response.data.imported < 0 || response.data.skipped < 0
        || response.data.imported + response.data.skipped !== entries.length) {
        throw new Error(response?.error === PARTIAL_PROFILE_IMPORT_ERROR
          ? PARTIAL_PROFILE_IMPORT_ERROR : '导入失败');
      }
      const { imported, skipped } = response.data;
      setImportSuccess(`成功导入 ${imported} 个词汇${skipped > 0 ? `，跳过 ${skipped} 个` : ''}`);
      onImportComplete();

      // 3 秒后关闭弹窗
      setTimeout(() => {
        setShowImportModal(false);
        setImportSuccess(null);
      }, 3000);
    } catch (error) {
      logger.error('Import failed');
      const message = error instanceof Error ? error.message : '';
      setImportError(message === PARTIAL_PROFILE_IMPORT_ERROR || message.startsWith('数据格式无效')
        || message.startsWith('文件过大') || message.startsWith('不支持的文件格式')
        ? message : '导入失败，请检查文件或稍后重试');
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
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary-600 hover:bg-primary-700 text-white rounded-lg transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          导出词汇
        </button>

        <button
          onClick={() => setShowImportModal(true)}
          className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          导入词汇
        </button>
      </div>

      {/* 导出弹窗 */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="导出词汇">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">导出词汇</h4>

            {/* 格式选择 */}
            <div className="mb-4">
              <span id="export-format-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                导出格式
              </span>
              <div className="flex gap-2" role="group" aria-labelledby="export-format-label">
                <button
                  onClick={() => setExportOptions({ ...exportOptions, format: 'json' })}
                  aria-pressed={exportOptions.format === 'json'}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                    exportOptions.format === 'json'
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  JSON
                </button>
                <button
                  onClick={() => setExportOptions({ ...exportOptions, format: 'csv' })}
                  aria-pressed={exportOptions.format === 'csv'}
                  className={`flex-1 px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
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
              <label htmlFor="export-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                筛选条件
              </label>
              <select
                id="export-filter"
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
                  <label htmlFor="export-start-date" className="block text-xs text-gray-500 dark:text-gray-300 mb-1">
                    开始日期
                  </label>
                  <input
                    id="export-start-date"
                    type="date"
                    value={exportOptions.startDate || ''}
                    onChange={(e) =>
                      setExportOptions({ ...exportOptions, startDate: e.target.value })
                    }
                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
                <div>
                  <label htmlFor="export-end-date" className="block text-xs text-gray-500 dark:text-gray-300 mb-1">
                    结束日期
                  </label>
                  <input
                    id="export-end-date"
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
                  <label htmlFor="min-mastery-range" className="block text-xs text-gray-500 dark:text-gray-300 mb-1">
                    最小掌握度: {Math.round((exportOptions.minMasteryLevel || 0) * 100)}%
                  </label>
                  <input
                    id="min-mastery-range"
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
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((exportOptions.minMasteryLevel || 0) * 100)}
                  />
                </div>
                <div>
                  <label htmlFor="max-mastery-range" className="block text-xs text-gray-500 dark:text-gray-300 mb-1">
                    最大掌握度: {Math.round((exportOptions.maxMasteryLevel || 1) * 100)}%
                  </label>
                  <input
                    id="max-mastery-range"
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
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round((exportOptions.maxMasteryLevel || 1) * 100)}
                  />
                </div>
              </div>
            )}

            {/* 导出错误提示 */}
            {exportError && (
              <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400" role="alert">
                {exportError}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => { setShowExportModal(false); setExportError(null); }}
                className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                取消
              </button>
              <button
                onClick={handleExport}
                disabled={isExporting}
                className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg transition-colors flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
              >
                {isExporting && (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" role="status" aria-label="导出中" />
                )}
                导出
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 导入弹窗 */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="导入词汇">
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
              aria-label="选择要导入的 JSON 或 CSV 文件"
              className="w-full mb-4 text-gray-700 dark:text-gray-300 disabled:opacity-50"
            />

            {isImporting && (
              <div className="mb-4 flex items-center justify-center gap-2 text-gray-600 dark:text-gray-300">
                <div className="w-5 h-5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
                <span className="text-sm">正在导入...</span>
              </div>
            )}

            {importError && (
              <div role="status" className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
                {importError}
              </div>
            )}

            {importSuccess && (
              <div role="status" className="mb-4 p-3 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm">
                {importSuccess}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setShowImportModal(false)}
                disabled={isImporting}
                className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
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
