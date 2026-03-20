/**
 * 性能监控类型定义
 *
 * 定义性能指标、阈值、报告等核心类型
 */

/**
 * 指标类型枚举
 */
export enum MetricType {
  /** 翻译 API 响应时间 */
  API_RESPONSE_TIME = 'api_response_time',
  /** DOM 渲染耗时 */
  DOM_RENDER_TIME = 'dom_render_time',
  /** 存储操作性能 */
  STORAGE_OPERATION = 'storage_operation',
  /** 内存使用量 */
  MEMORY_USAGE = 'memory_usage',
  /** 批量翻译性能 */
  BATCH_TRANSLATION = 'batch_translation',
  /** 缓存操作性能 */
  CACHE_OPERATION = 'cache_operation',
  /** 消息传递延迟 */
  MESSAGE_LATENCY = 'message_latency',
  /** 翻译总耗时 */
  TRANSLATION_TOTAL_TIME = 'translation_total_time',
}

/**
 * 操作类型
 */
export type OperationType =
  | 'translate'
  | 'translate_total'
  | 'batch_translate'
  | 'cache_get'
  | 'cache_set'
  | 'cache_evict'
  | 'storage_read'
  | 'storage_write'
  | 'dom_highlight'
  | 'dom_render'
  | 'message_send'
  | 'message_receive'
  | 'memory_check'
  | 'hybrid_translate'
  | 'traditional_translate'
  | 'llm_translate'
  | 'deepl_translate'
  | 'deepl_cache_hit'
  | 'deepl_primary_translate'
  | 'translation_source'
  | 'llm_fallback_translate'
  | 'enhanced_analysis';  // CMP-106: LLM 增强分析

/**
 * 性能指标条目
 */
export interface PerformanceMetric {
  /** 唯一标识 */
  id: string;
  /** 指标类型 */
  type: MetricType;
  /** 操作类型 */
  operation: OperationType;
  /** 耗时（毫秒） */
  duration: number;
  /** 时间戳 */
  timestamp: number;
  /** 是否成功 */
  success: boolean;
  /** 额外元数据 */
  metadata?: MetricMetadata;
}

/**
 * 指标元数据
 */
export interface MetricMetadata {
  /** 文本长度（翻译相关） */
  textLength?: number;
  /** 段落数量（批量翻译） */
  paragraphCount?: number;
  /** 缓存命中 */
  cacheHit?: boolean;
  /** 缓存大小 */
  cacheSize?: number;
  /** 存储键数量 */
  storageKeyCount?: number;
  /** DOM 元素数量 */
  elementCount?: number;
  /** 内存使用量（字节） */
  memoryUsage?: number;
  /** 错误信息 */
  errorMessage?: string;
  /** 错误 */
  error?: string;
  /** API 提供商 */
  provider?: string;
  /** 用户词汇量等级 */
  userLevel?: string;
  /** 缓存键 */
  cacheKey?: string;
  /** 翻译引擎类型（混合翻译） */
  engine?: string;
  /** 翻译来源（deepl/llm/hybrid） */
  source?: 'deepl' | 'llm' | 'hybrid';
  /** 单词数量 */
  wordCount?: number;
  /** 短语数量 (CMP-106) */
  phraseCount?: number;
  /** 语法点数量 (CMP-106) */
  grammarCount?: number;
  /** 文本复杂度 */
  textComplexity?: string;
}

/**
 * 性能阈值配置
 */
