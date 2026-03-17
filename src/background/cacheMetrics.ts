/**
 * 缓存性能指标追踪模块
 *
 * 用于监控缓存命中率、响应时间等关键指标
 *
 * @module background/cacheMetrics
 */

import { logger } from '@/shared/utils';

/**
 * 缓存指标数据接口
 */
export interface CacheMetricsData {
  /** 缓存命中次数 */
  hits: number;
  /** 缓存未命中次数 */
  misses: number;
  /** API 调用次数 */
  apiCalls: number;
  /** API 调用总耗时（毫秒） */
  apiTotalDuration: number;
  /** 请求总耗时（毫秒） */
  totalDuration: number;
  /** 请求次数 */
  totalRequests: number;
  /** 最后更新时间 */
  lastUpdatedAt: number;
}

/**
 * 缓存性能报告接口
 */
export interface CachePerformanceReport {
  /** 缓存命中率（百分比） */
  hitRate: number;
  /** 平均 API 响应时间（毫秒） */
  avgApiDuration: number;
  /** 平均总响应时间（毫秒） */
  avgTotalDuration: number;
  /** 总请求数 */
  totalRequests: number;
  /** 缓存命中数 */
  hits: number;
  /** 缓存未命中数 */
  misses: number;
}

/**
 * 默认指标数据
 */
const DEFAULT_METRICS: CacheMetricsData = {
  hits: 0,
  misses: 0,
  apiCalls: 0,
  apiTotalDuration: 0,
  totalDuration: 0,
  totalRequests: 0,
  lastUpdatedAt: Date.now(),
};

/** 存储键名 */
const METRICS_STORAGE_KEY = 'translation_cache_metrics';

/** 指标保存间隔（毫秒） */
const SAVE_INTERVAL_MS = 30000; // 30秒

/**
 * 缓存性能指标管理器
 *
 * 追踪缓存命中率和响应时间，提供性能报告
 */
export class CacheMetricsManager {
  private metrics: CacheMetricsData = { ...DEFAULT_METRICS };
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;

  /**
   * 初始化，从存储加载历史数据
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await chrome.storage.local.get(METRICS_STORAGE_KEY);
      if (data[METRICS_STORAGE_KEY]) {
        this.metrics = {
          ...DEFAULT_METRICS,
          ...data[METRICS_STORAGE_KEY],
        };
      }
      this.initialized = true;
      logger.info('CacheMetrics: 已初始化', this.getReport());
    } catch (error) {
      logger.error('CacheMetrics: 初始化失败', error);
      this.initialized = true;
    }
  }

  /**
   * 记录缓存命中
   * @param duration 响应时间（毫秒）
   */
  recordHit(duration: number): void {
    this.metrics.hits++;
    this.metrics.totalRequests++;
    this.metrics.totalDuration += duration;
    this.metrics.lastUpdatedAt = Date.now();
    this.scheduleSave();

    logger.info(`CacheMetrics: 缓存命中，响应时间 ${duration.toFixed(2)}ms`);
  }

  /**
   * 记录缓存未命中
   */
  recordMiss(): void {
    this.metrics.misses++;
    this.metrics.totalRequests++;
    this.metrics.lastUpdatedAt = Date.now();
    this.scheduleSave();

    logger.info('CacheMetrics: 缓存未命中');
  }

  /**
   * 记录 API 调用
   * @param duration API 响应时间（毫秒）
   */
  recordApiCall(duration: number): void {
    this.metrics.apiCalls++;
    this.metrics.apiTotalDuration += duration;
    this.metrics.lastUpdatedAt = Date.now();
    this.scheduleSave();

    logger.info(`CacheMetrics: API 调用耗时 ${duration.toFixed(2)}ms`);
  }

  /**
   * 记录总响应时间
   * @param duration 总响应时间（毫秒）
   */
  recordTotalDuration(duration: number): void {
    // 已在 recordHit 中记录，这里用于未命中情况
    this.metrics.totalDuration += duration;
    this.scheduleSave();
  }

  /**
   * 获取性能报告
   */
  getReport(): CachePerformanceReport {
    const total = this.metrics.hits + this.metrics.misses;
    const hitRate = total > 0 ? (this.metrics.hits / total) * 100 : 0;
    const avgApiDuration = this.metrics.apiCalls > 0
      ? this.metrics.apiTotalDuration / this.metrics.apiCalls
      : 0;
    const avgTotalDuration = this.metrics.totalRequests > 0
      ? this.metrics.totalDuration / this.metrics.totalRequests
      : 0;

    return {
      hitRate: parseFloat(hitRate.toFixed(2)),
      avgApiDuration: parseFloat(avgApiDuration.toFixed(2)),
      avgTotalDuration: parseFloat(avgTotalDuration.toFixed(2)),
      totalRequests: this.metrics.totalRequests,
      hits: this.metrics.hits,
      misses: this.metrics.misses,
    };
  }

  /**
   * 获取原始指标数据
   */
  getMetrics(): CacheMetricsData {
    return { ...this.metrics };
  }

  /**
   * 重置所有指标
   */
  async reset(): Promise<void> {
    this.metrics = { ...DEFAULT_METRICS };
    await this.saveToStorage();
    logger.info('CacheMetrics: 已重置');
  }

  /**
   * 安排保存到存储
   */
  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      this.saveToStorage().catch(error => {
        logger.error('CacheMetrics: 保存失败', error);
      });
    }, SAVE_INTERVAL_MS);
  }

  /**
   * 保存到 Chrome 存储
   */
  private async saveToStorage(): Promise<void> {
    try {
      await chrome.storage.local.set({
        [METRICS_STORAGE_KEY]: this.metrics,
      });
    } catch (error) {
      logger.error('CacheMetrics: 保存到存储失败', error);
    }
  }
}

// 导出单例实例
export const cacheMetrics = new CacheMetricsManager();

// 便捷导出函数
export const CacheMetrics = {
  recordCacheHit: (duration: number) => cacheMetrics.recordHit(duration),
  recordCacheMiss: () => cacheMetrics.recordMiss(),
  recordApiCall: (duration: number) => cacheMetrics.recordApiCall(duration),
  recordTotalDuration: (duration: number) => cacheMetrics.recordTotalDuration(duration),
  getReport: () => cacheMetrics.getReport(),
  getMetrics: () => cacheMetrics.getMetrics(),
  reset: () => cacheMetrics.reset(),
  initialize: () => cacheMetrics.initialize(),
};
