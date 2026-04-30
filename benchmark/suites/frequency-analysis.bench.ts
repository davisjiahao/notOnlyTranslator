import { describe, bench } from 'vitest'
import { frequencyManager } from '@/background/frequencyManager'

// Initialize before benchmarks
frequencyManager['wordSets'].set('common', new Set(['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'is', 'a', 'in', 'and', 'of', 'to', 'it', 'this', 'that', 'for', 'are', 'was']))
frequencyManager['wordSets'].set('cet4', new Set(['algorithm', 'function', 'process', 'system', 'method', 'result', 'performance', 'efficient', 'optimize', 'cache']))
frequencyManager['wordSets'].set('cet6', new Set(['implementation', 'architecture', 'infrastructure', 'synchronization', 'concurrency', 'serialization', 'encapsulation', 'polymorphism']))
frequencyManager['wordSets'].set('toefl', new Set(['epistemology', 'paradigm', 'heuristic', 'paradigmatic', 'hermeneutics']))
frequencyManager['wordSets'].set('ielts', new Set(['socioeconomic', 'interdisciplinary', 'psycholinguistic']))
frequencyManager['wordSets'].set('gre', new Set(['perspicacious', 'obfuscate', 'laconic', 'sycophant', 'pusillanimous']))
frequencyManager['initialized'] = true

// ============================================================
// Benchmark 1: Word Difficulty Lookup
// ============================================================

describe('Word Difficulty Lookup', () => {
  bench('common word (difficulty 1)', () => {
    frequencyManager.getDifficulty('the')
  })

  bench('CET-4 word (difficulty 3)', () => {
    frequencyManager.getDifficulty('algorithm')
  })

  bench('CET-6 word (difficulty 5)', () => {
    frequencyManager.getDifficulty('implementation')
  })

  bench('TOEFL word (difficulty 7)', () => {
    frequencyManager.getDifficulty('epistemology')
  })

  bench('GRE word (difficulty 9)', () => {
    frequencyManager.getDifficulty('perspicacious')
  })

  bench('unknown/rare word (difficulty 8)', () => {
    frequencyManager.getDifficulty('supercalifragilistic')
  })
})

// ============================================================
// Benchmark 2: Easy Word Detection
// ============================================================

describe('Easy Word Detection', () => {
  bench('isEasyWord common', () => {
    frequencyManager.isEasyWord('the')
  })

  bench('isEasyWord CET-4', () => {
    frequencyManager.isEasyWord('algorithm')
  })

  bench('isEasyWord hard', () => {
    frequencyManager.isEasyWord('perspicacious')
  })
})

// ============================================================
// Benchmark 3: Frequency Rank
// ============================================================

describe('Frequency Rank', () => {
  bench('getFrequencyRank common', () => {
    frequencyManager.getFrequencyRank('the')
  })

  bench('getFrequencyRank CET-4', () => {
    frequencyManager.getFrequencyRank('algorithm')
  })

  bench('getFrequencyRank GRE', () => {
    frequencyManager.getFrequencyRank('perspicacious')
  })
})

// ============================================================
// Benchmark 4: Translation Need Detection
// ============================================================

describe('Translation Need Detection', () => {
  const simpleParagraph = 'The quick brown fox jumps over the lazy dog. This is a simple sentence for testing.'
  const complexParagraph = 'The epistemological paradigm of hermeneutics requires interdisciplinary socioeconomic analysis. The perspicacious observer notices the sycophantic behavior.'
  const mixedParagraph = 'The algorithm uses efficient caching to optimize performance. The implementation of synchronization requires careful concurrency control.'

  bench('hasPotentialUnknownWords simple (vocab 3000)', () => {
    frequencyManager.hasPotentialUnknownWords(simpleParagraph, 3000)
  })

  bench('hasPotentialUnknownWords simple (vocab 8000)', () => {
    frequencyManager.hasPotentialUnknownWords(simpleParagraph, 8000)
  })

  bench('hasPotentialUnknownWords complex (vocab 3000)', () => {
    frequencyManager.hasPotentialUnknownWords(complexParagraph, 3000)
  })

  bench('hasPotentialUnknownWords mixed (vocab 5000)', () => {
    frequencyManager.hasPotentialUnknownWords(mixedParagraph, 5000)
  })

  bench('analyzeText simple', () => {
    frequencyManager.analyzeText(simpleParagraph, 5000)
  })

  bench('analyzeText complex', () => {
    frequencyManager.analyzeText(complexParagraph, 5000)
  })
})
