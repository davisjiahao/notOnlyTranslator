/**
 * 性能数据仪表盘模块
 *
 * 提供仪表盘数据聚合、可视化支持和实时更新功能
 */
import {
  MetricType,
  PerformanceMetric,
  MemorySnapshot,
  ApiPerformanceMetrics,
  PerformanceAlert,
} from './types';
import { logger } from '@/shared/utils';
import { getPerformanceMonitor } from './monitor';
import { calculateApiMetrics, calculateCacheMetrics } from './reporter';

/**
 * 图表数据点
 */
export interface ChartDataPoint {
  /** X轴标签（时间或分类） */
  label: string;
  /** Y轴数值 */
  value: number;
  /** 可选元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 图表数据集
 */
export interface ChartDataset {
  /** 数据集名称 */
  name: string;
  /** 数据点数组 */
  data: ChartDataPoint[];
  /** 颜色 */
  color?: string;
  /** 单位 */
  unit?: string;
}

/**
 * 仪表盘图表配置
 */
export interface ChartConfig {
  /** 图表类型 */
  type: 'line' | 'bar' | 'pie' | 'area';
  /** 标题 */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** X轴标签 */
  xAxisLabel?: string;
  /** Y轴标签 */
  yAxisLabel?: string;
  /** 数据集 */
  datasets: ChartDataset[];
  /** 是否显示图例 */
  showLegend?: boolean;
  /** 是否启用缩放 */
  enableZoom?: boolean;
}

/**
 * API性能卡片数据
 */
export interface ApiPerformanceCard {
  /** 提供商名称 */
  provider: string;
  /** 总调用次数 */
  totalCalls: number;
  /** 成功调用次数 */
  successCalls: number;
  /** 失败调用次数 */
  failedCalls: number;
  /** 平均响应时间（毫秒） */
  avgResponseTime: number;
  /** P95响应时间 */
  p95ResponseTime: number;
  /** 成功率 */
  successRate: number;
  /** 趋势（上升/下降/持平） */
  trend: 'up' | 'down' | 'flat';
  /** 趋势百分比 */
  trendPercent: number;
}

/**
 * 缓存性能卡片数据
 */
export interface CachePerformanceCard {
  /** 总请求数 */
  totalRequests: number;
  /** 命中次数 */
  hits: number;
  /** 未命中次数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 平均获取时间 */
  avgGetTime: number;
  /** 平均设置时间 */
  avgSetTime: number;
  /** 当前缓存大小 */
  currentSize: number;
  /** 淘汰次数 */
  evictionCount: number;
}

/**
 * 系统健康状态
 */
export interface SystemHealth {
  /** 整体状态 */
  status: 'healthy' | 'warning' | 'critical';
  /** 状态分数 (0-100) */
  score: number;
  /** 检查项 */
  checks: HealthCheckItem[];
  /** 最后更新时间 */
  lastUpdated: number;
}

/**
 * 健康检查项
 */
export interface HealthCheckItem {
  /** 检查名称 */
  name: string;
  /** 状态 */
  status: 'healthy' | 'warning' | 'critical';
  /** 数值 */
  value: number;
  /** 阈值 */
  threshold: number;
  /** 描述 */
  description: string;
}

/**
 * 仪表盘数据
 */
export interface DashboardData {
  /** 时间范围（小时） */
  periodHours: number;
  /** 生成时间 */
  generatedAt: number;
  /** API性能卡片 */
  apiCards: ApiPerformanceCard[];
  /** 缓存性能卡片 */
  cacheCard: CachePerformanceCard;
  /** 系统健康状态 */
  systemHealth: SystemHealth;
  /** 活跃告警 */
  activeAlerts: PerformanceAlert[];
  /** 图表配置数组 */
  charts: ChartConfig[];
}

/**
 * 仪表盘更新回调
 */
export type DashboardUpdateCallback = (data: DashboardData) => void;

/**
 * 性能仪表盘类
 */
export class PerformanceDashboard {
  /** 当前数据 */
  private currentData: DashboardData | null = null;
  /** 更新间隔（毫秒） */
  private updateInterval: number = 30000; // 30秒
  /** 定时器ID */
  private intervalId: ReturnType<typeof setInterval> | null = null;
  /** 更新监听器 */
  private listeners: Set<DashboardUpdateCallback> = new Set();
  /** 是否正在运行 */
  private isRunning: boolean = false;
  /** 时间范围（小时） */
  private periodHours: number = 24;

  constructor(updateInterval?: number) {
    if (updateInterval) {
      this.updateInterval = updateInterval;
    }
  }

