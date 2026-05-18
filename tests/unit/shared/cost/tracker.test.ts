/**
 * 成本追踪器测试
 *
 * 测试 CostTracker 类的纯函数逻辑：token 估算、成本计算、摘要、趋势、预算警告
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CostTracker,
  getCostTracker,
  initCostTracker,
  recordTokenUsage,
  recordCharacterUsage,
  getCostDashboardData,
} from '@/shared/cost/tracker';
import { DEFAULT_COST_TRACKER_CONFIG, PROVIDER_PRICING } from '@/shared/cost/types';

// Mock logger to avoid console noise
vi.mock('@/shared/utils', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  generateId: () => `id-${Math.random().toString(36).slice(2, 8)}`,
}));

describe('DEFAULT_COST_TRACKER_CONFIG', () => {
  it('should have default values', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.monthlyBudget).toBe(10);
    expect(DEFAULT_COST_TRACKER_CONFIG.showWarnings).toBe(true);
    expect(DEFAULT_COST_TRACKER_CONFIG.warningThreshold).toBe(80);
    expect(DEFAULT_COST_TRACKER_CONFIG.maxStoredRecords).toBeGreaterThan(0);
  });
});

describe('PROVIDER_PRICING', () => {
  it('should have pricing for known LLM providers', () => {
    expect(PROVIDER_PRICING.openai_gpt_4o_mini).toBeDefined();
    expect(PROVIDER_PRICING.anthropic_claude_3_5_sonnet).toBeDefined();
    expect(PROVIDER_PRICING.gemini_2_0_flash).toBeDefined();
  });

  it('should have pricing for translation providers', () => {
    expect(PROVIDER_PRICING.deepl_free).toBeDefined();
    expect(PROVIDER_PRICING.google_translate).toBeDefined();
    expect(PROVIDER_PRICING.free_google_translate).toBeDefined();
  });
});

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker({ monthlyBudget: 100, showWarnings: true });
  });

  describe('recordTokenUsage', () => {
    it('should return a record with all required fields', () => {
      const record = tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1000, 500);

      expect(record.provider).toBe('openai');
      expect(record.model).toBe('gpt-4o-mini');
      expect(record.inputTokens).toBe(1000);
      expect(record.outputTokens).toBe(500);
      expect(record.success).toBe(true);
      expect(record.id).toBeDefined();
      expect(record.timestamp).toBeDefined();
    });

    it('should calculate cost as 0 for unknown provider (free default)', () => {
      const record = tracker.recordTokenUsage('unknown', 'model', 1_000_000, 1_000_000);

      expect(record.estimatedCost).toBe(0);
    });

    it('should calculate cost using known pricing', () => {
      // gpt-4o-mini: $0.15/1M input, $0.6/1M output
      const record = tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);

      expect(record.estimatedCost).toBeCloseTo(0.15 + 0.6, 6);
    });

    it('should record failed requests', () => {
      const record = tracker.recordTokenUsage('openai', 'gpt-4o-mini', 100, 50, false);

      expect(record.success).toBe(false);
    });

    it('should include requestId when provided', () => {
      const record = tracker.recordTokenUsage('openai', 'gpt-4o-mini', 100, 50, true, 'req-123');

      expect(record.requestId).toBe('req-123');
    });
  });

  describe('recordCharacterUsage', () => {
    it('should return a record with all required fields', () => {
      const record = tracker.recordCharacterUsage('deepl', 10000);

      expect(record.provider).toBe('deepl');
      expect(record.characters).toBe(10000);
      expect(record.success).toBe(true);
      expect(record.withinFreeQuota).toBeDefined();
    });

    it('should be within free quota for small usage', () => {
      const record = tracker.recordCharacterUsage('deepl', 1000);

      expect(record.withinFreeQuota).toBe(true);
      expect(record.estimatedCost).toBe(0);
    });

    it('should calculate cost when exceeding free quota', () => {
      // google_translate has freeCharactersPerMonth: 500000
      const pricing = PROVIDER_PRICING.google_translate as { freeCharactersPerMonth: number; pricePerMillionCharacters: number };
      // Use up free quota first
      tracker.recordCharacterUsage('google_translate', pricing.freeCharactersPerMonth);
      // Now record more - should cost something
      const record = tracker.recordCharacterUsage('google_translate', 1_000_000);
      expect(record.withinFreeQuota).toBe(false);
      expect(record.estimatedCost).toBeGreaterThan(0);
    });

    it('should be free for free providers', () => {
      const record = tracker.recordCharacterUsage('free_google_translate', 1_000_000);

      expect(record.estimatedCost).toBe(0);
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for English text (4 chars per token)', () => {
      const text = 'Hello world this is a test';
      const result = tracker.estimateTokens(text);

      // 26 chars / 4 = 6.5 -> ceil to 7
      expect(result.input).toBeGreaterThan(0);
      expect(result.output).toBe(Math.ceil(result.input * 0.5));
    });

    it('should estimate tokens for Chinese text (1.5 chars per token)', () => {
      const text = '你好世界测试文本';
      const result = tracker.estimateTokens(text);

      // 8 chars / 1.5 = 5.33 -> ceil to 6
      expect(result.input).toBeGreaterThan(0);
      expect(result.output).toBeLessThan(result.input);
    });

    it('should estimate more tokens for longer text', () => {
      const short = tracker.estimateTokens('Hi');
      const long = tracker.estimateTokens('This is a much longer piece of text with many words');

      expect(long.input).toBeGreaterThan(short.input);
      expect(long.output).toBeGreaterThan(short.output);
    });
  });

  describe('getSummary', () => {
    it('should return zero summary with no data', () => {
      const summary = tracker.getSummary(30);

      expect(summary.totalCost).toBe(0);
      expect(summary.llmCost).toBe(0);
      expect(summary.translationCost).toBe(0);
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalOutputTokens).toBe(0);
      expect(summary.totalCharacters).toBe(0);
      expect(summary.successRequests).toBe(0);
      expect(summary.failedRequests).toBe(0);
    });

    it('should summarize token usage correctly', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1000, 500);
      tracker.recordTokenUsage('anthropic', 'claude-3-haiku', 2000, 1000);

      const summary = tracker.getSummary(30);

      expect(summary.totalInputTokens).toBe(3000);
      expect(summary.totalOutputTokens).toBe(1500);
      expect(summary.successRequests).toBe(2);
    });

    it('should summarize character usage correctly', () => {
      tracker.recordCharacterUsage('deepl', 10000);
      tracker.recordCharacterUsage('deepl', 5000);

      const summary = tracker.getSummary(30);

      expect(summary.totalCharacters).toBe(15000);
      expect(summary.translationCost).toBe(0); // within free quota
    });

    it('should combine LLM and translation costs', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);
      tracker.recordCharacterUsage('deepl', 1000);

      const summary = tracker.getSummary(30);

      expect(summary.totalCost).toBeGreaterThan(0);
      expect(summary.llmCost).toBeGreaterThan(0);
    });

    it('should count failed requests separately', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 100, 50, false);
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 200, 100, true);

      const summary = tracker.getSummary(30);

      expect(summary.successRequests).toBe(1);
      expect(summary.failedRequests).toBe(1);
    });
  });

  describe('getProviderDetails', () => {
    it('should return details grouped by provider', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1000, 500);
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 2000, 1000);
      tracker.recordTokenUsage('anthropic', 'claude-3-haiku', 500, 250);

      const details = tracker.getProviderDetails(30);

      expect(details.length).toBe(2);
      const openaiDetail = details.find(d => d.provider === 'openai');
      expect(openaiDetail).toBeDefined();
      expect(openaiDetail!.requestCount).toBe(2);
    });

    it('should separate LLM and translation categories', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1000, 500);
      tracker.recordCharacterUsage('deepl', 10000);

      const details = tracker.getProviderDetails(30);

      expect(details.length).toBe(2);
      const llmDetail = details.find(d => d.category === 'llm');
      const transDetail = details.find(d => d.category === 'translation');
      expect(llmDetail).toBeDefined();
      expect(transDetail).toBeDefined();
    });

    it('should sort by total cost descending', () => {
      // Anthropic is more expensive per token than OpenAI
      tracker.recordTokenUsage('anthropic', 'claude-3-opus', 1_000_000, 1_000_000);
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);

      const details = tracker.getProviderDetails(30);

      expect(details[0].totalCost).toBeGreaterThanOrEqual(details[1].totalCost);
    });

    it('should return empty array with no data', () => {
      const details = tracker.getProviderDetails(30);

      expect(details).toEqual([]);
    });
  });

  describe('getBudgetStatus', () => {
    it('should show zero usage initially', () => {
      const status = tracker.getBudgetStatus();

      expect(status.monthlyBudget).toBe(100);
      expect(status.used).toBe(0);
      expect(status.remaining).toBe(100);
      expect(status.usagePercent).toBe(0);
      expect(status.isOverBudget).toBe(false);
    });

    it('should show usage after recording', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);

      const status = tracker.getBudgetStatus();

      expect(status.used).toBeGreaterThan(0);
      expect(status.remaining).toBeLessThan(100);
      expect(status.usagePercent).toBeGreaterThan(0);
    });

    it('should show over budget when cost exceeds limit', () => {
      const smallBudget = new CostTracker({ monthlyBudget: 0.01, showWarnings: false });
      smallBudget.recordTokenUsage('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);

      const status = smallBudget.getBudgetStatus();

      expect(status.isOverBudget).toBe(true);
      expect(status.remaining).toBe(0);
    });

    it('should calculate projected end of month', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1_000_000, 1_000_000);

      const status = tracker.getBudgetStatus();

      expect(status.projectedEndOfMonth).toBeGreaterThanOrEqual(status.used);
    });
  });

  describe('getActiveWarnings', () => {
    it('should return no warnings initially', () => {
      const warnings = tracker.getActiveWarnings();

      expect(warnings).toHaveLength(0);
    });

    it('should generate budget exceeded warning when over limit', () => {
      const smallBudget = new CostTracker({ monthlyBudget: 0.001, showWarnings: true });
      smallBudget.recordTokenUsage('openai', 'gpt-4o-mini', 10_000_000, 10_000_000);

      const warnings = smallBudget.getActiveWarnings();

      const budgetWarnings = warnings.filter(w => w.type === 'budget_exceeded');
      expect(budgetWarnings.length).toBeGreaterThan(0);
    });
  });

  describe('acknowledgeWarning', () => {
    it('should return false for non-existent warning', () => {
      expect(tracker.acknowledgeWarning('non-existent')).toBe(false);
    });

    it('should mark warning as acknowledged', () => {
      const smallBudget = new CostTracker({ monthlyBudget: 0.001, showWarnings: true });
      smallBudget.recordTokenUsage('openai', 'gpt-4o-mini', 10_000_000, 10_000_000);

      const warnings = smallBudget.getActiveWarnings();
      expect(warnings.length).toBeGreaterThan(0);

      const result = smallBudget.acknowledgeWarning(warnings[0].id);
      expect(result).toBe(true);

      const activeAfter = smallBudget.getActiveWarnings();
      expect(activeAfter.length).toBeLessThan(warnings.length);
    });
  });

  describe('updateConfig / getConfig', () => {
    it('should merge config updates', () => {
      tracker.updateConfig({ monthlyBudget: 200 });

      const config = tracker.getConfig();
      expect(config.monthlyBudget).toBe(200);
      // Other values should remain
      expect(config.showWarnings).toBe(true);
    });

    it('should return a copy of config', () => {
      const config1 = tracker.getConfig();
      config1.monthlyBudget = 999;

      const config2 = tracker.getConfig();
      expect(config2.monthlyBudget).toBe(100);
    });
  });

  describe('addListener', () => {
    it('should call listener when data changes', () => {
      let callCount = 0;
      tracker.addListener(() => { callCount++; });

      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 100, 50);

      expect(callCount).toBeGreaterThan(0);
    });

    it('should remove listener when unsubscribe function is called', () => {
      let callCount = 0;
      const unsubscribe = tracker.addListener(() => { callCount++; });

      unsubscribe();
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 100, 50);

      expect(callCount).toBe(0);
    });

    it('should handle listener errors without crashing', () => {
      tracker.addListener(() => { throw new Error('boom'); });

      expect(() => {
        tracker.recordTokenUsage('openai', 'gpt-4o-mini', 100, 50);
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should reset all data', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1000, 500);
      tracker.recordCharacterUsage('deepl', 10000);
      tracker.clear();

      const summary = tracker.getSummary(30);
      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalCharacters).toBe(0);
      expect(tracker.getActiveWarnings()).toHaveLength(0);
    });
  });

  describe('exportData / importData', () => {
    it('should export all data correctly', () => {
      tracker.recordTokenUsage('openai', 'gpt-4o-mini', 1000, 500);
      tracker.recordCharacterUsage('deepl', 5000);

      const data = tracker.exportData();

      expect(data.tokenRecords.length).toBe(1);
      expect(data.characterRecords.length).toBe(1);
      expect(data.config).toBeDefined();
    });

    it('should import data correctly', () => {
      const original = tracker.exportData();
      const newTracker = new CostTracker();

      newTracker.importData(original);

      const imported = newTracker.exportData();
      expect(imported.tokenRecords.length).toBe(original.tokenRecords.length);
      expect(imported.characterRecords.length).toBe(original.characterRecords.length);
    });
  });

  describe('getCostTrend', () => {
    it('should return trend points for specified period', () => {
      const trend = tracker.getCostTrend(7);

      expect(trend.length).toBe(7);
      trend.forEach(point => {
        expect(point.date).toBeDefined();
        expect(point.cost).toBeDefined();
        expect(point.requestCount).toBeDefined();
      });
    });

    it('should have zero costs when no data recorded', () => {
      const trend = tracker.getCostTrend(30);

      trend.forEach(point => {
        expect(point.cost).toBe(0);
        expect(point.requestCount).toBe(0);
      });
    });
  });

  describe('record limit enforcement', () => {
    it('should limit stored records to maxStoredRecords', () => {
      const limited = new CostTracker({ maxStoredRecords: 5 });

      for (let i = 0; i < 10; i++) {
        limited.recordTokenUsage('openai', 'gpt-4o-mini', i * 100, i * 50);
      }

      const summary = limited.getSummary(365); // long period to include all
      // Should only have last 5 records
      expect(summary.successRequests).toBe(5);
    });
  });
});

describe('getCostTracker', () => {
  it('should return the same instance (singleton)', () => {
    const a = getCostTracker();
    const b = getCostTracker();

    expect(a).toBe(b);
  });
});

describe('initCostTracker', () => {
  it('should create a new instance if none exists', () => {
    // Force reset by clearing global
    const instance = initCostTracker({ monthlyBudget: 50 });
    expect(instance.getConfig().monthlyBudget).toBe(50);
  });

  it('should update existing instance config', () => {
    const first = initCostTracker({ monthlyBudget: 30 });
    const second = initCostTracker({ monthlyBudget: 75 });

    // Same instance, config should be updated
    expect(first).toBe(second);
    expect(second.getConfig().monthlyBudget).toBe(75);
  });
});

describe('Convenience functions', () => {
  it('recordTokenUsage should delegate to global tracker', () => {
    initCostTracker({ monthlyBudget: 1000 });
    const record = recordTokenUsage('openai', 'gpt-4o-mini', 500, 250);

    expect(record.provider).toBe('openai');
    expect(record.inputTokens).toBe(500);
  });

  it('recordCharacterUsage should delegate to global tracker', () => {
    initCostTracker({ monthlyBudget: 1000 });
    const record = recordCharacterUsage('deepl', 5000);

    expect(record.provider).toBe('deepl');
    expect(record.characters).toBe(5000);
  });

  it('getCostDashboardData should return dashboard data', () => {
    initCostTracker({ monthlyBudget: 1000 });
    const data = getCostDashboardData(7);

    expect(data.periodDays).toBe(7);
    expect(data.summary).toBeDefined();
    expect(data.providerDetails).toBeDefined();
    expect(data.costTrend).toBeDefined();
    expect(data.budget).toBeDefined();
  });
});
