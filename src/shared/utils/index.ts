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
