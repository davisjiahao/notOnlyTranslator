import { afterEach, describe, expect, it } from 'vitest';
import { createTranslatableTextWalker, getTranslatableText, PageScanner } from '@/content/pageScanner';
import { TranslationDisplay } from '@/content/translationDisplay';
import { VocabularyHighlighter } from '@/content/vocabularyHighlighter';
import { Highlighter } from '@/content/highlighter';
import type { TranslationResult, UserSettings } from '@/shared/types';

const original = 'The ephemeral nature gives curious readers meaningful context and new ideas.';
const result: TranslationResult = {
  words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8 }],
  sentences: [],
  fullText: '短暂的本质为好奇的读者提供有意义的背景和新想法。',
};

function fixture(): HTMLElement {
  document.body.innerHTML = `<div id="host"><script type="application/json">${JSON.stringify({ props: { contextRegion: original, only: 'interactionlimitbanner transcript' } })}</script><style>/* ${original} */</style><template>${original}</template><noscript>${original}</noscript><span hidden>${original}</span><span style="display:none"><em>${original}</em></span><span style="visibility:hidden">${original}</span><code>${original}</code><p id="story">The <a href="/projects">ephemeral</a> nature gives curious readers meaningful context and new ideas.</p></div>`;
  return document.getElementById('host')!;
}

function excludedSnapshots(host: HTMLElement): string[] {
  return Array.from(host.children).filter(el => el.id !== 'story').map(el => el.outerHTML);
}

afterEach(() => { document.body.innerHTML = ''; });

