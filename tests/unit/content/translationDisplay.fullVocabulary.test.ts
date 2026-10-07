import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TranslationDisplay } from '@/content/translationDisplay';
import { VocabularyHighlighter } from '@/content/vocabularyHighlighter';
import { HoverManager } from '@/content/core/hoverManager';
import { getTranslatableText } from '@/content/pageScanner';
import type { Tooltip } from '@/content/tooltip';
import type { TranslationResult } from '@/shared/types';

const original = 'The democratization of publishing tools empowers independent writers.';
const response: TranslationResult = {
  words: [{ original: 'democratization', translation: '民主化', position: [4, 18], difficulty: 8, isPhrase: false }],
  sentences: [], fullText: '出版工具的民主化赋予独立作者力量。',
};
const paragraph = () => {
  const element = document.createElement('p');
  element.textContent = original;
  document.body.appendChild(element);
  return element;
};
const hoverOver = (manager: HoverManager, element: HTMLElement) => {
  element.addEventListener('mouseover', event => manager.handleMouseOver(event), { once: true });
  element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, ctrlKey: true }));
};

afterEach(() => {
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
  document.body.replaceChildren();
});

describe('全文模式不把英语CEFR装饰与交互赋给中文片段', () => {
  it('真实CEFR高亮进入全文后中文无等级装饰或旧英文hover，合法英文注释仍唯一且可交互', () => {
    const element = paragraph();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(element);
    const wrappers = Array.from(element.querySelectorAll<HTMLElement>('mark.not-translator-vocab-highlight'));
    expect(wrappers.length).toBeGreaterThan(1);
    const shown: HTMLElement[] = [];
    const hover = new HoverManager({ hide() {}, getPinned: () => false } as Tooltip, target => shown.push(target));
    const style = document.createElement('style');
    style.textContent = readFileSync('src/content/styles.css', 'utf8');
    document.head.appendChild(style);
    try {
      TranslationDisplay.applyTranslation(element, response, 'full-translate');
      expect(getTranslatableText(element)).toBe(response.fullText);
      expect(element.querySelectorAll('.not-translator-vocab-highlight')).toHaveLength(0);
      for (const wrapper of wrappers) {
        expect(wrapper.isConnected).toBe(true);
        expect(wrapper.getAttribute('data-word')).toBeNull();
        expect(wrapper.getAttribute('data-level')).toBeNull();
        expect(wrapper.getAttribute('title')).toBeNull();
        expect(wrapper.getAttribute('tabindex')).toBeNull();
        expect(getComputedStyle(wrapper).backgroundColor).toBe('rgba(0, 0, 0, 0)');
        expect(getComputedStyle(wrapper).borderBottomStyle).not.toBe('solid');
        hoverOver(hover, wrapper);
      }
      expect(shown).toHaveLength(0);
      const annotation = document.querySelectorAll<HTMLElement>('.not-translator-inline-translation');
      expect(annotation).toHaveLength(1);
      expect(annotation[0].textContent).toBe('democratization');
      hoverOver(hover, annotation[0]);
      expect(shown).toHaveLength(1);
      expect(shown[0].dataset.word).toBe('democratization');
      expect(shown[0].dataset.translation).toBe('民主化');
    } finally {
      style.remove();
      hover.destroy();
      highlighter.destroy();
    }
  });

  it('中文片段经过真实hover路由不能再选择旧英文词汇卡目标', () => {
    const element = paragraph();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(element);
    const wrapper = element.querySelector<HTMLElement>('[data-word="publishing"]')!;
    const shown: HTMLElement[] = [];
    const hover = new HoverManager({ hide() {}, getPinned: () => false } as Tooltip, target => shown.push(target));
    try {
      TranslationDisplay.applyTranslation(element, response, 'full-translate');
      expect(wrapper.textContent).toMatch(/\p{Script=Han}/u);
      hoverOver(hover, wrapper);
      expect(shown).toHaveLength(0);
    } finally { hover.destroy(); highlighter.destroy(); }
  });

  it.each(['inline-only', 'bilingual'] as const)('全文切回%s恢复同一CEFR节点的等级、tooltip与原英文', mode => {
    const element = paragraph();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(element);
    const wrapper = element.querySelector<HTMLElement>('[data-word="publishing"]')!;
    const attributes = Object.fromEntries(Array.from(wrapper.attributes, attribute => [attribute.name, attribute.value]));
    try {
      TranslationDisplay.applyTranslation(element, response, 'full-translate');
      expect(wrapper.matches('.not-translator-vocab-highlight')).toBe(false);
      TranslationDisplay.rerenderTranslations(mode);
      expect(getTranslatableText(element)).toBe(original);
      expect(element.querySelector('[data-word="publishing"]')).toBe(wrapper);
      expect(Object.fromEntries(Array.from(wrapper.attributes, attribute => [attribute.name, attribute.value]))).toEqual(attributes);
      expect(wrapper.textContent).toBe('publishing');
      expect(element.querySelectorAll('.not-translator-inline-translation')).toHaveLength(1);
    } finally { highlighter.destroy(); }
  });

  it('网站改写中性词汇节点属性时先拒绝整段撤销，不覆盖属性或半恢复英文', () => {
    const element = paragraph();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(element);
    const wrapper = element.querySelector<HTMLElement>('[data-word="publishing"]')!;
    try {
      TranslationDisplay.applyTranslation(element, response, 'full-translate');
      wrapper.title = '网站刚修改的标题';
      const currentHtml = element.innerHTML;
      TranslationDisplay.clearTranslation(element);
      expect(element.innerHTML).toBe(currentHtml);
      expect(wrapper.title).toBe('网站刚修改的标题');
      TranslationDisplay.rerenderTranslations('inline-only');
      expect(element.innerHTML).toBe(currentHtml);
    } finally { highlighter.destroy(); }
  });

  it('后代变隐藏后保留其词汇包装和属性，仅暂停仍可译正文上的英语装饰', () => {
    const element = paragraph();
    element.innerHTML = '<span>publishing tools</span> and democratization empower writers.';
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(element);
    const hidden = element.querySelector('span')!;
    hidden.hidden = true;
    const originalHtml = hidden.innerHTML;
    const originalMark = hidden.querySelector('mark');
    try {
      TranslationDisplay.applyTranslation(element, response, 'full-translate');
      expect(hidden.innerHTML).toBe(originalHtml);
      expect(hidden.querySelector('mark')).toBe(originalMark);
      expect(getTranslatableText(element)).toBe(response.fullText);
      TranslationDisplay.clearTranslation(element);
      expect(hidden.innerHTML).toBe(originalHtml);
      expect(hidden.querySelector('mark')).toBe(originalMark);
    } finally { highlighter.destroy(); }
  });

  it('原来缺失的title和tabindex在恢复后仍保持缺失', () => {
    const element = paragraph();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(element);
    const wrapper = element.querySelector<HTMLElement>('[data-word="publishing"]')!;
    wrapper.removeAttribute('title');
    wrapper.removeAttribute('tabindex');
    try {
      TranslationDisplay.applyTranslation(element, response, 'full-translate');
      TranslationDisplay.rerenderTranslations('inline-only');
      expect(wrapper.getAttribute('title')).toBeNull();
      expect(wrapper.getAttribute('tabindex')).toBeNull();
      expect(wrapper.dataset.word).toBe('publishing');
    } finally { highlighter.destroy(); }
  });

  it('全文词汇同步仍保持中文中性，并保留原链接、表单值及事件', () => {
    const element = paragraph();
    element.innerHTML = 'The democratization of <a href="#target">publishing tools</a> empowers writers.<textarea>初始值</textarea>';
    const link = element.querySelector('a')!;
    const textarea = element.querySelector('textarea')!;
    let clicks = 0;
    link.addEventListener('click', event => { event.preventDefault(); clicks++; });
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(element);
    try {
      TranslationDisplay.applyTranslation(element, response, 'full-translate');
      textarea.value = '用户新编辑';
      highlighter.applySnapshot({ userLevel: 'A1', knownWords: new Set(), unknownWords: new Set() });
      expect(element.querySelectorAll('.not-translator-vocab-highlight')).toHaveLength(0);
      expect(getTranslatableText(element)).toBe(response.fullText);
      expect(element.querySelector('a')).toBe(link);
      expect(element.querySelector('textarea')).toBe(textarea);
      expect(textarea.value).toBe('用户新编辑');
      TranslationDisplay.rerenderTranslations('inline-only');
      expect(element.querySelector('a')).toBe(link);
      expect(textarea.value).toBe('用户新编辑');
      link.click();
      expect(clicks).toBe(1);
    } finally { highlighter.destroy(); }
  });
});
