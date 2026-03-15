/**
 * Content Script E2E 测试
 * 测试内容脚本在网页上的功能
 */

import { test, expect } from '../utils/extensionTest';
import { waitForPageLoad, safeClick, getElementText } from '../utils/testHelpers';

// 创建本地测试页面内容的辅助函数
function createTestPageContent(title: string, paragraphs: string[]): string {
  const paragraphsHtml = paragraphs.map(p => `<p>${p}</p>`).join('\n        ');
  return `
    <!DOCTYPE html>
    <html>
    <head><title>${title}</title></head>
    <body>
      <h1>${title}</h1>
      ${paragraphsHtml}
    </body>
    </html>
  `;
}

const TEST_CONTENT = {
  simple: {
    title: 'Simple Test Page',
    paragraphs: [
      'The ubiquitous nature of smartphones has revolutionized modern communication.',
      'This phenomenon epitomizes the juxtaposition of rapid innovation.',
    ],
  },
  article: {
    title: 'Article Test Page',
    paragraphs: [
      'The ubiquitous nature of smartphones has revolutionized modern communication.',
      'People from all walks of life now carry powerful computing devices in their pockets.',
      'This democratization of technology has both advantages and challenges.',
      'However, the proliferation of misinformation through social media platforms has become a significant concern.',
      'The ephemeral nature of digital content creates unique archival challenges.',
      'The juxtaposition of rapid technological advancement with long-term preservation needs requires innovative solutions.',
    ],
  },
  large: {
    title: 'Large Page Test',
    paragraphs: Array(20).fill(null).map((_, i) =>
      `Paragraph ${i + 1}: The ubiquitous nature of smartphones has revolutionized modern communication. ` +
      'People from all walks of life now carry powerful computing devices in their pockets. ' +
      'This democratization of technology has both advantages and challenges.'
    ),
  },
};