describe('真实正文遍历隔离 GitHub 隐藏 payload', () => {
  it('共享抽取保持链接词内偏移、Unicode 和原始空白，空根返回空串', () => {
    const host = fixture();
    expect(getTranslatableText(host)).toBe(original);
    const root = document.createElement('div');
    expect(getTranslatableText(root)).toBe('');
    root.innerHTML = '前缀 e<a>phe</a>meral\n &amp; café';
    expect(getTranslatableText(root)).toBe('前缀 ephemeral\n & café');
    const walker = createTranslatableTextWalker(root, { acceptNode: node => node.parentElement?.tagName === 'A' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT });
    expect(walker.nextNode()?.textContent).toBe('phe');
    expect(walker.nextNode()).toBeNull();
  });

  it('隐藏状态改变后重新抽取正文，不复用上次遍历的样式状态', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p style="display:none">The ephemeral nature of existence.</p>';
    document.body.appendChild(root);
    expect(getTranslatableText(root)).toBe('');
    root.querySelector('p')!.style.display = '';
    expect(getTranslatableText(root)).toBe('The ephemeral nature of existence.');
    root.style.visibility = 'hidden';
    expect(getTranslatableText(root)).toBe('');
  });

  it('只含不可译后代的父块全文翻译不删除载荷、表单或隐藏内容', () => {
    const root = document.createElement('div');
    root.innerHTML = '<script type="application/json">{"only":"ephemeral"}</script><form><span>formOnlyPayload</span><textarea>draft</textarea><select><option>option</option></select></form><div contenteditable="true">draftOnlyPayload</div><span hidden>hiddenOnlyPayload</span>';
    document.body.appendChild(root);
    const before = root.innerHTML;
    expect(getTranslatableText(root)).toBe('');
    TranslationDisplay.applyTranslation(root, result, 'full-translate');
    expect(root.innerHTML).toBe(before);
  });

  it('仅包含脚本和普通正文时，全文翻译仍保留脚本节点及内容', () => {
    const root = document.createElement('div');
    root.innerHTML = '<script type="application/json">{"only":"payload"}</script>Hello world.';
    document.body.appendChild(root);
    const script = root.firstChild;
    TranslationDisplay.applyTranslation(root, { words: [], sentences: [{ original: 'Hello world.', translation: '你好世界。', position: [0, 12] }], fullText: '你好世界。' }, 'full-translate');
    expect(root.firstChild).toBe(script);
    expect(script?.textContent).toBe('{"only":"payload"}');
    expect(getTranslatableText(root)).toBe('你好世界。');
  });

  it.each([
    'International interdisciplinary communication improves accessibility.',
    'International <a href="/communication">interdisciplinary communication</a> improves accessibility.',
    '<strong>Hello</strong> world.',
  ])('只有 fullText 的全文响应替换所有可译节点且保留保护后代：%s', html => {
    const root = document.createElement('p');
    root.innerHTML = `${html}<span hidden>payload</span><script type="application/json">{"only":"payload"}</script><textarea>draft</textarea>`;
    document.body.appendChild(root);
    const protectedNodes = Array.from(root.querySelectorAll('[hidden], script, textarea'));
    const before = protectedNodes.map(node => node.outerHTML);
    const link = root.querySelector('a');
    const fullText = '国际跨学科交流改善了无障碍体验。';
    TranslationDisplay.applyTranslation(root, { words: [], sentences: [], fullText }, 'full-translate');
    expect(getTranslatableText(root)).toBe(fullText);
    expect(root.classList.contains('not-translator-full-translated')).toBe(true);
    const remainingProtectedNodes = root.querySelectorAll('[hidden], script, textarea');
    protectedNodes.forEach((node, index) => expect(remainingProtectedNodes[index]).toBe(node));
    expect(protectedNodes.map(node => node.outerHTML)).toEqual(before);
    expect(root.querySelector('a')).toBe(link);
  });

  it('真实词汇高亮拆分的空白节点不得残留在中文全文中', () => {
    const root = document.createElement('p');
    root.textContent = '\n            The democratization of publishing tools has empowered independent writers,\n            while interdisciplinary research teams continue to reshape how institutions\n            approach complex scientific questions in practice.\n        ';
    document.body.appendChild(root);
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    try {
      highlighter.highlightElement(root);
      expect(root.querySelectorAll('mark').length).toBeGreaterThan(1);
      expect(Array.from(root.childNodes).some(node => node.nodeType === Node.TEXT_NODE && node.textContent === ' ')).toBe(true);
      const fullText = '出版工具的民主化赋予独立作者力量，跨学科团队不断改变科研实践。';
      TranslationDisplay.applyTranslation(root, { words: [], sentences: [], fullText }, 'full-translate');
      // 不剥除空格或换行：断言浏览器渲染所用的完整文本本身就是准确译文。
      expect(root.textContent).toBe(fullText);
    } finally { highlighter.destroy(); }
  });

  it('全文分配处理节点间空白而不替换链接、代码或隐藏后代', () => {
    const root = document.createElement('p');
    root.innerHTML = '<a href="/projects">International</a> \n <strong>communication</strong> <code>original-code</code> <span hidden>payload</span>';
    document.body.appendChild(root);
    const link = root.querySelector('a');
    const code = root.querySelector('code');
    const hidden = root.querySelector('[hidden]');
    const fullText = '国际交流改善了无障碍体验。';
    TranslationDisplay.applyTranslation(root, { words: [], sentences: [], fullText }, 'full-translate');
    expect(getTranslatableText(root)).toBe(fullText);
    expect(root.querySelector('a')).toBe(link);
    expect(link?.getAttribute('href')).toBe('/projects');
    expect(root.querySelector('code')).toBe(code);
    expect(code?.textContent).toBe('original-code');
    expect(root.querySelector('[hidden]')).toBe(hidden);
    expect(hidden?.textContent).toBe('payload');
  });

  it('重新渲染前正文失去资格时保留当前结构并废弃旧快照', () => {
    const root = document.createElement('p');
    root.textContent = original;
    document.body.appendChild(root);
    TranslationDisplay.applyTranslation(root, result, 'inline-only');
    root.setAttribute('contenteditable', 'true');
    root.innerHTML = '<strong>User edited draft must survive.</strong>';
    const before = root.innerHTML;
    const draft = root.firstChild;
    TranslationDisplay.applyTranslation(root, { words: [], sentences: [], fullText: '过期译文' }, 'full-translate');
    expect(root.innerHTML).toBe(before);
    expect(root.firstChild).toBe(draft);
    expect(root.getAttribute('contenteditable')).toBe('true');
    expect(root.dataset.originalHtml).toBeUndefined();
    expect(root.dataset.originalText).toBeUndefined();
  });

  it('扫描只返回正文，隐藏祖先内文本不成为段落，零矩形正文仍保留', () => {
    const host = fixture();
    expect(document.getElementById('story')!.getClientRects()).toHaveLength(0);
    const paragraphs = new PageScanner().scanElement(host);
    expect(paragraphs.map(p => p.element.id)).toEqual(['story']);
    expect(paragraphs[0].text.replace(/\s+/g, ' ')).toBe(original);
  });

  it.each(['inline-only', 'bilingual', 'full-translate'] as const)(
    '%s 只修改后置正文，前置同文脚本及其它非正文逐字保持', mode => {
      const host = fixture();
      const before = excludedSnapshots(host);
      TranslationDisplay.applyTranslation(host, result, mode);
      expect(excludedSnapshots(host)).toEqual(before);
      if (mode === 'full-translate') {
        expect(host.querySelector('#story')?.textContent).toBe(result.fullText);
        expect(host.querySelector('#story a')?.getAttribute('href')).toBe('/projects');
      } else {
        expect(host.querySelector('#story mark')).not.toBeNull();
      }
      expect(host.querySelector('script mark')).toBeNull();
    }
  );

  it('语法高亮不被前置 JSON 同文抢占', () => {
    const host = fixture();
    const before = excludedSnapshots(host);
    TranslationDisplay.applyTranslation(host, {
      words: [], sentences: [], grammarPoints: [{ original: 'nature gives curious readers', position: [14, 40], explanation: '主谓结构', type: '句子结构' }],
    }, 'inline-only', { grammarTranslationEnabled: true } as UserSettings);
    expect(excludedSnapshots(host)).toEqual(before);
    expect(host.querySelector('#story .not-translator-grammar-highlight')).not.toBeNull();
  });

  it('真实词汇分析不扫描 JSON-only 词，状态重扫不污染非正文', () => {
    const host = fixture();
    const before = excludedSnapshots(host);
    const highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
    try {
      highlighter.highlightElement(host);
      expect(excludedSnapshots(host)).toEqual(before);
      expect(host.querySelector('#story .not-translator-vocab-highlight[data-word="ephemeral"]')).not.toBeNull();
      highlighter.applySnapshot({ userLevel: 'A1', knownWords: new Set(['ephemeral']), unknownWords: new Set() });
      expect(excludedSnapshots(host)).toEqual(before);
      expect(host.querySelector('#story .not-translator-vocab-highlight[data-word="ephemeral"]')).toBeNull();
    } finally { highlighter.destroy(); }
  });

  it('旧高亮入口同样排除隐藏祖先及代码', () => {
    const host = fixture();
    const before = excludedSnapshots(host);
    new Highlighter().highlightWords(host, result.words);
    expect(excludedSnapshots(host)).toEqual(before);
    expect(host.querySelectorAll('#story mark')).toHaveLength(1);
  });

  it('重复词继续逐次命中正文，局部位置不被前置 JSON 长度影响', () => {
    const host = fixture();
    const story = document.getElementById('story')!;
    story.appendChild(document.createTextNode(' Another ephemeral example.'));
    const before = excludedSnapshots(host);
    TranslationDisplay.applyTranslation(host, { ...result, words: [result.words[0], { ...result.words[0], position: [9, 18] }] }, 'inline-only');
    expect(excludedSnapshots(host)).toEqual(before);
    expect(story.querySelectorAll('mark.not-translator-highlight')).toHaveLength(2);
    expect(story.querySelector('a')?.getAttribute('href')).toBe('/projects');
  });
});
