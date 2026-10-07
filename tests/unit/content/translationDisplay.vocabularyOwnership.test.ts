import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationDisplay } from '@/content/translationDisplay';
import { VocabularyHighlighter } from '@/content/vocabularyHighlighter';
import { VocabularyStateSync } from '@/content/core/vocabularyState';
import type { TranslationMode, TranslationResult } from '@/shared/types';

const fixtures = [
  { text: 'The democratization of publishing tools empowers independent writers.', word: 'democratization', translation: '民主化', fullText: '出版工具的民主化赋予独立作者力量。' },
  { text: 'The counterintuitive findings surprised reviewers and changed research.', word: 'counterintuitive', translation: '违反直觉的', fullText: '违反直觉的发现让评审感到惊讶，并改变了研究。' },
  { text: 'The cat sat on the mat. It was a good day.', fullText: '猫坐在垫子上。那是美好的一天。' },
];
const makeParagraphs = () => fixtures.map(fixture => {
  const paragraph = document.createElement('p');
  paragraph.textContent = fixture.text;
  document.body.appendChild(paragraph);
  return paragraph;
});
const resultAt = (index: number): TranslationResult => {
  const fixture = fixtures[index];
  const original = fixture.word;
  return {
    words: original ? [{ original, translation: fixture.translation!, position: [fixture.text.indexOf(original), fixture.text.indexOf(original) + original.length], difficulty: 8, isPhrase: false }] : [],
    sentences: [], fullText: fixture.fullText,
  };
};
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

afterEach(() => {
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
  document.body.replaceChildren();
});

