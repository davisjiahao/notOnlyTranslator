import { describe, bench } from 'vitest'
import {
  normalizeText,
  extractContext,
  mergeTranslationResults,
  debounce,
  throttle,
  calculateReviewPriority,
  extractJsonFromResponse,
  repairMalformedJson,
  getChineseRatio,
} from '@/shared/utils'
import type { TranslationResult } from '@/shared/types'

// ============================================================
// Benchmark 1: Text Normalization Pipeline
// ============================================================

describe('Text Normalization', () => {
  const shortText = '  Hello   world  '
  const longText = '  The quick brown fox   jumps over the lazy dog.\n\n  Multiple   spaces and   newlines everywhere.  '
  const htmlText = '<p>Hello  world</p>\n<span>  Test  </span>'

  bench('normalizeText short', () => {
    normalizeText(shortText)
  })

  bench('normalizeText long', () => {
    normalizeText(longText)
  })

  bench('normalizeText with HTML', () => {
    normalizeText(htmlText)
  })
})

// ============================================================
// Benchmark 2: Context Extraction
// ============================================================

describe('Context Extraction', () => {
  const fullText = 'The quick brown fox jumps over the lazy dog. The fox is a clever animal that lives in the forest.'

  bench('extractContext center', () => {
    extractContext(fullText, 20, 30)
  })

  bench('extractContext start', () => {
    extractContext(fullText, 5, 30)
  })

  bench('extractContext end', () => {
    extractContext(fullText, 80, 30)
  })
})

// ============================================================
// Benchmark 3: Chinese Ratio Calculation
// ============================================================

describe('Chinese Ratio', () => {
  const englishText = 'The quick brown fox jumps over the lazy dog'
  const mixedText = 'The algorithm 算法 is very efficient 高效'
  const chineseText = '这是一个中文测试文本用于验证比例计算'
  const emptyText = '   '

  bench('pure English', () => {
    getChineseRatio(englishText)
  })

  bench('mixed English/Chinese', () => {
    getChineseRatio(mixedText)
  })

  bench('pure Chinese', () => {
    getChineseRatio(chineseText)
  })

  bench('empty/whitespace', () => {
    getChineseRatio(emptyText)
  })
})

// ============================================================
// Benchmark 4: JSON Extraction & Repair
// ============================================================

describe('JSON Extraction', () => {
  const markdownJson = '```json\n{"words": ["test"], "sentences": []}\n```'
  const plainJson = '{"words": ["test"], "sentences": []}'
  const noisyText = 'Some explanation here\n{"words": ["hello"], "sentences": ["world"]}\nMore text'
  const trailingComma = '{"a": 1, "b": [1, 2, 3,],}'

  bench('extract from markdown', () => {
    extractJsonFromResponse(markdownJson)
  })

  bench('extract plain JSON', () => {
    extractJsonFromResponse(plainJson)
  })

  bench('extract from noisy text', () => {
    extractJsonFromResponse(noisyText)
  })

  bench('repair trailing comma', () => {
    repairMalformedJson(trailingComma)
  })
})

// ============================================================
// Benchmark 5: Translation Result Merging
// ============================================================

describe('Translation Result Merging', () => {
  const base: TranslationResult = {
    words: [
      { original: 'algorithm', translated: '算法', context: '' },
      { original: 'efficient', translated: '高效的', context: '' },
    ],
    sentences: [
      { original: 'This is efficient.', translated: '这是高效的。' },
    ],
  }

  const delta: TranslationResult = {
    words: [
      { original: 'algorithm', translated: '演算法', context: '' },
      { original: 'performance', translated: '性能', context: '' },
    ],
    sentences: [
      { original: 'Performance matters.', translated: '性能很重要。' },
    ],
  }

  bench('merge small results', () => {
    mergeTranslationResults(base, delta)
  })
})

// ============================================================
// Benchmark 6: Debounce & Throttle
// ============================================================

describe('Debounce / Throttle Creation', () => {
  const fn = () => {}

  bench('create debounce', () => {
    debounce(fn, 300)
  })

  bench('create throttle', () => {
    throttle(fn, 300)
  })
})

// ============================================================
// Benchmark 7: Review Priority Calculation
// ============================================================

describe('Review Priority', () => {
  const now = Date.now()
  const oneDayAgo = now - 86400000
  const oneWeekAgo = now - 7 * 86400000

  bench('new word no review', () => {
    calculateReviewPriority(now, 0)
  })

  bench('overdue after 1 review', () => {
    calculateReviewPriority(oneWeekAgo, 1, oneWeekAgo)
  })

  bench('recently reviewed', () => {
    calculateReviewPriority(oneWeekAgo, 2, oneDayAgo)
  })
})
