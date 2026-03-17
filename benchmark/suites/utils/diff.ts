/**
 * 简单的行级差异计算工具
 * 用于性能基准测试
 */

export interface DiffResult {
  added: string[]
  removed: string[]
  unchanged: string[]
}

export function diffLines(text1: string, text2: string): DiffResult {
  const lines1 = text1.split('\n')
  const lines2 = text2.split('\n')

  const added: string[] = []
  const removed: string[] = []
  const unchanged: string[] = []

  const set1 = new Set(lines1)
  const set2 = new Set(lines2)

  for (const line of lines1) {
    if (!set2.has(line)) {
      removed.push(line)
    } else {
      unchanged.push(line)
    }
  }

  for (const line of lines2) {
    if (!set1.has(line)) {
      added.push(line)
    }
  }

  return { added, removed, unchanged }
}

/**
 * 计算文本相似度（0-1之间）
 */
export function similarity(text1: string, text2: string): number {
  if (text1 === text2) return 1
  if (!text1 || !text2) return 0

  const len1 = text1.length
  const len2 = text2.length
  const maxLen = Math.max(len1, len2)

  if (maxLen === 0) return 1

  // 简单的字符级相似度
  let matches = 0
  const minLen = Math.min(len1, len2)
  for (let i = 0; i < minLen; i++) {
    if (text1[i] === text2[i]) matches++
  }

  return matches / maxLen
}
