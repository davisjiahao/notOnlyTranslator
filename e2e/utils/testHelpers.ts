/**
 * 通用测试辅助函数
 * 提供页面操作、元素定位、断言等常用功能
 */

import { type Page, type Locator, expect } from '@playwright/test';

/**
 * 等待页面加载完成
 */
export async function waitForPageLoad(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForLoadState('domcontentloaded');
}

/**
 * 安全地点击元素（等待元素可点击）
 */
export async function safeClick(locator: Locator, timeout = 5000): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout });
  await locator.waitFor({ state: 'enabled', timeout });
  await locator.click();
}

/**
 * 安全地填充输入框
 */
export async function safeFill(locator: Locator, text: string, timeout = 5000): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout });
  await locator.clear();
  await locator.fill(text);
}

/**
 * 等待元素出现
 */
export async function waitForElement(
  page: Page,
  selector: string,
  timeout = 5000
): Promise<Locator> {
  const locator = page.locator(selector);
  await locator.waitFor({ state: 'visible', timeout });
  return locator;
}

/**
 * 等待元素消失
 */
export async function waitForElementToDisappear(
  locator: Locator,
  timeout = 5000
): Promise<void> {
  await locator.waitFor({ state: 'hidden', timeout });
}

/**
 * 检查元素是否存在
 */
export async function elementExists(locator: Locator): Promise<boolean> {
  try {
    await locator.waitFor({ state: 'visible', timeout: 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取元素的文本内容
 */
export async function getElementText(locator: Locator): Promise<string> {
  await locator.waitFor({ state: 'visible' });
  return await locator.textContent() || '';
}

/**
 * 模拟键盘按键
 */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}

/**
 * 模拟键盘输入
 */
export async function typeText(page: Page, text: string, delay = 50): Promise<void> {
  await page.keyboard.type(text, { delay });
}

/**
 * 滚动到元素
 */
export async function scrollToElement(page: Page, selector: string): Promise<void> {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
}

/**
 * 滚动页面
 */
export async function scrollPage(page: Page, direction: 'up' | 'down' | 'left' | 'right', amount = 500): Promise<void> {
  const scrollMap = {
    up: [0, -amount],
    down: [0, amount],
    left: [-amount, 0],
    right: [amount, 0],
  };

  await page.evaluate(([x, y]) => window.scrollBy(x, y), scrollMap[direction]);
}

/**
 * 等待网络请求完成
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout });
}

/**
 * 拦截网络请求
 */
export function interceptRequest(
  page: Page,
  urlPattern: string | RegExp,
  handler: (route: import('@playwright/test').Route) => Promise<void>
): Promise<void> {
  return page.route(urlPattern, handler);
}

/**
 * 模拟网络离线
 */
export async function setOfflineMode(page: Page, offline: boolean): Promise<void> {
  await page.context().setOffline(offline);
}

/**
 * 设置视口大小
 */
export async function setViewportSize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
}

/**
 * 获取页面性能指标
 */
export async function getPerformanceMetrics(page: Page): Promise<Record<string, number>> {
  return await page.evaluate(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    return {
      loadTime: navigation.loadEventEnd - navigation.startTime,
      domContentLoaded: navigation.domContentLoadedEventEnd - navigation.startTime,
      firstPaint: performance.getEntriesByType('paint').find(p => p.name === 'first-paint')?.startTime || 0,
    };
  });
}

/**
 * 断言元素文本内容
 */
export async function expectElementToHaveText(
  locator: Locator,
  expectedText: string | RegExp,
  timeout = 5000
): Promise<void> {
  await expect(locator).toHaveText(expectedText, { timeout });
}

/**
 * 断言元素可见
 */
export async function expectElementToBeVisible(
  locator: Locator,
  timeout = 5000
): Promise<void> {
  await expect(locator).toBeVisible({ timeout });
}

/**
 * 断言元素隐藏
 */
export async function expectElementToBeHidden(
  locator: Locator,
  timeout = 5000
): Promise<void> {
  await expect(locator).toBeHidden({ timeout });
}
