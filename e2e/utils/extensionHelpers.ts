/**
 * Chrome 扩展测试辅助函数
 * 提供加载扩展、操作扩展图标、获取背景页等功能
 */

import { type Page, type BrowserContext, expect } from '@playwright/test';
import path from 'path';

// 扩展 ID 缓存
let extensionId: string | undefined;

/**
 * 获取 Chrome Extension ID
 * 通过访问 chrome://extensions 页面获取
 */
export async function getExtensionId(context: BrowserContext): Promise<string> {
  if (extensionId) {
    return extensionId;
  }

  // 打开扩展管理页面
  const page = await context.newPage();
  await page.goto('chrome://extensions');

  // 获取扩展 ID
  // 通过查找包含扩展名称的元素来获取 ID
  const idElement = await page.$('text=NotOnlyTranslator >> xpath=../../.. >> [class*="id"]');
  if (idElement) {
    extensionId = await idElement.textContent() || undefined;
  }

  await page.close();

  if (!extensionId) {
    throw new Error('无法获取扩展 ID');
  }

  return extensionId;
}

/**
 * 打开扩展的 Popup 页面
 */
export async function openExtensionPopup(context: BrowserContext): Promise<Page> {
  const id = await getExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/popup/index.html`);
  return page;
}

/**
 * 打开扩展的 Options 页面
 */
export async function openExtensionOptions(context: BrowserContext): Promise<Page> {
  const id = await getExtensionId(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/options/index.html`);
  return page;
}

/**
 * 获取背景页（Background Service Worker）
 */
export async function getBackgroundPage(context: BrowserContext): Promise<Page | null> {
  // 等待背景页加载
  await new Promise(resolve => setTimeout(resolve, 1000));

  // 获取所有页面
  const pages = context.pages();

  // 查找背景页 - Service Worker 通常没有 visible 属性或者是特殊的页面
  for (const page of pages) {
    const url = page.url();
    if (url.includes('background') || url.includes('service-worker')) {
      return page;
    }
  }

  // 如果没有找到，返回第一个页面（可能是背景页）
  return pages[0] || null;
}

/**
 * 等待扩展加载完成
 * 通过检查内容脚本是否注入到页面中
 */
export async function waitForExtensionLoaded(page: Page): Promise<void> {
  // 等待一段时间让扩展加载
  await page.waitForTimeout(2000);

  // 检查内容脚本是否已注入
  // 这里假设内容脚本会设置一个特定的 data 属性或类
  await expect.poll(async () => {
    const hasContentScript = await page.evaluate(() => {
      // 检查是否有内容脚本注入的标志
      // 根据实际的内容脚本实现调整这里
      return document.body.hasAttribute('data-not-only-translator') ||
             document.querySelector('.not-only-translator-tooltip') !== null;
    });
    return hasContentScript;
  }, {
    message: '等待扩展加载完成',
    timeout: 10000,
  }).toBe(true);
}

/**
 * 模拟点击扩展图标（通过 background script 发送消息）
 */
export async function clickExtensionIcon(context: BrowserContext): Promise<void> {
  const backgroundPage = await getBackgroundPage(context);
  if (!backgroundPage) {
    throw new Error('无法获取背景页');
  }

  // 通过执行脚本模拟点击图标
  // 这里需要根据实际情况调整，可能需要发送特定的消息
  await backgroundPage.evaluate(() => {
    // 触发自定义事件或调用 background script 的方法
    chrome.action?.onClicked?.dispatch({
      id: chrome.runtime.id,
    } as unknown as chrome.tabs.Tab);
  });
}

/**
 * 清除扩展存储的数据
 */
export async function clearExtensionStorage(context: BrowserContext): Promise<void> {
  const backgroundPage = await getBackgroundPage(context);
  if (!backgroundPage) {
    throw new Error('无法获取背景页');
  }

  await backgroundPage.evaluate(() => {
    return new Promise<void>((resolve) => {
      chrome.storage.local.clear(() => {
        chrome.storage.sync.clear(() => {
          resolve();
        });
      });
    });
  });
}

/**
 * 设置扩展存储的数据
 */
export async function setExtensionStorage(
  context: BrowserContext,
  data: Record<string, unknown>,
  storageArea: 'local' | 'sync' = 'local'
): Promise<void> {
  const backgroundPage = await getBackgroundPage(context);
  if (!backgroundPage) {
    throw new Error('无法获取背景页');
  }

  await backgroundPage.evaluate(([storageData, area]) => {
    return new Promise<void>((resolve, reject) => {
      const storage = area === 'sync' ? chrome.storage.sync : chrome.storage.local;
      storage.set(storageData, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }, [data, storageArea] as const);
}

/**
 * 获取扩展存储的数据
 */
export async function getExtensionStorage(
  context: BrowserContext,
  keys: string | string[] | null = null,
  storageArea: 'local' | 'sync' = 'local'
): Promise<Record<string, unknown>> {
  const backgroundPage = await getBackgroundPage(context);
  if (!backgroundPage) {
    throw new Error('无法获取背景页');
  }

  return await backgroundPage.evaluate(([storageKeys, area]) => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const storage = area === 'sync' ? chrome.storage.sync : chrome.storage.local;
      storage.get(storageKeys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result as Record<string, unknown>);
        }
      });
    });
  }, [keys, storageArea] as const);
}
