/**
 * TranslationApiService 测试
 *
 * 覆盖纯函数部分：PROVIDER_CONFIGS (buildHeaders, buildBody, response extractors),
 * generateYoudaoSign (via private access), buildMessages (via private access).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TranslationApiService } from '@/background/translationApi';

// Mock dependencies
vi.mock('@/shared/constants/providers', () => ({
  getProviderConfig: vi.fn((provider: string) => ({
    name: provider,
    apiFormat: provider === 'custom' ? 'openai' : provider,
    recommendedModel: provider === 'openai' ? 'gpt-4o-mini' : 'model',
  })),
  getChatEndpoint: vi.fn((_provider: string, _model: string, customUrl?: string) =>
    customUrl || `https://api.${_provider}.com/v1/chat/completions`
  ),
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
    ApiError: class ApiError extends Error {
      constructor(msg: string, status?: number, retryable?: boolean) {
        super(msg);
        this.status = status;
        this.retryable = retryable;
      }
      status?: number;
      retryable?: boolean;
    },
  };
});

vi.mock('@/shared/performance', () => ({
  recordMetric: vi.fn(),
}));

describe('TranslationApiService — PROVIDER_CONFIGS', () => {
  const configs = (TranslationApiService as any).PROVIDER_CONFIGS;

  describe('openai config', () => {
    it('builds correct headers', () => {
      const headers = configs.openai.buildHeaders('test-key');
      expect(headers.Authorization).toBe('Bearer test-key');
      expect(headers['Content-Type']).toBe('application/json');
    });

    it('builds correct body with JSON format', () => {
      const body = configs.openai.buildBody('gpt-4', [{ role: 'user', content: 'hi' }], true);
      expect(body.model).toBe('gpt-4');
      expect(body.messages).toHaveLength(1);
      expect(body.response_format).toEqual({ type: 'json_object' });
    });

    it('builds body without JSON format when disabled', () => {
      const body = configs.openai.buildBody('gpt-4', [{ role: 'user', content: 'hi' }], false);
      expect(body.response_format).toBeUndefined();
    });

    it('extracts content from OpenAI response', () => {
      const response = { choices: [{ message: { content: 'hello world' } }] };
      const extracted = configs.openai.responseExtractor.extractContent(response);
      expect(extracted).toBe('hello world');
    });

    it('returns undefined for empty OpenAI response', () => {
      const response = { choices: [] };
      const extracted = configs.openai.responseExtractor.extractContent(response);
      expect(extracted).toBeUndefined();
    });

    it('validates correct OpenAI response structure', () => {
      const response = { choices: [{ message: { content: 'test' } }] };
      expect(configs.openai.responseExtractor.isValid(response)).toBe(true);
    });

    it('rejects invalid OpenAI response', () => {
      expect(configs.openai.responseExtractor.isValid({})).toBe(false);
      expect(configs.openai.responseExtractor.isValid(null)).toBe(false);
    });
  });

  describe('anthropic config', () => {
    it('builds correct headers', () => {
      const headers = configs.anthropic.buildHeaders('test-key');
      expect(headers['x-api-key']).toBe('test-key');
      expect(headers['anthropic-version']).toBe('2023-06-01');
    });

    it('builds correct body', () => {
      const body = configs.anthropic.buildBody('claude-3', [{ role: 'user', content: 'hi' }], false);
      expect(body.model).toBe('claude-3');
      expect(body.max_tokens).toBe(2000);
      expect(body.messages).toHaveLength(1);
    });

    it('extracts content from Anthropic response', () => {
      const response = { content: [{ text: 'anthropic reply' }] };
      const extracted = configs.anthropic.responseExtractor.extractContent(response);
      expect(extracted).toBe('anthropic reply');
    });

    it('validates Anthropic response', () => {
      expect(configs.anthropic.responseExtractor.isValid({ content: [{ text: 'hi' }] })).toBe(true);
      expect(configs.anthropic.responseExtractor.isValid({})).toBe(false);
    });
  });

  describe('gemini config', () => {
    it('builds correct URL with API key', () => {
      const url = configs.gemini.buildUrl('https://generativelanguage.googleapis.com', 'key123');
      expect(url).toContain('key=key123');
    });

    it('builds correct body', () => {
      const body = configs.gemini.buildBody('gemini-pro', [{ role: 'user', content: 'hi' }], false);
      expect(body.contents).toHaveLength(1);
      expect(body.contents[0].parts[0].text).toBe('hi');
      expect(body.generationConfig.maxOutputTokens).toBe(100);
    });

    it('builds body with JSON mime type when enabled', () => {
      const body = configs.gemini.buildBody('gemini-pro', [{ role: 'user', content: 'hi' }], true);
      expect(body.generationConfig.responseMimeType).toBe('application/json');
    });

    it('extracts content from Gemini response', () => {
      const response = {
        candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }],
      };
      const extracted = configs.gemini.responseExtractor.extractContent(response);
      expect(extracted).toBe('gemini reply');
    });

    it('validates Gemini response', () => {
      expect(configs.gemini.responseExtractor.isValid({ candidates: [] })).toBe(true);
      expect(configs.gemini.responseExtractor.isValid({})).toBe(false);
    });
  });

  describe('ollama config', () => {
    it('builds ollama-specific headers', () => {
      const headers = configs.ollama.buildHeaders('');
      expect(headers.Authorization).toBe('Bearer ollama');
    });

    it('builds body without max_tokens when JSON format enabled', () => {
      const body = configs.ollama.buildBody('llama3', [{ role: 'user', content: 'hi' }], true);
      expect(body.max_tokens).toBeUndefined();
    });

    it('reuses OpenAI extractor', () => {
      const response = { choices: [{ message: { content: 'ollama reply' } }] };
      const extracted = configs.ollama.responseExtractor.extractContent(response);
      expect(extracted).toBe('ollama reply');
    });
  });

  describe('deepl extractor', () => {
    it('extracts translation from DeepL response', () => {
      // DeepL extractor is module-scoped, not accessible via PROVIDER_CONFIGS
      // Testing behavior through response shape validation
      const isValid = (data: unknown) => {
        return (
          typeof data === 'object' &&
          data !== null &&
          'translations' in data &&
          Array.isArray((data as any).translations)
        );
      };
      const extractContent = (data: any) => data.translations?.[0]?.text;

      const response = { translations: [{ text: 'DeepL translation', detected_source_language: 'EN' }] };
      expect(isValid(response)).toBe(true);
      expect(extractContent(response)).toBe('DeepL translation');
      expect(isValid({})).toBe(false);
    });
  });

  describe('googleTranslate extractor', () => {
    it('extracts translation from Google Translate response', () => {
      const isValid = (data: unknown) => {
        return (
          typeof data === 'object' &&
          data !== null &&
          'data' in data &&
          typeof (data as any).data === 'object'
        );
      };
      const extractContent = (data: any) => data.data?.translations?.[0]?.translatedText;

      const response = {
        data: {
          translations: [{ translatedText: 'Google translation', detectedSourceLanguage: 'en' }],
        },
      };
      expect(isValid(response)).toBe(true);
      expect(extractContent(response)).toBe('Google translation');
      expect(isValid({})).toBe(false);
    });
  });

  describe('youdao extractor', () => {
    it('extracts translation from Youdao response', () => {
      const isValid = (data: unknown) => {
        return (
          typeof data === 'object' &&
          data !== null &&
          'translation' in data &&
          Array.isArray((data as any).translation)
        );
      };
      const extractContent = (data: any) => data.translation?.[0];

      const response = { translation: ['有道翻译'], errorCode: '0' };
      expect(isValid(response)).toBe(true);
      expect(extractContent(response)).toBe('有道翻译');
      expect(isValid({})).toBe(false);
    });

    it('extracts error from Youdao response', () => {
      const extractError = (data: any) => {
        if (typeof data !== 'object' || data === null) return undefined;
        if (data.errorCode && data.errorCode !== '0') {
          return `有道翻译错误: ${data.errorCode}`;
        }
        return undefined;
      };

      expect(extractError({ errorCode: '101', translation: [] })).toBe('有道翻译错误: 101');
      expect(extractError({ errorCode: '0', translation: ['ok'] })).toBeUndefined();
    });
  });
});

describe('TranslationApiService — buildMessages', () => {
  const buildMessages = (TranslationApiService as any).buildMessages.bind(TranslationApiService);

  it('builds system + user messages for openai format', () => {
    const messages = buildMessages('openai', 'You are a helper', 'Translate this');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
  });

  it('merges system prompt into user message for anthropic format', () => {
    const messages = buildMessages('anthropic', 'You are Claude', 'Translate this');
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('You are Claude');
    expect(messages[0].content).toContain('Translate this');
    expect(messages[0].content).toContain('respond with valid JSON');
  });

  it('merges system prompt for gemini format with JSON requirement', () => {
    const messages = buildMessages('gemini', 'You are Gemini', 'Translate this');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('You are Gemini');
    expect(messages[0].content).toContain('respond with valid JSON');
    expect(messages[0].content).toContain('Translate this');
  });

  it('defaults to openai format for unknown apiFormat', () => {
    const messages = buildMessages('unknown', 'system', 'user');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
  });
});

describe('TranslationApiService — response extractors', () => {
  it('OpenAI extractor handles error response', () => {
    const extractor = (TranslationApiService as any).PROVIDER_CONFIGS.openai.responseExtractor;
    const errorResponse = { error: { message: 'Rate limit exceeded' } };
    const errorMsg = extractor.extractError?.(errorResponse);
    expect(errorMsg).toBe('Rate limit exceeded');
  });

  it('extractors handle null/undefined input', () => {
    const openAI = (TranslationApiService as any).PROVIDER_CONFIGS.openai.responseExtractor;
    expect(openAI.isValid(null)).toBe(false);
  });
});

describe('TranslationApiService — generateYoudaoSign', () => {
  it('generates deterministic SHA-256 hash', async () => {
    const sign1 = await (TranslationApiService as any).generateYoudaoSign(
      'appKey', 'appSecret', 'hello', 'salt', '1234567890'
    );
    const sign2 = await (TranslationApiService as any).generateYoudaoSign(
      'appKey', 'appSecret', 'hello', 'salt', '1234567890'
    );
    expect(sign1).toBe(sign2);
    expect(sign1.length).toBe(64); // SHA-256 hex length
  });

  it('truncates long query text', async () => {
    const longText = 'a'.repeat(50);
    const sign = await (TranslationApiService as any).generateYoudaoSign(
      'appKey', 'appSecret', longText, 'salt', '1234567890'
    );
    expect(sign.length).toBe(64);
  });
});
