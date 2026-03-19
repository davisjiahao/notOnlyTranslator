/**
 * 性能监控核心模块
 *
 * 提供性能指标收集、存储、阈值检查等功能
 */
import {
  MetricType,
  OperationType,
  PerformanceMetric,
  PerformanceThreshold,
  PerformanceAlert,
  PerformanceStats,
  PerformanceConfig,
  DEFAULT_PERFORMANCE_CONFIG,
  MemorySnapshot,
  MetricMetadata,
} from './types';
import { logger, generateId } from '@/shared/utils';

/**
 * 性能监控器类
 */
export class PerformanceMonitor {
  /** 配置 */
  private config: PerformanceConfig;

  /** 内存中的指标数据 */
  private metrics: PerformanceMetric[] = [];

  /** 活跃告警 */
  private activeAlerts: PerformanceAlert[] = [];

  /** 内存快照历史 */
  private memorySnapshots: MemorySnapshot[] = [];

  /** 内存监控定时器 */
  private memoryIntervalId: ReturnType<typeof setInterval> | null = null;

  /** 自动上报定时器 */
  private reportIntervalId: ReturnType<typeof setInterval> | null = null;

  /** 指标监听器 */
  private listeners: Set<(metric: PerformanceMetric) => void> = new Set();

  /** 告警监听器 */
  private alertListeners: Set<(alert: PerformanceAlert) => void> = new Set();

  constructor(config: Partial<PerformanceConfig> = {}) {
    this.config = {
      ...DEFAULT_PERFORMANCE_CONFIG,
      ...config,
      thresholds: config.thresholds || DEFAULT_PERFORMANCE_CONFIG.thresholds,
    };

    if (this.config.enabled) {
      this.start();
    }
  }

  /**
   * 启动监控
   */
  start(): void {
    if (this.config.enableMemoryMonitoring) {
      this.startMemoryMonitoring();
    }

    if (this.config.autoReportInterval > 0) {
      this.startAutoReporting();
    }

    logger.info('PerformanceMonitor: 性能监控已启动');
  }

  /**
   * 停止监控
   */
  stop(): void {
    this.stopMemoryMonitoring();
    this.stopAutoReporting();
    logger.info('PerformanceMonitor: 性能监控已停止');
  }

  /**
   * 记录性能指标
   */
  recordMetric(
    type: MetricType,
    operation: OperationType,
    duration: number,
    success: boolean = true,
    metadata?: MetricMetadata
  ): PerformanceMetric | null {
    // 检查采样率
    const threshold = this.getThreshold(type);
    if (threshold && Math.random() > threshold.sampleRate) {
      return null;
    }

    const metric: PerformanceMetric = {
      id: generateId(),
      type,
      operation,
      duration,
      timestamp: Date.now(),
      success,
      metadata,
    };

    // 添加到内存
    this.metrics.push(metric);

    // 限制存储数量
    if (this.metrics.length > this.config.maxStoredMetrics) {
      this.metrics = this.metrics.slice(-this.config.maxStoredMetrics);
    }

    // 通知监听器
    this.notifyListeners(metric);

    // 检查阈值
    this.checkThreshold(metric);

    return metric;
  }

  /**
   * 创建性能测量器
   * 返回一个函数，调用后返回耗时
   */
  createTimer(): () => number {
    const start = performance.now();
    return () => performance.now() - start;
  }

  /**
   * 包装异步函数，自动记录性能指标
   */
  async wrapAsync<T>(
    type: MetricType,
    operation: OperationType,
    fn: () => Promise<T>,
    metadata?: MetricMetadata
  ): Promise<T> {
    const timer = this.createTimer();
    let success = true;

    try {
      const result = await fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = timer();
      this.recordMetric(type, operation, duration, success, metadata);
    }
  }

  /**
   * 包装同步函数，自动记录性能指标
   */
  wrapSync<T>(
    type: MetricType,
    operation: OperationType,
    fn: () => T,
    metadata?: MetricMetadata
  ): T {
    const timer = this.createTimer();
    let success = true;

    try {
      const result = fn();
      return result;
    } catch (error) {
      success = false;
      throw error;
    } finally {
      const duration = timer();
      this.recordMetric(type, operation, duration, success, metadata);
    }
  }

  /**
   * 获取阈值配置
   */
  private getThreshold(type: MetricType): PerformanceThreshold | undefined {
    return this.config.thresholds.find(t => t.type === type && t.enabled);
  }

  /**
   * 检查指标是否超出阈值
   */
  private checkThreshold(metric: PerformanceMetric): void {
    const threshold = this.getThreshold(metric.type);
    if (!threshold) return;

    let level: 'warning' | 'critical' | null = null;

    if (metric.duration >= threshold.critical) {
      level = 'critical';
    } else if (metric.duration >= threshold.warning) {
      level = 'warning';
    }

    if (level) {
      this.createAlert(metric, level, threshold);
    }
  }

