import { readFile } from 'node:fs/promises';
import {
  test, expect, SPINNER, LOADING, releaseReply, expectInlineSource, type LlmScope,
} from '../fixtures/fake-llm-extension';
import { TEST_PAGE_URL } from '../fixtures/local-first-extension';

test.use({ initialMode: 'inline-only' });

test('GitHub 类外层容器只翻译可见正文，重复词定位不落入 SCRIPT JSON 或代码', async ({
  llmWorker, extContext, openTestPage,
}, testInfo) => {
  const html = await readFile(new URL('../fixtures/github-like-reading.html', import.meta.url), 'utf8');
  // 只替换本用例的页面资源，复用既有 8765 服务、拒绝代理和真实 MV3 消息链。
  await extContext.route(TEST_PAGE_URL, route => route.fulfill({ contentType: 'text/html', body: html }));
  await llmWorker.evaluate(async () => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: {
      ...settings, grammarTranslationEnabled: true, hoverDelay: 500,
    } });
  });
  const page = await openTestPage();
  const original = await page.evaluate(source => {
    const document = new DOMParser().parseFromString(source, 'text/html');
    return {
      protected: ['bootstrap-data', 'embedded-style', 'embedded-template', 'embedded-noscript', 'inline-code'].map(id => {
        const node = document.getElementById(id)!;
        return { id, text: node.textContent, html: node.innerHTML };
      }),
      paragraphs: Array.from(document.querySelectorAll('#readme > p'), node => ({ id: node.id, text: node.textContent ?? '' })),
    };
  }, html);
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length))
    .toBeGreaterThan(0);
  // 复用已验证的词义回包契约，不替换扫描器、候选解析器或任何 DOM 高亮方法。
  await releaseReply(llmWorker, 'inline-output-limit-fallback');
  await expect(page.locator(SPINNER)).toHaveCount(0);
  await expect(page.locator(LOADING)).toHaveCount(0);
  // 零注入断言不能当完成屏障：以词义恢复调用到位为真实屏障
  await expect.poll(() => llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls.length))
    .toBe(2);
  // 先等真实渲染完成（译文回填按段自动重试），再采集 DOM 证据：
  // fake-llm 的 calls 计数在 Response 返回前即增加，calls=2 不等于渲染完成。
  for (const paragraph of original.paragraphs) {
    await expectInlineSource(page.locator(`#${paragraph.id}`), paragraph.text);
  }

  const evidence = await page.evaluate(ids => ({
    protected: ids.map(id => {
      const node = document.getElementById(id)!;
      const root = node instanceof HTMLTemplateElement ? node.content : node;
      return { id, text: node.textContent, html: node.innerHTML, marks: root.querySelectorAll('mark').length };
    }),
    marks: Array.from(document.querySelectorAll('#github-shell mark'), node => ({
      word: node.getAttribute('data-word'), parent: node.parentElement?.tagName,
      excludedAncestor: node.closest('script, style, template, noscript, code')?.tagName ?? null,
      clientRects: node.getClientRects().length,
    })),
    processed: Array.from(document.querySelectorAll('.not-translator-processed'), node => node.id),
  }), original.protected.map(node => node.id));
  await testInfo.attach('github-like-dom-evidence', {
    body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
  });
  const calls = await llmWorker.evaluate(() => (globalThis as LlmScope).__llmDisplayE2E.calls);
  const prompts = calls.flatMap(call => call.messages.filter(message => message.role === 'user'))
    .map(message => message.content).join('\n');
  expect.soft(prompts, '排除节点的专属文本不得泄漏进任何模型请求')
    .not.toMatch(/jsononlysentinel|interactionlimitbanner|overflow-auto|styleonlysentinel|templateonlysentinel|noscriptonlysentinel|codeonlysentinel/);
  expect(prompts).toContain('repeated measurements challenged their assumptions');
  expect(prompts).toContain('verified the evidence before publication');
  for (const expected of original.protected) {
    const actual = evidence.protected.find(node => node.id === expected.id);
    expect.soft(actual, `${expected.id} 文本和结构必须原封不动，内部不得插入 mark`)
      .toEqual({ ...expected, marks: 0 });
  }
  expect.soft(evidence.marks.filter(mark => mark.excludedAncestor !== null), '所有高亮必须位于可翻译区域').toEqual([]);
  // 同词分别出现在 JSON、代码、链接和第二段；译文必须定位到两段真正可见的原词。
  for (const container of ['#findings-link', '#second-occurrence']) {
    const translated = page.locator(`${container} mark.not-translator-highlight[data-word="counterintuitive"]`);
    await expect(translated).toHaveCount(1);
    await expect(translated).toBeVisible();
    await expectInlineSource(translated, 'counterintuitive');
    await expect(translated).toHaveAttribute('data-translation', '违反直觉的');
    const annotation = translated.locator(':scope > .not-translator-inline-translation');
    await expect(annotation).toHaveCount(1);
    await expect(annotation).toBeVisible();
    await expect(annotation).toHaveText('违反直觉的');
  }
  await expect(page.locator('#findings-link')).toHaveAttribute('href', '#readme-second');
  await page.locator('#findings-link mark.not-translator-highlight[data-word="counterintuitive"]').hover();
  const tooltip = page.locator('.not-translator-tooltip-visible');
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('.not-translator-tooltip-translation')).toContainText('违反直觉的');
  await expect(page.locator('.not-translator-translation-line')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
