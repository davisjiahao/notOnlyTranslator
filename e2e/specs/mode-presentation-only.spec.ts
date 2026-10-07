import { readFile } from 'node:fs/promises';
import type { Locator, Page, Worker } from '@playwright/test';
import type { TranslationMode } from '../../src/shared/types';
import { TIMING } from '../../src/shared/constants';
import {
  test as base, expect, PARAGRAPHS, SPINNER, LOADING, releaseReply, observeCallCount, expectNoVisibleVocabDecorations, type LlmScope,
} from '../fixtures/fake-llm-extension';

const MODES = {
  'inline-only': '行内', bilingual: '对照', 'full-translate': '全文',
} satisfies Record<TranslationMode, string>;
const WORDS = [
  { id: 'para-alpha', original: 'democratization', translation: '民主化' },
  { id: 'para-beta', original: 'counterintuitive', translation: '违反直觉的' },
];
// v2 失败 trace 中这两处普通中文确被旧 CEFR 包装覆盖，不属于合法难词注释。
const CHINESE_HOVER_TARGETS = [
  { id: 'para-alpha', offset: 17, character: '跨', oldWord: 'continue' },
  { id: 'para-beta', offset: 9, character: '令', oldWord: 'measured' },
];
const ANNOTATION = '.not-translator-inline-translation';
const callCount = (worker: Worker) => worker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length);

