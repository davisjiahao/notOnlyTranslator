/**
 * modelService 测试
 *
 * 覆盖 getModels 和 testConnection 的各供应商分支
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getModels, testConnection } from '@/shared/services/modelService';
import type { ApiProvider, ModelInfo } from '@/shared/types';

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock provider configs
vi.mock('@/shared/constants/providers', () => ({
  getProviderConfig: vi.fn((provider: ApiProvider) => {
    const configs: Record<ApiProvider, ReturnType<typeof vi.fn>> = {
      openai: {
        id: 'openai', name: 'OpenAI', modelsSupported: true,
        modelsEndpoint: 'https://api.openai.com/v1/models',
        chatEndpoint: 'https://api.openai.com/v1/chat/completions',
        recommendedModel: 'gpt-4o-mini',
        defaultModels: [
          { id: 'gpt-4o-mini', name: 'GPT-4o Mini', isRecommended: true },
        ],
      },
      anthropic: {
        id: 'anthropic', name: 'Anthropic', modelsSupported: false,
        chatEndpoint: 'https://api.anthropic.com/v1/messages',
        recommendedModel: 'claude-3-5-haiku-latest',
        defaultModels: [
          { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku', isRecommended: true },
        ],
      },
      gemini: {
        id: 'gemini', name: 'Google Gemini', modelsSupported: true,
        modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
        chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
        recommendedModel: 'gemini-2.0-flash',
        defaultModels: [
          { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', isRecommended: true },
        ],
      },
      ollama: {
        id: 'ollama', name: 'Ollama', modelsSupported: true,
        modelsEndpoint: 'http://localhost:11434/api/tags',
        chatEndpoint: 'http://localhost:11434/v1/chat/completions',
        recommendedModel: 'llama3',
        defaultModels: [
          { id: 'llama3', name: 'Llama 3', isRecommended: true },
        ],
      },
      custom: {
        id: 'custom', name: 'Custom', modelsSupported: true,
        chatEndpoint: 'https://custom.com/v1/chat/completions',
        recommendedModel: 'custom-model',
        defaultModels: [
          { id: 'custom-model', name: 'Custom Model', isRecommended: true },
        ],
      },
      baidu: {
        id: 'baidu', name: '百度文心', modelsSupported: false,
        chatEndpoint: 'https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/{model}',
        recommendedModel: 'ernie-bot',
        defaultModels: [
          { id: 'ernie-bot', name: 'ERNIE Bot', isRecommended: true },
        ],
      },
      deepl: {
        id: 'deepl', name: 'DeepL', modelsSupported: false,
        chatEndpoint: 'https://api-free.deepl.com/v2/translate',
        recommendedModel: 'deepl',
        defaultModels: [
          { id: 'deepl', name: 'DeepL', isRecommended: true },
        ],
      },
      google_translate: {
        id: 'google_translate', name: 'Google Translate', modelsSupported: false,
        chatEndpoint: 'https://translation.googleapis.com/language/translate/v2',
        recommendedModel: 'google',
        defaultModels: [
          { id: 'google', name: 'Google Translate', isRecommended: true },
        ],
      },
      alibaba: {
        id: 'alibaba', name: '阿里通义', modelsSupported: false,
        chatEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        recommendedModel: 'qwen-turbo',
        defaultModels: [
          { id: 'qwen-turbo', name: 'Qwen Turbo', isRecommended: true },
        ],
      },
      groq: {
        id: 'groq', name: 'Groq', modelsSupported: true,
        modelsEndpoint: 'https://api.groq.com/openai/v1/models',
        chatEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
        recommendedModel: 'llama-3.1-8b',
        defaultModels: [
          { id: 'llama-3.1-8b', name: 'Llama 3.1 8B', isRecommended: true },
        ],
      },
      deepseek: {
        id: 'deepseek', name: 'DeepSeek', modelsSupported: false,
        chatEndpoint: 'https://api.deepseek.com/v1/chat/completions',
        recommendedModel: 'deepseek-chat',
        defaultModels: [
          { id: 'deepseek-chat', name: 'DeepSeek Chat', isRecommended: true },
        ],
      },
      zhipu: {
        id: 'zhipu', name: '智谱', modelsSupported: false,
        chatEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        recommendedModel: 'glm-4',
        defaultModels: [
          { id: 'glm-4', name: 'GLM-4', isRecommended: true },
        ],
      },
      youdao: {
        id: 'youdao', name: '有道', modelsSupported: false,
        chatEndpoint: 'https://openapi.youdao.com/api',
        recommendedModel: 'youdao',
        defaultModels: [
          { id: 'youdao', name: '有道翻译', isRecommended: true },
        ],
      },
      free_google_translate: {
        id: 'free_google_translate', name: 'Free Google Translate', modelsSupported: false,
        chatEndpoint: 'https://translate.googleapis.com/translate_a/single',
        recommendedModel: 'free',
        defaultModels: [
          { id: 'free', name: 'Free Translate', isRecommended: true },
        ],
      },
    };
    return configs[provider] || configs.openai;
  }),
  requiresSecondaryKey: vi.fn((provider: ApiProvider) => provider === 'baidu'),
}));

describe('getModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('不支持模型查询的供应商返回预定义列表', async () => {
    const models = await getModels('anthropic', 'test-key');
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('claude-3-5-haiku-latest');
  });

  it('自定义供应商无端点时返回预定义列表', async () => {
    const models = await getModels('custom', 'test-key');
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('custom-model');
  });

  it('无 API Key 时返回预定义列表（除 Ollama 外）', async () => {
    const models = await getModels('openai', '');
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gpt-4o-mini');
  });

  it('OpenAI 格式响应解析正确', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { id: 'gpt-4o', name: 'GPT-4o' },
          { id: 'text-embedding-3-small' },
          { id: 'gpt-4o-mini' },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const models = await getModels('openai', 'sk-test');

    expect(models.length).toBe(2); // 过滤掉 embedding 模型
    expect(models.some(m => m.id === 'gpt-4o')).toBe(true);
    expect(models.some(m => m.id === 'gpt-4o-mini')).toBe(true);
    expect(models.some(m => m.id === 'text-embedding-3-small')).toBe(false);

    vi.unstubAllGlobals();
  });

  it('Gemini 格式响应解析正确', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash' },
          { name: 'models/gemini-1.5-pro' },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const models = await getModels('gemini', 'AIza-test');

    expect(models.length).toBe(2);
    expect(models[0].id).toBe('gemini-2.0-flash');
    expect(models[0].name).toBe('Gemini 2.0 Flash');

    vi.unstubAllGlobals();
  });

  it('Ollama 格式响应解析正确', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { name: 'llama3', size: 4661220176 },
          { name: 'qwen:7b', size: 38267905 },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const models = await getModels('ollama', '');

    expect(models.length).toBe(2);
    expect(models[0].id).toBe('llama3');
    expect(models[0].description).toContain('GB');

    vi.unstubAllGlobals();
  });

  it('fetch 失败时回退到预定义列表', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network error'));
    vi.stubGlobal('fetch', mockFetch);

    const models = await getModels('openai', 'sk-test');

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gpt-4o-mini');

    vi.unstubAllGlobals();
  });

  it('HTTP 错误时回退到预定义列表', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });
    vi.stubGlobal('fetch', mockFetch);

    const models = await getModels('openai', 'sk-test');

    expect(models).toHaveLength(1);

    vi.unstubAllGlobals();
  });

  it('返回空数据时回退到预定义列表', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const models = await getModels('openai', 'sk-test');

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe('gpt-4o-mini');

    vi.unstubAllGlobals();
  });

  it('自定义端点推断 models URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ id: 'custom-model' }] }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await getModels('custom', 'test-key', 'https://custom.com/v1/chat/completions');

    const callUrl = mockFetch.mock.calls[0][0];
    expect(callUrl).toBe('https://custom.com/v1/models');

    vi.unstubAllGlobals();
  });

  it('返回模型限制最多 20 个', async () => {
    const manyModels = Array.from({ length: 30 }, (_, i) => ({ id: `model-${i}` }));
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: manyModels }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const models = await getModels('openai', 'sk-test');

    expect(models.length).toBeLessThanOrEqual(20);

    vi.unstubAllGlobals();
  });
});

describe('testConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('无 API Key 时返回失败（Ollama 除外）', async () => {
    const result = await testConnection('openai', '');
    expect(result.success).toBe(false);
    expect(result.error).toContain('API Key');
  });

  it('百度无 Secret Key 时返回失败', async () => {
    const result = await testConnection('baidu', 'api-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Secret Key');
  });

  it('自定义供应商无端点时返回失败', async () => {
    const result = await testConnection('custom', 'test-key');
    expect(result.success).toBe(false);
    expect(result.error).toContain('端点');
  });

  it('OpenAI 连接成功', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('openai', 'sk-test', 'gpt-4o-mini');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalled();

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer sk-test');

    vi.unstubAllGlobals();
  });

  it('Anthropic 连接成功', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('anthropic', 'sk-ant-test', 'claude-3-5-haiku-latest');

    expect(result.success).toBe(true);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['x-api-key']).toBe('sk-ant-test');
    expect(options.headers['anthropic-version']).toBe('2023-06-01');

    vi.unstubAllGlobals();
  });

  it('Gemini 连接成功', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('gemini', 'AIza-test', 'gemini-2.0-flash');

    expect(result.success).toBe(true);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('key=AIza-test');

    vi.unstubAllGlobals();
  });

  it('API 返回错误时返回失败信息', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: { message: 'Invalid API key' } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('openai', 'sk-invalid', 'gpt-4o-mini');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid API key');

    vi.unstubAllGlobals();
  });

  it('API 返回非 JSON 错误时返回状态码', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('openai', 'sk-test', 'gpt-4o-mini');

    expect(result.success).toBe(false);
    expect(result.error).toContain('500');

    vi.unstubAllGlobals();
  });

  it('Ollama 不需要 API Key', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('ollama', '', 'llama3');

    expect(result.success).toBe(true);

    vi.unstubAllGlobals();
  });

  it('百度连接成功', async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'token123' }),
      })
      .mockResolvedValueOnce({
        ok: true,
      });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('baidu', 'api-key', 'ernie-bot', undefined, 'secret-key');

    expect(result.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it('百度获取 token 失败', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('baidu', 'api-key', 'ernie-bot', undefined, 'secret-key');

    expect(result.success).toBe(false);
    expect(result.error).toContain('access token');

    vi.unstubAllGlobals();
  });

  it('百度 token 响应无 access_token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'invalid_client' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('baidu', 'api-key', 'ernie-bot', undefined, 'secret-key');

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid_client');

    vi.unstubAllGlobals();
  });

  it('DeepL 连接成功', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('deepl', 'deepl-key');

    expect(result.success).toBe(true);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toContain('DeepL-Auth-Key');

    vi.unstubAllGlobals();
  });

  it('Google Translate 连接成功', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('google_translate', 'google-key');

    expect(result.success).toBe(true);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('key=google-key');

    vi.unstubAllGlobals();
  });

  it('fetch 异常时返回错误信息', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'));
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('openai', 'sk-test', 'gpt-4o-mini');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Network timeout');

    vi.unstubAllGlobals();
  });

  it('使用默认模型名测试', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('openai', 'sk-test');

    expect(result.success).toBe(true);

    const [, options] = mockFetch.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4o-mini'); // 默认推荐模型

    vi.unstubAllGlobals();
  });

  it('阿里通义使用 Bearer token', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await testConnection('alibaba', 'ali-key', 'qwen-turbo');

    expect(result.success).toBe(true);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer ali-key');

    vi.unstubAllGlobals();
  });
});
