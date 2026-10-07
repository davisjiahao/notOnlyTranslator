import type { WordMasteryEntry } from '@/shared/types/mastery';

export interface LearningRecordDay {
  date: string;
  savedWords: number;
  reviewedWords: number;
}

/** 只汇总当前保留的时间戳，不倒推逐次复习、词汇量或 CEFR 历史。 */
export function getLearningRecordDays(
  entries: WordMasteryEntry[], days: number, now = Date.now()
): LearningRecordDay[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - days + 1);
  const records = new Map<string, LearningRecordDay>();
  const add = (timestamp: number | undefined, field: 'savedWords' | 'reviewedWords') => {
    if (timestamp === undefined || !Number.isFinite(timestamp) || timestamp < start.getTime() || timestamp > now) return;
    const date = new Date(timestamp);
    const key = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    const record = records.get(key) ?? { date: key, savedWords: 0, reviewedWords: 0 };
    record[field] += 1;
    records.set(key, record);
  };
  entries.forEach(entry => {
    add(entry.markedAt, 'savedWords');
    add(entry.lastReviewAt, 'reviewedWords');
  });
  return [...records.values()].sort((a, b) => b.date.localeCompare(a.date));
}
