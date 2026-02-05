/**
 * Page Object 模式
 * 为扩展的不同页面提供面向对象的封装
 */

import { type Page, type Locator, expect } from '@playwright/test';
import { safeClick, safeFill, waitForElement, getElementText } from './testHelpers';

/**
 * 基础页面对象
 */
export abstract class BasePage {
  protected page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * 导航到指定 URL
   */
  async goto(url: string): Promise<void> {
    await this.page.goto(url);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * 等待页面加载完成
   */
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * 截图
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `e2e/screenshots/${name}.png`,
      fullPage: true,
    });
  }

  /**
   * 获取页面标题
   */
  async getTitle(): Promise<string> {
    return await this.page.title();
  }

  /**
   * 查找元素
   */
  locator(selector: string): Locator {
    return this.page.locator(selector);
  }

  /**
   * 等待元素可见
   */
  async waitForElement(selector: string, timeout = 5000): Promise<Locator> {
    const locator = this.locator(selector);
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  }
}

/**
 * Popup 页面
 */
export class PopupPage extends BasePage {
  // 常用元素选择器
  private selectors = {
    container: '.popup-container, #popup, body',
    header: 'header, .popup-header',
    settingsButton: 'button[data-action="open-options"], a[href*="options"]',
    translateButton: 'button[data-action="translate"], .translate-btn',
    statusText: '.status, .status-text',
  };

  /**
   * 检查 Popup 是否已加载
   */
  async isLoaded(): Promise<boolean> {
    const container = this.locator(this.selectors.container);
    return await container.isVisible().catch(() => false);
  }

  /**
   * 获取标题文本
   */
  async getHeaderText(): Promise<string> {
    const header = await this.waitForElement(this.selectors.header);
    return await getElementText(header);
  }

  /**
   * 点击设置按钮打开选项页面
   */
  async openSettings(): Promise<void> {
    const settingsBtn = this.locator(this.selectors.settingsButton);
    if (await settingsBtn.isVisible()) {
      await safeClick(settingsBtn);
    }
  }

  /**
   * 点击翻译按钮
   */
  async clickTranslate(): Promise<void> {
    const translateBtn = this.locator(this.selectors.translateButton);
    if (await translateBtn.isVisible()) {
      await safeClick(translateBtn);
    }
  }

  /**
   * 获取状态文本
   */
  async getStatusText(): Promise<string> {
    const status = this.locator(this.selectors.statusText);
    if (await status.isVisible()) {
      return await getElementText(status);
    }
    return '';
  }
}

/**
 * Options 页面
 */
export class OptionsPage extends BasePage {
  // 常用元素选择器
  private selectors = {
    container: '.options-container, #options, body',
    tabs: '[role="tab"], .tab',
    tabPanels: '[role="tabpanel"], .tab-panel',
    // API 设置
    apiKeyInput: 'input[type="password"][name*="api"], input[name*="key"]',
    apiProviderSelect: 'select[name*="provider"], select[name*="api"]',
    // 词汇设置
    vocabularyLevelSelect: 'select[name*="level"], select[name*="vocabulary"]',
    // 保存按钮
    saveButton: 'button[type="submit"], button:has-text("保存"), button:has-text("Save")',
    // 成功消息
    successMessage: '.success, .toast-success, [data-success]',
  };

  /**
   * 检查 Options 页面是否已加载
   */
  async isLoaded(): Promise<boolean> {
    const container = this.locator(this.selectors.container);
    return await container.isVisible().catch(() => false);
  }

  /**
   * 切换到指定标签页
   */
  async switchTab(tabName: string): Promise<void> {
    const tabs = this.locator(this.selectors.tabs);
    const count = await tabs.count();

    for (let i = 0; i < count; i++) {
      const tab = tabs.nth(i);
      const text = await tab.textContent();
      if (text?.toLowerCase().includes(tabName.toLowerCase())) {
        await safeClick(tab);
        await this.page.waitForTimeout(500);
        return;
      }
    }
  }

  /**
   * 填写 API 密钥
   */
  async fillApiKey(apiKey: string): Promise<void> {
    const input = this.locator(this.selectors.apiKeyInput).first();
    if (await input.isVisible()) {
      await input.fill(apiKey);
    }
  }

  /**
   * 选择 API 提供商
   */
  async selectApiProvider(provider: string): Promise<void> {
    const select = this.locator(this.selectors.apiProviderSelect).first();
    if (await select.isVisible()) {
      await select.selectOption(provider);
    }
  }

  /**
   * 选择词汇级别
   */
  async selectVocabularyLevel(level: string): Promise<void> {
    const select = this.locator(this.selectors.vocabularyLevelSelect).first();
    if (await select.isVisible()) {
      await select.selectOption(level);
    }
  }

  /**
   * 点击保存按钮
   */
  async clickSave(): Promise<void> {
    const saveBtn = this.locator(this.selectors.saveButton).first();
    if (await saveBtn.isVisible()) {
      await safeClick(saveBtn);
    }
  }

  /**
   * 保存设置（组合操作）
   */
  async saveSettings(settings: {
    apiKey?: string;
    apiProvider?: string;
    vocabularyLevel?: string;
  }): Promise<void> {
    // 切换到 API 设置标签
    await this.switchTab('API');

    // 填写设置
    if (settings.apiKey) {
      await this.fillApiKey(settings.apiKey);
    }
    if (settings.apiProvider) {
      await this.selectApiProvider(settings.apiProvider);
    }

    // 切换到词汇设置标签
    await this.switchTab('词汇');

    if (settings.vocabularyLevel) {
      await this.selectVocabularyLevel(settings.vocabularyLevel);
    }

    // 保存设置
    await this.clickSave();

    // 等待保存完成
    await this.page.waitForTimeout(1000);
  }

  /**
   * 获取保存成功消息
   */
  async getSuccessMessage(): Promise<string> {
    const message = this.locator(this.selectors.successMessage).first();
    if (await message.isVisible()) {
      return await message.textContent() || '';
    }
    return '';
  }
}

/**
 * 普通网页（用于内容脚本测试）
 */
export class WebPage extends BasePage {
  /**
   * 获取页面上所有文本内容
   */
  async getAllText(): Promise<string> {
    return await this.page.evaluate(() => document.body.innerText);
  }

  /**
   * 查找包含特定文本的元素
   */
  async findText(text: string): Promise<boolean> {
    const pageText = await this.getAllText();
    return pageText.includes(text);
  }

  /**
   * 获取被扩展标注的单词
   */
  async getHighlightedWords(): Promise<string[]> {
    return await this.page.evaluate(() => {
      const elements = document.querySelectorAll('[data-not-only-translator-word]');
      return Array.from(elements).map(el => el.textContent || '');
    });
  }

  /**
   * 悬停在单词上显示提示框
   */
  async hoverOverWord(word: string): Promise<void> {
    const wordElement = this.page.locator(`[data-not-only-translator-word]:has-text("${word}")`).first();
    if (await wordElement.count() > 0) {
      await wordElement.hover();
      await this.page.waitForTimeout(500);
    }
  }

  /**
   * 获取提示框内容
   */
  async getTooltipContent(): Promise<string> {
    const tooltip = this.page.locator('.not-only-translator-tooltip, [data-not-only-translator-tooltip]').first();
    if (await tooltip.isVisible()) {
      return await tooltip.textContent() || '';
    }
    return '';
  }
}
