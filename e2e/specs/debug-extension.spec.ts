import { test, expect, chromium } from '@playwright/test';
import { waitForExtensionLoaded, waitForTranslationMarkers } from '../fixtures/extension';

test.describe('调试扩展加载', () => {
  test('调试扩展加载过程', async ({ browserName }, testInfo) => {
    // 只在 chromium 上运行
    if (browserName !== 'chromium') {
      test.skip();
    }

    const extensionPath = './dist';

    // 启动带扩展的浏览器
    const context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    try {
      // 获取 service worker
      const serviceWorkers = context.serviceWorkers();
      console.log('[Debug] Service workers count:', serviceWorkers.length);

      // 等待 service worker 注册
      if (serviceWorkers.length === 0) {
        console.log('[Debug] Waiting for service worker...');
        await context.waitForEvent('serviceworker', { timeout: 10000 });
        console.log('[Debug] Service worker registered');
      }

      // 获取新的 service worker 列表
      const sw = context.serviceWorkers()[0];
      console.log('[Debug] Service worker URL:', sw?.url());

      // 创建新页面
      const page = await context.newPage();

      // 监听控制台消息
      page.on('console', msg => {
        console.log(`[Page Console] ${msg.type()}: ${msg.text()}`);
      });

      page.on('pageerror', error => {
        console.log(`[Page Error] ${error.message}`);
      });

      // 导航到测试页面
      const testServerUrl = process.env.TEST_SERVER_URL || 'http://localhost:8765';
      console.log(`[Debug] Navigating to ${testServerUrl}/test-page.html`);
      await page.goto(`${testServerUrl}/test-page.html`);
      await page.waitForLoadState('domcontentloaded');

      // 等待并检查扩展标记
      console.log('[Debug] Waiting for extension loaded marker...');
      await page.waitForTimeout(3000);

      // 检查标记是否存在
      const markerExists = await page.evaluate(() => {
        return {
          bodyMarker: document.body?.getAttribute('data-extension-loaded'),
          windowMarker: !!(window as any).__EXTENSION_LOADED__,
          windowInstance: !!(window as any).__NOT_ONLY_TRANSLATOR__,
          testPageLoaded: !!(window as any).__TEST_PAGE_LOADED__,
        };
      });
      console.log('[Debug] Extension markers:', markerExists);

      // 检查内容脚本是否注入
      const scripts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('script')).map(s => ({
          src: s.src,
          type: s.type,
        }));
      });
      console.log('[Debug] Scripts on page:', scripts);

      // 检查 service worker 是否响应
      const swResponse = await sw?.evaluate(() => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
            resolve({
              success: !!response?.success,
              error: chrome.runtime.lastError?.message,
              data: response?.data,
            });
          });
        });
      });
      console.log('[Debug] Service worker GET_SETTINGS response:', swResponse);

      // 注意: 在页面上下文中无法直接访问 chrome.runtime
      // 内容脚本可以访问，但普通页面 JavaScript 不行
      console.log('[Debug] Extension ID from SW:', sw?.url());

      // 断言
      expect(markerExists.bodyMarker).toBe('true');
    } finally {
      await context.close();
    }
  });
});
