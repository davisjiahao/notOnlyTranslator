import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationDisplay } from '@/content/translationDisplay';
import { getTranslatableText } from '@/content/pageScanner';
import type { TranslatedWord, TranslationMode, TranslationResult } from '@/shared/types';

const word = (original = 'bank', translation = '银行', position: [number, number] = [0, 4]): TranslatedWord => ({
  original, translation, position, difficulty: 6, isPhrase: original.includes(' '),
});
const result = (words = [word()], fullText = '银行和河岸。'): TranslationResult => ({ words, fullText, sentences: [] });
const paragraph = (html = 'bank and bank'): HTMLElement => {
  const element = document.createElement('p');
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
};
const meanings = (element: HTMLElement) => Array.from(element.querySelectorAll<HTMLElement>('mark.not-translator-highlight'),
  mark => [mark.dataset.word, mark.dataset.translation]);

afterEach(() => {
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
  document.body.replaceChildren();
});

describe('展示恢复只触碰仍有资格的正文节点', () => {
  it.each(['contenteditable', 'hidden', 'data-notranslate'])('清空不恢复已变为 %s 的当前改稿，并废弃快照和结果', attribute => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    element.setAttribute(attribute, '');
    element.textContent = '用户刚写的新稿';
    TranslationDisplay.clearAll();

    expect(element.textContent).toBe('用户刚写的新稿');
    expect(element.dataset.originalHtml).toBeUndefined();
    expect(element.dataset.originalText).toBeUndefined();
    element.removeAttribute(attribute);
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.textContent).toBe('用户刚写的新稿');
    TranslationDisplay.clearTranslation(element);
    expect(element.textContent).toBe('用户刚写的新稿');
  });

  it.each<TranslationMode>(['inline-only', 'bilingual', 'full-translate'])('%s 往返重绘保留受保护节点身份、实时表单值、载荷和链接事件', first => {
    const element = paragraph('bank <a href="#target">and bank</a><textarea>初值</textarea><form><input value="初值"></form><span hidden>旧隐藏内容</span><script type="application/json">{"v":1}</script>');
    const textarea = element.querySelector('textarea')!;
    const input = element.querySelector('input')!;
    const hidden = element.querySelector<HTMLElement>('[hidden]')!;
    const script = element.querySelector('script')!;
    const link = element.querySelector('a')!;
    const click = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', click);
    TranslationDisplay.applyTranslation(element, result(), first);
    textarea.value = '未保存的编辑';
    input.value = '新表单值';
    hidden.textContent = '新隐藏内容';
    script.textContent = '{"v":2}';

    for (const mode of ['bilingual', 'full-translate', 'inline-only'] as const) {
      TranslationDisplay.rerenderTranslations(mode);
      expect(element.querySelector('textarea')).toBe(textarea);
      expect(element.querySelector('input')).toBe(input);
      expect(textarea.value).toBe('未保存的编辑');
      expect(input.value).toBe('新表单值');
      expect(element.querySelector('[hidden]')).toBe(hidden);
      expect(hidden.textContent).toBe('新隐藏内容');
      expect(element.querySelector('script')).toBe(script);
      expect(script.textContent).toBe('{"v":2}');
      expect(element.querySelector('a')).toBe(link);
    }
    TranslationDisplay.clearTranslation(element);
    expect(getTranslatableText(element)).toBe('bank and bank');
    expect(element.querySelector('textarea')).toBe(textarea);
    link.click();
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('终止展示删除快照，下一轮采集网站的新正文而不是复活旧正文', () => {
    const element = paragraph('bank A');
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    TranslationDisplay.clearAll();
    expect(element.dataset.originalHtml).toBeUndefined();
    expect(element.dataset.originalText).toBeUndefined();
    element.textContent = 'bank B';
    TranslationDisplay.applyTranslation(element, result(), 'full-translate');
    TranslationDisplay.clearTranslation(element);
    expect(element.textContent).toBe('bank B');
  });

  it('网站已改写生成正文时重绘失败关闭，不覆盖当前文本', () => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    element.textContent = '网站替换的新正文';
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.textContent).toBe('网站替换的新正文');
    expect(element.dataset.originalHtml).toBeUndefined();
  });

  it('生成标记内新增无文本保护节点时清理不能删除该节点或当前表单值', () => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    const input = document.createElement('input');
    input.value = '不能丢失的编辑';
    element.querySelector('mark')!.appendChild(input);
    TranslationDisplay.clearAll();
    expect(element.querySelector('input')).toBe(input);
    expect(input.value).toBe('不能丢失的编辑');
  });

  it('任一撤销记录失效时先整体拒绝，不把其他正文恢复到一半', () => {
    const element = paragraph('<span>bank</span> and bank');
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    element.querySelector('span mark')!.appendChild(document.createElement('input'));
    const currentHtml = element.innerHTML;
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.innerHTML).toBe(currentHtml);
    expect(element.dataset.originalHtml).toBeUndefined();
    TranslationDisplay.rerenderTranslations('bilingual');
    expect(element.innerHTML).toBe(currentHtml);
  });

  it.each(['empty', 'known'])('%s 导致无撤销记录时，网站的新正文不能被缓存旧译文覆盖', kind => {
    const element = paragraph();
    if (kind === 'known') TranslationDisplay.setKnownWords(['bank']);
    TranslationDisplay.applyTranslation(element, result(kind === 'empty' ? [] : [word()], '旧译文'), 'inline-only');
    element.textContent = '网站刚更新的新正文';
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.textContent).toBe('网站刚更新的新正文');
    expect(element.dataset.originalHtml).toBeUndefined();
    expect(element.dataset.originalText).toBeUndefined();
    TranslationDisplay.rerenderTranslations('bilingual');
    expect(element.nextElementSibling).toBeNull();
    expect(element.textContent).toBe('网站刚更新的新正文');
  });

  it.each(['clear', 'rerender'])('%s 前正文追加了新文本时，不撤销既有标记或丢弃新增正文', action => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    element.appendChild(document.createTextNode(' 网站追加的新正文'));
    const currentHtml = element.innerHTML;
    if (action === 'clear') TranslationDisplay.clearAll();
    else TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.innerHTML).toBe(currentHtml);
    expect(element.dataset.originalHtml).toBeUndefined();
    TranslationDisplay.rerenderTranslations('bilingual');
    expect(element.innerHTML).toBe(currentHtml);
  });

  it.each(['hidden', 'contenteditable', 'detached'])('apply 被 %s 门禁拒绝时也失效旧结果，恢复资格后不能复活', state => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    if (state === 'detached') element.remove();
    else element.setAttribute(state, '');
    const currentHtml = element.innerHTML;
    TranslationDisplay.applyTranslation(element, result(), 'full-translate');
    expect(element.innerHTML).toBe(currentHtml);
    expect(element.dataset.originalHtml).toBeUndefined();
    if (state === 'detached') document.body.appendChild(element);
    else element.removeAttribute(state);
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(element.innerHTML).toBe(currentHtml);
  });

  it('直接 apply/save 拒绝断开节点，不写快照、标记或正文', () => {
    const element = document.createElement('p');
    element.textContent = 'bank and bank';
    TranslationDisplay.saveOriginalText(element);
    TranslationDisplay.applyTranslation(element, result(), 'inline-only');
    expect(element.outerHTML).toBe('<p>bank and bank</p>');
  });
});

