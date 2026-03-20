import { useState, useCallback } from 'react';
import {
  exportToJSON,
  importFromJSON,
  exportVocabularyToCSV,
  clearAllData,
  getStorageStats,
  validateImportData,
  DEFAULT_IMPORT_OPTIONS,
  type ImportOptions,
  type ImportResult,
} from '@/shared/utils/dataExport';
import { logger } from '@/shared/utils';

type Tab = 'export' | 'import' | 'advanced';

/**
 * 数据导出/导入组件
 *
 * 提供用户数据的导出、导入和管理功能
 */
export default function DataManager() {
  const [activeTab, setActiveTab] = useState<Tab>('export');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [importOptions, setImportOptions] = useState<ImportOptions>(DEFAULT_IMPORT_OPTIONS);
  const [importPreview, setImportPreview] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
    metadata?: {
      knownWordsCount: number;
      unknownWordsCount: number;
      masteryWordsCount: number;
    };
  } | null>(null);
  const [storageStats, setStorageStats] = useState<{
    syncUsed: number;
    localUsed: number;
    syncQuota: number;
    localQuota: number;
  } | null>(null);

  // 显示消息
  const showMessage = (type: 'success' | 'error' | 'warning', text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 5000);
  };

  // 导出为 JSON
  const handleExportJSON = useCallback(async () => {
    setIsLoading(true);
    try {
      const json = await exportToJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `notonlytranslator-backup-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMessage('success', '数据导出成功');
    } catch (error) {
      logger.error('Export failed:', error);
      showMessage('error', '导出失败：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 导出词汇为 CSV
  const handleExportCSV = useCallback(async () => {
    setIsLoading(true);
    try {
      const csv = await exportVocabularyToCSV();
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vocabulary-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showMessage('success', '词汇导出成功');
    } catch (error) {
      logger.error('Export CSV failed:', error);
      showMessage('error', '导出失败：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 处理文件选择
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const content = await file.text();
      const data = JSON.parse(content);
      const validation = validateImportData(data);

      setImportPreview({
        valid: validation.valid,
        errors: validation.errors,
        warnings: validation.warnings,
        metadata: validation.data?.metadata,
      });
    } catch (error) {
      setImportPreview({
        valid: false,
        errors: ['文件解析失败：' + (error instanceof Error ? error.message : String(error))],
        warnings: [],
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 执行导入
  const handleImport = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';

    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setIsLoading(true);
      try {
        const content = await file.text();
        const result: ImportResult = await importFromJSON(content, importOptions);

        if (result.success) {
          const details = [];
          if (result.details.profileImported) details.push('用户配置');
          if (result.details.settingsImported) details.push('设置');
          if (result.details.masteryImported) details.push('掌握度');
          if (result.details.cacheImported) details.push('缓存');

          showMessage('success', `导入成功：${details.join('、')}`);

          if (result.warnings.length > 0) {
            logger.warn('Import warnings:', result.warnings);
          }
        } else {
          showMessage('error', `导入失败：${result.errors.join('、')}`);
        }
      } catch (error) {
        logger.error('Import failed:', error);
        showMessage('error', '导入失败：' + (error instanceof Error ? error.message : String(error)));
      } finally {
        setIsLoading(false);
      }
    };

    input.click();
  }, [importOptions]);

  // 清除所有数据
  const handleClearData = useCallback(async () => {
    if (!confirm('确定要清除所有数据吗？此操作不可恢复！')) {
      return;
    }

    if (!confirm('再次确认：这将删除所有用户配置、词汇、掌握度数据。确定继续吗？')) {
      return;
    }

    setIsLoading(true);
    try {
      await clearAllData();
      showMessage('success', '数据已清除，请刷新页面');
    } catch (error) {
      logger.error('Clear failed:', error);
      showMessage('error', '清除失败：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 获取存储统计
  const handleGetStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const stats = await getStorageStats();
      setStorageStats(stats);
    } catch (error) {
      logger.error('Get stats failed:', error);
      showMessage('error', '获取统计失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 格式化字节大小
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <div className="max-w-2xl mx-auto">
      {/* 消息提示 */}
      {message && (
        <div
          className={`mb-4 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200'
              : message.type === 'warning'
              ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-200'
              : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 标签页导航 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        <button
          onClick={() => setActiveTab('export')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'export'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          导出数据
        </button>
        <button
          onClick={() => setActiveTab('import')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'import'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          导入数据
        </button>
        <button
          onClick={() => {
            setActiveTab('advanced');
            handleGetStats();
          }}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'advanced'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          高级选项
        </button>
      </div>

      {/* 导出标签页 */}
      {activeTab === 'export' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              导出备份
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              将所有用户数据导出为 JSON 文件，包括用户配置、词汇列表、掌握度数据等。
              可用于数据备份或迁移到其他设备。
            </p>
            <button
              onClick={handleExportJSON}
              disabled={isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium
                         hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? '导出中...' : '导出 JSON 备份'}
            </button>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              导出词汇列表
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              将词汇列表导出为 CSV 文件，可在 Excel 或其他表格软件中查看和编辑。
            </p>
            <button
              onClick={handleExportCSV}
              disabled={isLoading}
              className="px-4 py-2 bg-green-600 text-white rounded-lg font-medium
                         hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? '导出中...' : '导出 CSV 词汇表'}
            </button>
          </div>
        </div>
      )}

      {/* 导入标签页 */}
      {activeTab === 'import' && (
        <div className="space-y-6">
          {/* 导入选项 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              导入选项
            </h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={importOptions.importProfile}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, importProfile: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-gray-700 dark:text-gray-300">导入用户配置</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={importOptions.importSettings}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, importSettings: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-gray-700 dark:text-gray-300">导入用户设置</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={importOptions.importMastery}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, importMastery: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-gray-700 dark:text-gray-300">导入掌握度数据</span>
              </label>
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={importOptions.mergeVocabulary}
                  onChange={(e) => setImportOptions(prev => ({ ...prev, mergeVocabulary: e.target.checked }))}
                  className="w-4 h-4 rounded border-gray-300"
                />
                <span className="text-gray-700 dark:text-gray-300">合并词汇列表（而非替换）</span>
              </label>
            </div>
          </div>

          {/* 预览导入文件 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
              选择备份文件
            </h3>
            <div className="mb-4">
              <label className="block">
                <span className="sr-only">选择文件</span>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="block w-full text-sm text-gray-500 dark:text-gray-400
                             file:mr-4 file:py-2 file:px-4
                             file:rounded-lg file:border-0
                             file:text-sm file:font-medium
                             file:bg-blue-50 dark:file:bg-blue-900/20
                             file:text-blue-700 dark:file:text-blue-300
                             hover:file:bg-blue-100 dark:hover:file:bg-blue-900/30"
                />
              </label>
            </div>

            {importPreview && (
              <div className={`p-4 rounded-lg ${
                importPreview.valid
                  ? 'bg-green-50 dark:bg-green-900/20'
                  : 'bg-red-50 dark:bg-red-900/20'
              }`}>
                {importPreview.valid ? (
                  <>
                    <p className="text-green-800 dark:text-green-200 font-medium mb-2">
                      文件验证通过
                    </p>
                    {importPreview.metadata && (
                      <div className="text-sm text-green-700 dark:text-green-300 space-y-1">
                        <p>已知词汇：{importPreview.metadata.knownWordsCount} 个</p>
                        <p>生词：{importPreview.metadata.unknownWordsCount} 个</p>
                        <p>掌握度记录：{importPreview.metadata.masteryWordsCount} 个</p>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className="text-red-800 dark:text-red-200 font-medium mb-2">
                      文件验证失败
                    </p>
                    <ul className="text-sm text-red-700 dark:text-red-300 list-disc list-inside">
                      {importPreview.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  </>
                )}
                {importPreview.warnings.length > 0 && (
                  <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                    <p className="font-medium">警告：</p>
                    <ul className="list-disc list-inside">
                      {importPreview.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 导入按钮 */}
          <button
            onClick={handleImport}
            disabled={isLoading}
            className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg font-medium
                       hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {isLoading ? '导入中...' : '选择文件并导入'}
          </button>
        </div>
      )}

      {/* 高级选项标签页 */}
      {activeTab === 'advanced' && (
        <div className="space-y-6">
          {/* 存储统计 */}
          {storageStats && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">
                存储使用情况
              </h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 dark:text-gray-400">同步存储</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {formatBytes(storageStats.syncUsed)} / {formatBytes(storageStats.syncQuota)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${(storageStats.syncUsed / storageStats.syncQuota) * 100}%` }}
                    />
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 dark:text-gray-400">本地存储</span>
                    <span className="text-gray-800 dark:text-gray-200">
                      {formatBytes(storageStats.localUsed)} / {formatBytes(storageStats.localQuota)}
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${(storageStats.localUsed / storageStats.localQuota) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 危险操作 */}
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 p-6">
            <h3 className="text-lg font-semibold text-red-800 dark:text-red-200 mb-4">
              危险操作
            </h3>
            <p className="text-sm text-red-600 dark:text-red-300 mb-4">
              以下操作不可恢复，请谨慎使用。
            </p>
            <button
              onClick={handleClearData}
              disabled={isLoading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium
                         hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {isLoading ? '清除中...' : '清除所有数据'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}