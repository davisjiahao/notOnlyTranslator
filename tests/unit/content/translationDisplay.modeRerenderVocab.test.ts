import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationDisplay } from '@/content/translationDisplay';
import { VocabularyHighlighter } from '@/content/vocabularyHighlighter';
import { VocabularyStateSync } from '@/content/core/vocabularyState';
import { getTranslatableText, PageScanner } from '@/content/pageScanner';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { TranslationMode, TranslationResult } from '@/shared/types';

const source = 'The democratization of publishing tools empowers independent writers.';
const result: TranslationResult = {
  words: [{ original: 'democratization', translation: '民主化', position: [4, 18], difficulty: 8, isPhrase: false }],
  sentences: [], fullText: '出版工具的民主化赋予独立作者力量。',
};
const savedResult = (element: HTMLElement) => (TranslationDisplay as unknown as {
  results: WeakMap<HTMLElement, { result: TranslationResult; mode: TranslationMode }>;
}).results.get(element);

beforeEach(() => {
  vi.useFakeTimers();
  document.documentElement.lang = 'en';
  document.body.replaceChildren();
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
});
afterEach(() => {
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
  document.body.replaceChildren();
  document.documentElement.removeAttribute('lang');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('模式切换与词汇存储同步不重新请求已完成段落', () => {
  it.each(['inline-only', 'bilingual', 'full-translate'] as const)('全文切到 %s 后经历真实500ms词汇重扫仍保留结果', async targetMode => {
    const paragraph = document.createElement('p');
    paragraph.textContent = source;
    document.body.appendChild(paragraph);
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(paragraph);
    expect(paragraph.querySelectorAll('.not-translator-vocab-highlight').length).toBeGreaterThan(1);
    TranslationDisplay.applyTranslation(paragraph, result, 'full-translate');
    expect(TranslationDisplay.isProcessed(paragraph)).toBe(true);
    let mode: TranslationMode = 'full-translate';
    const onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
    vi.stubGlobal('chrome', { storage: { onChanged } });
    const applySnapshot = vi.fn(snapshot => {
      TranslationDisplay.setKnownWords(Array.from(snapshot.knownWords));
      highlighter.updateConfig({ enabled: true });
      highlighter.applySnapshot(snapshot);
      TranslationDisplay.rerenderTranslations(mode);
    });
    const sync = new VocabularyStateSync({ applyVocabularySnapshot: applySnapshot }, async () => ({
      userLevel: 'A1', knownWords: new Set(), unknownWords: new Set(),
    }));
    sync.start();
    // 每次观察均清缓存，不让先前扫描结果掩盖被重新入队的段落。
    const scanner = new PageScanner();
    // 段落级 spinner 注入已移除：入队动作仅作探针，断言不重新入队即不出现加载指示
    const enqueue = vi.fn();
    const observer = new MutationObserver(() => {
      scanner.clearCache();
      scanner.scan().filter(entry => !TranslationDisplay.isProcessed(entry.element)).forEach(entry => enqueue(entry.element));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      mode = targetMode;
      TranslationDisplay.rerenderTranslations(mode);
      onChanged.addListener.mock.calls[0][0]({ settings: { newValue: { translationMode: mode } } }, 'sync');
      await vi.advanceTimersByTimeAsync(500);
      expect(applySnapshot).toHaveBeenCalledTimes(1);
      expect(TranslationDisplay.isProcessed(paragraph)).toBe(true);
      expect(savedResult(paragraph)?.result).toBe(result);
      expect(savedResult(paragraph)?.mode).toBe(mode);
      expect(enqueue).not.toHaveBeenCalled();
      expect(document.querySelector('.not-translator-loading-spinner')).toBeNull();
      expect(getTranslatableText(paragraph)).toBe(mode === 'full-translate' ? result.fullText : source);
      if (mode === 'bilingual') expect(paragraph.nextElementSibling?.textContent).toBe(result.fullText);
    } finally {
      observer.disconnect();
      sync.stop();
      highlighter.destroy();
    }
  });

  it.each(['inline-only', 'bilingual'] as const)('长段落词汇与语法嵌套、离屏全文切回 %s 不丢结果', async mode => {
    const text = "From Claude Code's perspective, there are two independent limits: GitHub's API rate limits and Claude Code's own usage limits.";
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    document.body.appendChild(paragraph);
    vi.spyOn(paragraph, 'getBoundingClientRect').mockReturnValue({ top: -2000, bottom: -1900, left: 0, right: 800 } as DOMRect);
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    highlighter.highlightElement(paragraph);
    const response: TranslationResult = {
      words: [{ original: 'usage', translation: '使用量', position: [text.indexOf('usage'), text.indexOf('usage') + 5], difficulty: 6, isPhrase: false }],
      sentences: [],
      fullText: '从 Claude Code 的角度来看，有两个独立的限制：GitHub 的 API 速率限制，以及 Claude Code 自身的使用量限制。',
      grammarPoints: ['perspective', 'independent'].map(original => ({
        original, explanation: '修饰后面的名词，明确限制的范围。', type: '定语',
        position: [text.indexOf(original), text.indexOf(original) + original.length],
      })),
    };
    const sync = new VocabularyStateSync({
      applyVocabularySnapshot(snapshot) {
        highlighter.applySnapshot(snapshot);
        TranslationDisplay.rerenderTranslations(mode);
      },
    }, async () => ({ userLevel: 'A1', knownWords: new Set(), unknownWords: new Set() }));
    const mutations = vi.fn();
    const observer = new MutationObserver(mutations);
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      TranslationDisplay.applyTranslation(paragraph, response, 'bilingual', { ...DEFAULT_SETTINGS, grammarTranslationEnabled: true });
      expect(paragraph.querySelector('mark.not-translator-vocab-highlight .not-translator-grammar-highlight')).not.toBeNull();
      expect(paragraph.querySelector('mark.not-translator-vocab-highlight .not-translator-highlight')).not.toBeNull();
      TranslationDisplay.rerenderTranslations('full-translate');
      expect(getTranslatableText(paragraph)).toBe(response.fullText);
      expect(savedResult(paragraph)?.result).toBe(response);
      TranslationDisplay.rerenderTranslations(mode);
      await sync.syncNow();
      await vi.advanceTimersByTimeAsync(500);
      expect(mutations).toHaveBeenCalled();
      expect(TranslationDisplay.isProcessed(paragraph)).toBe(true);
      expect(savedResult(paragraph)?.result).toBe(response);
      expect(savedResult(paragraph)?.mode).toBe(mode);
      expect(getTranslatableText(paragraph)).toBe(text);
      expect(paragraph.querySelector('mark.not-translator-vocab-highlight .not-translator-grammar-highlight')).not.toBeNull();
      expect(document.querySelector('.not-translator-loading-spinner')).toBeNull();
    } finally {
      observer.disconnect();
      sync.stop();
      highlighter.destroy();
    }
  });

  it.each(['内部嵌套', '外部表单', '外部属性'])('全文API词义与语法嵌套：%s 的预检只撤销自有变更', async scenario => {
    const text = "This warning means you are hitting GitHub's API rate limit. Unauthenticated requests are measured carefully; continue with a Personal Access Token to avoid interruption.";
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    document.body.appendChild(paragraph);
    const highlighter = new VocabularyHighlighter({ userLevel: 'C2', enabled: true });
    const unknown = ['warning', 'unauthenticated', 'measured', 'continue', 'interruption'];
    highlighter.setCustomWords((text.toLowerCase().match(/[a-z]+/g) || []).filter(word => !unknown.includes(word)), unknown);
    highlighter.highlightElement(paragraph);
    expect(paragraph.querySelectorAll('.not-translator-vocab-highlight')).toHaveLength(5);
    const response: TranslationResult = {
      words: [{ original: 'API', translation: 'API', position: [text.indexOf('API'), text.indexOf('API') + 3], difficulty: 6, isPhrase: false }],
      sentences: [],
      fullText: '此警告表示你正在触及 GitHub API 的速率限制。未经身份验证的请求会被仔细计量；请使用个人访问令牌继续，以免中断。',
      grammarPoints: [{ original: 'API', explanation: '名词作定语，修饰后面的速率限制。', type: '定语', position: [text.indexOf('API'), text.indexOf('API') + 3] }],
    };
    const sync = new VocabularyStateSync({
      applyVocabularySnapshot(snapshot) {
        highlighter.applySnapshot(snapshot);
        TranslationDisplay.rerenderTranslations('bilingual');
      },
    }, async () => ({ userLevel: 'C2', knownWords: new Set(), unknownWords: new Set(unknown) }));
    try {
      TranslationDisplay.applyTranslation(paragraph, response, 'full-translate', { ...DEFAULT_SETTINGS, grammarTranslationEnabled: true });
      const grammar = paragraph.querySelector<HTMLElement>('.not-translator-highlighted-translation .not-translator-grammar-highlight')!;
      expect(grammar).not.toBeNull();
      expect(savedResult(paragraph)?.result).toBe(response);
      if (scenario !== '内部嵌套') {
        const input = document.createElement('input');
        input.value = '不能被内部撤销删除的未保存编辑';
        if (scenario === '外部表单') grammar.appendChild(input);
        else grammar.title = '网站改写了语法节点';
        const current = paragraph.innerHTML;
        TranslationDisplay.rerenderTranslations('bilingual');
        expect(savedResult(paragraph)).toBeUndefined();
        expect(TranslationDisplay.isProcessed(paragraph)).toBe(true);
        expect(paragraph.innerHTML).toBe(current);
        if (scenario === '外部表单') expect(paragraph.querySelector('input')).toBe(input);
        return;
      }
      TranslationDisplay.rerenderTranslations('bilingual');
      await sync.syncNow();
      expect(TranslationDisplay.isProcessed(paragraph)).toBe(true);
      expect(savedResult(paragraph)?.result).toBe(response);
      expect(getTranslatableText(paragraph)).toBe(text);
      expect(paragraph.nextElementSibling?.textContent).toContain(response.fullText);
    } finally {
      sync.stop();
      highlighter.destroy();
    }
  });

  it('外部结构改写导致失败关闭时保留完成标记和当前节点，只废弃旧结果', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = source;
    document.body.appendChild(paragraph);
    TranslationDisplay.applyTranslation(paragraph, result, 'inline-only');
    const input = document.createElement('input');
    input.value = '用户未保存的编辑';
    paragraph.querySelector('mark')!.appendChild(input);
    const currentHtml = paragraph.innerHTML;
    TranslationDisplay.rerenderTranslations('bilingual');
    expect(TranslationDisplay.isProcessed(paragraph)).toBe(true);
    expect(savedResult(paragraph)).toBeUndefined();
    expect(paragraph.innerHTML).toBe(currentHtml);
    expect(paragraph.querySelector('input')).toBe(input);
    expect(input.value).toBe('用户未保存的编辑');
    TranslationDisplay.clearAll();
    expect(TranslationDisplay.isProcessed(paragraph)).toBe(false);
  });
});
