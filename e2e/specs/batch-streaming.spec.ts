import type { Locator, Page, Worker } from '@playwright/test';
import { DEFAULT_BATCH_CONFIG, TIMING } from '../../src/shared/constants';
import {
  test, expect, STREAM_PARAGRAPHS, STREAM_WORD, STREAM_GRAMMAR, releaseRemainingParagraphs, type StreamingScope,
} from '../fixtures/streaming-llm-extension';

test.setTimeout(120_000);

async function visibleStyle(locator: Locator) {
  const read = () => locator.evaluate(element => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const ancestorsVisible = (node: Element | null): boolean => {
      if (!node) return true;
      const computed = getComputedStyle(node);
      return computed.display !== 'none' && !['hidden', 'collapse'].includes(computed.visibility)
        && Number(computed.opacity) > 0 && ancestorsVisible(node.parentElement);
    };
    return {
      text: element.textContent?.replace(/\s+/g, ' ').trim(),
      display: style.display, visibility: style.visibility, opacity: style.opacity,
      width: rect.width, height: rect.height, ancestorsVisible: ancestorsVisible(element),
    };
  });
  // 译文行有真实 CSS 淡入动画；等待计算样式可见，而非在 opacity=0 的首帧误报。
  await expect.poll(async () => (await read()).ancestorsVisible).toBe(true);
  return read();
}

async function expectParagraph(page: Page, index: number, phase: string): Promise<void> {
  const paragraph = STREAM_PARAGRAPHS[index];
  const source = page.locator(`#${paragraph.id}`);
  const translated = page.locator(`#${paragraph.id} + .not-translator-translation-line`);
  await expect.poll(() => source.evaluate(element => {
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.not-translator-inline-translation, .not-translator-grammar-annotation')
      .forEach(annotation => annotation.remove());
    return clone.textContent?.replace(/\s+/g, ' ').trim();
  })).toBe(paragraph.text);
  await expect(source).toBeVisible();
  await expect(translated, '完整段落必须在同批其余段落和 EOF 到达前渲染').toHaveText(paragraph.translation);
  await expect(translated).toBeVisible();
  const annotations = index === 0 ? await expectCompleteAnnotations(source) : {};
  const evidence = {
    ...annotations, source: await visibleStyle(source), translation: await visibleStyle(translated),
  };
  for (const style of Object.values(evidence)) {
    expect(style.ancestorsVisible).toBe(true);
    expect(style.width).toBeGreaterThan(0);
    expect(style.height).toBeGreaterThan(0);
  }
  await test.info().attach(`${phase}-${paragraph.id}-visible-dom`, {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
}

async function expectCompleteAnnotations(source: Locator) {
  const structure = await source.evaluate(element => ({
    word: element.querySelector('mark.not-translator-highlight[data-word="democratization"]')?.getAttribute('data-translation'),
    grammar: element.querySelector('.not-translator-grammar-highlight')?.getAttribute('data-grammar-explanation'),
    annotation: element.querySelector('.not-translator-grammar-annotation')?.textContent,
  }));
  expect(structure.word, '全文出现时词汇结构必须已经一起发布').toBe(STREAM_WORD.translation);
  expect(structure.grammar, '全文出现时语法结构必须已经一起发布').toBe(STREAM_GRAMMAR.explanation);
  expect(structure.annotation).toContain(STREAM_GRAMMAR.explanation);
  return {
    word: await visibleStyle(source.locator('mark.not-translator-highlight[data-word="democratization"]')),
    grammar: await visibleStyle(source.locator('.not-translator-grammar-highlight')),
    grammarAnnotation: await visibleStyle(source.locator('.not-translator-grammar-annotation')),
  };
}

async function expectFirstWhileHeld(page: Page, worker: Worker, phase: string): Promise<void> {
  await expect.poll(() => worker.evaluate(() => (globalThis as StreamingScope).__streamingLlmE2E.calls[0]?.firstSent), {
    timeout: 45_000,
  }).toBe(true);
  await expectParagraph(page, 0, phase);
  const second = STREAM_PARAGRAPHS[1];
  await expect(page.locator(`#${second.id}`)).toHaveText(second.text);
  await expect(page.locator(`#${second.id}`)).toBeVisible();
  await expect(page.locator(`#${second.id} + .not-translator-translation-line`)).toHaveCount(0);
  const calls = await worker.evaluate(() => (globalThis as StreamingScope).__streamingLlmE2E.calls);
  expect(calls, '两段共用一个外发批次，不接受逐段请求').toHaveLength(1);
  expect(calls[0]).toMatchObject({
    stream: true, paragraphIds: ['PARA_0', 'PARA_1'], firstSent: true, completed: false, cancelled: false,
  });
}

async function expectSingleCallStable(worker: Worker): Promise<void> {
  const duration = TIMING.DEFAULT_MESSAGE_TIMEOUT + TIMING.SCAN_DEBOUNCE + DEFAULT_BATCH_CONFIG.debounceDelay;
  const samples = await worker.evaluate(async ({ duration, interval }) => {
    const started = performance.now();
    let observations: Array<{ elapsed: number; count: number }> = [];
    do {
      observations = [...observations, {
        elapsed: performance.now() - started, count: (globalThis as StreamingScope).__streamingLlmE2E.calls.length,
      }];
      await new Promise<void>(resolve => setTimeout(resolve, interval));
    } while (performance.now() - started < duration);
    return observations;
  }, { duration, interval: DEFAULT_BATCH_CONFIG.debounceDelay });
  await test.info().attach('completed-refresh-call-observation', {
    body: JSON.stringify({ duration, samples }), contentType: 'application/json',
  });
  expect(samples.every(sample => sample.count === 1), '完成后刷新在观察窗口内不得新增外发').toBe(true);
}

async function batchDocuments(worker: Worker) {
  return worker.evaluate(() => (globalThis as StreamingScope).__streamingLlmE2E.documents
    .filter(document => document.type === 'BATCH_TRANSLATE_TEXT'));
}

test('同一批次第一段完整即渲染，无需等待第二段或 SSE EOF', async ({ streamingWorker, openTestPage }) => {
  const page = await openTestPage();
  await expectFirstWhileHeld(page, streamingWorker, 'before-eof');
  await page.screenshot({ path: test.info().outputPath('first-paragraph-before-eof.png'), fullPage: true });

  await releaseRemainingParagraphs(streamingWorker);
  await expectParagraph(page, 0, 'completed');
  await expectParagraph(page, 1, 'completed');
  await expect(page.getByRole('alert')).toHaveCount(0);
  const calls = await streamingWorker.evaluate(() => (globalThis as StreamingScope).__streamingLlmE2E.calls);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ stream: true, completed: true, cancelled: false });
});

