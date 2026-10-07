import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { TranslationMode } from '../../src/shared/types';
import {
  test, expect, PARAGRAPHS, SPINNER, LOADING, releaseReply, observeCallCount, expectNoVisibleVocabDecorations, type LlmScope,
} from '../fixtures/fake-llm-extension';

const MODES: Record<TranslationMode, { popup: string; floating: string }> = {
  'inline-only': { popup: '生词高亮', floating: '行内' },
  bilingual: { popup: '双语对照', floating: '对照' },
  'full-translate': { popup: '全文翻译', floating: '全文' },
};

async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await expect(popup.getByRole('radiogroup', { name: '翻译模式', exact: true })).toBeVisible();
  return popup;
}

async function selectPopupMode(popup: Page, mode: TranslationMode): Promise<void> {
  const radio = popup.getByRole('radio', { name: MODES[mode].popup, exact: true });
  await radio.click();
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

async function expectModeControls(page: Page, popup: Page, worker: Worker, mode: TranslationMode): Promise<void> {
  await expect(popup.getByRole('radio', { name: MODES[mode].popup, exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.not-translator-floating-btn-text')).toHaveText(MODES[mode].floating);
  await expect(page.locator(`.not-translator-floating-mode-item[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.translationMode))
    .toBe(mode);
}

async function expectPageMode(page: Page, mode: TranslationMode): Promise<void> {
  const originals = mode === 'inline-only' ? await page.evaluate(html => Object.fromEntries(Array.from(
    new DOMParser().parseFromString(html, 'text/html').querySelectorAll('#content > p'),
    paragraph => [paragraph.id, (paragraph.textContent ?? '').replace(/\s+/g, ' ').trim()]
  )), await readFile(new URL('../fixtures/local-first-reading.html', import.meta.url), 'utf8')) : {};
  for (const paragraph of PARAGRAPHS.slice(0, 3)) {
    const original = page.locator(`#${paragraph.id}`);
    await expect(original).toHaveClass(/not-translator-processed/);
    await expect(original).toBeVisible();
    // Playwright 的 visible 不检查 opacity，必须断言计算样式以拦截淡出后正文透明。
    await expect(original).toHaveCSS('opacity', '1');
    await expect(original).not.toHaveClass(/not-translator-fade-out/);
    if (mode === 'full-translate') {
      await expect(original).toHaveText(paragraph.translation);
      await expect(original).toHaveClass(/not-translator-full-translated/);
      await expect(original).not.toContainText(paragraph.source);
      await expectNoVisibleVocabDecorations(original);
    } else {
      if (mode === 'inline-only') {
        // 不改真实正文，只移除副本中的模块注释后核对完整原英文。
        await expect.poll(() => original.evaluate(node => {
          const clone = node.cloneNode(true) as HTMLElement;
          clone.querySelectorAll('mark.not-translator-highlight[data-word][data-translation] > .not-translator-inline-translation')
            .forEach(annotation => annotation.remove());
          return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
        })).toBe(originals[paragraph.id]);
      } else {
        await expect(original).toContainText(paragraph.source);
      }
      await expect(original).not.toContainText(paragraph.translation);
      await expect(original).not.toHaveClass(/not-translator-full-translated/);
    }
    if (mode === 'bilingual') {
      const translated = page.locator(`#${paragraph.id} + .not-translator-translation-line`);
      await expect(translated).toHaveText(paragraph.translation);
      await expect(translated).toBeVisible();
      await expect(translated).toHaveCSS('opacity', '1');
    }
  }
  const lines = page.locator('.not-translator-translation-line');
  // valid 回包没有模型难词，不能凭空多出词义对照；双语全文行仍精确计数。
  await expect(lines.filter({ hasText: /^难词对照：/ })).toHaveCount(0);
  await expect(lines.filter({ hasNotText: /^难词对照：/ })).toHaveCount(mode === 'bilingual' ? 3 : 0);
  await expect(page.locator(`${SPINNER}, ${LOADING}, .not-translator-translating`)).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
}

async function expectCleanRequests(worker: Worker): Promise<void> {
  const calls = await worker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
  const texts = calls.flatMap(call => call.messages.filter(message => message.role === 'user'))
    .flatMap(message => [...message.content.matchAll(/^\[PARA_\d+\]\n([^\n]+)/gm)].map(match => match[1]));
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    expect(text, '请求正文必须仍为英文，不能混入旧译文、本地释义或通知').not.toMatch(/[㐀-鿿]/);
    expect(PARAGRAPHS.some(paragraph => text.includes(paragraph.source))).toBe(true);
  }
}

async function openCompletedInlinePage(worker: Worker, openTestPage: () => Promise<Page>): Promise<Page> {
  await releaseReply(worker, 'valid');
  const page = await openTestPage();
  await expectPageMode(page, 'bilingual');
  const baseline = await worker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length);
  expect(baseline).toBeGreaterThan(0);
  // 首轮完整结果只从正常 HTTP 回包获得，再经真实控件进入原矩阵起点。
  await page.getByRole('button', { name: '翻译模式切换', exact: true }).click();
  await page.locator('.not-translator-floating-mode-item[data-mode="inline-only"]').click();
  await expectPageMode(page, 'inline-only');
  expect(await observeCallCount(worker, 'inline-only')).toBe(baseline);
  return page;
}

test.describe('真实 UI 三模式切换', () => {

  const cycles: TranslationMode[][] = [
    ['bilingual', 'full-translate', 'inline-only'],
    ['full-translate', 'bilingual', 'inline-only'],
  ];
  for (const cycle of cycles) {
    test(`popup 六方向矩阵：行内→${cycle.map(mode => MODES[mode].floating).join('→')}`, async ({
      llmWorker, openTestPage, extContext, extensionId,
    }) => {
      const page = await openCompletedInlinePage(llmWorker, openTestPage);
      const popup = await openPopup(extContext, extensionId);
      for (const mode of cycle) {
        await test.step(`切换至${MODES[mode].popup}`, async () => {
          await selectPopupMode(popup, mode);
          await expectPageMode(page, mode);
          await expectModeControls(page, popup, llmWorker, mode);
          await expectCleanRequests(llmWorker);
        });
      }
    });
  }

  test('滚动后 Enter 打开浮动面板仍完整位于视口，点击模式后正文正确', async ({
    llmWorker, openTestPage,
  }, testInfo) => {
    const page = await openCompletedInlinePage(llmWorker, openTestPage);
    // 只增加测试页面前部留白，让真实正文滚入视口，不修改浮动组件或触发模拟事件。
    await page.evaluate(() => { document.body.style.paddingTop = '1800px'; });
    await page.locator('#para-alpha').scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

    const button = page.getByRole('button', { name: '翻译模式切换', exact: true });
    await button.press('Enter');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('.not-translator-floating-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS('position', 'fixed');
    const bounds = await panel.evaluate(element => {
      const { top, right, bottom, left, width, height } = element.getBoundingClientRect();
      return { top, right, bottom, left, width, height,
        viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, scrollY: window.scrollY };
    });
    await testInfo.attach('scrolled-floating-panel-geometry', {
      body: JSON.stringify(bounds, null, 2), contentType: 'application/json',
    });
    expect(bounds.scrollY).toBeGreaterThan(1000);
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.bottom, '展开面板底部必须位于视口内，不能重复叠加页面 scrollY').toBeLessThanOrEqual(bounds.viewportHeight);

    await panel.locator('.not-translator-floating-mode-item[data-mode="full-translate"]').click();
    await expectPageMode(page, 'full-translate');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => llmWorker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.translationMode))
      .toBe('full-translate');
    await expectCleanRequests(llmWorker);
  });

  test('浮动按钮切换后三种模式与重新打开的 popup 一致', async ({
    llmWorker, openTestPage, extContext, extensionId,
  }) => {
    const page = await openCompletedInlinePage(llmWorker, openTestPage);
    for (const mode of ['full-translate', 'inline-only', 'bilingual'] as const) {
      await page.getByRole('button', { name: '翻译模式切换', exact: true }).click();
      await page.locator(`.not-translator-floating-mode-item[data-mode="${mode}"]`).click();
      await expectPageMode(page, mode);
      const popup = await openPopup(extContext, extensionId);
      await expectModeControls(page, popup, llmWorker, mode);
      await popup.close();
      await expectCleanRequests(llmWorker);
    }
  });
});

test('在途双语批次切全文不取消或重发，唯一响应按最新模式显示并清圈', async ({
  llmWorker, openTestPage, extContext, extensionId,
}) => {
  const page = await openTestPage();
  await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBe(1);
  const popup = await openPopup(extContext, extensionId);
  await selectPopupMode(popup, 'full-translate');
  await expectModeControls(page, popup, llmWorker, 'full-translate');
  expect(await observeCallCount(llmWorker, 'full-translate')).toBe(1);
  expect(await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBe(1);
  // 不放行第二个请求，唯一在途响应应直接用于当前模式。
  await releaseReply(llmWorker, 'valid');
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls[0].aborted)).toBe(false);
  await expectPageMode(page, 'full-translate');
  await expectModeControls(page, popup, llmWorker, 'full-translate');
  expect(await observeCallCount(llmWorker, 'full-translate')).toBe(1);
  await expectCleanRequests(llmWorker);
});

