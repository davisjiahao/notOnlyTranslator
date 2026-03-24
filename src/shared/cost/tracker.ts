/**
 * 成本追踪核心模块
 *
 * 提供 API 调用成本记录、统计、存储等功能
 */
import {
  TokenUsageRecord,
  CharacterUsageRecord,
  CostSummary,
  ProviderCostDetail,
  CostTrendPoint,
  CostDashboardData,
  BudgetStatus,
  CostWarning,
  CostTrackerConfig,
  DEFAULT_COST_TRACKER_CONFIG,
  PROVIDER_PRICING,
  LlmPricing,
  TranslationPricing,
} from './types';
import { logger, generateId } from '@/shared/utils';

/**
 * 成本追踪器类
 */
export class CostTracker {
  /** 配置 */
  private config: CostTrackerConfig;

  /** Token 使用记录 */
  private tokenRecords: TokenUsageRecord[] = [];

  /** 字符使用记录 */
  private characterRecords: CharacterUsageRecord[] = [];

  /** 活跃警告 */
  private warnings: CostWarning[] = [];

  /** 数据变更监听器 */
  private listeners: Set<() => void> = new Set();

  constructor(config: Partial<CostTrackerConfig> = {}) {
    this.config = {
      ...DEFAULT_COST_TRACKER_CONFIG,
      ...config,
    };
  }

  /**
   * 记录 LLM Token 使用
   */
  recordTokenUsage(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    success: boolean = true,
    requestId?: string
  ): TokenUsageRecord {
    const pricing = this.getLlmPricing(provider, model);
    const estimatedCost = this.calculateLlmCost(pricing, inputTokens, outputTokens);

    const record: TokenUsageRecord = {
      id: generateId(),
      provider,
      model,
      inputTokens,
      outputTokens,
      estimatedCost,
      timestamp: Date.now(),
      success,
      requestId,
    };

    this.tokenRecords.push(record);
    this.limitRecords();
    this.checkBudgetWarning(record);

    this.notifyListeners();

    logger.info(`CostTracker: 记录 Token 使用`, {
      provider,
      model,
      inputTokens,
      outputTokens,
      cost: `$${estimatedCost.toFixed(6)}`,
    });

    return record;
  }

  /**
   * 记录翻译服务字符使用
   */
  recordCharacterUsage(
    provider: string,
    characters: number,
    success: boolean = true
  ): CharacterUsageRecord {
    const pricing = this.getTranslationPricing(provider);
    const monthlyUsage = this.getMonthlyCharacterUsage(provider);
    const withinFreeQuota = monthlyUsage + characters <= pricing.freeCharactersPerMonth;
    const estimatedCost = withinFreeQuota
      ? 0
      : this.calculateTranslationCost(pricing, characters, monthlyUsage);

    const record: CharacterUsageRecord = {
      id: generateId(),
      provider,
      characters,
      estimatedCost,
      timestamp: Date.now(),
      success,
      withinFreeQuota,
    };

    this.characterRecords.push(record);
    this.limitRecords();
    this.checkBudgetWarning(record);

    this.notifyListeners();

    logger.info(`CostTracker: 记录字符使用`, {
      provider,
      characters,
      cost: `$${estimatedCost.toFixed(6)}`,
      withinFreeQuota,
    });

    return record;
  }

  /**
   * 估算 Token 数量（基于文本长度）
   * 简单估算：英文约 4 字符 = 1 token，中文约 1.5 字符 = 1 token
   */
  estimateTokens(text: string): { input: number; output: number } {
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    const avgCharsPerToken = hasChinese ? 1.5 : 4;
    const estimatedTokens = Math.ceil(text.length / avgCharsPerToken);
    return {
      input: estimatedTokens,
      output: Math.ceil(estimatedTokens * 0.5), // 假设输出约为输入的一半
    };
  }

  /**
   * 获取成本摘要
   */
  getSummary(periodDays: number = 30): CostSummary {
    const now = Date.now();
    const startTime = now - periodDays * 24 * 60 * 60 * 1000;

    const recentTokenRecords = this.tokenRecords.filter(r => r.timestamp >= startTime);
    const recentCharRecords = this.characterRecords.filter(r => r.timestamp >= startTime);

    const llmCost = recentTokenRecords.reduce((sum, r) => sum + r.estimatedCost, 0);
    const translationCost = recentCharRecords.reduce((sum, r) => sum + r.estimatedCost, 0);
    const totalInputTokens = recentTokenRecords.reduce((sum, r) => sum + r.inputTokens, 0);
    const totalOutputTokens = recentTokenRecords.reduce((sum, r) => sum + r.outputTokens, 0);
    const totalCharacters = recentCharRecords.reduce((sum, r) => sum + r.characters, 0);
    const successRequests =
      recentTokenRecords.filter(r => r.success).length +
      recentCharRecords.filter(r => r.success).length;
    const failedRequests =
      recentTokenRecords.filter(r => !r.success).length +
      recentCharRecords.filter(r => !r.success).length;

    return {
      totalCost: llmCost + translationCost,
      llmCost,
      translationCost,
      totalInputTokens,
      totalOutputTokens,
      totalCharacters,
      successRequests,
      failedRequests,
      periodStart: startTime,
      periodEnd: now,
    };
  }