describe('逐个出现位置的词义与短语优先级', () => {
  it.each<TranslationMode>(['inline-only', 'bilingual'])('%s 只在验证过的两个 bank 位置显示各自词义，模式往返不换义', mode => {
    const element = paragraph();
    const response = result([word(), word('bank', '河岸', [9, 13])]);
    TranslationDisplay.applyTranslation(element, response, mode);
    expect(meanings(element)).toEqual([['bank', '银行'], ['bank', '河岸']]);
    TranslationDisplay.rerenderTranslations(mode === 'inline-only' ? 'bilingual' : 'inline-only');
    expect(meanings(element)).toEqual([['bank', '银行'], ['bank', '河岸']]);
  });

  it.each<TranslationMode>(['inline-only', 'bilingual'])('%s 多义词偏移无效时不随意覆盖其他出现位置', mode => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result([word(), word('bank', '河岸', [100, 104])]), mode);
    expect(meanings(element)).toEqual([['bank', '银行']]);
    expect(document.body.textContent).toContain('河岸');
    expect(Array.from(document.querySelectorAll('.not-translator-translation-line')).some(node => node.textContent?.includes('难词对照'))).toBe(true);
  });

  it('多义位置即使落在独立文本节点内，也必须核验整段原文的单词边界', () => {
    const element = paragraph('river<span>bank</span> and bank');
    TranslationDisplay.applyTranslation(element, result([word('bank', '银行', [5, 9]), word('bank', '河岸', [14, 18])]), 'inline-only');
    expect(meanings(element)).toEqual([['bank', '河岸']]);
    expect(element.querySelector('span')?.textContent).toBe('bank');
    expect(element.nextElementSibling?.textContent).toContain('银行');
  });

  it.each<TranslationMode>(['inline-only', 'bilingual'])('%s 短语优先于重叠的单词，往返仍只有完整短语注释', mode => {
    const element = paragraph('climate change');
    const response = result([word('climate change', '气候变化', [0, 14]), word('change', '变化', [8, 14])], '气候变化');
    TranslationDisplay.applyTranslation(element, response, mode);
    expect(meanings(element)).toEqual([['climate change', '气候变化']]);
    TranslationDisplay.rerenderTranslations(mode === 'inline-only' ? 'bilingual' : 'inline-only');
    expect(meanings(element)).toEqual([['climate change', '气候变化']]);
  });

  it.each<TranslationMode>(['bilingual', 'full-translate'])('%s 零词结果缺全文时准确说明已保留原文', mode => {
    const element = paragraph();
    TranslationDisplay.applyTranslation(element, result([], ''), 'inline-only');
    TranslationDisplay.rerenderTranslations(mode);
    expect(element.textContent).toBe('bank and bank');
    expect(element.nextElementSibling?.textContent).toBe('当前没有全文译文，已保留原文');
  });
});
