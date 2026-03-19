/**
 * 性能数据上报模块
 *
 * 提供性能数据上报、存储、导出等功能
 */
import {
  MetricType,
  PerformanceMetric,
  PerformanceAlert,
  PerformanceStats,
  SystemInfo,
  MemorySnapshot,
  ApiPerformanceMetrics,
  CachePerformanceMetrics,
} from './types';
import { logger } from '@/shared/utils';
import { getPerformanceMonitor } from './monitor';

/**
 * 上报配置
 */
export interface ReporterConfig {
  /** 是否启用上报 */
  enabled: boolean;
  /** 服务端点 */
  endpoint?: string;
  /** API密钥 */
  apiKey?: string;
  /** 上报间隔（分钟） */
  interval: number;
  /** 本地存储最大条目数 */
  maxLocalEntries: number;
  /** 是否包含系统信息 */
  includeSystemInfo: boolean;
  /** 是否上报内存数据 */
  includeMemoryData: boolean;
  /** 数据采样率 */
  sampleRate: number;
}

/**
 * 默认上报配置
 */
export const DEFAULT_REPORTER_CONFIG: ReporterConfig = {
  enabled: false,
  interval: 60,
  maxLocalEntries: 1000,
  includeSystemInfo: true,
  includeMemoryData: true,
  sampleRate: 1.0,
};

/**
 * 上报数据格式
 */
export interface ReportPayload {
  /** 上报ID */
  id: string;
  /** 上报时间戳 */
  timestamp: number;
  /** 扩展版本 */
  version: string;
  /** 系统信息 */
  systemInfo?: SystemInfo;
  /** 性能指标 */
  metrics?: PerformanceMetric[];
  /** 告警数据 */
  alerts?: PerformanceAlert[];
  /** 统计数据 */
  stats?: PerformanceStats[];
  /** 内存快照 */
  memorySnapshots?: MemorySnapshot[];
}

/**
 * 本地存储的性能报告
 */
interface StoredReport {
  id: string;
  timestamp: number;
  data: ReportPayload;
}

/**
 * 性能数据上报器
 */
export class PerformanceReporter {
  private config: ReporterConfig;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private pendingReports: StoredReport[] = [];
  private isInitialized: boolean = false;

  constructor(config: Partial<ReporterConfig> = {}) {
    this.config = { ...DEFAULT_REPORTER_CONFIG, ...config };
  }

