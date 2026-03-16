/**
 * 销售数据整合类型定义
 * 用于数据整合代理与其他代理之间的数据交换
 */

// 销售指标接口
export interface SalesMetrics {
  revenue: number;
  target: number;
  achievementRate: number;
}

// 年终预测接口
export interface YearEndProjection {
  projectedRevenue: number;
  target: number;
  projectedAchievementRate: number;
}

// 摘要数据接口
export interface SummaryData {
  mtd: SalesMetrics;
  ytd: SalesMetrics;
  yearEnd: YearEndProjection;
}

// 地域数据接口
export interface TerritoryData {
  name: string;
  mtd: SalesMetrics;
  ytd: SalesMetrics;
  reps: string[];
}

// 代表数据接口
export interface RepData {
  id: string;
  name: string;
  territory: string;
  mtd: SalesMetrics;
  ytd: SalesMetrics;
  email?: string;
}

// 管道数据接口
export interface PipelineData {
  stage: string;
  value: number;
  count: number;
  probability: number;
  weightedValue: number;
}

// 元数据接口
export interface ReportMetadata {
  lastUpdated: string;
  dataSource: string;
  reportingPeriod: {
    mtd: string;
    ytd: string;
    yearEnd: string;
  };
}

// 完整仪表板数据接口
export interface SalesDashboard {
  metadata: ReportMetadata;
  summary: SummaryData;
  byTerritory: Record<string, TerritoryData>;
  byRep: Record<string, RepData>;
  byPipeline: Record<string, PipelineData>;
  status: 'awaiting_data' | 'consolidating' | 'ready' | 'error';
  errorMessage?: string;
}

// 数据整合配置接口
export interface ConsolidationConfig {
  dataSourcePath: string;
  outputPath: string;
  refreshInterval: number; // 分钟
  territories: string[];
  distributionRules: DistributionRule[];
}

// 分发规则接口
export interface DistributionRule {
  territory?: string;
  repId?: string;
  email?: string;
  format: 'json' | 'pdf' | 'excel';
  schedule: 'realtime' | 'daily' | 'weekly';
}

// 数据提取代理输出接口
export interface ExtractionOutput {
  sourceFile: string;
  extractedAt: string;
  metrics: {
    mtd: SalesMetrics;
    ytd: SalesMetrics;
    yearEnd: YearEndProjection;
  };
  byTerritory: Record<string, TerritoryData>;
  byRep: Record<string, RepData>;
  byPipeline: Record<string, PipelineData>;
}

// 数据整合代理输出接口
export interface ConsolidationOutput {
  dashboard: SalesDashboard;
  reports: {
    byTerritory: Record<string, string>; // 报告文件路径
    byRep: Record<string, string>;
  };
  distributionQueue: DistributionTask[];
}

// 分发任务接口
export interface DistributionTask {
  id: string;
  type: 'territory' | 'rep';
  target: string;
  reportPath: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  errorMessage?: string;
}
