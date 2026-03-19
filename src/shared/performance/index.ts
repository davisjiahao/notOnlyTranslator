/**
 * 性能监控模块
 *
 * 统一导出性能监控相关的所有类型、类和函数
 */

// 类型定义
export {
  MetricType,
  type OperationType,
  type PerformanceMetric,
  type PerformanceThreshold,
  type PerformanceAlert,
  type PerformanceStats,
  type PerformanceReport,
  type PerformanceConfig,
  type SystemInfo,
  type MemorySnapshot,
  type CachePerformanceMetrics,
  type ApiPerformanceMetrics,
  type MetricMetadata,
  DEFAULT_PERFORMANCE_CONFIG,
} from './types';

// 监控核心
export {
  PerformanceMonitor,
  getPerformanceMonitor,
  initPerformanceMonitor,
  recordMetric,
  createTimer,
  measureAsync,
  measureSync,
} from './monitor';

// 数据上报
export {
  PerformanceReporter,
  type ReporterConfig,
  DEFAULT_REPORTER_CONFIG,
  type ReportPayload,
  calculateApiMetrics,
  calculateCacheMetrics,
  getPerformanceReporter,
  initPerformanceReporter,
  reportPerformance,
  exportPerformanceReport,
} from './reporter';

// 仪表盘
export {
  PerformanceDashboard,
  type ChartDataPoint,
  type ChartDataset,
  type ChartConfig,
  type ApiPerformanceCard,
  type CachePerformanceCard,
  type SystemHealth,
  type HealthCheckItem,
  type DashboardData,
  type DashboardUpdateCallback,
  getPerformanceDashboard,
  initPerformanceDashboard,
  getDashboardData,
  exportDashboardData,
} from './dashboard';