  /**
   * 获取各提供商成本详情
   */
  getProviderDetails(periodDays: number = 30): ProviderCostDetail[] {
    const now = Date.now();
    const startTime = now - periodDays * 24 * 60 * 60 * 1000;

    const details: ProviderCostDetail[] = [];

    // 处理 LLM 提供商
    const llmProviders = new Set(this.tokenRecords.map(r => r.provider));
    for (const provider of llmProviders) {
      const records = this.tokenRecords.filter(
        r => r.provider === provider && r.timestamp >= startTime
      );
      if (records.length === 0) continue;

      const totalCost = records.reduce((sum, r) => sum + r.estimatedCost, 0);
      const successCount = records.filter(r => r.success).length;

      details.push({
        provider,
        displayName: this.getProviderDisplayName(provider),
        category: 'llm',
        totalCost,
        requestCount: records.length,
        successCount,
        avgCostPerRequest: totalCost / records.length,
        totalInputTokens: records.reduce((sum, r) => sum + r.inputTokens, 0),
        totalOutputTokens: records.reduce((sum, r) => sum + r.outputTokens, 0),
      });
    }

    // 处理翻译服务提供商
    const translationProviders = new Set(this.characterRecords.map(r => r.provider));
    for (const provider of translationProviders) {
      const records = this.characterRecords.filter(
        r => r.provider === provider && r.timestamp >= startTime
      );
      if (records.length === 0) continue;

      const totalCost = records.reduce((sum, r) => sum + r.estimatedCost, 0);
      const successCount = records.filter(r => r.success).length;
      const totalCharacters = records.reduce((sum, r) => sum + r.characters, 0);
      const pricing = this.getTranslationPricing(provider);

      details.push({
        provider,
        displayName: this.getProviderDisplayName(provider),
        category: 'translation',
        totalCost,
        requestCount: records.length,
        successCount,
        avgCostPerRequest: totalCost / records.length,
        totalCharacters,
        freeQuotaUsed: totalCharacters,
        freeQuotaRemaining: Math.max(0, pricing.freeCharactersPerMonth - totalCharacters),
      });
    }

    return details.sort((a, b) => b.totalCost - a.totalCost);
  }

  /**
   * 获取成本趋势
   */
  getCostTrend(periodDays: number = 30): CostTrendPoint[] {
    const now = Date.now();
    const trend: CostTrendPoint[] = [];

    for (let i = periodDays - 1; i >= 0; i--) {
      const dayStart = now - (i + 1) * 24 * 60 * 60 * 1000;
      const dayEnd = now - i * 24 * 60 * 60 * 1000;
      const date = new Date(dayEnd).toLocaleDateString('zh-CN', {
        month: 'short',
        day: 'numeric',
      });

      const tokenCost = this.tokenRecords
        .filter(r => r.timestamp >= dayStart && r.timestamp < dayEnd)
        .reduce((sum, r) => sum + r.estimatedCost, 0);

      const charCost = this.characterRecords
        .filter(r => r.timestamp >= dayStart && r.timestamp < dayEnd)
        .reduce((sum, r) => sum + r.estimatedCost, 0);

      const requestCount =
        this.tokenRecords.filter(r => r.timestamp >= dayStart && r.timestamp < dayEnd).length +
        this.characterRecords.filter(r => r.timestamp >= dayStart && r.timestamp < dayEnd).length;

      trend.push({
        date,
        cost: tokenCost + charCost,
        requestCount,
      });
    }

    return trend;
  }

  /**
   * 获取预算状态
   */
  getBudgetStatus(): BudgetStatus {
    const summary = this.getSummary(30); // 本月
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const usagePercent = this.config.monthlyBudget > 0
      ? (summary.totalCost / this.config.monthlyBudget) * 100
      : 0;

    // 预计月底使用量
    const dailyAverage = summary.totalCost / Math.max(1, dayOfMonth);
    const projectedEndOfMonth = dailyAverage * daysInMonth;

    return {
      monthlyBudget: this.config.monthlyBudget,
      used: summary.totalCost,
      remaining: Math.max(0, this.config.monthlyBudget - summary.totalCost),
      usagePercent,
      isOverBudget: summary.totalCost > this.config.monthlyBudget && this.config.monthlyBudget > 0,
      projectedEndOfMonth,
    };
  }

