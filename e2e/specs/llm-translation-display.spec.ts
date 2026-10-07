import { readFile } from 'node:fs/promises';
import { TEST_PAGE_URL } from '../fixtures/local-first-extension';
import type { TranslationResult } from '../../src/shared/types';
import {
  test, expect, FAKE_CONFIG, PARAGRAPHS, SPINNER, LOADING,
  releaseReply, expectBilingual, expectInlineSource, type LlmScope,
} from '../fixtures/fake-llm-extension';

const DYNAMIC_TEXT = 'Independent replication helps researchers verify the evidence and improves the reliability of scientific conclusions.';

test.describe('行内 output_limit 词义恢复', () => {
  test.use({ initialMode: 'inline-only' });

  test('4500 词汇量零本地候选在输出耗尽后复核超纲词，恢复可见 ubiquitous 及正确位置', async ({
    llmWorker, extContext, openTestPage,
  }, testInfo) => {
    const sentence = 'The ubiquitous phenomenon demonstrates an ephemeral yet idiosyncratic juxtaposition of unprecedented complexity and inherent ambiguity.';
    await llmWorker.evaluate(async () => {
      const { settings, userProfile } = await chrome.storage.sync.get(['settings', 'userProfile']);
      await chrome.storage.local.set({ knownWords: [], unknownWords: [] });
      await chrome.storage.sync.set({
        settings: { ...settings, phraseTranslationEnabled: true, grammarTranslationEnabled: true, hoverDelay: 500 },
        userProfile: { ...userProfile, examType: 'cet4', estimatedVocabulary: 4500 },
      });
    });
    // 语言检测使用足量英文，但排除辅助正文，只让现场固定句进入真实翻译链。
    await extContext.route(TEST_PAGE_URL, route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Reading sample</title></head><body><main id="content">
        <p data-notranslate>This reading sample provides enough English text for page language detection. It is intentionally excluded from translation so that only the target sentence is sent to the model.</p>
        <p id="low-confidence-target">${sentence}</p>
      </main></body></html>`,
    }));
    const page = await openTestPage();
    const paragraph = page.locator('#low-confidence-target');
    await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
    await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBeGreaterThan(0); // 等待批次真实发出
    await expect(paragraph.locator('mark')).toHaveCount(0);
    await releaseReply(llmWorker, 'inline-output-limit-select');
    await expect(page.locator(SPINNER)).toHaveCount(0);
    await expect(page.locator(LOADING)).toHaveCount(0);
    await testInfo.attach('low-confidence-recovery-dom', {
      body: JSON.stringify(await paragraph.evaluate(element => ({
        text: element.textContent, processed: element.classList.contains('not-translator-processed'),
        marks: element.querySelectorAll('mark').length,
      }))), contentType: 'application/json',
    });
    // 零注入断言（SPINNER/LOADING 恒 0）不能当完成屏障：以恢复调用到位为真实屏障
    await expect.poll(
      () => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length),
      // 零本地候选不能在 length 后以空 words 直接成功，必须追加一次简化选择
    ).toBe(2);
    const calls = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
    expect(calls.map(call => call.max_tokens)).toEqual([2000, 2000]);
    const originalPrompt = calls[0].messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
    expect([...originalPrompt.matchAll(/^\[PARA_\d+\]\n([^\n]+)/gm)].map(match => match[1])).toEqual([sentence]);
    expect(originalPrompt).toContain('grammarPoints');
    const recoverySystem = calls[1].messages.find(message => message.role === 'system')?.content;
    expect(recoverySystem).toContain('B2');
    expect(recoverySystem).toContain('4500');
    expect(recoverySystem).toContain('仅选择超出用户水平');
    const recovery = JSON.parse(calls[1].messages.filter(message => message.role === 'user').map(message => message.content).join('\n'));
    expect(recovery.paragraphs).toHaveLength(1);
    expect(recovery.paragraphs[0]).toMatchObject({
      id: 'PARA_0', sentence, selectAboveLevel: true, candidates: expect.arrayContaining(['ubiquitous']),
    });
    await expectInlineSource(paragraph, sentence);
    const word = paragraph.locator('mark.not-translator-highlight[data-word="ubiquitous"]');
    await expect(word).toHaveCount(1);
    await expect(word).toBeVisible();
    await expect(word).toHaveAttribute('data-translation', '无处不在的');
    await expectInlineSource(word, 'ubiquitous');
    const annotation = word.locator(':scope > .not-translator-inline-translation');
    await expect(annotation).toHaveCount(1);
    await expect(annotation).toBeVisible();
    await expect(annotation).toHaveText('无处不在的');
    const position = await word.evaluate(element => {
      const range = document.createRange();
      range.setStart(document.getElementById('low-confidence-target')!, 0);
      range.setEndBefore(element);
      const start = range.toString().length;
      const clone = element.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(':scope > .not-translator-inline-translation').forEach(node => node.remove());
      return [start, start + (clone.textContent?.length ?? 0)];
    });
    expect(position).toEqual([4, 14]);
    await word.hover();
    const tooltip = page.locator('.not-translator-tooltip-visible');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.not-translator-tooltip-translation')).toContainText('无处不在的');
    await expect(page.locator('.not-translator-translation-line')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length)).toBe(2);
  });

  for (const reply of ['inline-output-limit-fallback', 'inline-output-limit-always'] as const) {
    test(reply === 'inline-output-limit-fallback'
      ? '复杂任务耗尽后仅恢复一次候选词义，难词可见并能打开中文释义'
      : '词义恢复仍耗尽时显示固定预算错误，清圈且不发第三次请求', async ({ llmWorker, openTestPage }) => {
      await llmWorker.evaluate(async enableHover => {
        const { settings } = await chrome.storage.sync.get('settings');
        // 开启真实语法任务；成功例恢复生产默认悬停设置，0 表示关闭而非立即显示。
        await chrome.storage.sync.set({ settings: {
          ...settings, grammarTranslationEnabled: true,
          ...(enableHover ? { hoverDelay: 500 } : {}),
        } });
      }, reply === 'inline-output-limit-fallback');
      const page = await openTestPage();
      const originalParagraphs = await page.evaluate(html => Array.from(
        new DOMParser().parseFromString(html, 'text/html').querySelectorAll('#content > p'),
        paragraph => ({ id: paragraph.id, text: paragraph.textContent ?? '' })
      ), await readFile(new URL('../fixtures/local-first-reading.html', import.meta.url), 'utf8'));
      await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
      await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBeGreaterThan(0); // 等待批次真实发出
      await releaseReply(llmWorker, reply);
      await expect(page.locator(SPINNER)).toHaveCount(0);
      await expect(page.locator(LOADING)).toHaveCount(0);

      // 零注入断言不能当完成屏障：以恢复调用到位为真实屏障
      await expect.poll(
        () => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length),
        // 复杂任务后必须且只能追加一次词义恢复
      ).toBe(2);
      const calls = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
      for (const call of calls) {
        expect(call).toMatchObject({
          model: FAKE_CONFIG.modelName, authorization: `Bearer ${FAKE_CONFIG.apiKey}`, max_tokens: 2000,
        });
      }
      expect(calls[0].messages.find(message => message.role === 'system')?.content).toMatch(/CET|词汇量|英语水平/);
      const recoverySystem = calls[1].messages.find(message => message.role === 'system')?.content;
      expect(recoverySystem).toContain('只翻译每段 candidates');
      const recoveryPrompt = calls[1].messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
      const recovery = JSON.parse(recoveryPrompt) as {
        paragraphs: Array<{ id: string; sentence: string; candidates: string[]; selectAboveLevel?: boolean }>;
      };
      expect(recovery.paragraphs.map(paragraph => paragraph.id)).toEqual(['PARA_0', 'PARA_1', 'PARA_2']);
      expect(recovery.paragraphs.find(paragraph => paragraph.sentence.includes('counterintuitive'))?.candidates)
        .toContain('counterintuitive');
      const simpleRecovery = recovery.paragraphs.find(paragraph => paragraph.sentence.includes('apple'));
      expect(simpleRecovery).toMatchObject({ selectAboveLevel: true, candidates: expect.arrayContaining(['apple']) });
      expect(simpleRecovery!.candidates.every(word => simpleRecovery!.sentence.includes(word))).toBe(true);
      const normalizedCandidates = simpleRecovery!.candidates.map(word => word.toLowerCase());
      expect(normalizedCandidates).not.toContain('the');
      expect(normalizedCandidates).not.toContain('and');
      expect(recoverySystem).toContain('A2');
      expect(recoverySystem).toContain('2000');
      expect(recoverySystem).toContain('仅对 selectAboveLevel=true 的段落');
      expect(recoverySystem).toContain('仅选择超出用户水平');
      expect(recoverySystem).toContain('允许返回空 words 数组');
      expect(recoveryPrompt).not.toMatch(/"fullText"|"position"|"difficulty"|"grammarPoints"/);
      await expect(page.locator('.not-translator-translation-line')).toHaveCount(0);
      for (const paragraph of originalParagraphs) {
        await expectInlineSource(page.locator(`#${paragraph.id}`), paragraph.text);
      }

      if (reply === 'inline-output-limit-fallback') {
        for (const paragraph of PARAGRAPHS.slice(0, 3)) {
          await expect(page.locator(`#${paragraph.id}`)).toHaveClass(/not-translator-processed/);
        }
        const simple = page.locator('#para-simple');
        await expect(simple.locator('mark.not-translator-highlight, [data-translation]')).toHaveCount(0);
        expect(await simple.textContent()).toBe(originalParagraphs.find(paragraph => paragraph.id === 'para-simple')!.text);
        const recovered = page.locator('#para-beta mark.not-translator-highlight[data-word="counterintuitive"]');
        await expectInlineSource(recovered, 'counterintuitive');
        await expect(recovered).toBeVisible();
        await expect(recovered).toHaveAttribute('data-translation', /违反直觉的/);
        const annotation = recovered.locator(':scope > .not-translator-inline-translation');
        await expect(annotation).toHaveCount(1);
        await expect(annotation).toBeVisible();
        await expect(annotation).toHaveText('违反直觉的');
        await expect(page.locator('#para-alpha mark.not-translator-highlight[data-word="democratization"]')).toBeVisible();
        await recovered.hover();
        const tooltip = page.locator('.not-translator-tooltip-visible');
        await expect(tooltip).toBeVisible();
        await expect(tooltip.locator('.not-translator-tooltip-translation')).toContainText('违反直觉的');
        await expect(page.getByRole('alert')).toHaveCount(0);
      } else {
        const alert = page.getByRole('alert');
        await expect(alert).toBeVisible();
        await expect(alert).toContainText('模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型');
        await expect(page.locator('#content .not-translator-processed')).toHaveCount(0);
      }
      expect(await llmWorker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.translationMode))
        .toBe('inline-only');
      expect(await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length)).toBe(2);
    });
  }
});

