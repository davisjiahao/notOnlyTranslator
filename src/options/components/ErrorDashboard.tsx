// 错误追踪仪表板组件

import React, { useState, useEffect, useCallback } from 'react';
import type {
  ErrorEntry,
  ErrorStats,
  ErrorCategory,
  ErrorSeverity,
  ErrorQueryParams
} from '@/shared/error-tracking/types';
import { ERROR_CATEGORIES } from '@/shared/error-tracking/types';

// 错误严重程度配置
const ERROR_SEVERITIES: Record<ErrorSeverity, { label: string; color: string; bgColor: string }> = {
  fatal: { label: '致命', color: 'text-red-700', bgColor: 'bg-red-100 dark:bg-red-900/30' },
  error: { label: '错误', color: 'text-orange-700', bgColor: 'bg-orange-100 dark:bg-orange-900/30' },
  warning: { label: '警告', color: 'text-yellow-700', bgColor: 'bg-yellow-100 dark:bg-yellow-900/30' }
};

// 严重程度徽章组件
const SeverityBadge: React.FC<{ severity: ErrorSeverity }> = ({ severity }) => {
  const config = ERROR_SEVERITIES[severity];
  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}>
      {config.label}
    </span>
  );
};

// 分类徽章组件
const CategoryBadge: React.FC<{ category: ErrorCategory }> = ({ category }) => {
  const config = ERROR_CATEGORIES[category];
  return (
    <span className="px-2 py-1 rounded-full text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
      {config?.label || category}
    </span>
  );
};