describe('词汇高亮与翻译显示共享真实正文时的所有权', () => {
  it('真实词汇快照同步和MutationObserver后，有词两段及无词一段均能对照→行内→对照', async () => {
    const paragraphs = makeParagraphs();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElements(paragraphs);
    let mode: TranslationMode = 'bilingual';
    paragraphs.forEach((paragraph, index) => TranslationDisplay.applyTranslation(paragraph, resultAt(index), mode));
    expect(paragraphs[0].querySelector('mark.not-translator-vocab-highlight mark.not-translator-highlight')).not.toBeNull();
    expect(paragraphs[1].querySelector('mark.not-translator-vocab-highlight mark.not-translator-highlight')).not.toBeNull();
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(document.body, { childList: true, subtree: true });
    const sync = new VocabularyStateSync({
      applyVocabularySnapshot(snapshot) {
        TranslationDisplay.setKnownWords(Array.from(snapshot.knownWords));
        highlighter.applySnapshot(snapshot);
        TranslationDisplay.rerenderTranslations(mode);
      },
    }, async () => ({ userLevel: 'A1', knownWords: new Set(), unknownWords: new Set() }));
    try {
      mode = 'inline-only';
      TranslationDisplay.rerenderTranslations(mode);
      await sync.syncNow();
      await settle();
      mode = 'bilingual';
      TranslationDisplay.rerenderTranslations(mode);
      await settle();
      expect(mutations.length).toBeGreaterThan(0);
      expect(document.querySelectorAll('.not-translator-processed')).toHaveLength(3);
      paragraphs.forEach((paragraph, index) => {
        expect(paragraph.nextElementSibling?.classList.contains('not-translator-translation-line')).toBe(true);
        expect(paragraph.nextElementSibling?.textContent).toBe(fixtures[index].fullText);
      });
    } finally {
      observer.disconnect();
      sync.stop();
      highlighter.destroy();
    }
  });

  it('先翻译再插入其他词汇高亮，不能使原有生成文本的恢复记录失效', async () => {
    const paragraphs = makeParagraphs();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    try {
      paragraphs.forEach((paragraph, index) => TranslationDisplay.applyTranslation(paragraph, resultAt(index), 'inline-only'));
      highlighter.highlightElements(paragraphs);
      await settle();
      expect(paragraphs[0].querySelector('mark.not-translator-vocab-highlight')).not.toBeNull();
      TranslationDisplay.rerenderTranslations('bilingual');
      expect(document.querySelectorAll('.not-translator-processed')).toHaveLength(3);
      paragraphs.forEach((paragraph, index) => expect(paragraph.nextElementSibling?.textContent).toBe(fixtures[index].fullText));
    } finally { highlighter.destroy(); }
  });

  it('清理祖先词汇包装后仍能恢复原文并切换全文，不遗留旧父节点依赖', () => {
    const paragraphs = makeParagraphs();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElements(paragraphs);
    paragraphs.forEach((paragraph, index) => TranslationDisplay.applyTranslation(paragraph, resultAt(index), 'inline-only'));
    highlighter.clearAllHighlights();
    TranslationDisplay.rerenderTranslations('bilingual');
    expect(document.querySelectorAll('.not-translator-processed')).toHaveLength(3);
    paragraphs.forEach((paragraph, index) => expect(paragraph.nextElementSibling?.textContent).toBe(fixtures[index].fullText));
    highlighter.destroy();
  });

  it.each(['element', 'known', 'unknown', 'remove-known', 'remove-unknown', 'snapshot', 'disable', 'destroy'])('%s 清理或学习更新后仍可切换展示，局部清理不碰其他段落', operation => {
    const paragraphs = makeParagraphs();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElements(paragraphs);
    paragraphs.forEach((paragraph, index) => TranslationDisplay.applyTranslation(paragraph, resultAt(index), 'inline-only'));
    const untouched = paragraphs[1].querySelector('mark.not-translator-highlight');
    try {
      if (operation === 'element') highlighter.clearElementHighlights(paragraphs[0]);
      if (operation === 'known') highlighter.addKnownWord('democratization');
      if (operation === 'unknown') highlighter.addUnknownWord('democratization');
      if (operation === 'remove-known') highlighter.removeKnownWord('democratization');
      if (operation === 'remove-unknown') highlighter.removeUnknownWord('democratization');
      if (operation === 'snapshot') highlighter.setCustomWords([], ['democratization']);
      if (operation === 'disable') highlighter.updateConfig({ enabled: false });
      if (operation === 'destroy') highlighter.destroy();
      if (operation === 'element') expect(paragraphs[1].querySelector('mark.not-translator-highlight')).toBe(untouched);
      TranslationDisplay.rerenderTranslations('bilingual');
      expect(document.querySelectorAll('.not-translator-processed')).toHaveLength(3);
      paragraphs.forEach((paragraph, index) => expect(paragraph.nextElementSibling?.textContent).toBe(fixtures[index].fullText));
    } finally { highlighter.destroy(); }
  });

  it('初始化、空词事件、断开段落与销毁后的同步不会损坏仍在页面的译文', () => {
    const paragraphs = makeParagraphs();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.setCustomWords([], []);
    highlighter.applySnapshot({ userLevel: 'A1', knownWords: new Set(), unknownWords: new Set() });
    highlighter.highlightElements(paragraphs);
    paragraphs.forEach((paragraph, index) => TranslationDisplay.applyTranslation(paragraph, resultAt(index), 'inline-only'));
    highlighter.addKnownWord(' ');
    paragraphs[0].remove();
    highlighter.rescan();
    highlighter.destroy();
    const current = paragraphs[1].innerHTML;
    highlighter.rescan();
    highlighter.addUnknownWord('counterintuitive');
    expect(paragraphs[1].innerHTML).toBe(current);
    TranslationDisplay.rerenderTranslations('bilingual');
    expect(paragraphs[1].nextElementSibling?.textContent).toBe(fixtures[1].fullText);
  });

  it('同步词汇操作抛错时保留已恢复的原文并传播错误，不重新登记旧展示', () => {
    const paragraphs = makeParagraphs();
    TranslationDisplay.applyTranslation(paragraphs[0], resultAt(0), 'bilingual');
    expect(() => TranslationDisplay.updateVocabularyHighlights([paragraphs[0]], () => {
      throw new Error('词汇更新失败');
    })).toThrow('词汇更新失败');
    expect(paragraphs[0].textContent).toBe(fixtures[0].text);
    expect(TranslationDisplay.isProcessed(paragraphs[0])).toBe(false);
    expect(paragraphs[0].nextElementSibling).toBe(paragraphs[1]);
    TranslationDisplay.rerenderTranslations('inline-only');
    expect(paragraphs[0].querySelector('.not-translator-inline-translation')).toBeNull();
  });

  it.each(['hidden', 'contenteditable', 'detached'])('同步词汇操作中途变为 %s 时不套用旧结果，恢复资格后也不复活', state => {
    const paragraphs = makeParagraphs();
    const element = paragraphs[0];
    TranslationDisplay.applyTranslation(element, resultAt(0), 'bilingual');
    TranslationDisplay.updateVocabularyHighlights([element], () => {
      if (state === 'detached') element.remove();
      else element.setAttribute(state, '');
    });
    expect(element.textContent).toBe(fixtures[0].text);
    expect(TranslationDisplay.isProcessed(element)).toBe(false);
    if (state === 'detached') document.body.appendChild(element);
    else element.removeAttribute(state);
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.textContent).toBe(fixtures[0].text);
    expect(TranslationDisplay.isProcessed(element)).toBe(false);
  });

  it('协调期间正文变化时不把先前成功结果重新写回', () => {
    const paragraphs = makeParagraphs();
    TranslationDisplay.applyTranslation(paragraphs[0], resultAt(0), 'bilingual');
    TranslationDisplay.updateVocabularyHighlights([paragraphs[0]], () => {
      paragraphs[0].textContent = '更新期间的外部新正文';
    });
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(paragraphs[0].textContent).toBe('更新期间的外部新正文');
  });

  it.each(['batch', 'rescan', 'word'])('%s 操作只进入一次协调，不按段落或嵌套入口重复全局查找', operation => {
    const paragraphs = makeParagraphs();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    if (operation !== 'batch') highlighter.highlightElements(paragraphs);
    paragraphs.forEach((paragraph, index) => TranslationDisplay.applyTranslation(paragraph, resultAt(index), 'inline-only'));
    const query = vi.spyOn(document, 'querySelectorAll');
    try {
      if (operation === 'batch') highlighter.highlightElements(paragraphs);
      if (operation === 'rescan') highlighter.rescan();
      if (operation === 'word') highlighter.addUnknownWord('democratization');
      expect(query.mock.calls.filter(([selector]) => selector === '.not-translator-processed')).toHaveLength(1);
      expect(paragraphs.every(paragraph => TranslationDisplay.isProcessed(paragraph))).toBe(true);
      expect(paragraphs[0].querySelector('.not-translator-inline-translation')?.textContent).toBe('民主化');
    } finally {
      query.mockRestore();
      highlighter.destroy();
    }
  });

  it('词汇同步不能借内部重绘覆盖外部编辑或删除插入的表单节点', () => {
    const paragraphs = makeParagraphs();
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElements(paragraphs);
    paragraphs.forEach((paragraph, index) => TranslationDisplay.applyTranslation(paragraph, resultAt(index), 'inline-only'));
    const input = document.createElement('input');
    input.value = '用户的未保存编辑';
    paragraphs[0].querySelector('mark.not-translator-highlight')!.appendChild(input);
    paragraphs[1].appendChild(document.createTextNode(' 网站新增正文'));
    try {
      highlighter.applySnapshot({ userLevel: 'A1', knownWords: new Set(), unknownWords: new Set() });
      TranslationDisplay.rerenderTranslations('full-translate');
      expect(paragraphs[0].querySelector('input')).toBe(input);
      expect(input.value).toBe('用户的未保存编辑');
      expect(paragraphs[1].textContent).toContain('网站新增正文');
    } finally { highlighter.destroy(); }
  });
});
