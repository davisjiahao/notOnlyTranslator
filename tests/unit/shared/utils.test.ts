import { describe, it, expect } from 'vitest';
import {
  calculateVocabularySize,
  updateVocabularyEstimate,
  isWordLikelyKnown,
  generateCacheKey,
  getChineseRatio,
  normalizeText,
  debounce,
  throttle,
  formatDate,
  sleep,
  ApiError,
  defaultShouldRetry,
} from '@/shared/utils';
import type { UserProfile } from '@/shared/types';

describe('calculateVocabularySize', () => {
  it('应该返回 CET4 的基础词汇量', () => {
    const size = calculateVocabularySize('cet4');
    expect(size).toBeGreaterThan(0);
    expect(size).toBe(4500); // CET4 基础词汇量
  });

  it('应该根据分数调整词汇量', () => {
    // 分数会影响词汇量估计，高分和低分应该产生不同的结果
    const lowScoreSize = calculateVocabularySize('cet4', 400);
    const highScoreSize = calculateVocabularySize('cet4', 600);
    // 高分应该产生更高的词汇量估计
    expect(highScoreSize).toBeGreaterThan(lowScoreSize);
  });
});

describe('updateVocabularyEstimate', () => {
  it('当用户认识一个更难的词时应该增加估计', () => {
    const result = updateVocabularyEstimate(5000, 8, true, 0.5);
    expect(result.newEstimate).toBeGreaterThan(5000);
    expect(result.newConfidence).toBeGreaterThan(0.5);
  });

  it('当用户不认识一个简单词时应该减少估计', () => {
    const result = updateVocabularyEstimate(5000, 2, false, 0.5);
    expect(result.newEstimate).toBeLessThan(5000);
  });

  it('估计值应该在合理范围内', () => {
    const result = updateVocabularyEstimate(100, 10, true, 0);
    expect(result.newEstimate).toBeGreaterThanOrEqual(1000);
    expect(result.newEstimate).toBeLessThanOrEqual(15000);
  });
});

describe('isWordLikelyKnown', () => {
  const createProfile = (
    knownWords: string[] = [],
    unknownWords: { word: string }[] = [],
    vocabulary: number = 5000
  ): UserProfile => ({
    examType: 'cet4',
    estimatedVocabulary: vocabulary,
    levelConfidence: 0.5,
    knownWords,
    unknownWords: unknownWords.map(w => ({
      word: w.word,
      translation: '',
      markedAt: Date.now(),
    })),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  it('应该识别明确标记为认识的词', () => {
    const profile = createProfile(['hello']);
    expect(isWordLikelyKnown('hello', profile, 5)).toBe(true);
    expect(isWordLikelyKnown('HELLO', profile, 5)).toBe(true); // 大小写不敏感
  });

  it('应该识别明确标记为不认识的词', () => {
    const profile = createProfile([], [{ word: 'serendipity' }]);
    expect(isWordLikelyKnown('serendipity', profile, 5)).toBe(false);
  });

  it('应该根据词汇量估计判断未标记的词', () => {
    const profile = createProfile([], [], 8000);
    // 难度 3 的词对于 8000 词汇量的用户应该是认识的
    expect(isWordLikelyKnown('simple', profile, 3)).toBe(true);
    // 难度 9 的词应该是不认识的
    expect(isWordLikelyKnown('esoteric', profile, 9)).toBe(false);
  });
});

describe('generateCacheKey', () => {
  it('应该为相同文本和模式生成相同的键', () => {
    const key1 = generateCacheKey('hello world', 'inline-only');
    const key2 = generateCacheKey('hello world', 'inline-only');
    expect(key1).toBe(key2);
  });

  it('应该为不同模式生成不同的键', () => {
    const key1 = generateCacheKey('hello', 'inline-only');
    const key2 = generateCacheKey('hello', 'bilingual');
    expect(key1).not.toBe(key2);
  });
});

describe('getChineseRatio', () => {
  it('应该正确计算中文字符比例', () => {
    expect(getChineseRatio('你好世界')).toBe(1);
    expect(getChineseRatio('hello')).toBe(0);
    // "你好hello" = 2 个中文 + 5 个英文 = 7 个字符，中文比例 = 2/7 ≈ 0.286
    expect(getChineseRatio('你好hello')).toBeCloseTo(2 / 7, 2);
  });

  it('应该处理空字符串', () => {
    expect(getChineseRatio('')).toBe(0);
  });
});

describe('normalizeText', () => {
  it('应该去除多余空白并 trim', () => {
    expect(normalizeText('  hello   world  ')).toBe('hello world');
    expect(normalizeText('a\n\nb\t\tc')).toBe('a b c');
  });
});

describe('debounce', () => {
  it('应该延迟执行函数', async () => {
    let count = 0;
    const fn = debounce(() => { count++; }, 50);

    fn();
    fn();
    fn();

    expect(count).toBe(0);
    await sleep(100);
    expect(count).toBe(1);
  });
});

describe('throttle', () => {
  it('应该限制函数执行频率', async () => {
    let count = 0;
    const fn = throttle(() => { count++; }, 50);

    fn(); // 执行
    fn(); // 跳过
    fn(); // 跳过

    expect(count).toBe(1);

    await sleep(60);
    fn(); // 执行
    expect(count).toBe(2);
  });
});

describe('formatDate', () => {
  it('应该格式化时间戳为中文日期', () => {
    const timestamp = new Date('2024-01-15').getTime();
    const formatted = formatDate(timestamp);
    expect(formatted).toContain('2024');
    expect(formatted).toContain('1');
    expect(formatted).toContain('15');
  });
});

describe('ApiError', () => {
  it('应该创建包含状态码的错误', () => {
    const error = new ApiError('Not found', 404, false);
    expect(error.message).toBe('Not found');
    expect(error.statusCode).toBe(404);
    expect(error.isRetryable).toBe(false);
    expect(error.name).toBe('ApiError');
  });
});

describe('defaultShouldRetry', () => {
  it('应该重试网络错误（无状态码）', () => {
    const error = new ApiError('Network error', undefined, true);
    expect(defaultShouldRetry(error, 0)).toBe(true);
  });

  it('应该重试 429 限流错误', () => {
    const error = new ApiError('Rate limit', 429, true);
    expect(defaultShouldRetry(error, 0)).toBe(true);
  });

  it('应该重试 5xx 服务器错误', () => {
    const error = new ApiError('Server error', 500, true);
    expect(defaultShouldRetry(error, 0)).toBe(true);
  });

  it('不应该重试 4xx 客户端错误', () => {
    const error = new ApiError('Not found', 404, false);
    expect(defaultShouldRetry(error, 0)).toBe(false);
  });
});
