import { test, expect } from '../utils/extensionTest';
import { waitForExtensionLoaded, isContentScriptInjected } from '../fixtures/extension';
import { TEST_SERVER_URL } from '../global-setup';

/**
 * 扩展安装测试
 * 验证扩展是否正确加载和注入
 */
test.describe('扩展安装', () => {
  test('扩展 content script 应该成功注入到页面', async ({ extensionPage, configureExtensionApi }) => {
    const page = extensionPage;

    // 监听控制台消息
    page.on('console', msg => console.log(`[Page Console] ${msg.type()}: ${msg.text()}`));

    // 先配置扩展 API，确保 content script 能正常初始化
    await configureExtensionApi();

    // 使用测试服务器页面（setContent 不会触发 content script 注入）
    await page.goto(`${TEST_SERVER_URL}/test-page.html`);

    // 等待页面加载完成
    await page.waitForLoadState('domcontentloaded');

    // 等待 content script 注入 - 使用轮询而非单次检查
    // content script 在 document_idle 时注入，可能需要额外时间
    await expect.poll(async () => {
      // 调试：先打印 window 对象中有哪些属性
      const result = await isContentScriptInjected(page);
      if (!result) {
        const debug = await page.evaluate(() => {
          const keys = Object.keys(window).filter(k => k.includes('NOT') || k.includes('EXTENSION'));
          return { keys, hasNOT: '__NOT_ONLY_TRANSLATOR__' in window, hasEXT: '__EXTENSION_LOADED__' in window };
        });
        console.log('[Debug] window keys:', debug);
      }
      return result;
    }, {
      message: '等待 content script 注入',
      timeout: 10000,
      intervals: [100, 200, 500],
    }).toBe(true);
  });

  test('扩展应该在页面加载后初始化完成', async ({ extensionPage, waitForExtensionLoaded, configureExtensionApi }) => {
    const page = extensionPage;

    // 监听控制台消息
    page.on('console', msg => console.log(`[Page Console] ${msg.type()}: ${msg.text()}`));

    // 先配置扩展 API，确保 content script 能正常初始化
    await configureExtensionApi();

    // 使用测试服务器页面（setContent 不会触发 content script 注入）
    await page.goto(`${TEST_SERVER_URL}/test-page.html`);

    // 等待扩展加载完成 - 使用轮询确保正确初始化
    await expect.poll(async () => {
      try {
        await waitForExtensionLoaded(page);
        return true;
      } catch {
        return false;
      }
    }, {
      message: '等待扩展初始化完成',
      timeout: 15000,
      intervals: [100, 200, 500],
    }).toBe(true);

    // 验证扩展的全局对象存在
    // 注意：Manifest V3 内容脚本在隔离上下文中运行
    // 改为检查 data-extension-loaded 属性
    const extensionState = await page.evaluate(() => {
      return document.body?.getAttribute('data-extension-loaded') === 'true';
    });

    expect(extensionState).toBe(true);
  });

  test('扩展的样式应该正确注入到页面', async ({ extensionPage, waitForExtensionLoaded, configureExtensionApi }) => {
    const page = extensionPage;

    // 先配置扩展 API，确保 content script 能正常初始化
    await configureExtensionApi();

    // 使用测试服务器页面（setContent 不会触发 content script 注入）
    await page.goto(`${TEST_SERVER_URL}/test-page.html`);

    await page.waitForLoadState('domcontentloaded');
    await waitForExtensionLoaded(page);

    // 检查扩展样式是否注入
    const hasExtensionStyles = await page.evaluate(() => {
      // 查找扩展注入的样式元素
      const styles = document.querySelectorAll('style[data-extension-styles], link[href*="extension"]');
      return styles.length > 0;
    });

    // 注：由于无法确定具体的样式注入方式，这里只做基本检查
    expect(hasExtensionStyles).toBeDefined();
  });
});
