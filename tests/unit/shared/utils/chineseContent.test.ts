import { describe, expect, it } from 'vitest';
import { isChineseContent, isShortEnglishSample } from '@/shared/utils';
import { CHINESE_DETECTION_THRESHOLD } from '@/shared/constants';

describe('短英文语言判定', () => {
  it('短英文即使夹杂全角标点或一两个汉字也不算中文', () => {
    const text = 'The plant by the window is green. Police may plant evidence.';
    expect(isShortEnglishSample(text)).toBe(true);
    expect(isShortEnglishSample(`${text}！`)).toBe(true);
    expect(isChineseContent(`${text}你好`, CHINESE_DETECTION_THRESHOLD.PAGE)).toBe(false);
    expect(isChineseContent(`${text}你好`, CHINESE_DETECTION_THRESHOLD.PARAGRAPH)).toBe(false);
  });

  it('足够长的英文不再被当成短样本', () => {
    const text = 'The ephemeral nature of language provides curious readers with meaningful context and new ideas. '.repeat(5);
    expect(isShortEnglishSample(text)).toBe(false);
    expect(isChineseContent(text, CHINESE_DETECTION_THRESHOLD.PAGE)).toBe(false);
  });

  it('成段汉字仍按比例视为中文', () => {
    const text = '这是页面原有的中文正文，需要根据内容继续跳过翻译。'.repeat(3);
    expect(isShortEnglishSample(text)).toBe(false);
    expect(isChineseContent(text, CHINESE_DETECTION_THRESHOLD.PAGE)).toBe(true);
    expect(isChineseContent(text, CHINESE_DETECTION_THRESHOLD.PARAGRAPH)).toBe(true);
  });

  it('扩展界面里的中文句子本身仍会被识别为中文，调用方必须先剔除', () => {
    expect(isChineseContent('标记认识标记不认识加入生词本钉住面板', CHINESE_DETECTION_THRESHOLD.PAGE)).toBe(true);
  });
});
