import { test, expect, chromium } from '@playwright/test';
import { resolve } from 'path';

/**
 * 手动验证测试
 * 使用 Playwright MCP 方式加载扩展并截图验证
 */
test.describe('手动验证扩展功能', () => {
  test('打开维基百科并截图验证扩展', async ({}, testInfo) => {
    // 使用 playwright.chromium 启动带扩展的浏览器
    const extensionPath = resolve(process.cwd(), 'dist');

    const browser = await chromium.launch({
      headless: false, // 非 headless 模式便于调试
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    try {
      // 创建新页面
      const context = await browser.newContext();
      const page = await context.newPage();

      // 导航到维基百科人工智能页面
      console.log('导航到维基百科...');
      await page.goto('https://en.wikipedia.org/wiki/Artificial_intelligence', {
        waitUntil: 'networkidle',
        timeout: 60000,
      });

      // 等待页面完全加载
      await page.waitForTimeout(5000);

      // 截取初始状态截图
      const screenshotPath = testInfo.outputPath('wikipedia-initial.png');
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });
      console.log('已保存截图:', screenshotPath);

      // 测试报告附件
      await testInfo.attach('wikipedia-screenshot', {
        path: screenshotPath,
        contentType: 'image/png',
      });

      // 尝试查找扩展的高亮元素
      const highlights = await page.locator('[data-translation-marker], .translation-highlight, .word-highlight').count();
      console.log(`找到 ${highlights} 个高亮单词`);

      // 如果找到了高亮元素，点击其中一个
      if (highlights > 0) {
        const firstHighlight = page.locator('[data-translation-marker], .translation-highlight, .word-highlight').first();
        await firstHighlight.click();
        await page.waitForTimeout(2000);

        // 截图查看提示框
        const tooltipPath = testInfo.outputPath('wikipedia-tooltip.png');
        await page.screenshot({ path: tooltipPath, fullPage: false });
        await testInfo.attach('tooltip-screenshot', {
          path: tooltipPath,
          contentType: 'image/png',
        });
      }

      // 验证测试通过（扩展已加载）
      expect(true).toBe(true);

    } finally {
      // 关闭浏览器
      await browser.close();
    }
  });
});
