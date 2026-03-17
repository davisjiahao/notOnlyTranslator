/**
 * 缓存统计面板组件
 *
 * 显示翻译缓存的性能指标和统计信息
 *
 * @module options/components/CacheStats
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * 缓存统计信息接口
 */
interface CacheStats {
  /** 总缓存条目数 */
  totalEntries: number;
  /** 内存占用（字节） */
  memoryUsage: number;
  /** 缓存命中率（百分比） */
  hitRate: number;
  /** 总请求数 */
  totalRequests: number;
  /** 缓存命中数 */
  hits: number;
  /** 缓存未命中数 */
  misses: number;
  /** 平均 API 响应时间（毫秒） */
  avgApiDuration: number;
  /** 平均总响应时间（毫秒） */
  avgTotalDuration: number;
}

/**
 * 缓存统计面板组件
 */
export default function CacheStatsPanel() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  /**
   * 加载缓存统计信息
   */
  const loadStats = useCallback(async () => {
    try {
      setIsLoading(true);
      const [cacheResult, metricsResult] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_CACHE_STATS' }),
        chrome.runtime.sendMessage({ type: 'GET_CACHE_METRICS' }),
      ]);

      const enhancedStats = cacheResult.success ? cacheResult.data : { totalEntries: 0, memoryUsage: 0 };
      const metrics = metricsResult.success ? metricsResult.data : null;

      setStats({
        totalEntries: enhancedStats.totalEntries || 0,
        memoryUsage: enhancedStats.memoryUsage || 0,
        hitRate: metrics?.hitRate || 0,
        totalRequests: metrics?.totalRequests || 0,
        hits: metrics?.hits || 0,
        misses: metrics?.misses || 0,
        avgApiDuration: metrics?.avgApiDuration || 0,
        avgTotalDuration: metrics?.avgTotalDuration || 0,
      });
    } catch (error) {
      console.error('Failed to load cache stats:', error);
      setStats({
        totalEntries: 0,
        memoryUsage: 0,
        hitRate: 0,
        totalRequests: 0,
        hits: 0,
        misses: 0,
        avgApiDuration: 0,
        avgTotalDuration: 0,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
    // 每 30 秒自动刷新
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [loadStats]);

  /**
   * 清空缓存
   */
  const handleClearCache = async () => {
    if (!confirm('确定要清空所有翻译缓存吗？')) return;

    try {
      await chrome.runtime.sendMessage({ type: 'CLEAR_TRANSLATION_CACHE' });
      setMessage('缓存已清空');
      setTimeout(() => setMessage(null), 3000);
      loadStats();
    } catch (error) {
      setMessage('清空失败');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  /**
   * 重置统计
   */
  const handleResetStats = async () => {
    if (!confirm('确定要重置缓存统计吗？')) return;

    try {
      await chrome.runtime.sendMessage({ type: 'RESET_CACHE_METRICS' });
      setMessage('统计已重置');
      setTimeout(() => setMessage(null), 3000);
      loadStats();
    } catch (error) {
      setMessage('重置失败');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  /**
   * 格式化字节数为可读格式
   */
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  /**
   * 获取命中率颜色
   */
  const getHitRateColor = (rate: number): string => {
    if (rate >= 80) return 'text-green-600 dark:text-green-400';
    if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  /**
   * 获取响应时间颜色
   */
  const getDurationColor = (duration: number): string => {
    if (duration <= 100) return 'text-green-600 dark:text-green-400';
    if (duration <= 300) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">缓存统计</h2>
          {message && (
            <span className="text-sm text-green-600 dark:text-green-400 animate-fade-in">
              {message}
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* 核心指标卡片 */}
        <div className="grid grid-cols-2 gap-4">
          {/* 缓存命中率 */}
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">缓存命中率</div>
            <div className={`text-2xl font-bold ${getHitRateColor(stats.hitRate)}`}>
              {stats.hitRate.toFixed(1)}%
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              目标: ≥80%
            </div>
          </div>

          {/* 平均响应时间 */}
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">平均响应时间</div>
            <div className={`text-2xl font-bold ${getDurationColor(stats.avgTotalDuration)}`}>
              {stats.avgTotalDuration.toFixed(0)}ms
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              目标: &lt;100ms
            </div>
          </div>

          {/* 缓存条目数 */}
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">缓存条目数</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {stats.totalEntries.toLocaleString()}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              最大: 1,000
            </div>
          </div>

          {/* 内存占用 */}
          <div className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">内存占用</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">
              {formatBytes(stats.memoryUsage)}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              估算值
            </div>
          </div>
        </div>

        {/* 详细统计 */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">详细统计</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">总请求数</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {stats.totalRequests.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">缓存命中</span>
              <span className="font-medium text-green-600 dark:text-green-400">
                {stats.hits.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">缓存未命中</span>
              <span className="font-medium text-yellow-600 dark:text-yellow-400">
                {stats.misses.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">平均 API 耗时</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {stats.avgApiDuration.toFixed(0)}ms
              </span>
            </div>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex gap-3">
            <button
              onClick={handleClearCache}
              className="flex-1 py-2 px-4 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
            >
              清空缓存
            </button>
            <button
              onClick={handleResetStats}
              className="flex-1 py-2 px-4 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
            >
              重置统计
            </button>
            <button
              onClick={loadStats}
              className="py-2 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors text-sm"
            >
              刷新
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
