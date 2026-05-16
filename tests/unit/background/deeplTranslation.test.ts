/**
 * DeepLTranslationService 测试
 *
 * 覆盖纯函数部分：extractWordsFromText, isCommonWord, parseWordAnalysis, parseResponse
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepLTranslationService } from '@/background/deeplTranslation';

// Mock dependencies
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getSettings: vi.fn(),
    getApi: vi.fn(),
  },
}));

vi.mock('@/background/translationApi', () => ({
  TranslationApiService: {
    quickTranslate: vi.fn(),
    callWithSystem: vi.fn(),
  },
}));

vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    initialize: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

vi.mock('@/shared/performance', () => ({
  recordMetric: vi.fn(),
  MetricType: {
    CACHE_OPERATION: 'cache_operation',
    API_RESPONSE_TIME: 'api_response_time',
    TRANSLATION_TOTAL_TIME: 'translation_total_time',
  },
}));

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    generateCacheKey: vi.fn((text: string) => `cache:${text}`),
    retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
});

vi.mock('@/background/textComplexityAnalyzer', () => ({
  TextComplexityAnalyzer: {
    analyze: vi.fn(() => ({ level: 'intermediate' })),
  },
}));

vi.mock('@/shared/prompts', () => ({
  TranslationPromptBuilder: class {
    build() {
      return { systemPrompt: 'system', userPrompt: 'user' };
    }
    constructor() {}
  },
  promptVersionManager: {
    hasVersion: vi.fn(() => false),
    getTemplate: vi.fn(),
  },
}));

describe('DeepLTranslationService — isCommonWord', () => {
  it('identifies common articles', () => {
    expect((DeepLTranslationService as any).isCommonWord('the')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('and')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('for')).toBe(true);
  });

  it('identifies common pronouns', () => {
    expect((DeepLTranslationService as any).isCommonWord('they')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('their')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('she')).toBe(true);
  });

  it('identifies common modals', () => {
    expect((DeepLTranslationService as any).isCommonWord('could')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('should')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('might')).toBe(true);
  });

  it('rejects uncommon words', () => {
    expect((DeepLTranslationService as any).isCommonWord('serendipity')).toBe(false);
    expect((DeepLTranslationService as any).isCommonWord('ubiquitous')).toBe(false);
    expect((DeepLTranslationService as any).isCommonWord('juxtapose')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect((DeepLTranslationService as any).isCommonWord('THE')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('And')).toBe(true);
    expect((DeepLTranslationService as any).isCommonWord('Should')).toBe(true);
  });
});

describe('DeepLTranslationService — extractWordsFromText', () => {
  it('extracts words with 4+ characters', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'The quick brown fox jumps over the lazy dog'
    );
    expect(words).toContain('quick');
    expect(words).toContain('brown');
    expect(words).toContain('jumps');
    expect(words).toContain('lazy');
  });

  it('excludes common words', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'the quick and brown'
    );
    expect(words).not.toContain('the');
    expect(words).not.toContain('and');
    expect(words).toContain('quick');
    expect(words).toContain('brown');
  });

  it('filters out short words (less than 4 chars)', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'cat dog fox elephant'
    );
    expect(words).not.toContain('cat');
    expect(words).not.toContain('dog');
    expect(words).not.toContain('fox');
    expect(words).toContain('elephant');
  });

  it('deduplicates words', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'quick quick quick brown brown'
    );
    expect(words).toEqual(['quick', 'brown']);
  });

  it('limits to 20 words', () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    const words = (DeepLTranslationService as any).extractWordsFromText(text);
    expect(words.length).toBeLessThanOrEqual(20);
  });

  it('removes punctuation and special characters', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'Hello, world! This is a test-case with "quotes" and (parentheses).'
    );
    expect(words).toContain('hello');
    expect(words).toContain('world');
    expect(words).toContain('testcase'); // hyphen removed, words merge
    expect(words).toContain('quotes');
    expect(words).toContain('parentheses');
  });

  it('handles empty input', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText('');
    expect(words).toEqual([]);
  });

  it('handles input with only common words', () => {
    const words = (DeepLTranslationService as any).extractWordsFromText(
      'the and or but this that they their'
    );
    expect(words).toEqual([]);
  });
});

describe('DeepLTranslationService — parseWordAnalysis', () => {
  it('parses JSON word analysis from code block', () => {
    const content = `Here is the analysis:
\`\`\`json
{
  "words": [
    {"original": "serendipity", "translation": "偶然发现", "difficulty": 8, "isPhrase": false, "phonetic": "/ˌserənˈdɪpɪti/", "partOfSpeech": "noun", "examples": ["Finding this book was pure serendipity."]}
  ]
}
\`\`\``;

    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      original: 'serendipity',
      translation: '偶然发现',
      difficulty: 8,
      isPhrase: false,
      phonetic: '/ˌserənˈdɪpɪti/',
      partOfSpeech: 'noun',
      examples: ['Finding this book was pure serendipity.'],
    });
    expect(result[0].position).toEqual([0, 0]);
  });

  it('parses raw JSON without code block', () => {
    const content = JSON.stringify({
      words: [
        { original: 'ubiquitous', translation: '无处不在的', difficulty: 7 },
        { original: 'juxtapose', translation: '并列', difficulty: 9 },
      ],
    });

    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toHaveLength(2);
    expect(result[0].original).toBe('ubiquitous');
    expect(result[1].original).toBe('juxtapose');
  });

  it('handles empty words array', () => {
    const content = JSON.stringify({ words: [] });
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });

  it('returns empty array for missing words key', () => {
    const content = JSON.stringify({ data: 'something' });
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });

  it('returns empty array for invalid JSON', () => {
    const content = 'this is not json at all';
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });

  it('applies defaults for missing fields', () => {
    const content = JSON.stringify({
      words: [
        { original: 'test' },
        { original: 'test2', translation: '测试', difficulty: null },
      ],
    });

    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result[0].translation).toBe('');
    expect(result[0].difficulty).toBe(5);
    expect(result[0].isPhrase).toBe(false);
    expect(result[0].phonetic).toBeUndefined();
    expect(result[1].difficulty).toBe(5);
  });

  it('handles malformed code block content', () => {
    const content = '```json\n{ invalid json }\n```';
    const result = (DeepLTranslationService as any).parseWordAnalysis(content);
    expect(result).toEqual([]);
  });
});

describe('DeepLTranslationService — parseResponse', () => {
  const defaultSettings = {
    phraseTranslationEnabled: true,
    grammarTranslationEnabled: false,
  };

  it('parses full translation response with code block', () => {
    const content = `\`\`\`json
{
  "fullText": "这是一段翻译",
  "words": [
    {"original": "serendipity", "translation": "偶然发现", "position": [10, 21], "difficulty": 8, "isPhrase": false}
  ],
  "sentences": [
    {"original": "Hello world", "translation": "你好世界", "grammarNote": "simple greeting"}
  ],
  "grammarPoints": [
    {"original": "Hello world", "explanation": "greeting pattern", "type": "greeting", "position": [0, 11]}
  ]
}
\`\`\``;

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.fullText).toBe('这是一段翻译');
    expect(result.words).toHaveLength(1);
    expect(result.words[0].original).toBe('serendipity');
    expect(result.words[0].position).toEqual([10, 21]);
    expect(result.sentences).toHaveLength(1);
    expect(result.sentences[0].original).toBe('Hello world');
    expect(result.grammarPoints).toEqual([]); // grammarTranslationEnabled is false
  });

  it('parses words with defaults for missing fields', () => {
    const content = JSON.stringify({
      words: [
        { original: 'test', translation: '测试' },
        { original: 'test2', translation: '测试2', position: [0, 5], difficulty: 3, isPhrase: true, phonetic: '/test/', partOfSpeech: 'noun', examples: ['example'] },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.words).toHaveLength(2);
    // First word: defaults
    expect(result.words[0].difficulty).toBe(5);
    expect(result.words[0].position).toEqual([0, 0]);
    expect(result.words[0].isPhrase).toBe(false);
    // Second word: explicit values
    expect(result.words[1].difficulty).toBe(3);
    expect(result.words[1].position).toEqual([0, 5]);
    expect(result.words[1].phonetic).toBe('/test/');
    expect(result.words[1].examples).toEqual(['example']);
  });

  it('filters phrases when phraseTranslationEnabled is false', () => {
    const settings = { phraseTranslationEnabled: false, grammarTranslationEnabled: false };
    const content = JSON.stringify({
      words: [
        { original: 'word', translation: '词', isPhrase: false },
        { original: 'in spite of', translation: '尽管', isPhrase: true },
        { original: 'another', translation: '另一个', isPhrase: false },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, settings);
    expect(result.words).toHaveLength(2);
    expect(result.words[0].original).toBe('word');
    expect(result.words[1].original).toBe('another');
  });

  it('includes phrases when phraseTranslationEnabled is true', () => {
    const content = JSON.stringify({
      words: [
        { original: 'word', translation: '词', isPhrase: false },
        { original: 'in spite of', translation: '尽管', isPhrase: true },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.words).toHaveLength(2);
  });

  it('includes grammar points when grammarTranslationEnabled is true', () => {
    const settings = { phraseTranslationEnabled: true, grammarTranslationEnabled: true };
    const content = JSON.stringify({
      grammarPoints: [
        { original: 'If I were', explanation: '虚拟语气', type: 'subjunctive', position: [0, 9] },
        { original: 'had been', explanation: '过去完成时', type: 'tense' },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, settings);
    expect(result.grammarPoints).toHaveLength(2);
    expect(result.grammarPoints[0]).toMatchObject({
      original: 'If I were',
      explanation: '虚拟语气',
      type: 'subjunctive',
      position: [0, 9],
    });
    expect(result.grammarPoints[1].position).toEqual([0, 0]); // default
  });

  it('parses sentences correctly', () => {
    const content = JSON.stringify({
      sentences: [
        { original: 'Sentence one', translation: '第一句' },
        { original: 'Sentence two', translation: '第二句', grammarNote: 'note' },
      ],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.sentences).toHaveLength(2);
    expect(result.sentences[0]).toMatchObject({
      original: 'Sentence one',
      translation: '第一句',
    });
    expect(result.sentences[0].grammarNote).toBeUndefined();
    expect(result.sentences[1].grammarNote).toBe('note');
  });

  it('throws error for invalid JSON', () => {
    const content = 'not valid json';
    expect(() =>
      (DeepLTranslationService as any).parseResponse(content, defaultSettings)
    ).toThrow('Failed to parse translation response');
  });

  it('throws error for malformed code block JSON', () => {
    const content = '```json\n{ broken\n```';
    expect(() =>
      (DeepLTranslationService as any).parseResponse(content, defaultSettings)
    ).toThrow('Failed to parse translation response');
  });

  it('handles response without code block (raw JSON)', () => {
    const content = JSON.stringify({
      fullText: 'raw json response',
      words: [],
      sentences: [],
    });

    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.fullText).toBe('raw json response');
  });

  it('handles empty arrays gracefully', () => {
    const content = JSON.stringify({});
    const result = (DeepLTranslationService as any).parseResponse(content, defaultSettings);
    expect(result.words).toEqual([]);
    expect(result.sentences).toEqual([]);
    expect(result.grammarPoints).toEqual([]);
    expect(result.fullText).toBeUndefined();
  });
});