  /**
   * 创建告警
   */
  private createAlert(
    metric: PerformanceMetric,
    level: 'warning' | 'critical',
    threshold: PerformanceThreshold
  ): void {
    const alert: PerformanceAlert = {
      id: generateId(),
      type: metric.type,
      operation: metric.operation,
      level,
      value: metric.duration,
      threshold: level === 'critical' ? threshold.critical : threshold.warning,
      timestamp: metric.timestamp,
      acknowledged: false,
      metadata: metric.metadata,
    };

    this.activeAlerts.push(alert);
    this.notifyAlertListeners(alert);

    logger.warn(
      `PerformanceMonitor: ${level} 告警 - ${metric.type} (${metric.operation}): ${metric.duration}ms`
    );
  }

  /**
   * 获取所有指标
   */
  getMetrics(filters?: {
    type?: MetricType;
    operation?: OperationType;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): PerformanceMetric[] {
    let result = [...this.metrics];

    if (filters?.type) {
      result = result.filter(m => m.type === filters.type);
    }

    if (filters?.operation) {
      result = result.filter(m => m.operation === filters.operation);
    }

    if (filters?.startTime) {
      result = result.filter(m => m.timestamp >= filters.startTime!);
    }

    if (filters?.endTime) {
      result = result.filter(m => m.timestamp <= filters.endTime!);
    }

    if (filters?.limit) {
      result = result.slice(-filters.limit);
    }

    return result;
  }

  /**
   * 获取统计摘要
   */
  getStats(
    type: MetricType,
    operation: OperationType,
    periodHours: number = 24
  ): PerformanceStats | null {
    const endTime = Date.now();
    const startTime = endTime - periodHours * 60 * 60 * 1000;

    const metrics = this.metrics.filter(
      m =>
        m.type === type &&
        m.operation === operation &&
        m.timestamp >= startTime &&
        m.timestamp <= endTime
    );

    if (metrics.length === 0) {
      return null;
    }

    const durations = metrics.map(m => m.duration).sort((a, b) => a - b);
    const successCount = metrics.filter(m => m.success).length;

    return {
      type,
      operation,
      count: metrics.length,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: durations[0],
      maxDuration: durations[durations.length - 1],
      p50: this.percentile(durations, 0.5),
      p95: this.percentile(durations, 0.95),
      p99: this.percentile(durations, 0.99),
      successRate: successCount / metrics.length,
      periodStart: startTime,
      periodEnd: endTime,
    };
  }

  /**
   * 计算百分位数
   */
  private percentile(sortedArray: number[], percentile: number): number {
    const index = Math.ceil(sortedArray.length * percentile) - 1;
    return sortedArray[Math.max(0, index)];
  }

  /**
   * 获取活跃告警
   */
  getActiveAlerts(acknowledged?: boolean): PerformanceAlert[] {
    if (acknowledged === undefined) {
      return [...this.activeAlerts];
    }
    return this.activeAlerts.filter(a => a.acknowledged === acknowledged);
  }

  /**
   * 确认告警
   */
  acknowledgeAlert(alertId: string): boolean {
    const alert = this.activeAlerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      return true;
    }
    return false;
  }

  /**
   * 清除所有已确认的告警
   */
  clearAcknowledgedAlerts(): void {
    this.activeAlerts = this.activeAlerts.filter(a => !a.acknowledged);
  }

  /**
   * 启动内存监控
   */
  private startMemoryMonitoring(): void {
    if (this.memoryIntervalId) return;

    this.memoryIntervalId = setInterval(() => {
      this.recordMemorySnapshot();
    }, this.config.memorySampleInterval * 1000);
  }

  /**
   * 停止内存监控
   */
  private stopMemoryMonitoring(): void {
    if (this.memoryIntervalId) {
      clearInterval(this.memoryIntervalId);
      this.memoryIntervalId = null;
    }
  }

  /**
   * 记录内存快照
   */
  private recordMemorySnapshot(): void {
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
    if (!perf.memory) return;

    const memory = perf.memory;

    const snapshot: MemorySnapshot = {
      timestamp: Date.now(),
      usedHeapSize: memory.usedJSHeapSize,
      totalHeapSize: memory.totalJSHeapSize,
      heapSizeLimit: memory.jsHeapSizeLimit,
    };

    this.memorySnapshots.push(snapshot);

    // 限制历史记录
    if (this.memorySnapshots.length > 1000) {
      this.memorySnapshots = this.memorySnapshots.slice(-1000);
    }

    // 记录内存使用指标
    this.recordMetric(
      MetricType.MEMORY_USAGE,
      'memory_check',
      snapshot.usedHeapSize,
      true,
      {
        memoryUsage: snapshot.usedHeapSize,
      }
    );
  }

  /**
   * 获取内存快照历史
   */
  getMemorySnapshots(limit: number = 100): MemorySnapshot[] {
    return this.memorySnapshots.slice(-limit);
  }