// 错误详情弹窗组件
const ErrorDetailModal: React.FC<{
  error: ErrorEntry | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}> = ({ error, isOpen, onClose, onDelete }) => {
  if (!isOpen || !error) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto">
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                错误详情
              </h3>
              <div className="flex gap-2">
                <SeverityBadge severity={error.severity} />
                <CategoryBadge category={error.category} />
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-500 dark:text-gray-400">错误消息</label>
              <p className="mt-1 text-gray-900 dark:text-white break-all">{error.message}</p>
            </div>

            {error.stack && (
              <div>
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">堆栈追踪</label>
                <pre className="mt-1 p-3 bg-gray-100 dark:bg-gray-900 rounded text-xs text-gray-700 dark:text-gray-300 overflow-auto max-h-48">
                  {error.stack}
                </pre>
              </div>
            )}

            {error.context && (
              <div>
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">上下文信息</label>
                <div className="mt-1 space-y-1 text-sm">
                  {error.context.component && (
                    <p className="text-gray-700 dark:text-gray-300">
                      <span className="font-medium">组件:</span> {error.context.component}
                    </p>
                  )}
                  {error.context.action && (
                    <p className="text-gray-700 dark:text-gray-300">
                      <span className="font-medium">操作:</span> {error.context.action}
                    </p>
                  )}
                  {error.context.metadata && Object.keys(error.context.metadata).length > 0 && (
                    <pre className="p-2 bg-gray-100 dark:bg-gray-900 rounded text-xs overflow-auto">
                      {JSON.stringify(error.context.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <label className="text-gray-500 dark:text-gray-400">发生时间</label>
                <p className="text-gray-900 dark:text-white">
                  {new Date(error.timestamp).toLocaleString('zh-CN')}
                </p>
              </div>
              <div>
                <label className="text-gray-500 dark:text-gray-400">首次发生</label>
                <p className="text-gray-900 dark:text-white">
                  {new Date(error.firstOccurredAt).toLocaleString('zh-CN')}
                </p>
              </div>
              <div>
                <label className="text-gray-500 dark:text-gray-400">发生次数</label>
                <p className="text-gray-900 dark:text-white">{error.count}</p>
              </div>
              <div>
                <label className="text-gray-500 dark:text-gray-400">上报状态</label>
                <p className="text-gray-900 dark:text-white">
                  {error.reported ? '已上报' : '未上报'}
                  {error.reportedAt && ` (${new Date(error.reportedAt).toLocaleString('zh-CN')})`}
                </p>
              </div>
            </div>

            {error.browserInfo && (
              <div>
                <label className="text-sm font-medium text-gray-500 dark:text-gray-400">浏览器信息</label>
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 space-y-1">
                  <p>User Agent: {error.browserInfo.userAgent}</p>
                  <p>语言: {error.browserInfo.language}</p>
                  <p>平台: {error.browserInfo.platform}</p>
                  <p>扩展版本: {error.browserInfo.extensionVersion}</p>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex justify-end gap-3">
            <button
              onClick={() => {
                onDelete(error.id);
                onClose();
              }}
              className="px-4 py-2 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              删除此错误
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// 主仪表板组件
export const ErrorDashboard: React.FC = () => {
  const [stats, setStats] = useState<ErrorStats | null>(null);
  const [errors, setErrors] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedError, setSelectedError] = useState<ErrorEntry | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 过滤状态
  const [filters, setFilters] = useState<{
    category: ErrorCategory | '';
    severity: ErrorSeverity | '';
    reported: boolean | '';
  }>({
    category: '',
    severity: '',
    reported: ''
  });

  // 加载错误统计数据
  const loadStats = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_ERROR_STATS'
      });
      if (response.success) {
        setStats(response.data);
      }
    } catch (error) {
      console.error('加载错误统计失败:', error);
    }
  }, []);

  // 加载错误列表
  const loadErrors = useCallback(async () => {
    try {
      const params: ErrorQueryParams = {
        limit: 100
      };
      if (filters.category) params.category = filters.category;
      if (filters.severity) params.severity = filters.severity;
      if (filters.reported !== '') params.reported = filters.reported;

      const response = await chrome.runtime.sendMessage({
        type: 'QUERY_ERRORS',
        params
      });
      if (response.success) {
        setErrors(response.data.errors);
      }
    } catch (error) {
      console.error('加载错误列表失败:', error);
    }
  }, [filters]);

  // 初始加载
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([loadStats(), loadErrors()]);
      setLoading(false);
    };
    init();
  }, [loadStats, loadErrors]);

  // 自动刷新（每30秒）
  useEffect(() => {
    const interval = setInterval(() => {
      loadStats();
      loadErrors();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadStats, loadErrors]);

  // 清除所有错误
  const handleClearAll = async () => {
    if (!confirm('确定要清除所有错误记录吗？此操作不可恢复。')) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLEAR_ALL_ERRORS'
      });
      if (response.success) {
        await loadStats();
        await loadErrors();
      }
    } catch (error) {
      console.error('清除错误失败:', error);
    }
  };

  // 删除单个错误
  const handleDeleteError = async (id: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DELETE_ERROR',
        id
      });
      if (response.success) {
        await loadStats();
        await loadErrors();
      }
    } catch (error) {
      console.error('删除错误失败:', error);
    }
  };

  // 标记错误为已上报
  const handleMarkAsReported = async (ids: string[]) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'MARK_ERRORS_AS_REPORTED',
        ids
      });
      if (response.success) {
        await loadStats();
        await loadErrors();
      }
    } catch (error) {
      console.error('标记错误已上报失败:', error);
    }
  };

  // 上报所有未上报错误
  const handleReportAll = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'REPORT_ERRORS'
      });
      if (response.success) {
        await loadStats();
        await loadErrors();
      }
    } catch (error) {
      console.error('上报错误失败:', error);
    }
  };

  // 打开错误详情
  const openErrorDetail = (error: ErrorEntry) => {
    setSelectedError(error);
    setIsModalOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 统计概览 */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">总错误数</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalErrors}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">未上报</p>
            <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
              {stats.unreportedErrors}
            </p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">最近24小时</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats.last24Hours}</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">最近7天</p>
            <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.last7Days}</p>
          </div>
        </div>
      )}

      {/* 分类统计 */}
      {stats && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">按分类统计</h3>
          <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
            {(Object.keys(stats.byCategory) as ErrorCategory[]).map(category => (
              <div key={category} className="text-center p-2 rounded bg-gray-50 dark:bg-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {ERROR_CATEGORIES[category]?.label || category}
                </p>
                <p className="text-lg font-semibold text-gray-900 dark:text-white">
                  {stats.byCategory[category]}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 严重程度统计 */}
      {stats && (
        <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">按严重程度统计</h3>
          <div className="flex gap-4">
            {(Object.keys(stats.bySeverity) as ErrorSeverity[]).map(severity => (
              <div key={severity} className="flex-1">
                <div className={`p-3 rounded-lg ${ERROR_SEVERITIES[severity].bgColor}`}>
                  <p className={`text-xs ${ERROR_SEVERITIES[severity].color}`}>
                    {ERROR_SEVERITIES[severity].label}
                  </p>
                  <p className="text-xl font-bold text-gray-900 dark:text-white">
                    {stats.bySeverity[severity]}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleReportAll}
          disabled={!stats || stats.unreportedErrors === 0}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          上报未上报错误 ({stats?.unreportedErrors || 0})
        </button>
        <button
          onClick={handleClearAll}
          disabled={!stats || stats.totalErrors === 0}
          className="px-4 py-2 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          清除所有错误
        </button>
        <button
          onClick={() => {
            loadStats();
            loadErrors();
          }}
          className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
        >
          刷新
        </button>
      </div>

      {/* 过滤器 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">过滤条件</h3>
        <div className="flex flex-wrap gap-3">
          <select
            value={filters.category}
            onChange={e => setFilters(f => ({ ...f, category: e.target.value as ErrorCategory | '' }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="">所有分类</option>
            {(Object.keys(ERROR_CATEGORIES) as ErrorCategory[]).map(cat => (
              <option key={cat} value={cat}>{ERROR_CATEGORIES[cat].label}</option>
            ))}
          </select>
          <select
            value={filters.severity}
            onChange={e => setFilters(f => ({ ...f, severity: e.target.value as ErrorSeverity | '' }))}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="">所有严重程度</option>
            <option value="fatal">致命</option>
            <option value="error">错误</option>
            <option value="warning">警告</option>
          </select>
          <select
            value={filters.reported === '' ? '' : filters.reported ? 'true' : 'false'}
            onChange={e => {
              const value = e.target.value;
              setFilters(f => ({ ...f, reported: value === '' ? '' : value === 'true' }));
            }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
          >
            <option value="">所有状态</option>
            <option value="false">未上报</option>
            <option value="true">已上报</option>
          </select>
          <button
            onClick={() => setFilters({ category: '', severity: '', reported: '' })}
            className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          >
            重置过滤
          </button>
        </div>
      </div>

      {/* 错误列表 */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white">
            错误列表 ({errors.length})
          </h3>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-700">
          {errors.length === 0 ? (
            <div className="p-8 text-center text-gray-500 dark:text-gray-400">
              <svg className="mx-auto h-12 w-12 text-gray-300 dark:text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>暂无错误记录</p>
            </div>
          ) : (
            errors.map(error => (
              <div
                key={error.id}
                className="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors cursor-pointer"
                onClick={() => openErrorDetail(error)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <SeverityBadge severity={error.severity} />
                      <CategoryBadge category={error.category} />
                      {error.count > 1 && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          ×{error.count}
                        </span>
                      )}
                      {!error.reported && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                          未上报
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-900 dark:text-white truncate">
                      {error.message}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {error.context?.component && `${error.context.component} · `}
                      {new Date(error.timestamp).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!error.reported && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleMarkAsReported([error.id]);
                        }}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300"
                      >
                        标记已上报
                      </button>
                    )}
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleDeleteError(error.id);
                      }}
                      className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 错误详情弹窗 */}
      <ErrorDetailModal
        error={selectedError}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedError(null);
        }}
        onDelete={handleDeleteError}
      />
    </div>
  );
};

export default ErrorDashboard;
