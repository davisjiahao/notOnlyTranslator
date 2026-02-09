/**
 * 扩展测试基类和工具
 * 提供扩展测试的基础设施和常用方法
 */

import { test as base, type Page, type BrowserContext, chromium, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * 扩展测试固件类型定义
 */
export interface ExtensionFixtures {
  // 已加载扩展的上下文
  context: BrowserContext;
  // 扩展页面
  extensionPage: Page;
  // 扩展 ID
  extensionId: string;
  // 打开扩展 Popup
  openPopup: () => Promise<Page>;
  // 打开扩展 Options
  openOptions: () => Promise<Page>;
  // 获取背景页
  getBackgroundPage: () => Promise<Page | null>;
  // 等待扩展加载
  waitForExtensionLoaded: (page: Page) => Promise<void>;
}

/**
 * 扩展测试基类
 * 自动加载扩展并提供测试固件
 */
export const test = base.extend<ExtensionFixtures>({
  // 扩展路径
  extensionPath: [path.resolve(__dirname, '../../dist'), { option: true }],

  // 创建带有扩展的浏览器上下文
  context: async ({ extensionPath }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // 扩展测试需要 headed 模式
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // 禁用某些安全检查以便测试
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    await use(context);

    // 测试结束后清理
    await context.close();
  },

  // 扩展 ID - 延迟计算
  extensionId: async ({ context }, use) => {
    const id = await getExtensionIdFromContext(context);
    await use(id);
  },

  // 扩展页面 - 默认打开一个新页面
  extensionPage: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },

  // 打开 Popup 的辅助函数
  openPopup: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      return page;
    });
  },

  // 打开 Options 的辅助函数
  openOptions: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
      return page;
    });
  },

  // 获取背景页的辅助函数
  getBackgroundPage: async ({ context }, use) => {
    await use(async () => {
      return await getBackgroundPageFromContext(context);
    });
  },

  // 等待扩展加载的辅助函数
  waitForExtensionLoaded: async ({}, use) => {
    await use(async (page: Page) => {
      // 等待内容脚本注入
      await page.waitForFunction(() => {
        return document.body?.hasAttribute('data-not-only-translator') ||
               !!document.querySelector('.not-only-translator-tooltip');
      }, { timeout: 10000 });

      // 额外等待确保扩展完全初始化
      await page.waitForTimeout(1000);
    });
  },
});

/**
 * 从上下文中获取扩展 ID
 */
async function getExtensionIdFromContext(context: BrowserContext): Promise<string> {
  // 方法1: 尝试从背景页获取
  const backgroundPage = await getBackgroundPageFromContext(context);
  if (backgroundPage) {
    const id = await backgroundPage.evaluate(() => chrome.runtime.id);
    if (id) return id;
  }

  // 方法2: 打开扩展管理页面获取
  const tempPage = await context.newPage();
  await tempPage.goto('chrome://extensions');

  // 等待扩展列表加载
  await tempPage.waitForSelector('extensions-item', { timeout: 10000 });

  // 查找 NotOnlyTranslator 扩展
  const items = await tempPage.$$('extensions-item');
  for (const item of items) {
    const name = await item.$eval('#name', el => el.textContent).catch(() => null);
    if (name?.includes('NotOnlyTranslator')) {
      const id = await item.$eval('#extension-id', el => el.textContent).catch(() => null);
      if (id) {
        await tempPage.close();
        return id.trim();
      }
    }
  }

  await tempPage.close();

  // 方法3: 使用默认值（仅用于开发测试）
  throw new Error('无法获取扩展 ID，请确保扩展已正确加载');
}

/**
 * 从上下文中获取背景页
 */
async function getBackgroundPageFromContext(context: BrowserContext): Promise<Page | null> {
  // 等待 Service Worker 注册
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 尝试获取 Service Worker 页面
  const pages = context.pages();

  for (const page of pages) {
    const url = page.url();
    // Service Worker 通常有特定的 URL 模式
    if (url.includes('background') ||
        url.includes('service-worker') ||
        url.startsWith('chrome-extension://') && url.includes('sw.js')) {
      return page;
    }
  }

  // 如果没有找到，返回第一个扩展页面
  for (const page of pages) {
    if (page.url().startsWith('chrome-extension://')) {
      return page;
    }
  }

  return null;
}

// 导出 expect
export { expect };