export interface PerformanceThreshold {
  /** 指标类型 */
  type: MetricType;
  /** 警告阈值（毫秒或字节） */
  warning: number;
  /** 严重阈值（毫秒或字节） */
  critical: number;
  /** 采样率（0-1） */
  sampleRate: number;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 性能告警
 */
export interface PerformanceAlert {
  /** 唯一标识 */
  id: string;
  /** 指标类型 */
  type: MetricType;
  /** 操作类型 */
  operation: OperationType;
  /** 告警级别 */
  level: 'warning' | 'critical';
  /** 实际值 */
  value: number;
  /** 阈值 */
  threshold: number;
  /** 时间戳 */
  timestamp: number;
  /** 是否已处理 */
  acknowledged: boolean;
  /** 元数据 */
  metadata?: MetricMetadata;
}

/**
 * 性能统计摘要
 */
export interface PerformanceStats {
  /** 指标类型 */
  type: MetricType;
  /** 操作类型 */
  operation: OperationType;
  /** 总次数 */
  count: number;
  /** 平均耗时 */
  avgDuration: number;
  /** 最小耗时 */
  minDuration: number;
  /** 最大耗时 */
  maxDuration: number;
  /** P50 延迟 */
  p50: number;
  /** P95 延迟 */
  p95: number;
  /** P99 延迟 */
  p99: number;
  /** 成功率 */
  successRate: number;
  /** 统计时间段开始 */
  periodStart: number;
  /** 统计时间段结束 */
  periodEnd: number;
}

/**
 * 性能报告
 */
export interface PerformanceReport {
  /** 报告生成时间 */
  generatedAt: number;
  /** 统计时间段（小时） */
  periodHours: number;
  /** 各项指标统计 */
  stats: PerformanceStats[];
  /** 活跃告警 */
  activeAlerts: PerformanceAlert[];
  /** 系统信息 */
  systemInfo: SystemInfo;
}

/**
 * 系统信息
 */
export interface SystemInfo {
  /** 扩展版本 */
  extensionVersion: string;
  /** Chrome 版本 */
  chromeVersion: string;
  /** 用户代理 */
  userAgent: string;
  /** 当前内存使用量（字节） */
  currentMemoryUsage?: number;
  /** 缓存条目数 */
  cacheEntryCount?: number;
  /** 缓存内存占用（估算，字节） */
  cacheMemoryUsage?: number;
}

/**
 * 性能监控配置
 */
export interface PerformanceConfig {
  /** 是否启用监控 */
  enabled: boolean;
  /** 最大存储条目数 */
  maxStoredMetrics: number;
  /** 自动上报间隔（分钟） */
  autoReportInterval: number;
  /** 阈值配置 */
  thresholds: PerformanceThreshold[];
  /** 内存监控采样间隔（秒） */
  memorySampleInterval: number;
  /** 是否启用内存监控 */
  enableMemoryMonitoring: boolean;
}

/**
 * 默认配置
 */
export const DEFAULT_PERFORMANCE_CONFIG: PerformanceConfig = {
  enabled: true,
  maxStoredMetrics: 10000,
  autoReportInterval: 60,
  memorySampleInterval: 30,
  enableMemoryMonitoring: true,
  thresholds: [
    {
      type: MetricType.API_RESPONSE_TIME,
      warning: 2000,
      critical: 5000,
      sampleRate: 1.0,
      enabled: true,
    },
    {
      type: MetricType.DOM_RENDER_TIME,
      warning: 100,
      critical: 500,
      sampleRate: 0.5,
      enabled: true,
    },
    {
      type: MetricType.STORAGE_OPERATION,
      warning: 50,
      critical: 200,
      sampleRate: 0.3,
      enabled: true,
    },
    {
      type: MetricType.MEMORY_USAGE,
      warning: 50 * 1024 * 1024, // 50MB
      critical: 100 * 1024 * 1024, // 100MB
      sampleRate: 1.0,
      enabled: true,
    },
    {
      type: MetricType.BATCH_TRANSLATION,
      warning: 3000,
      critical: 10000,
      sampleRate: 1.0,
      enabled: true,
    },
    {
      type: MetricType.CACHE_OPERATION,
      warning: 10,
      critical: 50,
      sampleRate: 0.1,
      enabled: true,
    },
    {
      type: MetricType.MESSAGE_LATENCY,
      warning: 20,
      critical: 100,
      sampleRate: 0.2,
      enabled: true,
    },
  ],
};

/**
 * 内存使用快照
 */
export interface MemorySnapshot {
  /** 时间戳 */
  timestamp: number;
  /** 已使用堆内存（字节） */
  usedHeapSize: number;
  /** 总堆内存（字节） */
  totalHeapSize: number;
  /** 堆内存限制（字节） */
  heapSizeLimit: number;
  /** 扩展特有内存使用量 */
  extensionMemoryUsage?: number;
}

/**
 * 缓存性能指标
 */
export interface CachePerformanceMetrics {
  /** 总请求数 */
  totalRequests: number;
  /** 命中数 */
  hits: number;
  /** 未命中数 */
  misses: number;
  /** 命中率 */
  hitRate: number;
  /** 平均获取时间（毫秒） */
  avgGetTime: number;
  /** 平均设置时间（毫秒） */
  avgSetTime: number;
  /** 淘汰次数 */
  evictionCount: number;
  /** 当前条目数 */
  currentSize: number;
}

/**
 * API 性能指标
 */
export interface ApiPerformanceMetrics {
  /** 提供商 */
  provider: string;
  /** 总调用次数 */
  totalCalls: number;
  /** 成功次数 */
  successCalls: number;
  /** 失败次数 */
  failedCalls: number;
  /** 平均响应时间 */
  avgResponseTime: number;
  /** P95 响应时间 */
  p95ResponseTime: number;
  /** P99 响应时间 */
  p99ResponseTime: number;
  /** 平均 Token 使用量（估算） */
  avgTokenUsage?: number;
  /** 平均文本长度 */
  avgTextLength: number;
}
