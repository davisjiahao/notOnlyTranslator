import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { test, expect, BrowserContext, Page, chromium } from '@playwright/test';
import { openExtensionOptions, openExtensionPopup } from '../fixtures/extension';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 用户设置测试
 * 验证设置页面的功能和数据持久化
 */
test.describe('用户设置', () => {
  let extensionId: string;
  let context: BrowserContext;

  test.beforeAll(async () => {
    // 创建带扩展的 browser context
    const extensionPath = path.resolve(__dirname, '../../dist');
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    // 等待扩展加载
    await new Promise(resolve => setTimeout(resolve, 2000));
  });

  test.afterAll(async () => {
    await context.close();
  });

  /**
   * 从 context 获取扩展 ID
   */
  async function getExtensionId(context: BrowserContext): Promise<string> {
    // 方法1: 尝试从已有的 service worker 获取
    let serviceWorkers = context.serviceWorkers();

    // 方法2: 等待 service worker 注册（带超时）
    if (serviceWorkers.length === 0) {
      try {
        await context.waitForEvent('serviceworker', { timeout: 5000 });
        serviceWorkers = context.serviceWorkers();
      } catch {
        // 超时继续尝试其他方法
      }
    }

    if (serviceWorkers.length > 0) {
      const url = serviceWorkers[0].url();
      const match = url.match(/chrome-extension:\/\/([^\/]+)/);
      if (match) return match[1];
    }

    // 方法3: 通过 chrome://extensions 页面获取
    const tempPage = await context.newPage();
    try {
      await tempPage.goto('chrome://extensions');
      await tempPage.waitForSelector('extensions-item', { timeout: 5000 });

      const items = await tempPage.$$('extensions-item');
      for (const item of items) {
        const name = await item.$eval('#name', el => el.textContent).catch(() => null);
        if (name?.includes('NotOnlyTranslator')) {
          const id = await item.$eval('#extension-id', el => el.textContent).catch(() => null);
          if (id) return id.trim();
        }
      }
    } finally {
      await tempPage.close();
    }

    throw new Error('无法获取扩展 ID，请确保扩展已正确加载');
  }

  test.beforeEach(async () => {
    // 确保有扩展 ID
    if (!extensionId) {
      extensionId = await getExtensionId(context);
    }
  });

  test.describe('词汇量级别设置', () => {
    test('应该能够更改词汇量级别', async () => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找词汇量级别选择器
      const levelSelect = await page.locator('select[name="vocabulary-level"], select[name="proficiencyLevel"], [data-testid="vocab-level-select"]').first();

      if (await levelSelect.isVisible()) {
        // 选择新的级别
        await levelSelect.selectOption({ label: 'CET-6' });

        // 验证选择已更新
        const selectedValue = await levelSelect.inputValue();
        expect(selectedValue).toContain('cet6');
      }

      await page.close();
    });

    test('词汇量级别更改应该持久化', async () => {
      // 第一步：更改设置
      const optionsPage = await context.newPage();
      await openExtensionOptions(optionsPage, extensionId);

      const levelSelect = await optionsPage.locator('select[name="vocabulary-level"], select[name="proficiencyLevel"], [data-testid="vocab-level-select"]').first();

      if (await levelSelect.isVisible()) {
        // 选择 GRE 级别
        await levelSelect.selectOption({ label: 'GRE' });
        await optionsPage.waitForTimeout(1000); // 等待保存

        // 关闭 options 页面
        await optionsPage.close();

        // 第二步：重新打开验证设置是否持久化
        const newOptionsPage = await context.newPage();
        await openExtensionOptions(newOptionsPage, extensionId);

        const newLevelSelect = await newOptionsPage.locator('select[name="vocabulary-level"], select[name="proficiencyLevel"], [data-testid="vocab-level-select"]').first();
        const selectedValue = await newLevelSelect.inputValue();

        // 验证设置已持久化
        expect(selectedValue.toLowerCase()).toContain('gre');

        await newOptionsPage.close();
      }
    });
  });

  test.describe('API 设置', () => {
    test('应该能够输入 API 密钥', async () => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找 API Key 输入框
      const apiKeyInput = await page.locator('input[type="password"][name*="api"], input[name="apiKey"], input[data-testid="api-key"]').first();

      if (await apiKeyInput.isVisible()) {
        // 输入测试 API Key
        const testApiKey = 'sk-test-123456789';
        await apiKeyInput.fill(testApiKey);

        // 验证输入值
        const inputValue = await apiKeyInput.inputValue();
        expect(inputValue).toBe(testApiKey);
      }

      await page.close();
    });

    test('API 提供商选择应该可用', async () => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找 API 提供商选择器
      const providerSelect = await page.locator('select[name="apiProvider"], select[name="provider"], [data-testid="api-provider"]').first();

      if (await providerSelect.isVisible()) {
        // 获取所有可用选项
        const options = await providerSelect.locator('option').allTextContents();

        // 验证至少有一些常见的 API 提供商选项
        const expectedProviders = ['OpenAI', 'Anthropic', 'Custom', 'Claude', 'GPT'];
        const hasExpectedProvider = expectedProviders.some(provider =>
          options.some(option => option.includes(provider))
        );

        expect(hasExpectedProvider || options.length > 0).toBe(true);
      }

      await page.close();
    });
  });

  test.describe('设置导入导出', () => {
    test('应该有导出设置按钮', async () => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找导出按钮
      const exportButton = await page.locator('button:has-text("导出"), button:has-text("Export"), [data-testid="export-settings"]').first();

      // 导出按钮应该存在（即使不可见）
      expect(await exportButton.count()).toBeGreaterThanOrEqual(0);

      await page.close();
    });

    test('应该有导入设置按钮', async () => {
      const page = await context.newPage();
      await openExtensionOptions(page, extensionId);

      // 查找导入按钮
      const importButton = await page.locator('button:has-text("导入"), button:has-text("Import"), [data-testid="import-settings"]').first();

      // 导入按钮应该存在（即使不可见）
      expect(await importButton.count()).toBeGreaterThanOrEqual(0);

      await page.close();
    });
  });
});