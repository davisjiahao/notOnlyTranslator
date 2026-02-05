import { Page, BrowserContext, expect } from '@playwright/test';
import path from 'path';

/**
 * 扩展测试工具函数
 * 提供用于测试 Chrome 扩展的辅助函数
 */

/**
 * 等待扩展加载完成
 */
export async function waitForExtensionLoaded(page: Page, timeout = 10000): Promise<void> {
  // 等待扩展的 content script 注入完成
  await page.waitForFunction(
    () => {
      // 检查是否有扩展注入的标记或元素
      const extensionMarker = document.querySelector('[data-extension-loaded]');
      return !!extensionMarker || !!(window as any).__EXTENSION_LOADED__;
    },
    { timeout }
  );
}

/**
 * 获取扩展的 background service worker
 */
export async function getServiceWorker(context: BrowserContext): Promise<Page> {
  const serviceWorkers = context.serviceWorkers();
  if (serviceWorkers.length === 0) {
    // 等待 service worker 注册
    await context.waitForEvent('serviceworker');
    return getServiceWorker(context);
  }
  return serviceWorkers[0];
}

/**
 * 打开扩展的 popup 页面
 */
export async function openExtensionPopup(page: Page, extensionId: string): Promise<Page> {
  const popupUrl = `chrome-extension://${extensionId}/popup/index.html`;
  await page.goto(popupUrl);
  return page;
}

/**
 * 打开扩展的 options 页面
 */
export async function openExtensionOptions(page: Page, extensionId: string): Promise<Page> {
  const optionsUrl = `chrome-extension://${extensionId}/options/index.html`;
  await page.goto(optionsUrl);
  return page;
}

/**
 * 模拟点击扩展图标（通过 background script 触发）
 */
export async function clickExtensionIcon(serviceWorker: Page): Promise<void> {
  await serviceWorker.evaluate(() => {
    // 触发扩展图标的点击事件
    chrome.action?.onClicked?.dispatch({
      id: 'test-tab',
      url: 'https://example.com',
    } as any);
  });
}

/**
 * 等待页面上的翻译标记出现
 */
export async function waitForTranslationMarkers(page: Page, timeout = 10000): Promise<void> {
  await page.waitForSelector('[data-translation-marker], .translation-highlight, .word-highlight', {
    timeout,
    state: 'visible',
  });
}

/**
 * 获取页面上所有被标记的单词
 */
export async function getHighlightedWords(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const elements = document.querySelectorAll('[data-translation-marker], .translation-highlight, .word-highlight');
    return Array.from(elements).map(el => el.textContent || '').filter(Boolean);
  });
}

/**
 * 检查扩展是否已注入 content script
 */
export async function isContentScriptInjected(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    return typeof (window as any).__NOT_ONLY_TRANSLATOR__ !== 'undefined';
  });
}

/**
 * 获取扩展在页面上的配置
 */
export async function getExtensionConfig(page: Page): Promise<Record<string, any> | null> {
  return page.evaluate(() => {
    return (window as any).__NOT_ONLY_TRANSLATOR_CONFIG__ || null;
  });
}