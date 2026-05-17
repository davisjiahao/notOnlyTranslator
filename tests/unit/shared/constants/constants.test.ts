import { describe, it, expect } from 'vitest';
import { EXAM_DISPLAY_NAMES, EXAM_SCORE_RANGES } from '@/shared/constants';

describe('EXAM_DISPLAY_NAMES', () => {
  it('has display names for all exam types', () => {
    expect(EXAM_DISPLAY_NAMES).toHaveProperty('cet4');
    expect(EXAM_DISPLAY_NAMES).toHaveProperty('cet6');
    expect(EXAM_DISPLAY_NAMES).toHaveProperty('toefl');
    expect(EXAM_DISPLAY_NAMES).toHaveProperty('ielts');
    expect(EXAM_DISPLAY_NAMES).toHaveProperty('gre');
    expect(EXAM_DISPLAY_NAMES).toHaveProperty('custom');
  });

  it('GRE display name includes full Chinese translation (F10.2)', () => {
    expect(EXAM_DISPLAY_NAMES.gre).toBe('GRE (美国研究生入学考试)');
  });

  it('CET display names include Chinese', () => {
    expect(EXAM_DISPLAY_NAMES.cet4).toContain('大学英语四级');
    expect(EXAM_DISPLAY_NAMES.cet6).toContain('大学英语六级');
  });

  it('TOEFL display name includes Chinese', () => {
    expect(EXAM_DISPLAY_NAMES.toefl).toContain('托福');
  });

  it('IELTS display name includes Chinese', () => {
    expect(EXAM_DISPLAY_NAMES.ielts).toContain('雅思');
  });

  it('custom exam display name is 自定义', () => {
    expect(EXAM_DISPLAY_NAMES.custom).toBe('自定义');
  });
});

describe('EXAM_SCORE_RANGES', () => {
  it('has ranges for all exam types', () => {
    for (const key of Object.keys(EXAM_DISPLAY_NAMES)) {
      expect(EXAM_SCORE_RANGES).toHaveProperty(key);
    }
  });

  it('each range has min, max, and step', () => {
    for (const [key, range] of Object.entries(EXAM_SCORE_RANGES)) {
      expect(range).toHaveProperty('min');
      expect(range).toHaveProperty('max');
      expect(range).toHaveProperty('step');
      expect(range.max).toBeGreaterThan(range.min);
      expect(range.step).toBeGreaterThan(0);
    }
  });
});