  /**
   * 初始化上报器
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // 从存储加载待上报数据
      await this.loadPendingReports();
      this.isInitialized = true;

      if (this.config.enabled) {
        this.start();
      }

      logger.info('PerformanceReporter: 初始化完成');
    } catch (error) {
      logger.error('PerformanceReporter: 初始化失败', error);
    }
  }

  /**
   * 启动定时上报
   */
  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.report();
    }, this.config.interval * 60 * 1000);

    logger.info('PerformanceReporter: 定时上报已启动');
  }

  /**
   * 停止定时上报
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('PerformanceReporter: 定时上报已停止');
    }
  }

  /**
   * 执行上报
   */
  async report(): Promise<boolean> {
    if (!this.shouldReport()) {
      return false;
    }

    try {
      const payload = await this.generatePayload();

      // 如果有配置端点，尝试发送到服务器
      if (this.config.endpoint && this.config.apiKey) {
        const success = await this.sendToServer(payload);
        if (success) {
          logger.info('PerformanceReporter: 数据上报成功');
          return true;
        }
      }

      // 否则存储到本地
      await this.storeLocally(payload);
      return true;
    } catch (error) {
      logger.error('PerformanceReporter: 上报失败', error);
      return false;
    }
  }

  /**
   * 生成上报数据
   */
  private async generatePayload(): Promise<ReportPayload> {
    const report = getPerformanceMonitor().generateReport(24);
    const manifest = chrome.runtime.getManifest();

    const payload: ReportPayload = {
      id: this.generateReportId(),
      timestamp: Date.now(),
      version: manifest.version,
    };

    if (this.config.includeSystemInfo) {
      payload.systemInfo = await this.collectSystemInfo();
    }

    if (this.config.includeMemoryData) {
      payload.memorySnapshots = report.memoryTrend;
    }

    // 统计数据
    payload.stats = report.stats;

    // 未确认的告警
    payload.alerts = report.activeAlerts.filter(a => !a.acknowledged);

    return payload;
  }

  /**
   * 收集系统信息
   */
  private async collectSystemInfo(): Promise<SystemInfo> {
    const manifest = chrome.runtime.getManifest();

    // 获取缓存统计
    const { enhancedCache } = await import('@/background/enhancedCache');
    const cacheStats = await enhancedCache.getStats();

    // 获取内存使用（如果可用）
    let currentMemoryUsage: number | undefined;
    const perf = performance as unknown as { memory?: { usedJSHeapSize: number } };
    if (perf.memory) {
      currentMemoryUsage = perf.memory.usedJSHeapSize;
    }

    return {
      extensionVersion: manifest.version,
      chromeVersion: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || 'unknown',
      userAgent: navigator.userAgent,
      currentMemoryUsage,
      cacheEntryCount: cacheStats.totalEntries,
      cacheMemoryUsage: cacheStats.memoryUsage,
    };
  }

  /**
   * 发送数据到服务器
   */
  private async sendToServer(payload: ReportPayload): Promise<boolean> {
    if (!this.config.endpoint || !this.config.apiKey) {
      return false;
    }

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      return response.ok;
    } catch (error) {
      logger.error('PerformanceReporter: 服务器上报失败', error);
      return false;
    }
  }

  /**
   * 存储到本地
   */
  private async storeLocally(payload: ReportPayload): Promise<void> {
    const report: StoredReport = {
      id: payload.id,
      timestamp: payload.timestamp,
      data: payload,
    };

    this.pendingReports.push(report);

    // 限制存储数量
    if (this.pendingReports.length > this.config.maxLocalEntries) {
      this.pendingReports = this.pendingReports.slice(-this.config.maxLocalEntries);
    }

    // 保存到存储
    await chrome.storage.local.set({
      'performance_pending_reports': this.pendingReports,
    });

    logger.info(`PerformanceReporter: 已存储到本地 (${this.pendingReports.length} 条待上报)`);
  }

  /**
   * 加载待上报数据
   */
  private async loadPendingReports(): Promise<void> {
    try {
      const result = await chrome.storage.local.get('performance_pending_reports');
      this.pendingReports = result['performance_pending_reports'] || [];
    } catch (error) {
      logger.error('PerformanceReporter: 加载待上报数据失败', error);
      this.pendingReports = [];
    }
  }

  /**
   * 获取待上报数据
   */
  getPendingReports(): StoredReport[] {
    return [...this.pendingReports];
  }

  /**
   * 清除已上报的数据
   */
  async clearPendingReports(): Promise<void> {
    this.pendingReports = [];
    await chrome.storage.local.remove('performance_pending_reports');
  }

  /**
   * 生成报告ID
   */
  private generateReportId(): string {
    return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 检查是否应该上报
   */
  private shouldReport(): boolean {
    return this.config.enabled && Math.random() <= this.config.sampleRate;
  }

  /**
   * 导出性能数据为JSON
   */
  async exportToJSON(periodHours: number = 24): Promise<string> {
    const report = getPerformanceMonitor().generateReport(periodHours);
    const payload = await this.generatePayload();

    const exportData = {
      exportedAt: Date.now(),
      periodHours,
      report,
      payload,
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 下载性能报告
   */
  async downloadReport(periodHours: number = 24): Promise<void> {
    const json = await this.exportToJSON(periodHours);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().split('T')[0];
    const filename = `performance-report-${date}.json`;

    await chrome.downloads.download({
      url,
      filename,
      saveAs: true,
    });

    URL.revokeObjectURL(url);
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<ReporterConfig>): void {
    this.config = { ...this.config, ...newConfig };

    // 重启定时器
    this.stop();
    if (this.config.enabled) {
      this.start();
    }

    logger.info('PerformanceReporter: 配置已更新');
  }

  /**
   * 获取当前配置
   */
  getConfig(): ReporterConfig {
    return { ...this.config };
  }
}

/**
 * 计算API性能指标
 */
export function calculateApiMetrics(
  metrics: PerformanceMetric[],
  provider: string
): ApiPerformanceMetrics {
  const providerMetrics = metrics.filter(
    m => m.type === MetricType.API_RESPONSE_TIME && m.metadata?.provider === provider
  );

  if (providerMetrics.length === 0) {
    return {
      provider,
      totalCalls: 0,
      successCalls: 0,
      failedCalls: 0,
      avgResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
      avgTextLength: 0,
    };
  }

  const durations = providerMetrics.map(m => m.duration).sort((a, b) => a - b);
  const successCount = providerMetrics.filter(m => m.success).length;

  const avgTextLength =
    providerMetrics.reduce((sum, m) => sum + (m.metadata?.textLength || 0), 0) /
    providerMetrics.length;

  return {
    provider,
    totalCalls: providerMetrics.length,
    successCalls: successCount,
    failedCalls: providerMetrics.length - successCount,
    avgResponseTime: durations.reduce((a, b) => a + b, 0) / durations.length,
    p95ResponseTime: percentile(durations, 0.95),
    p99ResponseTime: percentile(durations, 0.99),
    avgTextLength,
  };
}

/**
 * 计算缓存性能指标
 */
export function calculateCacheMetrics(metrics: PerformanceMetric[]): CachePerformanceMetrics {
  const cacheMetrics = metrics.filter(m => m.type === MetricType.CACHE_OPERATION);

  if (cacheMetrics.length === 0) {
    return {
      totalRequests: 0,
      hits: 0,
      misses: 0,
      hitRate: 0,
      avgGetTime: 0,
      avgSetTime: 0,
      evictionCount: 0,
      currentSize: 0,
    };
  }

  const getOps = cacheMetrics.filter(m => m.operation === 'cache_get');
  const setOps = cacheMetrics.filter(m => m.operation === 'cache_set');
  const evictOps = cacheMetrics.filter(m => m.operation === 'cache_evict');

  const hits = getOps.filter(m => m.metadata?.cacheHit).length;
  const misses = getOps.length - hits;

  return {
    totalRequests: getOps.length + setOps.length,
    hits,
    misses,
    hitRate: getOps.length > 0 ? hits / getOps.length : 0,
    avgGetTime: getOps.length > 0
      ? getOps.reduce((sum, m) => sum + m.duration, 0) / getOps.length
      : 0,
    avgSetTime: setOps.length > 0
      ? setOps.reduce((sum, m) => sum + m.duration, 0) / setOps.length
      : 0,
    evictionCount: evictOps.length,
    currentSize: cacheMetrics[cacheMetrics.length - 1]?.metadata?.cacheSize || 0,
  };
}

/**
 * 计算百分位数
 */
function percentile(sortedArray: number[], p: number): number {
  const index = Math.ceil(sortedArray.length * p) - 1;
  return sortedArray[Math.max(0, index)];
}

/**
 * 全局上报器实例
 */
let globalReporter: PerformanceReporter | null = null;

/**
 * 获取全局上报器实例
 */
export function getPerformanceReporter(): PerformanceReporter {
  if (!globalReporter) {
    globalReporter = new PerformanceReporter();
    globalReporter.initialize();
  }
  return globalReporter;
}

/**
 * 初始化性能上报
 */
export function initPerformanceReporter(config?: Partial<ReporterConfig>): PerformanceReporter {
  if (globalReporter) {
    globalReporter.stop();
  }
  globalReporter = new PerformanceReporter(config);
  globalReporter.initialize();
  return globalReporter;
}

/**
 * 手动触发上报（便捷函数）
 */
export async function reportPerformance(): Promise<boolean> {
  return getPerformanceReporter().report();
}

/**
 * 导出性能报告（便捷函数）
 */
export async function exportPerformanceReport(periodHours?: number): Promise<string> {
  return getPerformanceReporter().exportToJSON(periodHours);
}
