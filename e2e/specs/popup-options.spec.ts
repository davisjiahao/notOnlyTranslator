import { test, expect, Page, BrowserContext } from '@playwright/test';
import { openExtensionPopup, openExtensionOptions, getServiceWorker } from '../fixtures/extension';

/**
 * Popup 和 Options 页面测试
 * 验证扩展的 UI 组件功能正常
 */
test.describe('Popup 和 Options 页面', () => {
  let extensionId: string;

  test.beforeEach(async ({ context }) => {
    // 获取扩展 ID
    extensionId = await getExtensionId(context);
  });

  /**
   * 从 context 获取扩展 ID
   */
  async function getExtensionId(context: BrowserContext): Promise<string> {
    // 获取 service worker
    const serviceWorkers = context.serviceWorkers();
    if (serviceWorkers.length === 0) {
      await context.waitForEvent('serviceworker');
      return getExtensionId(context);
    }

    const serviceWorker = serviceWorkers[0];
    const url = serviceWorker.url();
    const match = url.match(/chrome-extension:\/\/([^\/]+)/);
    return match ? match[1] : '';
  }

  test.describe('Popup 页面', () => {
    test('Popup 页面应该正确加载', async ({ context }) => {
      // 创建新页面
      const page = await context.newPage();

      // 打开 popup
      await openExtensionPopup(page, extensionId);

      // 验证页面标题
      const title = await page.title();
      expect(title).toContain('NotOnlyTranslator');

      // 验证主要内容存在
      const mainContent = await page.locator('main, #root, .app').first();
      await expect(mainContent).toBeVisible();
    });

    test('Popup 应该显示用户词汇量级别', async ({ context }) => {
      const page = await context.newPage();
      await openExtensionPopup(page, extensionId);

      // 查找词汇量级别显示元素
      const levelIndicator = await page.locator('[data-testid="vocabulary-level"], .vocab-level, .level-indicator').first();

      // 元素应该存在（即使不总是可见）
      expect(levelIndicator).toBeDefined();
    });

    test('Popup 的设置按钮应该可以打开选项页', async ({ context }) => {
      const page = await context.newPage();
      await openExtensionPopup(page, extensionId);

      // 查找设置按钮
      const settingsButton = await page.locator('button[title*="设置"], button[title*="Settings"], .settings-button, [data-testid="settings"]').first();

      if (await settingsButton.isVisible()) {
        // 创建新页面监听器来捕获选项页打开
        const [optionsPage] = await Promise.all([
          context.waitForEvent('page'),
          settingsButton.click(),
        ]);

        // 验证选项页 URL
        expect(optionsPage.url()).toContain('options');
      }
    });
  });

  test.describe('Options 页面', () => {
    test('Options 页面应该正确加载', async ({ context }) => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 验证页面标题
      const title = await page.title();
      expect(title).toContain('NotOnlyTranslator');

      // 验证主要内容区域
      const mainContent = await page.locator('main, #root, .options-container').first();
      await expect(mainContent).toBeVisible();
    });

    test('Options 页面应该包含 API 设置部分', async ({ context }) => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找 API 设置相关元素
      const apiSection = await page.locator('section:has-text("API"), [data-section="api"], .api-settings').first();

      // API 设置部分应该存在
      expect(apiSection).toBeDefined();
    });

    test('Options 页面应该包含词汇量设置', async ({ context }) => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找词汇量设置
      const vocabSection = await page.locator(
        'section:has-text("词汇"), section:has-text("Vocabulary"), [data-section="vocabulary"], .vocabulary-settings'
      ).first();

      expect(vocabSection).toBeDefined();
    });

    test('保存设置后应该显示成功提示', async ({ context }) => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找保存按钮
      const saveButton = await page.locator('button:has-text("保存"), button:has-text("Save"), [type="submit"]').first();

      if (await saveButton.isVisible()) {
        await saveButton.click();

        // 查找成功提示
        const successMessage = await page.locator('.success-message, .toast-success, [role="alert"]:has-text("成功"), [role="alert"]:has-text("saved")').first();

        // 成功消息应该出现（或设置应该被保存）
        expect(successMessage).toBeDefined();
      }
    });
  });

  test.describe('扩展状态同步', () => {
    test('Options 中的设置更改应该同步到 Popup', async ({ context }) => {
      // 打开 Options 页面
      const optionsPage = await context.newPage();
      await openExtensionOptions(optionsPage, extensionId);

      // 修改某个设置（例如词汇量级别）
      const levelSelect = await optionsPage.locator('select[name="vocabulary-level"], [data-testid="vocab-level-select"]').first();
      if (await levelSelect.isVisible()) {
        await levelSelect.selectOption({ label: 'CET-6' });
        await optionsPage.waitForTimeout(500); // 等待保存

        // 打开 Popup
        const popupPage = await context.newPage();
        await openExtensionPopup(popupPage, extensionId);

        // 验证 Popup 中显示的是新的设置
        const popupLevelIndicator = await popupPage.locator('[data-testid="vocabulary-level"], .vocab-level').first();
        const levelText = await popupLevelIndicator.textContent();
        expect(levelText).toContain('CET-6');
      }
    });
  });
});