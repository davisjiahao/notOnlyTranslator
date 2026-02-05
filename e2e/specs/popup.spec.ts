/**
 * Popup 页面 E2E 测试
 * 测试扩展弹出窗口的功能
 */

import { test, expect } from '../utils/extensionTest';

test.describe('Popup 页面测试', () => {
  test('Popup 页面应该正确加载', async ({ openPopup }) => {
    const popup = await openPopup();

    // 检查页面标题或关键元素
    await expect(popup.locator('body')).toBeVisible();

    // 截图保存
    await popup.screenshot({ path: 'e2e/screenshots/popup-loaded.png' });

    await popup.close();
  });

  test('Popup 应该显示主要功能按钮', async ({ openPopup }) => {
    const popup = await openPopup();

    // 检查是否存在主要按钮或元素
    // 根据实际 UI 调整选择器
    const buttons = await popup.$$('button');
    expect(buttons.length).toBeGreaterThan(0);

    await popup.close();
  });

  test('Popup 可以与选项页面交互', async ({ openPopup, openOptions }) => {
    const popup = await openPopup();

    // 尝试打开选项页面链接
    const optionsLink = popup.locator('a[href*="options"], button[data-action="open-options"]');

    if (await optionsLink.count() > 0) {
      await optionsLink.click();

      // 验证选项页面打开
      const options = await openOptions();
      await expect(options.locator('body')).toBeVisible();
      await options.close();
    }

    await popup.close();
  });
});