  /**
   * 启动仪表盘自动更新
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.refresh();

    this.intervalId = setInterval(() => {
      this.refresh();
    }, this.updateInterval);

    logger.info('PerformanceDashboard: 自动更新已启动');
  }

  /**
   * 停止仪表盘自动更新
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('PerformanceDashboard: 自动更新已停止');
  }

  /**
   * 刷新仪表盘数据
   */
  refresh(): DashboardData {
    const monitor = getPerformanceMonitor();
    const metrics = monitor.getMetrics({
      startTime: Date.now() - this.periodHours * 60 * 60 * 1000,
    });

    this.currentData = {
      periodHours: this.periodHours,
      generatedAt: Date.now(),
      apiCards: this.generateApiCards(metrics),
      cacheCard: this.generateCacheCard(metrics),
      systemHealth: this.generateSystemHealth(metrics),
      activeAlerts: monitor.getActiveAlerts(false),
      charts: this.generateCharts(metrics),
    };

    this.notifyListeners();
    return this.currentData;
  }

  /**
   * 设置时间范围
   */
  setPeriod(hours: number): void {
    this.periodHours = hours;
    this.refresh();
  }

  /**
   * 获取当前数据
   */
  getData(): DashboardData | null {
    return this.currentData;
  }

  /**
   * 生成API性能卡片
   */
  private generateApiCards(metrics: PerformanceMetric[]): ApiPerformanceCard[] {
    const providers = new Set<string>();

    // 收集所有提供商
    for (const metric of metrics) {
      if (metric.type === MetricType.API_RESPONSE_TIME && metric.metadata?.provider) {
        providers.add(metric.metadata.provider);
      }
    }

    // 为每个提供商生成卡片
    return Array.from(providers).map(provider => {
      const currentMetrics = calculateApiMetrics(metrics, provider);
      const prevMetrics = this.calculatePreviousPeriodMetrics(provider);

      const trend = this.calculateTrend(
        currentMetrics.avgResponseTime,
        prevMetrics?.avgResponseTime || 0
      );

      const trendPercent = prevMetrics
        ? ((currentMetrics.avgResponseTime - prevMetrics.avgResponseTime) /
            prevMetrics.avgResponseTime) * 100
        : 0;

      return {
        provider,
        totalCalls: currentMetrics.totalCalls,
        successCalls: currentMetrics.successCalls,
        failedCalls: currentMetrics.failedCalls,
        avgResponseTime: currentMetrics.avgResponseTime,
        p95ResponseTime: currentMetrics.p95ResponseTime,
        successRate: currentMetrics.totalCalls > 0
          ? currentMetrics.successCalls / currentMetrics.totalCalls
          : 0,
        trend: trend as 'up' | 'down' | 'flat',
        trendPercent: Math.abs(trendPercent),
      };
    });
  }

  /**
   * 计算上一周期的指标（用于趋势对比）
   */
  private calculatePreviousPeriodMetrics(provider: string): ApiPerformanceMetrics | null {
    const monitor = getPerformanceMonitor();
    const now = Date.now();
    const periodMs = this.periodHours * 60 * 60 * 1000;

    const prevMetrics = monitor.getMetrics({
      type: MetricType.API_RESPONSE_TIME,
      startTime: now - periodMs * 2,
      endTime: now - periodMs,
    });

    return prevMetrics.length > 0 ? calculateApiMetrics(prevMetrics, provider) : null;
  }

  /**
   * 计算趋势
   */
  private calculateTrend(current: number, previous: number): 'up' | 'down' | 'flat' {
    if (previous === 0) return 'flat';
    const change = (current - previous) / previous;
    if (Math.abs(change) < 0.05) return 'flat';
    return change > 0 ? 'up' : 'down';
  }

  /**
   * 生成缓存性能卡片
   */
  private generateCacheCard(metrics: PerformanceMetric[]): CachePerformanceCard {
    return calculateCacheMetrics(metrics);
  }

