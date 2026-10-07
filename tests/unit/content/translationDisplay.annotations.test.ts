import { afterEach, describe, expect, it } from 'vitest';
import { TranslationDisplay } from '@/content/translationDisplay';
import { getTranslatableText } from '@/content/pageScanner';
import type { TranslatedWord, TranslationMode, TranslationResult } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants';

const word = (original = 'ubiquitous', translation = '无处不在的'): TranslatedWord => ({
  original, translation, position: [999, 1009], difficulty: 7, isPhrase: false,
});
const result = (words = [word()], fullText = '这种技术是无处不在的。'): TranslationResult => ({
  words, fullText, sentences: [], phrases: [],
});
const paragraph = (html = 'This ubiquitous technology works.'): HTMLElement => {
  const element = document.createElement('p');
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
};
const annotations = (element: Element) => element.querySelectorAll('.not-translator-inline-translation');
const chineseBody = (element: Element) => {
  const clone = element.cloneNode(true) as Element;
  annotations(clone).forEach(node => node.remove());
  return getTranslatableText(clone);
};

afterEach(() => document.body.replaceChildren());

describe('已有结果的纯展示重绘', () => {
  it.each<TranslationMode>(['bilingual', 'full-translate'])('%s 缺全文时保留原文和词义，添加不参与正文抽取的只读说明', mode => {
    const element = paragraph('This <a href="#target">ubiquitous</a> technology.<code>code</code>');
    const originalHtml = element.innerHTML;
    TranslationDisplay.applyTranslation(element, result([word()], ''), 'inline-only');
    TranslationDisplay.rerenderTranslations(mode);

    expect(getTranslatableText(element)).toBe('This ubiquitous technology.');
    expect(annotations(element)).toHaveLength(1);
    const notice = element.nextElementSibling!;
    expect(notice?.textContent).toBe('当前仅有词义，暂无全文译文');
    expect(notice?.classList.contains('not-translator-translation-line')).toBe(true);
    expect(getTranslatableText(notice)).toBe('');
    expect(notice.querySelector('button, a')).toBeNull();
    expect(element.querySelector('code')?.textContent).toBe('code');
    TranslationDisplay.rerenderTranslations('inline-only');
    expect(element.nextElementSibling).toBeNull();
    TranslationDisplay.clearTranslation(element);
    expect(element.innerHTML).toBe(originalHtml);
  });

  it.each<[TranslationMode, TranslationMode]>([
    ['inline-only', 'bilingual'], ['inline-only', 'full-translate'],
    ['bilingual', 'inline-only'], ['bilingual', 'full-translate'],
    ['full-translate', 'inline-only'], ['full-translate', 'bilingual'],
  ])('%s → %s 复用成功结果，不丢失快照或重复注释', (from, to) => {
    const element = paragraph();
    const originalHtml = element.innerHTML;
    TranslationDisplay.applyTranslation(element, result(), from);
    TranslationDisplay.rerenderTranslations(to);
    TranslationDisplay.rerenderTranslations(to);

    expect(annotations(element)).toHaveLength(1);
    expect(element.dataset.originalHtml).toBe(originalHtml);
    if (to === 'full-translate') expect(chineseBody(element)).toBe(result().fullText);
    else expect(getTranslatableText(element)).toBe('This ubiquitous technology works.');
    if (to === 'bilingual') expect(element.nextElementSibling?.textContent).toBe(result().fullText);
    else expect(element.nextElementSibling).toBeNull();
  });

  it('保留语法显示设置，且不扫描或标记没有成功结果的新段落', () => {
    const element = paragraph();
    const untouched = paragraph('An untouched ubiquitous paragraph.');
    TranslationDisplay.applyTranslation(element, {
      ...result(), grammarPoints: [{ original: 'technology works', explanation: '主谓结构', position: [16, 32] }],
    }, 'inline-only', { ...DEFAULT_SETTINGS, grammarTranslationEnabled: true });
    TranslationDisplay.rerenderTranslations('bilingual');

    expect(element.querySelector('.not-translator-grammar-annotation')?.textContent).toContain('主谓结构');
    expect(TranslationDisplay.isProcessed(untouched)).toBe(false);
    expect(untouched.querySelector('mark')).toBeNull();
  });

  it('单段清理同时失效结果，即使外部重新添加processed也不能复活', () => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    TranslationDisplay.clearTranslation(element);
    element.classList.add('not-translator-processed');
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.textContent).toBe('This ubiquitous technology works.');
    expect(annotations(element)).toHaveLength(0);
  });

  it('clearAll 清理页面和断开节点的结果索引，重新连接后不使用旧结果', () => {
    const element = paragraph();
    const detached = paragraph();
    TranslationDisplay.applyTranslation(element, result([word()], ''), 'full-translate');
    TranslationDisplay.applyTranslation(detached, result(), 'inline-only');
    detached.remove();
    const detachedHtml = detached.innerHTML;

    TranslationDisplay.clearAll();
    expect(element.textContent).toBe('This ubiquitous technology works.');
    expect(element.nextElementSibling).toBeNull();
    document.body.appendChild(detached);
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(detached.innerHTML).toBe(detachedHtml);
    expect(detached.classList.contains('not-translator-full-translated')).toBe(false);
  });

  it.each(['hidden', 'contenteditable', 'detached'])('重绘不写入变成 %s 的旧段落', state => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    if (state === 'detached') element.remove();
    else element.setAttribute(state, '');
    const html = element.innerHTML;
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.innerHTML).toBe(html);
    expect(element.classList.contains('not-translator-full-translated')).toBe(false);
  });
});

