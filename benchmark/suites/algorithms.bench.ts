import { describe, bench } from 'vitest'
import { diffLines } from './utils/diff'

// 模拟不同大小的文本差异计算
describe('Diff Algorithm Performance', () => {
  const smallText1 = 'Hello world'
  const smallText2 = 'Hello there world'

  const mediumText1 = Array(100).fill('Line content here').join('\n')
  const mediumText2 = Array(100).fill('Line modified content here').join('\n')

  bench('small text diff', () => {
    diffLines(smallText1, smallText2)
  })

  bench('medium text diff', () => {
    diffLines(mediumText1, mediumText2)
  })
})

describe('String Operations', () => {
  const text = 'The quick brown fox jumps over the lazy dog'.repeat(100)

  bench('regex match', () => {
    /\b\w{4}\b/g.exec(text)
  })

  bench('string split', () => {
    text.split(' ')
  })

  bench('string replace', () => {
    text.replace(/fox/g, 'cat')
  })
})
