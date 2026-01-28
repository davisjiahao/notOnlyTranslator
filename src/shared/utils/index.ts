import type { ExamType, UserProfile, TranslationResult } from '../types';
import { EXAM_VOCABULARY_SIZES, SCORE_MULTIPLIERS } from '../constants';

/**
 * Calculate estimated vocabulary size based on exam type and score
 */
export function calculateVocabularySize(examType: ExamType, score?: number): number {
  const baseVocabulary = EXAM_VOCABULARY_SIZES[examType];

  if (score === undefined) {
    return baseVocabulary;
  }

  const multiplier = SCORE_MULTIPLIERS[examType](score);
  return Math.round(baseVocabulary * multiplier);
}

/**
 * Update vocabulary estimation using Bayesian update
 * When user marks a word, we adjust their estimated vocabulary
 */
export function updateVocabularyEstimate(
  currentEstimate: number,
  wordDifficulty: number,
  isKnown: boolean,
  confidence: number
): { newEstimate: number; newConfidence: number } {
  // wordDifficulty is 1-10, map to vocabulary percentile
  const wordPercentile = wordDifficulty / 10;
  const expectedVocab = wordPercentile * 15000; // Max vocabulary ~15000

  // Bayesian-like update
  const learningRate = 0.1 * (1 - confidence);

  let adjustment: number;
  if (isKnown && expectedVocab > currentEstimate) {
    // User knows a harder word than expected, increase estimate
    adjustment = (expectedVocab - currentEstimate) * learningRate;
  } else if (!isKnown && expectedVocab < currentEstimate) {
    // User doesn't know an easier word, decrease estimate
    adjustment = (expectedVocab - currentEstimate) * learningRate;
  } else {
    adjustment = 0;
  }

  const newEstimate = Math.max(1000, Math.min(15000, currentEstimate + adjustment));
  const newConfidence = Math.min(1, confidence + 0.01);

  return { newEstimate, newConfidence };
}

/**
 * Check if a word is likely known based on user profile
 */
export function isWordLikelyKnown(
  word: string,
  userProfile: UserProfile,
  wordDifficulty: number
): boolean {
  // If explicitly marked as known
  if (userProfile.knownWords.includes(word.toLowerCase())) {
    return true;
  }

  // If explicitly marked as unknown
  if (userProfile.unknownWords.some(w => w.word.toLowerCase() === word.toLowerCase())) {
    return false;
  }

  // Estimate based on vocabulary size and word difficulty
  const estimatedPercentile = userProfile.estimatedVocabulary / 15000;
  const wordPercentile = wordDifficulty / 10;

  return wordPercentile < estimatedPercentile;
}

/**
 * Generate a cache key for translation results
 */
export function generateCacheKey(text: string, mode: string): string {
  const hash = simpleHash(text);
  return `${mode}_${hash}`;
}

/**
 * Simple string hashing function
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Calculate the ratio of Chinese characters in a string
 */
export function getChineseRatio(text: string): number {
  if (!text) return 0;
  // Match Chinese characters (including punctuation)
  const chineseMatches = text.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/g);
  return (chineseMatches?.length || 0) / text.length;
}

/**
 * Clean and normalize text for translation
 */
export function normalizeText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract context around a position in text
 */
export function extractContext(fullText: string, position: number, contextLength: number = 50): string {
  const start = Math.max(0, position - contextLength);
  const end = Math.min(fullText.length, position + contextLength);
  return fullText.slice(start, end);
}

/**
 * Merge translation results (for incremental updates)
 */
export function mergeTranslationResults(
  existing: TranslationResult,
  newResult: TranslationResult
): TranslationResult {
  const wordMap = new Map(existing.words.map(w => [w.original, w]));
  newResult.words.forEach(w => wordMap.set(w.original, w));

  const sentenceMap = new Map(existing.sentences.map(s => [s.original, s]));
  newResult.sentences.forEach(s => sentenceMap.set(s.original, s));

  return {
    words: Array.from(wordMap.values()),
    sentences: Array.from(sentenceMap.values()),
  };
}

/**
 * Debounce function for rate limiting
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;

  return function (this: unknown, ...args: Parameters<T>) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * Throttle function for rate limiting
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function (this: unknown, ...args: Parameters<T>) {
    if (!inThrottle) {
      fn.apply(this, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Format date for display
 */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Calculate review priority for spaced repetition
 */