test('缺全文失败后切模式不重发，真实移回视口后恢复正文并清除错误及加载圈', async ({
  llmWorker, openTestPage, extContext, extensionId,
}) => {
  const page = await openTestPage();
  await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBeGreaterThan(0); // 等待批次真实发出
  await releaseReply(llmWorker, 'missing');
  await expect(page.getByRole('alert')).toContainText('批量翻译失败');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0);
  await expect(page.locator('#content .not-translator-processed')).toHaveCount(0);
  const baseline = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length);
  await releaseReply(llmWorker, 'valid');
  const popup = await openPopup(extContext, extensionId);
  for (const mode of ['full-translate', 'bilingual'] as const) {
    await selectPopupMode(popup, mode);
    await expectModeControls(page, popup, llmWorker, mode);
    expect(await observeCallCount(llmWorker, mode)).toBe(baseline);
    for (const paragraph of PARAGRAPHS.slice(0, 3)) {
      const original = page.locator(`#${paragraph.id}`);
      await expect(original).toContainText(paragraph.source);
      await expect(original).not.toContainText(paragraph.translation);
      await expect(original).toBeVisible();
      await expect(original).toHaveCSS('opacity', '1');
      await expect(original).not.toHaveClass(/not-translator-fade-out|not-translator-full-translated/);
    }
    await expect(page.locator(`${SPINNER}, ${LOADING}, .not-translator-translating`)).toHaveCount(0);
    await expect(page.locator('.not-translator-translation-line')).toHaveCount(0);
    await expectCleanRequests(llmWorker);
  }
  // 与已有失败恢复用例相同，真实滚出/滚回才重新请求，模式切换不充当重试。
  await page.evaluate(() => { document.body.style.minHeight = '6000px'; });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('#para-alpha')).not.toBeInViewport();
  await page.locator('#para-alpha').scrollIntoViewIfNeeded();
  await expectPageMode(page, 'bilingual');
  await expectModeControls(page, popup, llmWorker, 'bilingual');
  expect(await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length)).toBeGreaterThan(baseline);
  await expectCleanRequests(llmWorker);
});