  /**
   * 启动自动上报
   */
  private startAutoReporting(): void {
    if (this.reportIntervalId) return;

    this.reportIntervalId = setInterval(() => {
      this.report();
    }, this.config.autoReportInterval * 60 * 1000);
  }

  /**
   * 停止自动上报
   */
  private stopAutoReporting(): void {
    if (this.reportIntervalId) {
      clearInterval(this.reportIntervalId);
      this.reportIntervalId = null;
    }
  }

  /**
   * 上报性能数据
   */
  private report(): void {
    const report = this.generateReport();

    // 可以在这里实现实际上报逻辑，如发送到服务器
    logger.info('PerformanceMonitor: 性能报告', {
      metrics: report.stats.length,
      alerts: report.activeAlerts.length,
    });

    // 触发上报事件
    this.onReport?.(report);
  }

  /**
   * 生成性能报告
   */
  generateReport(periodHours: number = 24): {
    generatedAt: number;
    periodHours: number;
    stats: PerformanceStats[];
    activeAlerts: PerformanceAlert[];
    memoryTrend: MemorySnapshot[];
  } {
    // 获取所有指标类型的统计
    const typeOperationPairs = new Map<string, { type: MetricType; operation: OperationType }>();

    for (const metric of this.metrics) {
      const key = `${metric.type}:${metric.operation}`;
      if (!typeOperationPairs.has(key)) {
        typeOperationPairs.set(key, { type: metric.type, operation: metric.operation });
      }
    }

    const stats: PerformanceStats[] = [];
    for (const { type, operation } of typeOperationPairs.values()) {
      const stat = this.getStats(type, operation, periodHours);
      if (stat) {
        stats.push(stat);
      }
    }

    return {
      generatedAt: Date.now(),
      periodHours,
      stats,
      activeAlerts: this.getActiveAlerts(),
      memoryTrend: this.getMemorySnapshots(100),
    };
  }

  /**
   * 上报回调
   */
  onReport?: (report: ReturnType<typeof this.generateReport>) => void;

  /**
   * 添加指标监听器
   */
  addListener(listener: (metric: PerformanceMetric) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知监听器
   */
  private notifyListeners(metric: PerformanceMetric): void {
    for (const listener of this.listeners) {
      try {
        listener(metric);
      } catch (error) {
        logger.error('PerformanceMonitor: 监听器执行失败', error);
      }
    }
  }

  /**
   * 添加告警监听器
   */
  addAlertListener(listener: (alert: PerformanceAlert) => void): () => void {
    this.alertListeners.add(listener);
    return () => this.alertListeners.delete(listener);
  }

  /**
   * 通知告警监听器
   */
  private notifyAlertListeners(alert: PerformanceAlert): void {
    for (const listener of this.alertListeners) {
      try {
        listener(alert);
      } catch (error) {
        logger.error('PerformanceMonitor: 告警监听器执行失败', error);
      }
    }
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.metrics = [];
    this.activeAlerts = [];
    this.memorySnapshots = [];
    logger.info('PerformanceMonitor: 所有性能数据已清空');
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // 重启相关服务
    this.stopMemoryMonitoring();
    this.stopAutoReporting();

    if (this.config.enabled) {
      this.start();
    }

    logger.info('PerformanceMonitor: 配置已更新');
  }

  /**
   * 获取当前配置
   */
  getConfig(): PerformanceConfig {
    return { ...this.config };
  }
}

/**
 * 全局性能监控实例
 */
let globalMonitor: PerformanceMonitor | null = null;

/**
 * 获取全局性能监控实例
 */
export function getPerformanceMonitor(): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor();
  }
  return globalMonitor;
}

/**
 * 初始化性能监控
 */
export function initPerformanceMonitor(config?: Partial<PerformanceConfig>): PerformanceMonitor {
  if (globalMonitor) {
    globalMonitor.stop();
  }
  globalMonitor = new PerformanceMonitor(config);
  return globalMonitor;
}

/**
 * 记录性能指标（便捷函数）
 */
export function recordMetric(
  type: MetricType,
  operation: OperationType,
  duration: number,
  success: boolean = true,
  metadata?: MetricMetadata
): PerformanceMetric | null {
  return getPerformanceMonitor().recordMetric(type, operation, duration, success, metadata);
}

/**
 * 创建性能计时器（便捷函数）
 */
export function createTimer(): () => number {
  return getPerformanceMonitor().createTimer();
}

/**
 * 包装异步函数（便捷函数）
 */
export async function measureAsync<T>(
  type: MetricType,
  operation: OperationType,
  fn: () => Promise<T>,
  metadata?: MetricMetadata
): Promise<T> {
  return getPerformanceMonitor().wrapAsync(type, operation, fn, metadata);
}

/**
 * 包装同步函数（便捷函数）
 */
export function measureSync<T>(
  type: MetricType,
  operation: OperationType,
  fn: () => T,
  metadata?: MetricMetadata
): T {
  return getPerformanceMonitor().wrapSync(type, operation, fn, metadata);
}
