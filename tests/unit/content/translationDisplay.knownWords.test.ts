import { afterEach, describe, expect, it } from 'vitest';
import { TranslationDisplay } from '@/content/translationDisplay';
import type { TranslationMode, TranslationResult } from '@/shared/types';

const response: TranslationResult = {
  words: [{ original: 'Ubiquitous', translation: '无处不在的', position: [0, 10], difficulty: 7, isPhrase: false }],
  sentences: [], fullText: '无处不在的技术。',
};
const paragraph = () => {
  const element = document.createElement('p');
  element.textContent = 'Ubiquitous technology.';
  document.body.appendChild(element);
  return element;
};
const annotations = (element: HTMLElement) => element.querySelectorAll('.not-translator-inline-translation');

afterEach(() => {
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
  document.body.replaceChildren();
});

describe('已有翻译按当前知识状态派生展示', () => {
  it.each<TranslationMode>(['inline-only', 'bilingual', 'full-translate'])('%s 过滤已知词，但保留完整原始结果以供改未知后本地恢复', mode => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, response, mode);
    expect(annotations(element)).toHaveLength(1);
    const before = element.innerHTML;
    TranslationDisplay.setWordKnown(' ubiquitous ', true);
    expect(element.innerHTML).toBe(before);
    TranslationDisplay.rerenderTranslations(mode);
    expect(annotations(element)).toHaveLength(0);
    expect(response.words).toHaveLength(1);

    TranslationDisplay.setWordKnown('UBIQUITOUS', false);
    TranslationDisplay.rerenderTranslations(mode);
    expect(annotations(element)).toHaveLength(1);
    expect(element.querySelector<HTMLElement>('[data-word]')?.dataset.translation).toBe('无处不在的');
  });

  it('完整快照替换而非叠加，规范化大小写和空白并忽略空项', () => {
    const element = paragraph();
    TranslationDisplay.setKnownWords([' UBIQUITOUS ', ' ', '']);
    TranslationDisplay.applyTranslation(element, response, 'inline-only');
    expect(annotations(element)).toHaveLength(0);
    TranslationDisplay.setKnownWords(['another']);
    TranslationDisplay.rerenderTranslations('inline-only');
    expect(annotations(element)).toHaveLength(1);
  });

  it('先标认识后收到的迟到结果也按当前状态过滤，随后切模式不复活', () => {
    const element = paragraph();
    TranslationDisplay.setWordKnown('ubiquitous', true);
    TranslationDisplay.applyTranslation(element, response, 'inline-only');
    TranslationDisplay.rerenderTranslations('bilingual');
    expect(annotations(element)).toHaveLength(0);
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(annotations(element)).toHaveLength(0);
    expect(element.textContent).toBe(response.fullText);
  });

  it('clearAll 不遗忘当前知识状态，显式空快照才重置', () => {
    const element = paragraph();
    TranslationDisplay.setKnownWords(['ubiquitous']);
    TranslationDisplay.applyTranslation(element, response, 'inline-only');
    TranslationDisplay.clearAll();
    TranslationDisplay.applyTranslation(element, response, 'inline-only');
    expect(annotations(element)).toHaveLength(0);
    TranslationDisplay.setKnownWords([]);
    TranslationDisplay.rerenderTranslations('inline-only');
    expect(annotations(element)).toHaveLength(1);
  });

  it('空增量不更改已有状态，移除不存在的词也不影响已知词', () => {
    const element = paragraph();
    TranslationDisplay.setKnownWords(['ubiquitous']);
    TranslationDisplay.setWordKnown(' ', true);
    TranslationDisplay.setWordKnown('', false);
    TranslationDisplay.setWordKnown('another', false);
    TranslationDisplay.applyTranslation(element, response, 'inline-only');
    expect(annotations(element)).toHaveLength(0);
  });

  it('词义结果过滤为空后缺全文说明准确，撤销认识可恢复原词义', () => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, { ...response, fullText: undefined }, 'inline-only');
    TranslationDisplay.setKnownWords(['ubiquitous']);
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.nextElementSibling?.textContent).toBe('当前没有全文译文，已保留原文');
    TranslationDisplay.setKnownWords([]);
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(annotations(element)).toHaveLength(1);
    expect(element.nextElementSibling?.textContent).toBe('当前仅有词义，暂无全文译文');
  });
});