test('真实 popup 暂停全局翻译会中止在途请求，迟到响应不回填正文', async ({
  llmWorker, openTestPage, extContext, extensionId,
}) => {
  const page = await openTestPage();
  await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBe(1);
  const popup = await openPopup(extContext, extensionId);
  await popup.getByRole('switch', { name: '全局翻译已启用', exact: true }).click();
  await expect(popup.getByRole('switch', { name: '全局翻译已暂停', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => llmWorker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.enabled))
    .toBe(false);
  await expect(page.locator(`${SPINNER}, ${LOADING}, .not-translator-translating`)).toHaveCount(0);
  expect(await observeCallCount(llmWorker, 'bilingual')).toBe(1);
  const pausedText = await page.locator('#content').innerText();
  expect(pausedText).not.toMatch(/[㐀-鿿]/);

  // HTTP 替身故意允许已取消响应迟到；读取真实 AbortSignal，而非模拟取消状态。
  await releaseReply(llmWorker, 'valid');
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls[0].aborted)).toBe(true);
  expect(await observeCallCount(llmWorker, 'bilingual')).toBe(1);
  expect(await page.locator('#content').innerText()).toBe(pausedText);
  await expect(page.locator('#content .not-translator-processed')).toHaveCount(0);
  await expect(page.locator('.not-translator-translation-line')).toHaveCount(0);
  await expect(page.locator(`${SPINNER}, ${LOADING}, .not-translator-translating`)).toHaveCount(0);
  for (const paragraph of PARAGRAPHS.slice(0, 3)) {
    const original = page.locator(`#${paragraph.id}`);
    await expect(original).toContainText(paragraph.source);
    await expect(original).not.toContainText(paragraph.translation);
    await expect(original).toBeVisible();
    await expect(original).toHaveCSS('opacity', '1');
    await expect(original).not.toHaveClass(/not-translator-fade-out|not-translator-full-translated/);
  }
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectCleanRequests(llmWorker);
});