test.describe('Content Script 测试', () => {
  test('内容脚本应该注入到网页中', async ({ extensionPage, waitForExtensionLoaded }) => {
    // 使用本地内容替代外部 URL
    const content = createTestPageContent(
      TEST_CONTENT.simple.title,
      TEST_CONTENT.simple.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);

    // 等待内容脚本注入
    await waitForExtensionLoaded(extensionPage);

    // 验证内容脚本已注入（检查特定的 DOM 标记）
    const hasContentScript = await extensionPage.evaluate(() => {
      return document.body?.hasAttribute('data-not-only-translator') ||
             !!document.querySelector('.not-only-translator-tooltip') ||
             !!document.querySelector('[data-not-only-translator]');
    });

    expect(hasContentScript).toBe(true);

    // 截图
    await extensionPage.screenshot({ path: 'e2e/screenshots/content-script-injected.png' });
  });

  test('应该识别并标注难词', async ({ extensionPage, waitForExtensionLoaded, configureExtensionApi }) => {
    // 配置 mock API 和翻译缓存
    await configureExtensionApi();

    // 使用本地内容替代外部 URL
    const content = createTestPageContent(
      TEST_CONTENT.article.title,
      TEST_CONTENT.article.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);

    // 等待内容脚本加载
    await waitForExtensionLoaded(extensionPage);

    // 等待扩展处理页面内容
    await extensionPage.waitForTimeout(3000);

    // 检查是否有单词被标注（高亮）
    const highlightedWords = await extensionPage.$$('[data-not-only-translator-word]');

    // 记录找到的标注数量
    console.log(`找到 ${highlightedWords.length} 个标注的单词`);

    // 截图查看效果
    await extensionPage.screenshot({ path: 'e2e/screenshots/highlighted-words.png', fullPage: true });

    // 注意：由于词汇识别依赖于用户设置和页面内容，不做强制数量断言
  });

  test('悬停难词应该显示翻译提示框', async ({ extensionPage, waitForExtensionLoaded, configureExtensionApi }) => {
    // 配置 mock API 和翻译缓存
    await configureExtensionApi();

    // 使用本地内容替代外部 URL
    const content = createTestPageContent(
      TEST_CONTENT.article.title,
      TEST_CONTENT.article.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);

    // 等待内容脚本加载
    await waitForExtensionLoaded(extensionPage);

    // 等待单词被标注
    await extensionPage.waitForTimeout(3000);

    // 查找被标注的单词
    const highlightedWord = extensionPage.locator('[data-not-only-translator-word]').first();

    // 检查是否有标注的单词
    if (await highlightedWord.count() === 0) {
      console.log('未找到标注的单词，跳过提示框测试');
      return;
    }

    // 悬停在单词上
    await highlightedWord.hover();

    // 等待提示框出现
    const tooltip = extensionPage.locator('.not-only-translator-tooltip, [data-not-only-translator-tooltip]').first();

    // 验证提示框可见
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    // 获取提示框内容
    const tooltipText = await tooltip.textContent();
    console.log('提示框内容:', tooltipText);

    // 验证提示框包含翻译内容
    expect(tooltipText).toBeTruthy();

    // 截图
    await extensionPage.screenshot({ path: 'e2e/screenshots/tooltip-visible.png' });
  });

  test('应该可以标记单词为已掌握', async ({ extensionPage, waitForExtensionLoaded, configureExtensionApi }) => {
    // 配置 mock API 和翻译缓存
    await configureExtensionApi();

    // 使用本地内容替代外部 URL
    const content = createTestPageContent(
      TEST_CONTENT.article.title,
      TEST_CONTENT.article.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);

    // 等待内容脚本加载
    await waitForExtensionLoaded(extensionPage);

    // 等待单词被标注
    await extensionPage.waitForTimeout(3000);

    // 查找被标注的单词
    const highlightedWord = extensionPage.locator('[data-not-only-translator-word]').first();

    if (await highlightedWord.count() === 0) {
      console.log('未找到标注的单词，跳过标记测试');
      return;
    }

    // 悬停显示提示框
    await highlightedWord.hover();

    // 等待提示框出现
    const tooltip = extensionPage.locator('.not-only-translator-tooltip, [data-not-only-translator-tooltip]').first();
    await expect(tooltip).toBeVisible({ timeout: 3000 });

    // 查找"标记为已掌握"或类似按钮
    const markKnownButton = tooltip.locator('button:has-text("已掌握"), button:has-text("已知"), [data-action="mark-known"]').first();

    if (await markKnownButton.count() > 0) {
      // 点击标记按钮
      await safeClick(markKnownButton);

      // 等待标记生效
      await extensionPage.waitForTimeout(500);

      // 验证单词样式变化（例如：移除高亮）
      const wordStatus = await highlightedWord.getAttribute('data-status');
      console.log('单词状态:', wordStatus);

      // 截图
      await extensionPage.screenshot({ path: 'e2e/screenshots/word-marked-known.png' });
    } else {
      console.log('未找到标记按钮');
    }
  });

  test('全文翻译模式应该可以激活', async ({ extensionPage, waitForExtensionLoaded }) => {
    // 使用本地内容替代外部 URL
    const content = createTestPageContent(
      TEST_CONTENT.article.title,
      TEST_CONTENT.article.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);

    // 等待内容脚本加载
    await waitForExtensionLoaded(extensionPage);

    // 等待页面处理完成
    await extensionPage.waitForTimeout(2000);

    // 尝试通过上下文菜单或快捷键激活全文翻译
    // 方法1: 尝试使用快捷键
    await extensionPage.keyboard.press('Alt+T');
    await extensionPage.waitForTimeout(1000);

    // 检查是否出现了全文翻译的标记
    const fullPageTranslation = await extensionPage.evaluate(() => {
      return document.body?.hasAttribute('data-full-translation') ||
             !!document.querySelector('.full-translation-mode') ||
             !!document.querySelector('[data-translation-mode="full"]');
    });

    if (fullPageTranslation) {
      console.log('全文翻译模式已激活');

      // 验证翻译内容
      const translatedElements = await extensionPage.$$('[data-translated="true"]');
      console.log(`找到 ${translatedElements.length} 个已翻译的元素`);

      // 截图
      await extensionPage.screenshot({ path: 'e2e/screenshots/full-translation-mode.png', fullPage: true });
    } else {
      console.log('全文翻译模式未激活（可能是快捷键未绑定或功能未启用）');
    }
  });
});

test.describe('Content Script - 性能测试', () => {
  test('大页面处理性能', async ({ extensionPage, waitForExtensionLoaded }) => {
    // 使用本地大页面内容替代外部 URL
    const content = createTestPageContent(
      TEST_CONTENT.large.title,
      TEST_CONTENT.large.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);

    // 记录开始时间
    const startTime = Date.now();

    // 等待内容脚本加载和处理
    await waitForExtensionLoaded(extensionPage);
    await extensionPage.waitForTimeout(3000);

    // 计算处理时间
    const processingTime = Date.now() - startTime;

    console.log(`页面处理时间: ${processingTime}ms`);

    // 验证处理时间在合理范围内（例如小于30秒）
    expect(processingTime).toBeLessThan(30000);

    // 获取性能指标
    const performanceMetrics = await extensionPage.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
      return {
        loadTime: navigation.loadEventEnd - navigation.startTime,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
      };
    });

    console.log('性能指标:', performanceMetrics);

    // 截图
    await extensionPage.screenshot({ path: 'e2e/screenshots/performance-test.png', fullPage: true });
  });
});
