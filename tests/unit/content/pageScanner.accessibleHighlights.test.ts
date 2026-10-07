import { afterEach, describe, expect, it } from 'vitest';
import { getTranslatableText, isInExcludedArea } from '@/content/pageScanner';
import { Highlighter } from '@/content/highlighter';

const text = 'The ephemeral nature gives curious readers meaningful context.';

afterEach(() => { document.body.innerHTML = ''; });

describe('可键盘操作的正文高亮边界', () => {
  it('真实高亮添加按钮角色后仍保留完整原文和词内偏移', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    document.body.appendChild(paragraph);
    new Highlighter().highlightWords(paragraph, [{
      original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8,
    }]);

    const mark = paragraph.querySelector('mark')!;
    expect(mark.getAttribute('role')).toBe('button');
    expect(mark.getAttribute('aria-haspopup')).toBe('dialog');
    expect(isInExcludedArea(mark)).toBe(false);
    expect(getTranslatableText(paragraph)).toBe(text);
  });

  it.each([
    '<mark class="not-translator-highlight" data-word="ephemeral">ephemeral</mark>',
    '<mark class="not-translator-vocab-highlight" data-word="ephemeral">ephemeral</mark>',
    '<mark class="not-translator-highlighted-word" data-word="ephemeral">ephemeral</mark>',
    '<mark class="not-translator-highlighted-translation" data-word="ephemeral">ephemeral</mark>',
    '<span class="not-translator-grammar-highlight" data-grammar-original="ephemeral">ephemeral</span>',
  ])('自有正文高亮保持可译，追加中文不进入原文：%s', html => {
    document.body.innerHTML = `<p>The ${html} nature.</p>`;
    const paragraph = document.querySelector('p')!;
    const highlight = paragraph.firstElementChild!;
    highlight.setAttribute('role', 'button');
    highlight.setAttribute('aria-haspopup', 'dialog');
    const annotation = document.createElement('span');
    annotation.className = 'not-translator-inline-translation';
    annotation.textContent = '（短暂的）';
    highlight.appendChild(annotation);

    expect(getTranslatableText(paragraph)).toBe('The ephemeral nature.');
    expect(isInExcludedArea(highlight)).toBe(false);
    expect(isInExcludedArea(annotation)).toBe(true);
  });

  it.each([
    '<div role="button">HOST</div>',
    '<mark role="button">HOST</mark>',
    '<button><mark class="not-translator-highlight" data-word="host" role="button">HOST</mark></button>',
    '<div role="button"><mark class="not-translator-highlight" data-word="host" role="button">HOST</mark></div>',
    '<div hidden><mark class="not-translator-highlight" data-word="host" role="button">HOST</mark></div>',
    '<div contenteditable="true"><mark class="not-translator-highlight" data-word="host" role="button">HOST</mark></div>',
    '<span class="not-translator-grammar-highlight" role="button" aria-hidden="true">HOST</span>',
  ])('宿主按钮和保护区域不因内部高亮而开放：%s', html => {
    document.body.innerHTML = `<main><p>${text}</p>${html}</main>`;
    const main = document.querySelector('main')!;
    expect(getTranslatableText(main)).toBe(text);
    expect(isInExcludedArea(main.lastElementChild!)).toBe(true);
  });
});
