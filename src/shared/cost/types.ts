/**
 * 成本监控类型定义
 *
 * 定义 API 成本追踪相关的核心类型
 */

/**
 * 提供商类型分类
 */
export type ProviderCategory = 'llm' | 'translation';

/**
 * LLM 提供商定价模型
 */
export interface LlmPricing {
  /** 输入价格（美元/百万 token） */
  inputPricePerMillion: number;
  /** 输出价格（美元/百万 token） */
  outputPricePerMillion: number;
  /** 是否免费 */
  isFree?: boolean;
}

/**
 * 翻译服务定价模型
 */
export interface TranslationPricing {
  /** 每月免费字符额度 */
  freeCharactersPerMonth: number;
  /** 超出后价格（美元/百万字符） */
  pricePerMillionCharacters: number;
  /** 是否完全免费 */
  isFree?: boolean;
}

/**
 * 各提供商定价配置
 */
export const PROVIDER_PRICING: Record<string, LlmPricing | TranslationPricing> = {
  // LLM 提供商定价
  openai_gpt_4o_mini: {
    inputPricePerMillion: 0.15,
    outputPricePerMillion: 0.6,
  },
  openai_gpt_4o: {
    inputPricePerMillion: 2.5,
    outputPricePerMillion: 10,
  },
  openai_gpt_4_turbo: {
    inputPricePerMillion: 10,
    outputPricePerMillion: 30,
  },
  openai_gpt_3_5_turbo: {
    inputPricePerMillion: 0.5,
    outputPricePerMillion: 1.5,
  },
  anthropic_claude_3_5_haiku: {
    inputPricePerMillion: 0.8,
    outputPricePerMillion: 4,
  },
  anthropic_claude_3_5_sonnet: {
    inputPricePerMillion: 3,
    outputPricePerMillion: 15,
  },
  anthropic_claude_3_opus: {
    inputPricePerMillion: 15,
    outputPricePerMillion: 75,
  },
  gemini_2_0_flash: {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.4,
  },
  gemini_1_5_flash: {
    inputPricePerMillion: 0.075,
    outputPricePerMillion: 0.3,
  },
  gemini_1_5_pro: {
    inputPricePerMillion: 1.25,
    outputPricePerMillion: 5,
  },
  groq_llama_3_3_70b: {
    inputPricePerMillion: 0.59,
    outputPricePerMillion: 0.79,
  },
  deepseek_chat: {
    inputPricePerMillion: 0.27,
    outputPricePerMillion: 1.1,
  },
  zhipu_glm_4_flash: {
    inputPricePerMillion: 0.1,
    outputPricePerMillion: 0.1,
  },
  alibaba_qwen_turbo: {
    inputPricePerMillion: 0.3,
    outputPricePerMillion: 0.6,
  },
  baidu_ernie_speed: {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    isFree: true,
  },
  ollama: {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    isFree: true,
  },
  custom: {
    inputPricePerMillion: 0,
    outputPricePerMillion: 0,
    isFree: true,
  },

  // 翻译服务定价
  deepl_free: {
    freeCharactersPerMonth: 500000,
    pricePerMillionCharacters: 0,
    isFree: true,
  },
  deepl_pro: {
    freeCharactersPerMonth: 0,
    pricePerMillionCharacters: 25,
  },
  google_translate: {
    freeCharactersPerMonth: 500000,
    pricePerMillionCharacters: 20,
  },
  youdao_standard: {
    freeCharactersPerMonth: 2000000,
    pricePerMillionCharacters: 0,
    isFree: true,
  },
};

/**
 * Token 使用记录
 */
export interface TokenUsageRecord {
  /** 唯一标识 */
  id: string;
  /** 提供商 */
  provider: string;
  /** 模型名称 */
  model: string;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 估算成本（美元） */
  estimatedCost: number;
  /** 时间戳 */
  timestamp: number;
  /** 请求是否成功 */
  success: boolean;
  /** 请求 ID（用于追踪） */
  requestId?: string;
}

/**
 * 翻译字符使用记录
 */