export function calculateReviewPriority(
  markedAt: number,
  reviewCount: number,
  lastReviewAt?: number
): number {
  const now = Date.now();
  const daysSinceMarked = (now - markedAt) / (1000 * 60 * 60 * 24);
  const daysSinceReview = lastReviewAt
    ? (now - lastReviewAt) / (1000 * 60 * 60 * 24)
    : daysSinceMarked;

  // Simple spaced repetition intervals: 1, 3, 7, 14, 30 days
  const intervals = [1, 3, 7, 14, 30];
  const targetInterval = intervals[Math.min(reviewCount, intervals.length - 1)];

  // Higher priority if overdue for review
  return daysSinceReview / targetInterval;
}

// ========== API 重试相关工具 ==========

/**
 * 重试配置选项
 */
export interface RetryOptions {
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 初始延迟（毫秒），默认 1000 */
  initialDelay?: number;
  /** 延迟倍数（指数退避），默认 2 */
  backoffMultiplier?: number;
  /** 最大延迟（毫秒），默认 30000 */
  maxDelay?: number;
  /** 是否应该重试的判断函数，默认只重试网络错误和 5xx 错误 */
  shouldRetry?: (error: Error, attempt: number) => boolean;
  /** 重试时的回调，用于日志记录 */
  onRetry?: (error: Error, attempt: number, delay: number) => void;
}

/**
 * API 错误类型，包含 HTTP 状态码信息
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public isRetryable: boolean = false
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * 默认的重试判断函数
 * - 网络错误（无状态码）：重试
 * - 429 (Rate Limit)：重试
 * - 5xx 服务器错误：重试
 * - 其他错误：不重试
 */
export function defaultShouldRetry(error: Error, _attempt: number): boolean {
  if (error instanceof ApiError) {
    const code = error.statusCode;
    // 无状态码（网络错误）、429（限流）、5xx（服务器错误）应该重试
    if (!code) return true;
    if (code === 429) return true;
    if (code >= 500 && code < 600) return true;
    return false;
  }
  // 非 ApiError（如网络中断），默认重试
  return true;
}

/**
 * 带指数退避的重试函数
 *
 * @param fn 要执行的异步函数
 * @param options 重试配置
 * @returns 函数执行结果
 * @throws 最后一次重试失败后抛出错误
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 3, initialDelay: 1000 }
 * );
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    backoffMultiplier = 2,
    maxDelay = 30000,
    shouldRetry = defaultShouldRetry,
    onRetry,
  } = options;

  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // 检查是否应该重试
      if (attempt < maxRetries && shouldRetry(lastError, attempt)) {
        // 计算延迟时间（带随机抖动，避免惊群效应）
        const jitter = Math.random() * 0.3 * delay; // 0-30% 的随机抖动
        const actualDelay = Math.min(delay + jitter, maxDelay);

        // 调用重试回调
        if (onRetry) {
          onRetry(lastError, attempt + 1, actualDelay);
        }

        // 等待后重试
        await sleep(actualDelay);

        // 指数增加延迟
        delay = Math.min(delay * backoffMultiplier, maxDelay);
      } else {
        // 不应该重试，直接抛出
        throw lastError;
      }
    }
  }

  // 理论上不会到达这里，但 TypeScript 需要这个
  throw lastError!;
}

/**
 * 睡眠函数
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 包装 fetch 请求，自动转换为 ApiError
 *
 * @param url 请求 URL
 * @param options fetch 选项
 * @returns Response 对象
 * @throws ApiError
 */
export async function fetchWithApiError(
  url: string,
  options?: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      // 尝试解析错误信息
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorData = await response.clone().json();
        errorMessage = errorData.error?.message || errorData.message || errorMessage;
      } catch {
        // 忽略 JSON 解析错误，使用默认错误信息
      }

      // 判断是否可重试
      const isRetryable = response.status === 429 || response.status >= 500;

      throw new ApiError(errorMessage, response.status, isRetryable);
    }

    return response;
  } catch (error) {
    // 网络错误（如超时、DNS 失败等）
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(
      error instanceof Error ? error.message : '网络请求失败',
      undefined,
      true // 网络错误应该重试
    );
  }
}
