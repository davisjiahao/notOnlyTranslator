import { describe, expect, it } from 'vitest';
import { getLearningRecordDays } from '@/shared/utils/learningRecords';
import type { WordMasteryEntry } from '@/shared/types/mastery';

const entry = (dates: Partial<WordMasteryEntry>) => ({ word: 'apple', markedAt: 0, ...dates }) as WordMasteryEntry;
describe('可追溯的词条时间不是完整活动历史', () => {
  const now = new Date(2026, 9, 7, 15).getTime();
  it('按本地日读取保存和最近复习，不推导旧复习或掌握度', () => {
    const rows = getLearningRecordDays([
      entry({ markedAt: new Date(2026, 9, 6, 23).getTime(), lastReviewAt: new Date(2026, 9, 7, 2).getTime(), reviewCount: 20 }),
      entry({ markedAt: new Date(2026, 9, 7, 1).getTime() }),
    ], 7, now);
    expect(rows).toEqual([
      { date: '2026-10-07', savedWords: 1, reviewedWords: 1 },
      { date: '2026-10-06', savedWords: 1, reviewedWords: 0 },
    ]);
  });
  it('不填充虚构零天，忽略无效、未来和超出范围时间', () => {
    expect(getLearningRecordDays([], 30, now)).toEqual([]);
    expect(getLearningRecordDays([
      entry({ markedAt: NaN, lastReviewAt: now + 1 }),
      entry({ markedAt: new Date(2026, 8, 1).getTime() }),
    ], 7, now)).toEqual([]);
  });
  it('包含范围首日本地零点，排除之前一秒', () => {
    expect(getLearningRecordDays([
      entry({ markedAt: new Date(2026, 9, 1).getTime() }),
      entry({ markedAt: new Date(2026, 8, 30, 23, 59, 59).getTime() }),
    ], 7, now)).toEqual([{ date: '2026-10-01', savedWords: 1, reviewedWords: 0 }]);
  });
});