export interface CharacterUsageRecord {
  /** 唯一标识 */
  id: string;
  /** 提供商 */
  provider: string;
  /** 字符数 */
  characters: number;
  /** 估算成本（美元） */
  estimatedCost: number;
  /** 时间戳 */
  timestamp: number;
  /** 请求是否成功 */
  success: boolean;
  /** 是否在免费额度内 */
  withinFreeQuota: boolean;
}

/**
 * 成本统计摘要
 */
export interface CostSummary {
  /** 总成本（美元） */
  totalCost: number;
  /** LLM 成本 */
  llmCost: number;
  /** 翻译服务成本 */
  translationCost: number;
  /** 总 token 使用量 */
  totalInputTokens: number;
  totalOutputTokens: number;
  /** 总字符数 */
  totalCharacters: number;
  /** 成功请求数 */
  successRequests: number;
  /** 失败请求数 */
  failedRequests: number;
  /** 时间范围开始 */
  periodStart: number;
  /** 时间范围结束 */
  periodEnd: number;
}

/**
 * 提供商成本详情
 */
export interface ProviderCostDetail {
  /** 提供商名称 */
  provider: string;
  /** 提供商显示名称 */
  displayName: string;
  /** 类别 */
  category: ProviderCategory;
  /** 总成本 */
  totalCost: number;
  /** 请求数 */
  requestCount: number;
  /** 成功请求数 */
  successCount: number;
  /** 平均成本 */
  avgCostPerRequest: number;
  /** LLM 特有字段 */
  totalInputTokens?: number;
  totalOutputTokens?: number;
  /** 翻译服务特有字段 */
  totalCharacters?: number;
  /** 本月免费额度使用情况（翻译服务） */
  freeQuotaUsed?: number;
  freeQuotaRemaining?: number;
}

/**
 * 成本趋势数据点
 */
export interface CostTrendPoint {
  /** 日期标签 */
  date: string;
  /** 成本 */
  cost: number;
  /** 请求数 */
  requestCount: number;
}

/**
 * 成本仪表盘数据
 */
export interface CostDashboardData {
  /** 生成时间 */
  generatedAt: number;
  /** 时间范围（天） */
  periodDays: number;
  /** 总体统计 */
  summary: CostSummary;
  /** 各提供商详情 */
  providerDetails: ProviderCostDetail[];
  /** 成本趋势（按天） */
  costTrend: CostTrendPoint[];
  /** 预算使用情况 */
  budget: BudgetStatus;
  /** 成本最高的请求（最近） */
  topExpensiveRequests: Array<{
    provider: string;
    cost: number;
    timestamp: number;
    details: string;
  }>;
}

/**
 * 预算状态
 */
export interface BudgetStatus {
  /** 月度预算（美元），0 表示未设置 */
  monthlyBudget: number;
  /** 已使用金额 */
  used: number;
  /** 剩余金额 */
  remaining: number;
  /** 使用百分比 */
  usagePercent: number;
  /** 是否超预算 */
  isOverBudget: boolean;
  /** 预计月底使用量（基于当前使用率） */
  projectedEndOfMonth: number;
}

/**
 * 成本追踪配置
 */
export interface CostTrackerConfig {
  /** 是否启用成本追踪 */
  enabled: boolean;
  /** 月度预算（美元） */
  monthlyBudget: number;
  /** 最大存储记录数 */
  maxStoredRecords: number;
  /** 是否显示成本警告 */
  showWarnings: boolean;
  /** 预算警告阈值（百分比） */
  warningThreshold: number;
}

/**
 * 默认成本追踪配置
 */
export const DEFAULT_COST_TRACKER_CONFIG: CostTrackerConfig = {
  enabled: true,
  monthlyBudget: 10, // 默认 $10/月
  maxStoredRecords: 10000,
  showWarnings: true,
  warningThreshold: 80,
};

/**
 * 成本警告类型
 */
export type CostWarningType = 'budget_exceeded' | 'budget_warning' | 'high_cost_request' | 'unusual_usage';

/**
 * 成本警告
 */
export interface CostWarning {
  /** 唯一标识 */
  id: string;
  /** 警告类型 */
  type: CostWarningType;
  /** 警告消息 */
  message: string;
  /** 相关金额 */
  amount?: number;
  /** 时间戳 */
  timestamp: number;
  /** 是否已确认 */
  acknowledged: boolean;
}