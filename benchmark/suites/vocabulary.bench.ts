import { describe, bench } from 'vitest'
import {
  calculateVocabularySize,
  updateVocabularyEstimate,
  isWordLikelyKnown,
  generateCacheKey,
  generateId,
} from '@/shared/utils'
import type { UserProfile } from '@/shared/types'

// ============================================================
// Benchmark 1: Vocabulary Size Calculation
// ============================================================

describe('Vocabulary Size Calculation', () => {
  bench('CET-4 no score', () => {
    calculateVocabularySize('cet4')
  })

  bench('CET-4 with score', () => {
    calculateVocabularySize('cet4', 550)
  })

  bench('TOEFL with score', () => {
    calculateVocabularySize('toefl', 95)
  })

  bench('GRE with score', () => {
    calculateVocabularySize('gre', 320)
  })
})

// ============================================================
// Benchmark 2: Bayesian Vocabulary Update
// ============================================================

describe('Bayesian Vocabulary Update', () => {
  const profile: UserProfile = {
    examType: 'cet4',
    estimatedVocabulary: 4500,
    knownWords: [],
    unknownWords: [],
    levelConfidence: 0.7,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  bench('update with known easy word', () => {
    updateVocabularyEstimate(profile.estimatedVocabulary, 2, true, profile.levelConfidence)
  })

  bench('update with unknown hard word', () => {
    updateVocabularyEstimate(profile.estimatedVocabulary, 8, false, profile.levelConfidence)
  })

  bench('update with known hard word (surprise)', () => {
    updateVocabularyEstimate(profile.estimatedVocabulary, 8, true, profile.levelConfidence)
  })

  bench('update with unknown easy word (surprise)', () => {
    updateVocabularyEstimate(profile.estimatedVocabulary, 2, false, profile.levelConfidence)
  })

  bench('update with low confidence', () => {
    updateVocabularyEstimate(profile.estimatedVocabulary, 5, true, 0.2)
  })
})

// ============================================================
// Benchmark 3: Word Likelihood Prediction
// ============================================================

describe('Word Likelihood Prediction', () => {
  const beginner: UserProfile = {
    examType: 'cet4',
    estimatedVocabulary: 2000,
    knownWords: ['hello', 'world', 'test'],
    unknownWords: [{ word: 'algorithm', addedAt: Date.now() }],
    levelConfidence: 0.5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  const advanced: UserProfile = {
    examType: 'gre',
    estimatedVocabulary: 10000,
    knownWords: ['hello', 'algorithm', 'efficient'],
    unknownWords: [],
    levelConfidence: 0.9,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  bench('beginner known word', () => {
    isWordLikelyKnown('hello', beginner, 1)
  })

  bench('beginner unknown word', () => {
    isWordLikelyKnown('algorithm', beginner, 8)
  })

  bench('advanced known word', () => {
    isWordLikelyKnown('algorithm', advanced, 7)
  })

  bench('unmarked medium word', () => {
    isWordLikelyKnown('performance', advanced, 5)
  })
})

// ============================================================
// Benchmark 4: Cache Key Generation
// ============================================================

describe('Cache Key Generation', () => {
  const shortText = 'hello world'
  const paragraph = 'The quick brown fox jumps over the lazy dog near the river bank. This is a test paragraph for translation.'

  bench('short text', () => {
    generateCacheKey(shortText, 'inline')
  })

  bench('paragraph', () => {
    generateCacheKey(paragraph, 'bilingual')
  })

  bench('generateId', () => {
    generateId()
  })
})
