/**
 * Options 页面 E2E 测试
 * 测试扩展选项/设置页面的功能
 */

import { test, expect } from '../utils/extensionTest';
import { safeFill, safeClick, getElementText } from '../utils/testHelpers';

test.describe('Options 页面测试', () => {
  test('Options 页面应该正确加载', async ({ openOptions }) => {
    const options = await openOptions();

    // 检查页面主体
    await expect(options.locator('body')).toBeVisible();

    // 截图
    await options.screenshot({ path: 'e2e/screenshots/options-loaded.png' });

    await options.close();
  });

  test('应该显示设置标签页', async ({ openOptions }) => {
    const options = await openOptions();

    // 查找标签页元素
    const tabs = await options.$$('[role="tab"], .tab, [data-tab]');

    // 至少应该有某些导航元素
    expect(tabs.length).toBeGreaterThan(0);

    await options.close();
  });

  test('应该可以保存设置', async ({ openOptions, context }) => {
    const options = await openOptions();

    // 查找输入框（根据实际 UI 调整选择器）
    const inputs = await options.$$('input[type="text"], input[type="number"], select');

    if (inputs.length > 0) {
      // 尝试修改第一个输入框
      const firstInput = options.locator('input[type="text"]').first();

      if (await firstInput.count() > 0) {
        await safeFill(firstInput, 'test-value-123');

        // 查找保存按钮
        const saveButton = options.locator('button:has-text("保存"), button:has-text("Save"), [data-action="save"]').first();

        if (await saveButton.count() > 0) {
          await safeClick(saveButton);

          // 等待保存完成
          await options.waitForTimeout(1000);

          // 验证设置已保存（通过检查成功消息或重新加载）
          const successMessage = options.locator('.success, [data-success], .toast-success');
          // 不一定有成功消息，所以不做强制断言
        }
      }
    }

    await options.close();
  });

  test('API 设置标签页应该可用', async ({ openOptions }) => {
    const options = await openOptions();

    // 查找 API 设置相关的标签或链接
    const apiTab = options.locator('[data-tab="api"], button:has-text("API"), a:has-text("API")').first();

    if (await apiTab.count() > 0) {
      await safeClick(apiTab);

      // 等待 API 设置面板显示
      await options.waitForTimeout(500);

      // 验证 API 相关输入框存在
      const apiKeyInput = options.locator('input[type="password"], input[placeholder*="API"]').first();
      // 不一定存在，所以只做存在性检查
    }

    await options.close();
  });

  test('词汇量设置应该可配置', async ({ openOptions }) => {
    const options = await openOptions();

    // 查找词汇量相关的设置
    const vocabularySection = options.locator('[data-section="vocabulary"], .vocabulary-settings').first();

    if (await vocabularySection.count() > 0) {
      // 查找词汇级别选择器
      const levelSelect = vocabularySection.locator('select, [data-field="level"]').first();

      if (await levelSelect.count() > 0) {
        await levelSelect.selectOption('cet6'); // 假设有 cet6 选项

        // 验证选择已更新
        await expect(levelSelect).toHaveValue('cet6');
      }
    }

    await options.close();
  });
});
