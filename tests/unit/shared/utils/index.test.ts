/**
 * 共享工具函数测试
 *
 * 测试 src/shared/utils/index.ts 中的核心工具函数
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateId,
  calculateVocabularySize,
  updateVocabularyEstimate,
  isWordLikelyKnown,
  generateCacheKey,
  getChineseRatio,
  normalizeText,
  extractContext,
  mergeTranslationResults,
  debounce,
  throttle,
  formatDate,
  calculateReviewPriority,
  ApiError,
  defaultShouldRetry,
  retryWithBackoff,
  sleep,
  extractJsonFromResponse,
  repairMalformedJson,
  fetchWithApiError,
} from '@/shared/utils';
import type { UserProfile, TranslationResult } from '@/shared/types';

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('generateId', () => {
  it('应该生成唯一ID', () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });

  it('应该包含时间戳', () => {
    const id = generateId();
    const timestamp = id.split('-')[0];
    expect(Number(timestamp)).toBeGreaterThan(0);
  });

  it('应该包含随机字符串', () => {
    const id = generateId();
    const parts = id.split('-');
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts[1].length).toBe(9);
  });
});

describe('calculateVocabularySize', () => {
  it('应该返回基础词汇量当没有分数时', () => {
    expect(calculateVocabularySize('cet4')).toBe(4500);
    expect(calculateVocabularySize('cet6')).toBe(6000);
    expect(calculateVocabularySize('ielts')).toBe(7000);
    expect(calculateVocabularySize('toefl')).toBe(8000);
    expect(calculateVocabularySize('gre')).toBe(12000);
    expect(calculateVocabularySize('custom')).toBe(5000);
  });

  it('应该根据分数调整词汇量', () => {
    // 高分应该增加词汇量估计
    const highScore = calculateVocabularySize('cet4', 600);
    const lowScore = calculateVocabularySize('cet4', 400);
    expect(highScore).toBeGreaterThan(lowScore);
  });
});

describe('updateVocabularyEstimate', () => {
  it('应该在认识难词时增加估计词汇量', () => {
    const result = updateVocabularyEstimate(5000, 8, true, 0.5);
    expect(result.newEstimate).toBeGreaterThan(5000);
    expect(result.newConfidence).toBeGreaterThan(0.5);
  });

  it('应该在不认识简单词时减少估计词汇量', () => {
    const result = updateVocabularyEstimate(5000, 3, false, 0.5);
    expect(result.newEstimate).toBeLessThan(5000);
    expect(result.newConfidence).toBeGreaterThan(0.5);
  });

  it('应该限制最小词汇量为 1000', () => {
    const result = updateVocabularyEstimate(1100, 1, false, 0.1);
    expect(result.newEstimate).toBeGreaterThanOrEqual(1000);
  });

  it('应该限制最大词汇量为 15000', () => {
    const result = updateVocabularyEstimate(14900, 10, true, 0.1);
    expect(result.newEstimate).toBeLessThanOrEqual(15000);
  });

  it('应该增加置信度', () => {
    const result = updateVocabularyEstimate(5000, 5, true, 0.5);
    expect(result.newConfidence).toBeGreaterThan(0.5);
  });

  it('应该限制置信度最大为 1', () => {
    const result = updateVocabularyEstimate(5000, 5, true, 0.99);
    expect(result.newConfidence).toBeLessThanOrEqual(1);
  });

  it('应该不调整当认识简单词且估计词汇量已经很高', () => {
    const result = updateVocabularyEstimate(10000, 3, true, 0.5);
    expect(result.newEstimate).toBe(10000);
  });

  it('应该不调整当不认识难词且估计词汇量已经很低', () => {
    const result = updateVocabularyEstimate(2000, 8, false, 0.5);
    expect(result.newEstimate).toBe(2000);
  });
});

describe('isWordLikelyKnown', () => {
  const createProfile = (
    knownWords: string[] = [],
    unknownWords: Array<{ word: string }> = [],
    estimatedVocabulary = 5000
  ): UserProfile => ({
    examType: 'cet4',
    estimatedVocabulary,
    knownWords,
    unknownWords,
    levelConfidence: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  it('应该返回 true 当单词在已知词汇列表中', () => {
    const profile = createProfile(['hello', 'world']);
    expect(isWordLikelyKnown('hello', profile, 3)).toBe(true);
    expect(isWordLikelyKnown('HELLO', profile, 3)).toBe(true); // 大小写不敏感
  });

  it('应该返回 false 当单词在未知词汇列表中', () => {
    const profile = createProfile([], [{ word: 'unknown' }]);
    expect(isWordLikelyKnown('unknown', profile, 3)).toBe(false);
    expect(isWordLikelyKnown('UNKNOWN', profile, 3)).toBe(false); // 大小写不敏感
  });

  it('应该基于词汇量估计判断', () => {
    const profile = createProfile([], [], 5000); // 约 33% 百分位
    // 难度 2 (20% 百分位) < 33% 百分位，应该认识
    expect(isWordLikelyKnown('test', profile, 2)).toBe(true);
    // 难度 8 (80% 百分位) > 33% 百分位，可能不认识
    expect(isWordLikelyKnown('test', profile, 8)).toBe(false);
  });
});

describe('generateCacheKey', () => {
  it('应该生成缓存键', () => {
    const key = generateCacheKey('hello world', 'translate');
    expect(key).toMatch(/^translate_[a-f0-9]+$/);
  });

  it('应该为相同文本和模式生成相同的键', () => {
    const key1 = generateCacheKey('hello', 'translate');
    const key2 = generateCacheKey('hello', 'translate');
    expect(key1).toBe(key2);
  });

  it('应该为不同文本生成不同的键', () => {
    const key1 = generateCacheKey('hello', 'translate');
    const key2 = generateCacheKey('world', 'translate');
    expect(key1).not.toBe(key2);
  });

  it('应该为不同模式生成不同的键', () => {
    const key1 = generateCacheKey('hello', 'translate');
    const key2 = generateCacheKey('hello', 'define');
    expect(key1).not.toBe(key2);
  });
});

describe('getChineseRatio', () => {
  it('应该返回 0 当文本为空', () => {
    expect(getChineseRatio('')).toBe(0);
  });

  it('应该返回 0 当文本只有空格', () => {
    expect(getChineseRatio('   ')).toBe(0);
  });

  it('应该返回 1 当文本全是中文', () => {
    expect(getChineseRatio('你好世界')).toBe(1);
  });

  it('应该返回 0 当文本全是英文', () => {
    expect(getChineseRatio('hello world')).toBe(0);
  });

  it('应该正确计算混合文本的比例', () => {
    // 4个中文字符，8个英文字符，共12个
    expect(getChineseRatio('你好hello')).toBeCloseTo(0.29, 1);
  });

  it('应该忽略空格计算比例', () => {
    expect(getChineseRatio('你 好')).toBe(1); // 2个中文，忽略空格
  });

  it('应该支持韩文字符', () => {
    expect(getChineseRatio('안녕')).toBeCloseTo(1, 0);
  });
});

describe('normalizeText', () => {
  it('应该去除首尾空格', () => {
    expect(normalizeText('  hello  ')).toBe('hello');
  });

  it('应该将多个空格合并为一个', () => {
    expect(normalizeText('hello    world')).toBe('hello world');
  });

  it('应该保留单词间的单个空格', () => {
    expect(normalizeText('hello world')).toBe('hello world');
  });
});

describe('extractContext', () => {
  it('应该提取指定位置周围的文本', () => {
    const text = '0123456789abcdefghij';
    expect(extractContext(text, 10, 5)).toBe('56789abcde');
  });

  it('应该处理开始边界', () => {
    const text = '0123456789';
    // position=2, contextLength=5 -> start=0, end=7
    const context = extractContext(text, 2, 5);
    expect(context).toBe('0123456');
  });

  it('应该处理结束边界', () => {
    const text = '0123456789';
    // position=8, contextLength=5 -> start=3, end=10
    const context = extractContext(text, 8, 5);
    expect(context).toBe('3456789');
  });

  it('应该使用默认上下文长度', () => {
    const text = 'a'.repeat(200);
    const context = extractContext(text, 100);
    expect(context.length).toBe(100); // 50 + 50
  });
});

describe('mergeTranslationResults', () => {
  const createResult = (
    words: Array<{ original: string }> = [],
    sentences: Array<{ original: string }> = []
  ): TranslationResult => ({
    words: words.map(w => ({
      ...w,
      translation: 'trans',
      difficulty: 5,
    })),
    sentences: sentences.map(s => ({
      ...s,
      translation: 'trans',
    })),
  });

  it('应该合并词汇', () => {
    const existing = createResult([{ original: 'hello' }]);
    const newResult = createResult([{ original: 'world' }]);
    const merged = mergeTranslationResults(existing, newResult);
    expect(merged.words.length).toBe(2);
  });

  it('应该用新结果覆盖重复词汇', () => {
    const existing = createResult([{ original: 'hello' }]);
    const newResult = createResult([{ original: 'hello' }]);
    const merged = mergeTranslationResults(existing, newResult);
    expect(merged.words.length).toBe(1);
  });

  it('应该合并句子', () => {
    const existing = createResult([], [{ original: 'Hello world.' }]);
    const newResult = createResult([], [{ original: 'Good morning.' }]);
    const merged = mergeTranslationResults(existing, newResult);
    expect(merged.sentences.length).toBe(2);
  });
});

describe('debounce', () => {
  it('应该延迟执行函数', async () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 10);

    debouncedFn();
    expect(fn).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('应该只执行最后一次调用', async () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 10);

    debouncedFn('first');
    debouncedFn('second');
    debouncedFn('third');

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('third');
  });

  it('应该重置延迟时间', async () => {
    const fn = vi.fn();
    const debouncedFn = debounce(fn, 20);

    debouncedFn();
    await new Promise(resolve => setTimeout(resolve, 10));
    debouncedFn();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(fn).not.toHaveBeenCalled();

    await new Promise(resolve => setTimeout(resolve, 15));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('throttle', () => {
  it('应该立即执行第一次调用', () => {
    const fn = vi.fn();
    const throttledFn = throttle(fn, 50);

    throttledFn('first');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');
  });

  it('应该在限制时间内忽略后续调用', async () => {
    const fn = vi.fn();
    const throttledFn = throttle(fn, 50);

    throttledFn('first');
    throttledFn('second');
    throttledFn('third');

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');

    await new Promise(resolve => setTimeout(resolve, 60));
    throttledFn('second');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('应该限制时间后允许新调用', async () => {
    const fn = vi.fn();
    const throttledFn = throttle(fn, 10);

    throttledFn('first');
    await new Promise(resolve => setTimeout(resolve, 15));
    throttledFn('second');

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('formatDate', () => {
  it('应该格式化日期', () => {
    const timestamp = new Date('2024-01-15').getTime();
    const formatted = formatDate(timestamp);
    expect(formatted).toContain('2024');
    expect(formatted).toContain('1');
    expect(formatted).toContain('15');
  });

  it('应该使用中文格式', () => {
    const timestamp = new Date('2024-06-20').getTime();
    const formatted = formatDate(timestamp);
    expect(formatted).toContain('月');
  });
});

describe('calculateReviewPriority', () => {
  it('应该计算复习优先级', () => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const priority = calculateReviewPriority(oneDayAgo, 0);
    expect(priority).toBeGreaterThan(0);
  });

  it('应该对过期更久的单词返回更高优先级', () => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const twoDaysAgo = now - 48 * 60 * 60 * 1000;

    const priority1 = calculateReviewPriority(oneDayAgo, 0);
    const priority2 = calculateReviewPriority(twoDaysAgo, 0);

    expect(priority2).toBeGreaterThan(priority1);
  });

  it('应该考虑复习次数', () => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const priority0 = calculateReviewPriority(oneDayAgo, 0);
    const priority3 = calculateReviewPriority(oneDayAgo, 3);

    // 复习次数越多，目标间隔越长，相对优先级越低
    expect(priority0).toBeGreaterThan(priority3);
  });

  it('应该使用 lastReviewAt 当提供时', () => {
    const now = Date.now();
    const markedAt = now - 10 * 24 * 60 * 60 * 1000; // 10 天前标记
    const lastReviewAt = now - 24 * 60 * 60 * 1000; // 1 天前复习

    const priority = calculateReviewPriority(markedAt, 1, lastReviewAt);
    expect(priority).toBeGreaterThan(0);
  });
});

describe('ApiError', () => {
  it('应该创建 API 错误', () => {
    const error = new ApiError('Test error', 404, false);
    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(404);
    expect(error.isRetryable).toBe(false);
    expect(error.name).toBe('ApiError');
  });

  it('应该继承 Error', () => {
    const error = new ApiError('Test error');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe('defaultShouldRetry', () => {
  it('应该对网络错误返回 true', () => {
    const error = new ApiError('Network error');
    expect(defaultShouldRetry(error, 0)).toBe(true);
  });

  it('应该对 429 错误返回 true', () => {
    const error = new ApiError('Rate limited', 429, true);
    expect(defaultShouldRetry(error, 0)).toBe(true);
  });

  it('应该对 5xx 错误返回 true', () => {
    const error500 = new ApiError('Server error', 500, true);
    const error503 = new ApiError('Service unavailable', 503, true);
    expect(defaultShouldRetry(error500, 0)).toBe(true);
    expect(defaultShouldRetry(error503, 0)).toBe(true);
  });

  it('应该对 4xx 错误返回 false', () => {
    const error400 = new ApiError('Bad request', 400, false);
    const error401 = new ApiError('Unauthorized', 401, false);
    const error404 = new ApiError('Not found', 404, false);
    expect(defaultShouldRetry(error400, 0)).toBe(false);
    expect(defaultShouldRetry(error401, 0)).toBe(false);
    expect(defaultShouldRetry(error404, 0)).toBe(false);
  });

  it('应该对普通 Error 返回 true', () => {
    const error = new Error('Generic error');
    expect(defaultShouldRetry(error, 0)).toBe(true);
  });
});

describe('retryWithBackoff', () => {
  it('应该在成功时返回结果', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('应该在失败后重试', async () => {
    const error = new ApiError('Temporary error', 500, true);
    const fn = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue('success');

    const onRetry = vi.fn();
    const result = await retryWithBackoff(fn, { onRetry, initialDelay: 10, maxDelay: 20 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('应该在不可重试错误时立即抛出', async () => {
    const error = new ApiError('Not found', 404, false);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(retryWithBackoff(fn)).rejects.toThrow('Not found');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('应该在达到最大重试次数后抛出', async () => {
    const error = new ApiError('Server error', 500, true);
    const fn = vi.fn().mockRejectedValue(error);

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, initialDelay: 10 })
    ).rejects.toThrow('Server error');

    expect(fn).toHaveBeenCalledTimes(3); // 初始 + 2 次重试
  });
});

describe('sleep', () => {
  it('应该返回 Promise', () => {
    const promise = sleep(0);
    expect(promise).toBeInstanceOf(Promise);
  });

  it('应该等待指定时间后 resolve', async () => {
    const start = Date.now();
    await sleep(10);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(8); // 允许一些误差
  });
});

describe('extractJsonFromResponse', () => {
  it('应该从 Markdown 代码块提取 JSON', () => {
    const content = '```json\n{"name": "test"}\n```';
    expect(extractJsonFromResponse(content)).toBe('{"name": "test"}');
  });

  it('应该从普通代码块提取 JSON', () => {
    const content = '```\n{"name": "test"}\n```';
    expect(extractJsonFromResponse(content)).toBe('{"name": "test"}');
  });

  it('应该从文本中提取 JSON 对象', () => {
    const content = 'Here is the result: {"name": "test"} and more text';
    expect(extractJsonFromResponse(content)).toBe('{"name": "test"}');
  });

  it('应该从文本中提取 JSON 数组', () => {
    const content = 'Result: [1, 2, 3]';
    expect(extractJsonFromResponse(content)).toBe('[1, 2, 3]');
  });

  it('应该返回 null 当没有 JSON 时', () => {
    const content = 'No JSON here';
    expect(extractJsonFromResponse(content)).toBeNull();
  });
});

describe('repairMalformedJson', () => {
  it('应该移除末尾逗号', () => {
    expect(repairMalformedJson('[1, 2, 3, ]')).toBe('[1, 2, 3]');
    expect(repairMalformedJson('{"a": 1, }')).toBe('{"a": 1}');
  });

  it('应该移除控制字符', () => {
    const json = '{"a": "test\u0000"}';
    const repaired = repairMalformedJson(json);
    expect(repaired).not.toContain('\u0000');
  });

  it('应该保留有效 JSON', () => {
    const validJson = '{"name": "test"}';
    expect(repairMalformedJson(validJson)).toBe(validJson);
  });
});

describe('fetchWithApiError', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('应该返回成功的响应', async () => {
    const mockResponse = new Response('{"data": "test"}', { status: 200 });
    mockFetch.mockResolvedValue(mockResponse);

    const response = await fetchWithApiError('https://api.test.com');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith('https://api.test.com', undefined);
  });

  it('应该为 4xx 错误抛出 ApiError', async () => {
    const mockResponse = new Response('{"error": {"message": "Not found"}}', {
      status: 404,
      statusText: 'Not Found',
    });
    mockFetch.mockResolvedValue(mockResponse);

    await expect(fetchWithApiError('https://api.test.com')).rejects.toThrow(ApiError);
    await expect(fetchWithApiError('https://api.test.com')).rejects.toMatchObject({
      statusCode: 404,
      isRetryable: false,
    });
  });

  it('应该为 5xx 错误抛出可重试的 ApiError', async () => {
    const mockResponse = new Response('Internal Server Error', {
      status: 500,
      statusText: 'Internal Server Error',
    });
    mockFetch.mockResolvedValue(mockResponse);

    await expect(fetchWithApiError('https://api.test.com')).rejects.toMatchObject({
      statusCode: 500,
      isRetryable: true,
    });
  });

  it('应该为 429 错误抛出可重试的 ApiError', async () => {
    const mockResponse = new Response('Rate Limited', {
      status: 429,
      statusText: 'Too Many Requests',
    });
    mockFetch.mockResolvedValue(mockResponse);

    await expect(fetchWithApiError('https://api.test.com')).rejects.toMatchObject({
      statusCode: 429,
      isRetryable: true,
    });
  });

  it('应该为网络错误抛出可重试的 ApiError', async () => {
    mockFetch.mockRejectedValue(new Error('Network failure'));

    await expect(fetchWithApiError('https://api.test.com')).rejects.toMatchObject({
      statusCode: undefined,
      isRetryable: true,
    });
  });

  it('应该传递请求选项', async () => {
    const mockResponse = new Response('{}', { status: 200 });
    mockFetch.mockResolvedValue(mockResponse);

    await fetchWithApiError('https://api.test.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(mockFetch).toHaveBeenCalledWith('https://api.test.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
  });
});