  /**
   * 获取仪表盘数据
   */
  getDashboardData(periodDays: number = 30): CostDashboardData {
    const summary = this.getSummary(periodDays);
    const providerDetails = this.getProviderDetails(periodDays);
    const costTrend = this.getCostTrend(periodDays);
    const budget = this.getBudgetStatus();

    // 获取成本最高的请求
    const allRecords = [
      ...this.tokenRecords.map(r => ({
        provider: r.provider,
        cost: r.estimatedCost,
        timestamp: r.timestamp,
        details: `Input: ${r.inputTokens} tokens, Output: ${r.outputTokens} tokens`,
      })),
      ...this.characterRecords.map(r => ({
        provider: r.provider,
        cost: r.estimatedCost,
        timestamp: r.timestamp,
        details: `${r.characters} characters`,
      })),
    ];

    const topExpensiveRequests = allRecords
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    return {
      generatedAt: Date.now(),
      periodDays,
      summary,
      providerDetails,
      costTrend,
      budget,
      topExpensiveRequests,
    };
  }

  /**
   * 获取活跃警告
   */
  getActiveWarnings(): CostWarning[] {
    return this.warnings.filter(w => !w.acknowledged);
  }

  /**
   * 确认警告
   */
  acknowledgeWarning(warningId: string): boolean {
    const warning = this.warnings.find(w => w.id === warningId);
    if (warning) {
      warning.acknowledged = true;
      this.notifyListeners();
      return true;
    }
    return false;
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<CostTrackerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.notifyListeners();
  }

  /**
   * 获取配置
   */
  getConfig(): CostTrackerConfig {
    return { ...this.config };
  }