async function expectSettled(page: Page, mode: TranslationMode): Promise<void> {
  const originals = mode === 'inline-only' ? await page.evaluate(html => Object.fromEntries(Array.from(
    new DOMParser().parseFromString(html, 'text/html').querySelectorAll('#content > p'),
    paragraph => [paragraph.id, (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim()]
  )), await readFile(new URL('../fixtures/local-first-reading.html', import.meta.url), 'utf8')) : {};
  await expect(page.locator('.not-translator-floating-btn-text')).toHaveText(MODES[mode]);
  await expect(page.locator('#content > .not-translator-processed')).toHaveCount(3);
  await expect(page.locator(`${SPINNER}, ${LOADING}, .not-translator-translating`)).toHaveCount(0);
  const lines = page.locator('.not-translator-translation-line');
  await expect(lines.filter({ hasNotText: /^难词对照：/ })).toHaveCount(mode === 'bilingual' ? 3 : 0);
  if (mode === 'full-translate') await expectFullAnnotations(page);
  else await expect(lines.filter({ hasText: /^难词对照：/ })).toHaveCount(0);
  for (const paragraph of PARAGRAPHS.slice(0, 3)) {
    const element = page.locator(`#${paragraph.id}`);
    await expect(element).toBeVisible();
    await expect(element).toHaveCSS('opacity', '1');
    await expect(element).not.toHaveClass(/not-translator-fade-out/);
    if (mode === 'full-translate') {
      await expect(element).toHaveClass(/not-translator-full-translated/);
      await expect(element).toContainText(paragraph.translation.slice(0, 4));
    } else {
      await expect(element).not.toHaveClass(/not-translator-full-translated/);
      if (mode === 'inline-only') {
        // 只在脱离页面的副本中去掉生成注释，完整英文必须逐字恢复。
        await expect.poll(() => element.evaluate(node => {
          const clone = node.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('mark.not-translator-highlight[data-word][data-translation] > .not-translator-inline-translation')
            .forEach(annotation => annotation.remove());
          return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
        })).toBe(originals[paragraph.id]);
      } else {
        await expect(element).toContainText(paragraph.source);
      }
    }
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function selectMode(page: Page, mode: TranslationMode): Promise<void> {
  await page.getByRole('button', { name: '翻译模式切换', exact: true }).click();
  await page.locator(`.not-translator-floating-mode-item[data-mode="${mode}"]`).click();
  await expectSettled(page, mode);
}

// 只计入翻译注释的 CSS 括号，不混入词汇等级徽标；不修改页面或生产数据。
async function displayedText(locator: Locator): Promise<string> {
  return locator.evaluate(element => {
    const pseudo = (node: Element, part: string) => {
      if (!node.matches('.not-translator-inline-translation')) return '';
      const content = getComputedStyle(node, part).content;
      return content === 'none' || content === 'normal' ? '' : content.replace(/^["']|["']$/g, '');
    };
    const read = (node: Node): string => node instanceof Element
      ? pseudo(node, '::before') + Array.from(node.childNodes, read).join('') + pseudo(node, '::after')
      : node.textContent ?? '';
    return read(element).replace(/\s+/g, ' ').trim();
  });
}

async function expectFullAnnotations(page: Page): Promise<void> {
  const glossaryCounts = await Promise.all(WORDS.map(async word => {
    const paragraph = page.locator(`#${word.id}`);
    const glossary = page.locator(`#${word.id} + .not-translator-translation-line`);
    const annotation = page.locator(`#${word.id} ${ANNOTATION}, #${word.id} + .not-translator-translation-line ${ANNOTATION}`);
    await expect(annotation).toHaveCount(1);
    await expect(annotation).toHaveText(word.original);
    await expect(annotation).toBeVisible();
    const inParagraph = await paragraph.locator(ANNOTATION).count();
    await expect(glossary).toHaveCount(inParagraph ? 0 : 1);
    const text = await displayedText(inParagraph ? paragraph : glossary);
    const pair = `${word.translation}\\s*[（(]${word.original}[）)]`;
    expect(text).toMatch(new RegExp(inParagraph ? pair : `^难词对照：\\s*${pair}$`));
    expect(text.match(/[（(]/g)).toHaveLength(1);
    expect(text.match(/[）)]/g)).toHaveLength(1);
    if (!inParagraph) {
      await expect(glossary).toBeVisible();
      await expect(glossary).toHaveCSS('opacity', '1');
    }
    return inParagraph ? 0 : 1;
  }));
  await expect(page.locator('.not-translator-translation-line')).toHaveCount(glossaryCounts.reduce<number>((sum, count) => sum + count, 0));
  await expect(page.locator(`#content ${ANNOTATION}`)).toHaveCount(WORDS.length);
  for (const paragraph of PARAGRAPHS.slice(0, 3)) {
    const element = page.locator(`#${paragraph.id}`);
    await expect.poll(() => element.evaluate(node => {
      const clone = node.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.not-translator-highlighted-translation > .not-translator-inline-translation')
        .forEach(annotation => annotation.remove());
      return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
    })).toBe(paragraph.translation);
    await expectNoVisibleVocabDecorations(element);
  }
}

async function expectNoOldWordCard(page: Page, target: typeof CHINESE_HOVER_TARGETS[number]): Promise<void> {
  await page.mouse.move(0, 0);
  await expect(page.locator('.not-translator-tooltip-visible')).toHaveCount(0);
  // 只读 Range 定位旧 trace 的错误覆盖位置，英文注释不计入中文正文偏移。
  const point = await page.locator(`#${target.id}`).evaluate((element, expected) => {
    let remaining = expected.offset;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('.not-translator-inline-translation')) continue;
      const length = node.textContent?.length ?? 0;
      if (remaining >= length) { remaining -= length; continue; }
      if (node.textContent?.[remaining] !== expected.character) throw new Error('正文悬停偏移不再对应旧 trace 的汉字');
      const range = document.createRange();
      range.setStart(node, remaining);
      range.setEnd(node, remaining + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error('正文悬停汉字不可见');
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error('无法定位全文悬停文本节点');
  }, target);
  await page.mouse.move(point.x, point.y);
  const seen = await page.evaluate(async ({ duration, interval }) => {
    const started = performance.now();
    const sample = () => Array.from(document.querySelectorAll('.not-translator-tooltip-visible'), node => node.textContent ?? '');
    let cards = sample();
    while (performance.now() - started < duration) {
      await new Promise<void>(resolve => setTimeout(resolve, interval));
      cards = [...cards, ...sample()];
    }
    return cards;
  }, { duration: TIMING.DEFAULT_HOVER_DELAY + TIMING.MODE_SWITCH_TRANSITION + TIMING.TOOLTIP_HIDE_DELAY, interval: TIMING.SELECTION_DELAY });
  await test.info().attach(`full-chinese-hover-${target.id}`, { body: JSON.stringify({ target, point, seen }), contentType: 'application/json' });
  expect(seen, '悬停普通中文正文不得弹出旧英语词卡').toEqual([]);
  await expectNoVisibleVocabDecorations(page.locator(`#${target.id}`));
  await page.mouse.move(0, 0);
}

const test = base.extend<{ ready: { page: Page; baseline: number; originals: Record<string, string> } }>({
  ready: async ({ llmWorker, openTestPage }, use, testInfo) => {
    await llmWorker.evaluate(async () => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: { ...settings, hoverDelay: 500 } });
    });
    await releaseReply(llmWorker, 'annotated');
    const page = await openTestPage();
    await expectSettled(page, 'bilingual');
    for (const paragraph of PARAGRAPHS.slice(0, 3)) {
      await expect(page.locator(`#${paragraph.id} + .not-translator-translation-line`)).toHaveText(paragraph.translation);
    }
    for (const word of WORDS) {
      await expect(page.locator(`#${word.id} [data-word="${word.original}"]`).first()).toBeVisible();
    }
    const originals = await page.evaluate(html => Object.fromEntries(Array.from(
      new DOMParser().parseFromString(html, 'text/html').querySelectorAll('#content > p'),
      paragraph => [paragraph.id, (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim()]
    )), await readFile(new URL('../fixtures/local-first-reading.html', import.meta.url), 'utf8'));
    const baseline = await callCount(llmWorker);
    expect(baseline, '首轮必须经过真实后台 HTTP 边界，不能 seed 现成结果').toBeGreaterThan(0);
    await testInfo.attach('completed-initial-http-baseline', {
      body: JSON.stringify({ baseline, originals }), contentType: 'application/json',
    });
    await use({ page, baseline, originals });
    const calls = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
    const submitted = calls.flatMap(call => call.messages.filter(message => message.role === 'user'))
      .flatMap(message => [...message.content.matchAll(/^\[PARA_\d+\]\n([^\n]+)/gm)].map(match => match[1]));
    expect(submitted.length).toBeGreaterThan(0);
    for (const text of submitted) {
      expect(text, '请求正文不能混入行内注释、旧译文或括号').not.toMatch(/[㐀-鿿（）()]/);
      expect(Object.values(originals)).toContain(text.replace(/\s+/g, ' ').trim());
    }
  },
});

test.describe('完整结果的三模式纯展示切换', () => {
  for (const from of Object.keys(MODES) as TranslationMode[]) {
    for (const to of Object.keys(MODES) as TranslationMode[]) {
      if (from === to) continue;
      test(`${MODES[from]}→${MODES[to]}及往返不新增 HTTP 翻译请求`, async ({ ready, llmWorker }, testInfo) => {
        const { page, baseline } = ready;
        if (from !== 'bilingual') {
          await selectMode(page, from);
          expect.soft(await observeCallCount(llmWorker, from), '准备来源模式也只能重绘首轮结果').toBe(baseline);
        }
        for (const [index, mode] of [to, from, to].entries()) {
          await test.step(`第 ${index + 1} 次切换至${MODES[mode]}`, async () => {
            await selectMode(page, mode);
            const count = await observeCallCount(llmWorker, mode);
            await testInfo.attach(`switch-${index}-${mode}`, {
              body: JSON.stringify({ baseline, count, text: await page.locator('#content').innerText() }),
              contentType: 'application/json',
            });
            expect.soft(count, `${from}→${mode}必须只重绘，不发新的 HTTP 翻译请求`).toBe(baseline);
          });
        }
      });
    }
  }

  test('行内无需 hover 即见难词中文，往返不累积括号且仍可打开 tooltip', async ({ ready, llmWorker }) => {
    const { page, baseline, originals } = ready;
    for (let round = 0; round < 2; round++) {
      await selectMode(page, 'inline-only');
      await expect(page.locator('.not-translator-tooltip-visible')).toHaveCount(0);
      for (const word of WORDS) {
        const paragraph = page.locator(`#${word.id}`);
        const annotation = paragraph.locator(ANNOTATION);
        await expect(annotation).toHaveCount(1);
        await expect(annotation).toBeVisible();
        const text = await displayedText(paragraph);
        expect(text).toMatch(new RegExp(`${word.original}\\s*[（(]${word.translation}[）)]`));
        expect(text.replace(new RegExp(`\\s*[（(]${word.translation}[）)]`), '')).toBe(originals[word.id]);
        expect(text.match(/[（(]/g)).toHaveLength(1);
        expect(text.match(/[）)]/g)).toHaveLength(1);
      }
      const word = page.locator('#para-beta [data-word="counterintuitive"]').first();
      await word.hover();
      const tooltip = page.locator('.not-translator-tooltip-visible');
      await expect(tooltip).toBeVisible();
      await expect(tooltip.locator('.not-translator-tooltip-translation')).toContainText('违反直觉的');
      await page.mouse.move(0, 0);
      await expect(tooltip).toHaveCount(0);
      await selectMode(page, 'bilingual');
      expect(await observeCallCount(llmWorker, 'bilingual')).toBe(baseline);
    }
  });

  test('全文保留中文全文与难词英文注释，往返无多余原文或重复括号', async ({ ready, llmWorker }) => {
    const { page, baseline } = ready;
    expect(await llmWorker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.hoverDelay))
      .toBe(TIMING.DEFAULT_HOVER_DELAY);
    for (let round = 0; round < 2; round++) {
      await selectMode(page, 'full-translate');
      for (const word of WORDS) {
        const translatedWord = page.locator(`#${word.id} .not-translator-highlighted-translation[data-word="${word.original}"], #${word.id} + .not-translator-translation-line .not-translator-highlighted-translation[data-word="${word.original}"]`);
        await translatedWord.hover();
        const tooltip = page.locator('.not-translator-tooltip-visible');
        await expect(tooltip).toBeVisible();
        await expect(tooltip.locator('.not-translator-tooltip-word')).toHaveText(word.original);
        await expect(tooltip.locator('.not-translator-tooltip-translation')).toContainText(word.translation);
        await page.mouse.move(0, 0);
        await expect(tooltip).toHaveCount(0);
      }
      for (const target of CHINESE_HOVER_TARGETS) await expectNoOldWordCard(page, target);
      await expect(page.locator('#para-simple')).toHaveText(PARAGRAPHS[2].translation);
      await selectMode(page, 'bilingual');
      for (const target of CHINESE_HOVER_TARGETS) {
        const english = page.locator(`#${target.id} [data-word="${target.oldWord}"]`);
        await expect(english).toBeVisible();
        await expect(english).toHaveText(target.oldWord);
        await expect.poll(() => english.evaluate(node => {
          const style = getComputedStyle(node);
          const border = parseFloat(style.borderBottomWidth) > 0 && style.borderBottomStyle !== 'none'
            && !['transparent', 'rgba(0, 0, 0, 0)'].includes(style.borderBottomColor);
          return border || style.textDecorationLine.includes('underline');
        })).toBe(true);
      }
      expect(await observeCallCount(llmWorker, 'bilingual')).toBe(baseline);
    }
  });
});