  /**
   * 生成系统健康状态
   */
  private generateSystemHealth(metrics: PerformanceMetric[]): SystemHealth {
    const checks: HealthCheckItem[] = [];
    let totalScore = 0;
    let checkCount = 0;

    // API响应时间健康检查
    const apiMetrics = metrics.filter(m => m.type === MetricType.API_RESPONSE_TIME);
    if (apiMetrics.length > 0) {
      const avgResponseTime = apiMetrics.reduce((sum, m) => sum + m.duration, 0) / apiMetrics.length;
      const apiScore = Math.max(0, 100 - (avgResponseTime / 50)); // 50ms = 0分
      checks.push({
        name: 'API响应时间',
        status: avgResponseTime > 5000 ? 'critical' : avgResponseTime > 2000 ? 'warning' : 'healthy',
        value: avgResponseTime,
        threshold: 2000,
        description: `平均响应时间: ${avgResponseTime.toFixed(0)}ms`,
      });
      totalScore += apiScore;
      checkCount++;
    }

    // 缓存命中率健康检查
    const cacheMetrics = metrics.filter(m => m.type === MetricType.CACHE_OPERATION);
    const cacheGetOps = cacheMetrics.filter(m => m.operation === 'cache_get');
    if (cacheGetOps.length > 0) {
      const hits = cacheGetOps.filter(m => m.metadata?.cacheHit).length;
      const hitRate = hits / cacheGetOps.length;
      checks.push({
        name: '缓存命中率',
        status: hitRate < 0.5 ? 'critical' : hitRate < 0.7 ? 'warning' : 'healthy',
        value: hitRate * 100,
        threshold: 70,
        description: `命中率: ${(hitRate * 100).toFixed(1)}%`,
      });
      totalScore += hitRate * 100;
      checkCount++;
    }

    // 内存使用健康检查
    const monitor = getPerformanceMonitor();
    const memorySnapshots = monitor.getMemorySnapshots(1);
    if (memorySnapshots.length > 0) {
      const latestMemory = memorySnapshots[0];
      const memoryUsagePercent = (latestMemory.usedHeapSize / latestMemory.heapSizeLimit) * 100;
      checks.push({
        name: '内存使用',
        status: memoryUsagePercent > 90 ? 'critical' : memoryUsagePercent > 70 ? 'warning' : 'healthy',
        value: memoryUsagePercent,
        threshold: 70,
        description: `内存使用: ${(latestMemory.usedHeapSize / 1024 / 1024).toFixed(1)}MB`,
      });
      totalScore += Math.max(0, 100 - memoryUsagePercent);
      checkCount++;
    }

    // 错误率健康检查
    if (metrics.length > 0) {
      const failedCount = metrics.filter(m => !m.success).length;
      const errorRate = failedCount / metrics.length;
      checks.push({
        name: '错误率',
        status: errorRate > 0.1 ? 'critical' : errorRate > 0.05 ? 'warning' : 'healthy',
        value: errorRate * 100,
        threshold: 5,
        description: `错误率: ${(errorRate * 100).toFixed(2)}%`,
      });
      totalScore += Math.max(0, 100 - errorRate * 1000);
      checkCount++;
    }

    const score = checkCount > 0 ? totalScore / checkCount : 100;
    const criticalCount = checks.filter(c => c.status === 'critical').length;
    const warningCount = checks.filter(c => c.status === 'warning').length;

    return {
      status: criticalCount > 0 ? 'critical' : warningCount > 0 ? 'warning' : 'healthy',
      score: Math.round(score),
      checks,
      lastUpdated: Date.now(),
    };
  }

  /**
   * 生成图表配置
   */
  private generateCharts(metrics: PerformanceMetric[]): ChartConfig[] {
    const charts: ChartConfig[] = [];

    // 1. API响应时间趋势图
    const apiResponseChart = this.generateTimeSeriesChart(
      metrics.filter(m => m.type === MetricType.API_RESPONSE_TIME),
      'api_response_trend',
      'API响应时间趋势',
      'ms'
    );
    if (apiResponseChart.datasets.length > 0) {
      charts.push(apiResponseChart);
    }

    // 2. 缓存操作分布图
    const cacheChart = this.generateCacheChart(metrics);
    charts.push(cacheChart);

    // 3. 操作类型分布图
    const operationChart = this.generateOperationTypeChart(metrics);
    charts.push(operationChart);

    // 4. 内存使用趋势图
    const monitor = getPerformanceMonitor();
    const memorySnapshots = monitor.getMemorySnapshots(100);
    if (memorySnapshots.length > 0) {
      charts.push(this.generateMemoryChart(memorySnapshots));
    }

    return charts;
  }

