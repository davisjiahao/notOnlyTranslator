/**
 * 成本类型和定价配置测试
 */
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_PRICING,
  DEFAULT_COST_TRACKER_CONFIG,
} from '@/shared/cost/types';
import type { LlmPricing, TranslationPricing } from '@/shared/cost/types';

function isLlmPricing(p: LlmPricing | TranslationPricing): p is LlmPricing {
  return 'inputPricePerMillion' in p;
}

function isTranslationPricing(p: LlmPricing | TranslationPricing): p is TranslationPricing {
  return 'freeCharactersPerMonth' in p;
}

describe('PROVIDER_PRICING', () => {
  it('should have pricing for all known LLM providers', () => {
    const llmProviders = [
      'openai_gpt_4o_mini', 'openai_gpt_4o', 'openai_gpt_4_turbo',
      'openai_gpt_3_5_turbo', 'anthropic_claude_3_5_haiku',
      'anthropic_claude_3_5_sonnet', 'anthropic_claude_3_opus',
      'gemini_2_0_flash', 'gemini_1_5_flash', 'gemini_1_5_pro',
      'groq_llama_3_3_70b', 'deepseek_chat', 'zhipu_glm_4_flash',
      'alibaba_qwen_turbo', 'baidu_ernie_speed', 'ollama', 'custom'
    ];
    for (const provider of llmProviders) {
      expect(PROVIDER_PRICING).toHaveProperty(provider);
    }
  });

  it('should have pricing for all known translation services', () => {
    const translationProviders = [
      'deepl_free', 'deepl_pro', 'google_translate',
      'free_google_translate', 'youdao_standard'
    ];
    for (const provider of translationProviders) {
      expect(PROVIDER_PRICING).toHaveProperty(provider);
    }
  });

  it('LLM pricing should have non-negative prices', () => {
    for (const [key, pricing] of Object.entries(PROVIDER_PRICING)) {
      if (isLlmPricing(pricing)) {
        expect(pricing.inputPricePerMillion).toBeGreaterThanOrEqual(0);
        expect(pricing.outputPricePerMillion).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('Translation pricing should have non-negative prices', () => {
    for (const pricing of Object.values(PROVIDER_PRICING)) {
      if (isTranslationPricing(pricing)) {
        expect(pricing.freeCharactersPerMonth).toBeGreaterThanOrEqual(0);
        expect(pricing.pricePerMillionCharacters).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('free providers should have isFree true', () => {
    const freeProviders = ['baidu_ernie_speed', 'ollama', 'custom', 'deepl_free', 'free_google_translate', 'youdao_standard'];
    for (const provider of freeProviders) {
      const pricing = PROVIDER_PRICING[provider];
      expect(pricing).toHaveProperty('isFree', true);
    }
  });

  it('paid providers should have positive input/output prices', () => {
    const paidLlmProviders = ['openai_gpt_4o_mini', 'openai_gpt_4o', 'anthropic_claude_3_5_sonnet'];
    for (const provider of paidLlmProviders) {
      const pricing = PROVIDER_PRICING[provider] as LlmPricing;
      expect(pricing.inputPricePerMillion).toBeGreaterThan(0);
      expect(pricing.outputPricePerMillion).toBeGreaterThan(0);
    }
  });

  it('deepl_pro should have a price per million characters', () => {
    const deeplPro = PROVIDER_PRICING.deepl_pro as TranslationPricing;
    expect(deeplPro.freeCharactersPerMonth).toBe(0);
    expect(deeplPro.pricePerMillionCharacters).toBe(25);
  });

  it('output price should be >= input price for LLM providers', () => {
    for (const [key, pricing] of Object.entries(PROVIDER_PRICING)) {
      if (isLlmPricing(pricing) && !pricing.isFree) {
        expect(pricing.outputPricePerMillion).toBeGreaterThanOrEqual(pricing.inputPricePerMillion);
      }
    }
  });

  it('should have at least 20 pricing entries', () => {
    expect(Object.keys(PROVIDER_PRICING).length).toBeGreaterThanOrEqual(20);
  });

  it('OpenAI GPT-4o-mini should be cheapest LLM for input', () => {
    const gpt4oMini = PROVIDER_PRICING.openai_gpt_4o_mini as LlmPricing;
    expect(gpt4oMini.inputPricePerMillion).toBe(0.15);
    expect(gpt4oMini.outputPricePerMillion).toBe(0.6);
  });

  it('Anthropic Claude 3 Opus should be most expensive LLM', () => {
    const opus = PROVIDER_PRICING.anthropic_claude_3_opus as LlmPricing;
    expect(opus.inputPricePerMillion).toBe(15);
    expect(opus.outputPricePerMillion).toBe(75);
  });
});

describe('DEFAULT_COST_TRACKER_CONFIG', () => {
  it('should have enabled true', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.enabled).toBe(true);
  });

  it('should have monthlyBudget of $10', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.monthlyBudget).toBe(10);
  });

  it('should have maxStoredRecords of 10000', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.maxStoredRecords).toBe(10000);
  });

  it('should have showWarnings true', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.showWarnings).toBe(true);
  });

  it('should have warningThreshold of 80%', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.warningThreshold).toBe(80);
  });

  it('all numeric values should be positive', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.monthlyBudget).toBeGreaterThan(0);
    expect(DEFAULT_COST_TRACKER_CONFIG.maxStoredRecords).toBeGreaterThan(0);
    expect(DEFAULT_COST_TRACKER_CONFIG.warningThreshold).toBeGreaterThan(0);
  });

  it('warningThreshold should be between 0 and 100', () => {
    expect(DEFAULT_COST_TRACKER_CONFIG.warningThreshold).toBeGreaterThan(0);
    expect(DEFAULT_COST_TRACKER_CONFIG.warningThreshold).toBeLessThanOrEqual(100);
  });
});
