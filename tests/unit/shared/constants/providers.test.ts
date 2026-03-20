/**
 * Provider 配置测试
 *
 * 测试翻译提供商配置相关的工具函数
 */
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_CONFIGS,
  PROVIDER_GROUPS,
  getProviderConfig,
  getRecommendedModel,
  requiresSecondaryKey,
  getChatEndpoint,
} from '@/shared/constants/providers';
import type { ApiProvider } from '@/shared/types';

describe('PROVIDER_CONFIGS', () => {
  it('应该包含所有必需的供应商', () => {
    const expectedProviders: ApiProvider[] = [
      'openai',
      'anthropic',
      'gemini',
      'groq',
      'deepseek',
      'zhipu',
      'alibaba',
      'baidu',
      'ollama',
      'custom',
      'deepl',
      'google_translate',
    ];

    expectedProviders.forEach(provider => {
      expect(PROVIDER_CONFIGS[provider]).toBeDefined();
    });
  });

  it('每个供应商配置应该有必需的字段', () => {
    Object.entries(PROVIDER_CONFIGS).forEach(([provider, config]) => {
      expect(config.id).toBe(provider);
      expect(config.name).toBeDefined();
      expect(config.apiFormat).toBeDefined();
      expect(config.defaultModels).toBeInstanceOf(Array);
      expect(config.defaultModels.length).toBeGreaterThan(0);
    });
  });

  it('OpenAI 应该有正确的默认模型', () => {
    const openai = PROVIDER_CONFIGS.openai;
    expect(openai.defaultModels.map(m => m.id)).toContain('gpt-4o-mini');
    expect(openai.recommendedModel).toBe('gpt-4o-mini');
  });

  it('DeepSeek 应该标记为国内供应商', () => {
    expect(PROVIDER_CONFIGS.deepseek.region).toBe('domestic');
  });

  it('Anthropic 不应该支持 models API', () => {
    expect(PROVIDER_CONFIGS.anthropic.modelsSupported).toBe(false);
  });
});

describe('PROVIDER_GROUPS', () => {
  it('应该有正确的分组结构', () => {
    expect(PROVIDER_GROUPS).toBeInstanceOf(Array);
    expect(PROVIDER_GROUPS.length).toBeGreaterThan(0);
  });

  it('每个分组应该有 label 和 providers', () => {
    PROVIDER_GROUPS.forEach(group => {
      expect(group.label).toBeDefined();
      expect(group.providers).toBeInstanceOf(Array);
    });
  });

  it('应该包含国内供应商分组', () => {
    const domesticGroup = PROVIDER_GROUPS.find(g => g.label === '国内供应商');
    expect(domesticGroup).toBeDefined();
    expect(domesticGroup!.providers).toContain('deepseek');
    expect(domesticGroup!.providers).toContain('zhipu');
  });
});

describe('getProviderConfig', () => {
  it('应该返回正确的供应商配置', () => {
    const openaiConfig = getProviderConfig('openai');
    expect(openaiConfig.id).toBe('openai');
    expect(openaiConfig.name).toBe('OpenAI');
  });

  it('应该返回 DeepSeek 配置', () => {
    const deepseekConfig = getProviderConfig('deepseek');
    expect(deepseekConfig.id).toBe('deepseek');
    expect(deepseekConfig.region).toBe('domestic');
  });
});

describe('getRecommendedModel', () => {
  it('应该返回 OpenAI 的推荐模型', () => {
    const model = getRecommendedModel('openai');
    expect(model.id).toBe('gpt-4o-mini');
    expect(model.isRecommended).toBe(true);
  });

  it('应该返回第一个模型当没有推荐模型时', () => {
    // 即使没有推荐标记，也应该返回一个有效的模型
    const model = getRecommendedModel('custom');
    expect(model).toBeDefined();
    expect(model.id).toBeDefined();
  });
});

describe('requiresSecondaryKey', () => {
  it('百度应该需要二次密钥', () => {
    expect(requiresSecondaryKey('baidu')).toBe(true);
  });

  it('其他供应商不应该需要二次密钥', () => {
    expect(requiresSecondaryKey('openai')).toBe(false);
    expect(requiresSecondaryKey('deepseek')).toBe(false);
    expect(requiresSecondaryKey('anthropic')).toBe(false);
  });
});

describe('getChatEndpoint', () => {
  it('应该返回 OpenAI 的 chat 端点', () => {
    const endpoint = getChatEndpoint('openai', 'gpt-4o-mini');
    expect(endpoint).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('应该返回自定义 URL 当提供时', () => {
    const customUrl = 'https://custom.api.com/chat';
    const endpoint = getChatEndpoint('openai', 'gpt-4o-mini', customUrl);
    expect(endpoint).toBe(customUrl);
  });

  it('应该为 Gemini 替换模型名', () => {
    const endpoint = getChatEndpoint('gemini', 'gemini-2.0-flash');
    expect(endpoint).toContain('gemini-2.0-flash');
    expect(endpoint).toContain('generateContent');
  });

  it('应该为百度替换模型名', () => {
    const endpoint = getChatEndpoint('baidu', 'ernie-4.0');
    expect(endpoint).toContain('ernie-4.0');
  });
});