  /**
   * 添加变更监听器
   */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    this.tokenRecords = [];
    this.characterRecords = [];
    this.warnings = [];
    this.notifyListeners();
  }

  /**
   * 导出数据（用于持久化）
   */
  exportData(): {
    tokenRecords: TokenUsageRecord[];
    characterRecords: CharacterUsageRecord[];
    warnings: CostWarning[];
    config: CostTrackerConfig;
  } {
    return {
      tokenRecords: this.tokenRecords,
      characterRecords: this.characterRecords,
      warnings: this.warnings,
      config: this.config,
    };
  }

  /**
   * 导入数据
   */
  importData(data: {
    tokenRecords?: TokenUsageRecord[];
    characterRecords?: CharacterUsageRecord[];
    warnings?: CostWarning[];
    config?: CostTrackerConfig;
  }): void {
    if (data.tokenRecords) {
      this.tokenRecords = data.tokenRecords;
    }
    if (data.characterRecords) {
      this.characterRecords = data.characterRecords;
    }
    if (data.warnings) {
      this.warnings = data.warnings;
    }
    if (data.config) {
      this.config = data.config;
    }
    this.notifyListeners();
  }

  // ==================== 私有方法 ====================

  /**
   * 获取 LLM 定价
   */
  private getLlmPricing(provider: string, model: string): LlmPricing {
    const key = `${provider}_${model.replace(/[-.:]/g, '_')}`.toLowerCase();

    // 尝试精确匹配
    for (const [k, v] of Object.entries(PROVIDER_PRICING)) {
      if (k.toLowerCase() === key) {
        return v as LlmPricing;
      }
    }

    // 尝试提供商前缀匹配
    for (const [k, v] of Object.entries(PROVIDER_PRICING)) {
      if (k.toLowerCase().startsWith(provider.toLowerCase())) {
        return v as LlmPricing;
      }
    }

    // 默认返回免费定价
    return {
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      isFree: true,
    };
  }

  /**
   * 获取翻译服务定价
   */
  private getTranslationPricing(provider: string): TranslationPricing {
    const key = provider.toLowerCase();

    for (const [k, v] of Object.entries(PROVIDER_PRICING)) {
      if (k.toLowerCase().includes(key)) {
        return v as TranslationPricing;
      }
    }

    // 默认返回免费定价
    return {
      freeCharactersPerMonth: 0,
      pricePerMillionCharacters: 0,
      isFree: true,
    };
  }

  /**
   * 计算 LLM 成本
   */
  private calculateLlmCost(
    pricing: LlmPricing,
    inputTokens: number,
    outputTokens: number
  ): number {
    if (pricing.isFree) return 0;

    const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion;
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion;

    return inputCost + outputCost;
  }

  /**
   * 计算翻译服务成本
   */
  private calculateTranslationCost(
    pricing: TranslationPricing,
    characters: number,
    currentUsage: number
  ): number {
    if (pricing.isFree) return 0;

    const freeRemaining = Math.max(0, pricing.freeCharactersPerMonth - currentUsage);
    const chargeableCharacters = Math.max(0, characters - freeRemaining);

    return (chargeableCharacters / 1_000_000) * pricing.pricePerMillionCharacters;
  }

  /**
   * 获取本月字符使用量
   */
  private getMonthlyCharacterUsage(provider: string): number {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return this.characterRecords
      .filter(r => r.provider === provider && r.timestamp >= monthStart)
      .reduce((sum, r) => sum + r.characters, 0);
  }

  /**
   * 获取提供商显示名称
   */
  private getProviderDisplayName(provider: string): string {
    const names: Record<string, string> = {
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      gemini: 'Google Gemini',
      groq: 'Groq',
      deepseek: 'DeepSeek',
      zhipu: '智谱 AI',
      alibaba: '阿里通义',
      baidu: '百度文心',
      ollama: 'Ollama',
      custom: '自定义 API',
      deepl: 'DeepL',
      google_translate: 'Google Translate',
      youdao: '有道翻译',
    };
    return names[provider] || provider;
  }

  /**
   * 限制存储记录数量
   */
  private limitRecords(): void {
    if (this.tokenRecords.length > this.config.maxStoredRecords) {
      this.tokenRecords = this.tokenRecords.slice(-this.config.maxStoredRecords);
    }
    if (this.characterRecords.length > this.config.maxStoredRecords) {
      this.characterRecords = this.characterRecords.slice(-this.config.maxStoredRecords);
    }
  }

  /**
   * 检查预算警告
   */
  private checkBudgetWarning(record: TokenUsageRecord | CharacterUsageRecord): void {
    if (!this.config.showWarnings || this.config.monthlyBudget <= 0) return;

    const summary = this.getSummary(30);

    // 预算超限警告
    if (summary.totalCost > this.config.monthlyBudget) {
      this.warnings.push({
        id: generateId(),
        type: 'budget_exceeded',
        message: `本月成本 $${summary.totalCost.toFixed(2)} 已超过预算 $${this.config.monthlyBudget}`,
        amount: summary.totalCost,
        timestamp: Date.now(),
        acknowledged: false,
      });
    }
    // 预算警告阈值
    else if (
      (summary.totalCost / this.config.monthlyBudget) * 100 >= this.config.warningThreshold
    ) {
      this.warnings.push({
        id: generateId(),
        type: 'budget_warning',
        message: `本月成本已使用 ${((summary.totalCost / this.config.monthlyBudget) * 100).toFixed(0)}% 预算`,
        amount: summary.totalCost,
        timestamp: Date.now(),
        acknowledged: false,
      });
    }

    // 高成本请求警告（单次超过 $1）
    if (record.estimatedCost > 1) {
      this.warnings.push({
        id: generateId(),
        type: 'high_cost_request',
        message: `单次请求成本较高: $${record.estimatedCost.toFixed(2)}`,
        amount: record.estimatedCost,
        timestamp: Date.now(),
        acknowledged: false,
      });
    }
  }

  /**
   * 通知监听器
   */
  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        logger.error('CostTracker: 监听器执行失败', error);
      }
    }
  }
}

/**
 * 全局成本追踪实例
 */
let globalTracker: CostTracker | null = null;

/**
 * 获取全局成本追踪实例
 */
export function getCostTracker(): CostTracker {
  if (!globalTracker) {
    globalTracker = new CostTracker();
  }
  return globalTracker;
}

/**
 * 初始化成本追踪
 */
export function initCostTracker(config?: Partial<CostTrackerConfig>): CostTracker {
  if (globalTracker) {
    globalTracker.updateConfig(config || {});
  } else {
    globalTracker = new CostTracker(config);
  }
  return globalTracker;
}

/**
 * 记录 Token 使用（便捷函数）
 */
export function recordTokenUsage(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  success?: boolean,
  requestId?: string
): TokenUsageRecord {
  return getCostTracker().recordTokenUsage(provider, model, inputTokens, outputTokens, success, requestId);
}

/**
 * 记录字符使用（便捷函数）
 */
export function recordCharacterUsage(
  provider: string,
  characters: number,
  success?: boolean
): CharacterUsageRecord {
  return getCostTracker().recordCharacterUsage(provider, characters, success);
}

/**
 * 获取成本仪表盘数据（便捷函数）
 */
export function getCostDashboardData(periodDays?: number): CostDashboardData {
  return getCostTracker().getDashboardData(periodDays);
}