test('custom 模型经真实后台返回全文，页面显示双语且单段请求发送完整输出 schema', async ({
  llmWorker, openTestPage, sendRuntimeMessage,
}) => {
  const page = await openTestPage();
  await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBeGreaterThan(0); // 等待批次真实发出
  await releaseReply(llmWorker, 'valid');
  await expectBilingual(page);

  // 首屏批量链验证真实渲染；真实扩展页单段消息覆盖版本模板的独立提示词路径。
  const response = await sendRuntimeMessage<TranslationResult>({
    type: 'TRANSLATE_TEXT',
    payload: { text: DYNAMIC_TEXT, context: DYNAMIC_TEXT, mode: 'bilingual' },
  });
  expect(response.success, response.error).toBe(true);
  expect(response.data?.fullText).toBe(PARAGRAPHS[3].translation);
  const calls = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
  const singlePrompt = calls.flatMap(call => call.messages)
    .find(message => message.role === 'user' && message.content.includes(DYNAMIC_TEXT))?.content;
  expect(singlePrompt).toBeDefined();
  expect(singlePrompt).not.toContain('[PARA_0]');
  expect(singlePrompt).toContain('"fullText"');
  expect(singlePrompt).toMatch(/"required"\s*:\s*\[\s*"fullText"/);
});

for (const reply of ['missing', 'blank'] as const) {
  test(`custom 模型返回${reply === 'missing' ? '缺失' : '空白'}全文时不伪报成功，错误可见且移回视口可重试`, async ({
    llmWorker, openTestPage,
  }) => {
    const page = await openTestPage();
    await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
    await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBeGreaterThan(0); // 等待批次真实发出
    await releaseReply(llmWorker, reply);

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('批量翻译失败');
    await expect(alert).toContainText('翻译失败，请检查翻译服务与模型配置后重试');
    await expect(alert).toBeVisible();
    await expect(page.locator(SPINNER)).toHaveCount(0);
    await expect(page.locator(LOADING)).toHaveCount(0);
    await expect(page.locator('#content .not-translator-processed')).toHaveCount(0);
    await expect(page.locator('.not-translator-translation-line')).toHaveCount(0);
    await expect(page.locator('#content [role="alert"]')).toHaveCount(0);

    const previousCount = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length);
    await releaseReply(llmWorker, 'valid');
    // 留出超过观察器预加载边界的空白区域，真实滚出/滚回触发失败段落重试。
    await page.evaluate(() => { document.body.style.minHeight = '6000px'; });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.locator('#para-alpha')).not.toBeInViewport();
    await page.locator('#para-alpha').scrollIntoViewIfNeeded();
    await expectBilingual(page);
    await expect(alert).toHaveCount(0);
    const retryCalls = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
    expect(retryCalls.length).toBeGreaterThan(previousCount);
    expect(JSON.stringify(retryCalls.slice(previousCount))).not.toContain('批量翻译失败');
    expect(JSON.stringify(retryCalls.slice(previousCount))).not.toContain('段落再次进入视口');
    expect(JSON.stringify(retryCalls.slice(previousCount))).not.toContain('翻译失败，请检查翻译服务与模型配置后重试');
  });
}