  /**
   * 生成时间序列图表
   */
  private generateTimeSeriesChart(
    metrics: PerformanceMetric[],
    name: string,
    title: string,
    unit: string
  ): ChartConfig {
    // 按小时分组
    const hourlyData = new Map<number, number[]>();
    const now = Date.now();
    const hourMs = 60 * 60 * 1000;

    for (let i = 0; i < this.periodHours; i++) {
      hourlyData.set(i, []);
    }

    for (const metric of metrics) {
      const hoursAgo = Math.floor((now - metric.timestamp) / hourMs);
      if (hoursAgo >= 0 && hoursAgo < this.periodHours) {
        const arr = hourlyData.get(hoursAgo);
        if (arr) {
          arr.push(metric.duration);
        }
      }
    }

    const dataPoints: ChartDataPoint[] = [];
    for (let i = this.periodHours - 1; i >= 0; i--) {
      const durations = hourlyData.get(i) || [];
      const avgDuration = durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0;
      dataPoints.push({
        label: `${i}h`,
        value: Math.round(avgDuration),
      });
    }

    return {
      type: 'line',
      title,
      datasets: [{
        name,
        data: dataPoints,
        unit,
        color: '#3b82f6',
      }],
      xAxisLabel: '时间',
      yAxisLabel: unit,
      showLegend: true,
    };
  }

  /**
   * 生成缓存图表
   */
  private generateCacheChart(metrics: PerformanceMetric[]): ChartConfig {
    const cacheMetrics = metrics.filter(m => m.type === MetricType.CACHE_OPERATION);
    const getOps = cacheMetrics.filter(m => m.operation === 'cache_get');
    const setOps = cacheMetrics.filter(m => m.operation === 'cache_set');
    const hits = getOps.filter(m => m.metadata?.cacheHit).length;
    const misses = getOps.length - hits;

    return {
      type: 'pie',
      title: '缓存操作分布',
      datasets: [{
        name: '缓存状态',
        data: [
          { label: '命中', value: hits },
          { label: '未命中', value: misses },
          { label: '设置', value: setOps.length },
        ],
        color: '#10b981',
      }],
      showLegend: true,
    };
  }

  /**
   * 生成操作类型分布图
   */
  private generateOperationTypeChart(metrics: PerformanceMetric[]): ChartConfig {
    const operationCounts = new Map<string, number>();

    for (const metric of metrics) {
      const count = operationCounts.get(metric.operation) || 0;
      operationCounts.set(metric.operation, count + 1);
    }

    const dataPoints: ChartDataPoint[] = Array.from(operationCounts.entries())
      .map(([operation, count]) => ({ label: operation, value: count }))
      .sort((a, b) => b.value - a.value);

    return {
      type: 'bar',
      title: '操作类型分布',
      datasets: [{
        name: '操作次数',
        data: dataPoints,
        color: '#8b5cf6',
      }],
      xAxisLabel: '操作类型',
      yAxisLabel: '次数',
      showLegend: false,
    };
  }

  /**
   * 生成内存使用趋势图
   */
  private generateMemoryChart(snapshots: MemorySnapshot[]): ChartConfig {
    const dataPoints: ChartDataPoint[] = snapshots.map(snapshot => ({
      label: new Date(snapshot.timestamp).toLocaleTimeString(),
      value: Math.round(snapshot.usedHeapSize / 1024 / 1024), // MB
    }));

    return {
      type: 'area',
      title: '内存使用趋势',
      datasets: [{
        name: '内存使用',
        data: dataPoints,
        unit: 'MB',
        color: '#f59e0b',
      }],
      xAxisLabel: '时间',
      yAxisLabel: '内存 (MB)',
      showLegend: true,
    };
  }

  /**
   * 添加数据更新监听器
   */
  addListener(callback: DashboardUpdateCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    if (!this.currentData) return;

    for (const listener of this.listeners) {
      try {
        listener(this.currentData);
      } catch (error) {
        logger.error('PerformanceDashboard: 监听器执行失败', error);
      }
    }
  }

  /**
   * 导出仪表盘数据为JSON
   */
  exportToJSON(): string {
    return JSON.stringify(this.currentData, null, 2);
  }
}

/**
 * 全局仪表盘实例
 */
let globalDashboard: PerformanceDashboard | null = null;

/**
 * 获取全局仪表盘实例
 */
export function getPerformanceDashboard(): PerformanceDashboard {
  if (!globalDashboard) {
    globalDashboard = new PerformanceDashboard();
  }
  return globalDashboard;
}

/**
 * 初始化性能仪表盘
 */
export function initPerformanceDashboard(updateInterval?: number): PerformanceDashboard {
  if (globalDashboard) {
    globalDashboard.stop();
  }
  globalDashboard = new PerformanceDashboard(updateInterval);
  return globalDashboard;
}

/**
 * 获取仪表盘数据（便捷函数）
 */
export function getDashboardData(): DashboardData {
  return getPerformanceDashboard().refresh();
}

/**
 * 导出仪表盘数据（便捷函数）
 */
export function exportDashboardData(): string {
  return getPerformanceDashboard().exportToJSON();
}
