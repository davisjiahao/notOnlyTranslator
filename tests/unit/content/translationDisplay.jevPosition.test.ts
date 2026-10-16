/**
 * TranslationDisplay Jev 严格位置渲染测试
 *
 * 契约:
 * 1. result.vocabularyAssessment.provider === 'jev' 时,所有 word.position 强制生效,
 *    position 是对 getTranslatableText 的 utf16 闭开区间;
 * 2. 同词多次出现只入选第 k 个时,只包裹该出现点;
 * 3. 词可跨 inline 节点,分段包裹共享同一词条数据;
 * 4. 位置切片与词条不一致、或落入已有高亮时失败关闭,不猜测正文位置;
 * 5. 缺失 vocabularyAssessment 的旧结果保持原有匹配行为。
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TranslationDisplay } from '@/content/translationDisplay';
import { getTranslatableText } from '@/content/pageScanner';
import type { TranslationResult, TranslatedWord } from '@/shared/types';

const jevWord = (original: string, position: [number, number], translation = '译文'): TranslatedWord => ({
  original,
  translation,
  position,
  difficulty: 5,
  isPhrase: false,
});

const jevResult = (words: TranslatedWord[], extra: Partial<TranslationResult> = {}): TranslationResult => ({
  words,
  sentences: [],
  vocabularyAssessment: { provider: 'jev' },
  ...extra,
});

const highlightsOf = (paragraph: HTMLElement) =>
  Array.from(paragraph.querySelectorAll<HTMLElement>('mark.not-translator-highlight'));

describe('TranslationDisplay Jev 严格位置渲染', () => {
  let paragraph: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    paragraph = document.createElement('p');
    document.body.appendChild(paragraph);
  });

  it('同词只第二个出现点入选时,只包裹该出现点', () => {
    paragraph.textContent = 'The bank is steep. The bank is high.';
    // 第二个 bank 的 utf16 区间 [23, 27)
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('bank', [23, 27], '河岸')]),
      'inline-only'
    );

    const marks = highlightsOf(paragraph);
    expect(marks).toHaveLength(1);
    expect(marks[0].dataset.word).toBe('bank');
    expect(marks[0].previousSibling?.textContent).toBe('The bank is steep. The ');
    expect(getTranslatableText(paragraph)).toBe('The bank is steep. The bank is high.');
  });

  it('旧流程结果不强制位置:同词全部出现点仍包裹', () => {
    paragraph.textContent = 'The bank is steep. The bank is high.';
    const legacy: TranslationResult = {
      words: [jevWord('bank', [23, 27], '河岸')],
      sentences: [],
    };
    TranslationDisplay.applyTranslation(paragraph, legacy, 'inline-only');

    expect(highlightsOf(paragraph)).toHaveLength(2);
    expect(getTranslatableText(paragraph)).toBe('The bank is steep. The bank is high.');
  });

  it('词跨 inline 节点时分段包裹,共享词条数据且词义只标注一次', () => {
    paragraph.innerHTML = 'He said wo<em>rd</em>play matters.';
    // 'wordplay' 的 utf16 区间 [8, 16):'wo' + 'rd'(<em>) + 'play'
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('wordplay', [8, 16], '文字游戏')]),
      'inline-only'
    );

    const marks = highlightsOf(paragraph);
    expect(marks).toHaveLength(3);
    expect(marks.map(mark => mark.childNodes[0].textContent)).toEqual(['wo', 'rd', 'play']);
    for (const mark of marks) {
      expect(mark.dataset.word).toBe('wordplay');
      expect(mark.dataset.translation).toBe('文字游戏');
    }
    const annotations = paragraph.querySelectorAll('.not-translator-inline-translation');
    expect(annotations).toHaveLength(1);
    expect(annotations[0].textContent).toBe('文字游戏');
    expect(getTranslatableText(paragraph)).toBe('He said wordplay matters.');
  });

  it('双语模式下跨节点分段:段落索引只在首段', () => {
    paragraph.innerHTML = 'He said wo<em>rd</em>play matters.';
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('wordplay', [8, 16], '文字游戏')], { fullText: '他说文字游戏很重要。' }),
      'bilingual'
    );

    const marks = highlightsOf(paragraph);
    expect(marks).toHaveLength(3);
    expect(marks[0].dataset.index).toBe('0');
    expect(marks[0].classList.contains('not-translator-highlighted-word')).toBe(true);
    expect(marks[1].dataset.index).toBeUndefined();
    expect(marks[2].dataset.index).toBeUndefined();
    expect(getTranslatableText(paragraph)).toBe('He said wordplay matters.');
  });

  it('位置切片与词条不一致时失败关闭,不猜测正文位置', () => {
    paragraph.textContent = 'The bank is steep. The bank is high.';
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('bank', [0, 4], '河岸')]),
      'inline-only'
    );

    expect(highlightsOf(paragraph)).toHaveLength(0);
    expect(getTranslatableText(paragraph)).toBe('The bank is steep. The bank is high.');
  });

  it('位置区间长度与词条长度不一致时拒绝包裹', () => {
    paragraph.textContent = 'The bank is steep. The bank is high.';
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('bank', [23, 28], '河岸')]),
      'inline-only'
    );

    expect(highlightsOf(paragraph)).toHaveLength(0);
  });

  it('区间落入已有高亮时整体失败关闭,不做部分包裹', () => {
    paragraph.innerHTML = 'He said wo<em>rd</em>play matters.';
    const em = paragraph.querySelector('em')!;
    const existing = document.createElement('mark');
    existing.className = 'not-translator-highlight';
    existing.textContent = 'rd';
    em.textContent = '';
    em.appendChild(existing);

    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('wordplay', [8, 16], '文字游戏')]),
      'inline-only'
    );

    const marks = highlightsOf(paragraph);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toBe(existing);
    expect(getTranslatableText(paragraph)).toBe('He said wordplay matters.');
  });

  it('utf16 位置按码元解释:前面的增补字符占两个码元', () => {
    paragraph.textContent = '🚀 rocket launches';
    // '🚀' 占两个 utf16 码元,'rocket' 区间为 [3, 9)
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('rocket', [3, 9], '火箭')]),
      'inline-only'
    );

    const marks = highlightsOf(paragraph);
    expect(marks).toHaveLength(1);
    expect(marks[0].childNodes[0].textContent).toBe('rocket');
    expect(getTranslatableText(paragraph)).toBe('🚀 rocket launches');
  });

  it('按字符数(而非码元)给出的位置被校验拒绝', () => {
    paragraph.textContent = '🚀 rocket launches';
    // 若调用方按字符数计算会得到 [2, 8),切片为 ' rocke',必须拒绝
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('rocket', [2, 8], '火箭')]),
      'inline-only'
    );

    expect(highlightsOf(paragraph)).toHaveLength(0);
  });

  it('跨节点包裹后清除翻译可完整恢复原文与 inline 结构', () => {
    paragraph.innerHTML = 'He said wo<em>rd</em>play matters.';
    TranslationDisplay.applyTranslation(
      paragraph,
      jevResult([jevWord('wordplay', [8, 16], '文字游戏')]),
      'inline-only'
    );
    expect(highlightsOf(paragraph)).toHaveLength(3);

    TranslationDisplay.clearTranslation(paragraph);

    expect(highlightsOf(paragraph)).toHaveLength(0);
    expect(paragraph.querySelector('em')).not.toBeNull();
    expect(getTranslatableText(paragraph)).toBe('He said wordplay matters.');
  });
});