test('刷新中的新 document 复用在途批次，重放首段并接收后段，完成后再刷新零新增请求', async ({
  streamingWorker, openTestPage,
}) => {
  const page = await openTestPage();
  await expectFirstWhileHeld(page, streamingWorker, 'before-refresh');
  const before = await batchDocuments(streamingWorker);
  expect(before).toHaveLength(1);
  expect(before[0].documentId).toBeTruthy();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toHaveAttribute('data-extension-loaded', 'true');
  await expect.poll(async () => (await batchDocuments(streamingWorker)).length).toBeGreaterThan(before.length);
  const after = await batchDocuments(streamingWorker);
  expect(after[after.length - 1].documentId).toBeTruthy();
  expect(after[after.length - 1].documentId).not.toBe(before[0].documentId);
  expect(after[after.length - 1].tabId).toBe(before[0].tabId);
  await expectFirstWhileHeld(page, streamingWorker, 'new-document-before-eof');
  await page.screenshot({ path: test.info().outputPath('refreshed-first-paragraph-before-eof.png'), fullPage: true });

  await releaseRemainingParagraphs(streamingWorker);
  await expectParagraph(page, 0, 'new-document-completed');
  await expectParagraph(page, 1, 'new-document-completed');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await streamingWorker.evaluate(() => (globalThis as StreamingScope).__streamingLlmE2E.calls.length)).toBe(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toHaveAttribute('data-extension-loaded', 'true');
  await expectParagraph(page, 0, 'completed-refresh');
  await expectParagraph(page, 1, 'completed-refresh');
  await expectSingleCallStable(streamingWorker);
  const cancelled = await streamingWorker.evaluate(() => (globalThis as StreamingScope).__streamingLlmE2E.documents
    .filter(document => document.type === 'CANCEL_TRANSLATION'));
  expect(cancelled, '刷新不能被误判为用户主动取消').toEqual([]);
});
