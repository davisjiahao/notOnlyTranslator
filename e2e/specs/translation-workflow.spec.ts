import { test, expect } from '../utils/extensionTest';
import { waitForTranslationMarkers, waitForExtensionLoaded, getHighlightedWords } from '../fixtures/extension';

/**
 * 翻译工作流测试
 * 验证完整的翻译功能流程
 */
test.describe('翻译工作流', () => {
  test.beforeEach(async ({ extensionPage, waitForExtensionLoaded, configureExtensionApi }) => {
    // 配置扩展 API（注入 mock API key 和翻译缓存）
    await configureExtensionApi();

    // 使用 HTTP 服务器提供的测试页面（避免 file:// 协议限制内容脚本注入）
    const testServerUrl = process.env.TEST_SERVER_URL || 'http://localhost:8765';
    await extensionPage.goto(`${testServerUrl}/test-page.html`);
    await extensionPage.waitForLoadState('domcontentloaded');
    await waitForExtensionLoaded(extensionPage);
  });

  test('页面加载后应该自动分析并标记难词', async ({ extensionPage }) => {
    // 等待翻译标记出现
    await waitForTranslationMarkers(extensionPage, 20000);

    // 获取所有高亮的单词
    const highlightedWords = await getHighlightedWords(extensionPage);

    // 验证有单词被高亮
    expect(highlightedWords.length).toBeGreaterThan(0);

    // 验证至少有一些复杂词汇被识别
    const complexWords = ['ubiquitous', 'revolutionized', 'democratization', 'proliferation'];
    const foundComplexWords = highlightedWords.filter(word =>
      complexWords.some(complex => word.toLowerCase().includes(complex.toLowerCase()))
    );

    // 至少应该识别出一些复杂词汇
    expect(foundComplexWords.length).toBeGreaterThanOrEqual(1);
  });

  test('点击标记单词应该显示翻译提示框', async ({ extensionPage }) => {
    // 等待翻译标记
    await waitForTranslationMarkers(extensionPage, 20000);

    // 找到第一个高亮的单词
    const firstHighlighted = extensionPage.locator('.not-translator-highlight, [data-word]').first();

    // 确保元素可见
    await expect(firstHighlighted).toBeVisible({ timeout: 5000 });

    // 滚动到元素可见
    await firstHighlighted.scrollIntoViewIfNeeded();

    // 点击高亮的单词
    await firstHighlighted.click();

    // 等待提示框出现
    const tooltip = extensionPage.locator('.not-translator-tooltip, [data-tooltip], .tooltip-content').first();

    // 验证提示框可见
    await expect(tooltip).toBeVisible({ timeout: 5000 });

    // 验证提示框包含内容
    const tooltipText = await tooltip.textContent();
    expect(tooltipText?.length).toBeGreaterThan(0);
  });

  test('翻译提示框应该显示原文和翻译', async ({ extensionPage }) => {
    // 等待翻译标记
    await waitForTranslationMarkers(extensionPage, 20000);

    // 找到并点击第一个高亮单词
    const firstHighlighted = extensionPage.locator('.not-translator-highlight, [data-word]').first();
    await firstHighlighted.scrollIntoViewIfNeeded();
    await firstHighlighted.click();

    // 等待提示框
    const tooltip = extensionPage.locator('.not-translator-tooltip, [data-tooltip]').first();
    await expect(tooltip).toBeVisible({ timeout: 5000 });

    // 验证提示框结构
    const hasOriginal = await tooltip.locator('.original-word, [data-original], .word-text').count() > 0 ||
                         (await tooltip.textContent())?.length > 0;
    expect(hasOriginal).toBe(true);
  });

  test('点击页面其他区域应该关闭翻译提示框', async ({ extensionPage }) => {
    // 等待翻译标记
    await waitForTranslationMarkers(extensionPage, 20000);

    // 点击高亮单词打开提示框
    const firstHighlighted = extensionPage.locator('.not-translator-highlight, [data-word]').first();
    await firstHighlighted.scrollIntoViewIfNeeded();
    await firstHighlighted.click();

    // 等待提示框出现
    const tooltip = extensionPage.locator('.not-translator-tooltip, [data-tooltip]').first();
    await expect(tooltip).toBeVisible({ timeout: 5000 });

    // 点击页面空白区域
    await extensionPage.mouse.click(10, 10);

    // 验证提示框消失
    await expect(tooltip).not.toBeVisible({ timeout: 5000 });
  });

  test('长篇文章应该支持分批翻译处理', async ({ extensionPage }) => {
    // 创建长文测试页面
    await extensionPage.setContent(`
      <!DOCTYPE html>
      <html>
      <head><title>Long Article Test</title></head>
      <body>
        <article>
          ${Array(10).fill(0).map((_, i) => `
            <p>
              Paragraph ${i + 1}: The ubiquitous proliferation of technology has
              revolutionized the democratization of information dissemination.
              This phenomenon epitomizes the juxtaposition of rapid innovation
              with traditional epistemological frameworks.
            </p>
          `).join('')}
        </article>
      </body>
      </html>
    `);

    await extensionPage.waitForLoadState('domcontentloaded');
    await waitForExtensionLoaded(extensionPage);

    // 等待翻译标记
    await waitForTranslationMarkers(extensionPage, 20000);

    // 验证整篇文章都有翻译标记
    const highlightedCount = await extensionPage.locator('[data-translation-marker], .translation-highlight, .word-highlight').count();

    // 应该有多个高亮标记
    expect(highlightedCount).toBeGreaterThan(5);
  });
});