for (const reply of ['output-limit-fallback', 'output-limit-always'] as const) {
  test(`输出上限后${reply === 'output-limit-fallback' ? '仅降级一次纯全文任务并显示三段中文' : '纯全文仍超限时明确失败且不递归重试'}`, async ({
    llmWorker, openTestPage,
  }) => {
    const page = await openTestPage();
    await expect(page.locator(`${SPINNER}, ${LOADING}`)).toHaveCount(0); // 新契约：在途段落零加载注入
    await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.pending.length)).toBeGreaterThan(0); // 等待批次真实发出
    await releaseReply(llmWorker, reply);
    await expect(page.locator(SPINNER)).toHaveCount(0);
    await expect(page.locator(LOADING)).toHaveCount(0);

    const calls = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
    expect(calls, '复杂任务不得原样重试；纯全文降级最多一次').toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({
        model: FAKE_CONFIG.modelName,
        authorization: `Bearer ${FAKE_CONFIG.apiKey}`,
        max_tokens: 2000,
      });
    }
    const originalSystem = calls[0].messages.find(message => message.role === 'system')?.content;
    const fallbackSystem = calls[1].messages.find(message => message.role === 'system')?.content;
    expect(originalSystem).toMatch(/CET|词汇量|英语水平/);
    expect(fallbackSystem).toMatch(/翻译|translat/i);
    expect(fallbackSystem).toMatch(/只|仅|only/i);
    expect(fallbackSystem).not.toMatch(/CET|词汇量|英语水平|语法|grammar|proficiency/i);
    const fallbackPrompt = calls[1].messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
    expect(fallbackPrompt).toContain('fullText');
    expect(fallbackPrompt).not.toMatch(/CET|词汇量|难度|位置|"difficulty"|"position"|"sentences"|"grammarPoints"/i);
    expect(fallbackPrompt).toMatch(/"words"\s*:\s*\[\s*\]/);
    expect(fallbackPrompt).toContain('Do not analyze words or grammar');
    expect([...fallbackPrompt.matchAll(/^\[(PARA_\d+)\]/gm)].map(match => match[1]))
      .toEqual(['PARA_0', 'PARA_1', 'PARA_2']);

    if (reply === 'output-limit-fallback') {
      await expectBilingual(page);
      await expect(page.getByRole('alert')).toHaveCount(0);
    } else {
      await expect(page.getByRole('alert')).toContainText('批量翻译失败');
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.locator('#content .not-translator-processed')).toHaveCount(0);
      await expect(page.locator('.not-translator-translation-line')).toHaveCount(0);
    }
    expect(await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length)).toBe(2);
  });
}