describe('难词直接呈现', () => {
  it('行内无需 hover 就在英文后显示中文，并保留 tooltip 数据与可扫描原文', () => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');

    const mark = element.querySelector<HTMLElement>('mark')!;
    expect(annotations(mark)[0]?.textContent).toBe('无处不在的');
    expect(mark.firstChild?.textContent).toBe('ubiquitous');
    expect(mark.dataset.word).toBe('ubiquitous');
    expect(mark.dataset.translation).toBe('无处不在的');
    expect(getTranslatableText(element)).toBe('This ubiquitous technology works.');
    expect(element.nextElementSibling).toBeNull();
  });

  it('偏移错误、前面出现词内子串时，仍标注真正的完整单词和重复出现位置', () => {
    const element = paragraph('concatenate cat cat.');
    TranslationDisplay.applyTranslation(element, result([word('cat', '猫')]), 'inline-only');

    expect(annotations(element)).toHaveLength(2);
    expect(element.firstChild?.textContent).toBe('concatenate ');
    expect(getTranslatableText(element)).toBe('concatenate cat cat.');
  });

  it('重复词条不会二次嵌套或将刚插入的中文当作原文匹配', () => {
    const element = paragraph('ubiquitous ubiquitous.');
    TranslationDisplay.applyTranslation(element, result([word(), word(), word('无处不在的', '错误')]), 'inline-only');

    expect(annotations(element)).toHaveLength(2);
    expect(element.querySelector('mark mark')).toBeNull();
    expect(element.textContent).not.toContain('错误');
  });

  it('空原词或空词义不产生空标记', () => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result([word('', '译文'), word('ubiquitous', '')]), 'inline-only');
    expect(element.querySelector('mark')).toBeNull();
  });

  it('全文在真实中文词义后显示英文，并提供正确的 tooltip 数据', () => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'full-translate');

    const mark = element.querySelector<HTMLElement>('.not-translator-highlighted-translation')!;
    expect(mark.firstChild?.textContent).toBe('无处不在的');
    expect(annotations(mark)[0]?.textContent).toBe('ubiquitous');
    expect(mark.dataset.word).toBe('ubiquitous');
    expect(mark.dataset.original).toBe('ubiquitous');
    expect(mark.dataset.translation).toBe('无处不在的');
    expect(mark.tabIndex).toBe(0);
    expect(chineseBody(element)).toBe(result().fullText);
    expect(element.nextElementSibling).toBeNull();
  });

  it.each(['普遍存在的', '无处不在的；普遍的', '在'])('不可靠词义 %s 使用独立难词对照，不修改中文正文', translation => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result([word('ubiquitous', translation)]), 'full-translate');

    expect(element.textContent).toBe(result().fullText);
    const glossary = element.nextElementSibling!;
    expect(glossary?.classList.contains('not-translator-translation-line')).toBe(true);
    expect(glossary?.textContent).toContain(translation);
    expect(annotations(glossary)[0]?.textContent).toBe('ubiquitous');
    expect(glossary.querySelector<HTMLElement>('[data-word]')?.dataset.translation).toBe(translation);
  });

  it('长词义优先，短词义不嵌入已匹配词中，也不会丢失其难词对照', () => {
    const element = paragraph('a ubiquitous place');
    TranslationDisplay.applyTranslation(element, result([word('place', '在的'), word()]), 'full-translate');

    expect(annotations(element)).toHaveLength(1);
    expect(annotations(element)[0].textContent).toBe('ubiquitous');
    expect(element.querySelector('.not-translator-highlighted-translation .not-translator-highlighted-translation')).toBeNull();
    expect(element.nextElementSibling?.textContent).toContain('在的');
    expect(element.nextElementSibling?.textContent).toContain('place');
    expect(chineseBody(element)).toBe(result().fullText);
  });

  it('全文重复词条和重复词义不叠加注释', () => {
    const element = paragraph('ubiquitous ubiquitous');
    const response = result([word(), word()], '无处不在的技术也是无处不在的机会。');
    TranslationDisplay.applyTranslation(element, response, 'full-translate');

    expect(annotations(element)).toHaveLength(2);
    expect(chineseBody(element)).toBe(response.fullText);
    expect(element.nextElementSibling).toBeNull();
  });

  it('不同英文共享相同中文义时不猜测正文对应位置', () => {
    const element = paragraph('ubiquitous omnipresent');
    TranslationDisplay.applyTranslation(element, result([word(), word('omnipresent')]), 'full-translate');

    expect(annotations(element)).toHaveLength(0);
    expect(annotations(element.nextElementSibling!)).toHaveLength(2);
    expect(element.textContent).toBe(result().fullText);
  });

  it('带链接的短段落也逐字保全 fullText，不只替换逐词或逐句结果', () => {
    const element = paragraph('This <a href="#target">ubiquitous</a> technology.');
    const link = element.querySelector('a');
    const response = { ...result(), sentences: [{ original: 'This', translation: '错误逐句' }] };
    TranslationDisplay.applyTranslation(element, response, 'full-translate');

    expect(chineseBody(element)).toBe(response.fullText);
    expect(element.querySelector('a')).toBe(link);
    expect(link?.getAttribute('href')).toBe('#target');
    expect(document.body.textContent).toContain('ubiquitous');
  });

  it.each<TranslationMode>(['inline-only', 'full-translate'])('%s 不改写脚本、样式、表单、代码或隐藏内容', mode => {
    const element = paragraph('This ubiquitous technology.<script>ubiquitous</script><style>ubiquitous</style><form>ubiquitous</form><code>ubiquitous</code><span hidden>ubiquitous</span>');
    const protectedNodes = Array.from(element.children);
    TranslationDisplay.applyTranslation(element, result(), mode);

    protectedNodes.forEach(node => {
      expect(node.textContent).toBe('ubiquitous');
      expect(node.querySelector('mark, .not-translator-highlighted-translation')).toBeNull();
      expect(node.parentElement).toBe(element);
    });
    if (mode === 'full-translate') expect(chineseBody(element)).toBe(result().fullText);
  });

  it.each(['hidden', 'contenteditable'])('在途段落变为 %s 时不保存快照或写入', attribute => {
    const element = paragraph();
    element.setAttribute(attribute, '');
    const originalHtml = element.innerHTML;
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    expect(element.innerHTML).toBe(originalHtml);
    expect(element.dataset.originalHtml).toBeUndefined();
    expect(element.nextElementSibling).toBeNull();
  });

  it('模式往返及批次重复呈现只保留当前注释，清理后精确恢复原 HTML', () => {
    const element = paragraph('This <a href="#target">ubiquitous</a> technology.');
    const originalHtml = element.innerHTML;
    const response = result([word('ubiquitous', '普遍存在的')]);
    for (const mode of ['inline-only', 'full-translate', 'full-translate', 'bilingual', 'inline-only'] as const) {
      TranslationDisplay.saveOriginalText(element);
      TranslationDisplay.applyTranslation(element, response, mode);
      expect(element.dataset.originalHtml).toBe(originalHtml);
      if (mode === 'full-translate') {
        expect(chineseBody(element)).toBe(response.fullText);
        expect(annotations(element.nextElementSibling!)).toHaveLength(1);
      } else {
        expect(annotations(element)).toHaveLength(1);
        expect(getTranslatableText(element)).toBe('This ubiquitous technology.');
        if (mode === 'bilingual') expect(element.nextElementSibling?.textContent).toBe(response.fullText);
        else expect(element.nextElementSibling).toBeNull();
      }
    }
    TranslationDisplay.clearTranslation(element);
    expect(element.innerHTML).toBe(originalHtml);
    expect(element.nextElementSibling).toBeNull();
  });

  it.each<TranslationMode>(['inline-only', 'full-translate'])('%s 的模型内容只作为文本展示，不注入元素', mode => {
    const element = paragraph();
    const malicious = '<img src=x onerror="alert(1)">';
    TranslationDisplay.applyTranslation(element, result([word('ubiquitous', malicious)], `完整译文${malicious}`), mode);

    expect(document.body.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain(malicious);
  });
});
