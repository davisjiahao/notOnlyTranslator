#!/usr/bin/env node
/**
 * Chrome Web Store 截图生成脚本
 * 使用 Playwright 自动化生成商店截图
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(new URL(import.meta.url).pathname);

// 截图配置
const SCREENSHOTS_DIR = path.join(__dirname, '../docs/store-screenshots');
const EXTENSION_PATH = path.join(__dirname, '../dist');

// 确保截图目录存在
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// 截图规格
const VIEWPORT = { width: 1280, height: 800 };

async function captureScreenshots() {
  console.log('🚀 启动浏览器...');

  const browser = await chromium.launch({
    headless: false, // 需要可视化来操作扩展
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
    });

    const page = await context.newPage();

    // 1. 主界面截图 - 英文网页翻译效果
    console.log('📸 拍摄: 主界面截图...');
    await page.goto('https://en.wikipedia.org/wiki/Artificial_intelligence');
    await page.waitForTimeout(3000); // 等待页面扫描

    // 尝试点击一个单词显示翻译提示
    const word = await page.locator('text=algorithm').first();
    if (await word.isVisible().catch(() => false)) {
      await word.hover();
      await page.waitForTimeout(1000);
    }

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-main-interface.png'),
      fullPage: false,
    });
    console.log('✅ 主界面截图完成');

    // 2. 设置页面截图
    console.log('📸 拍摄: 设置页面...');
    // 打开扩展选项页面
    const extensionId = await getExtensionId(browser);
    if (extensionId) {
      await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '02-settings-page.png'),
        fullPage: false,
      });
      console.log('✅ 设置页面截图完成');
    }

    // 3. 统计面板截图
    console.log('📸 拍摄: 统计面板...');
    if (extensionId) {
      await page.goto(`chrome-extension://${extensionId}/src/options/index.html#/statistics`);
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '03-statistics-dashboard.png'),
        fullPage: false,
      });
      console.log('✅ 统计面板截图完成');
    }

    // 4. 闪卡复习截图
    console.log('📸 拍摄: 闪卡复习...');
    if (extensionId) {
      await page.goto(`chrome-extension://${extensionId}/src/options/index.html#/review`);
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '04-flashcard-review.png'),
        fullPage: false,
      });
      console.log('✅ 闪卡复习截图完成');
    }

    // 5. 词汇管理截图
    console.log('📸 拍摄: 词汇管理...');
    if (extensionId) {
      await page.goto(`chrome-extension://${extensionId}/src/options/index.html#/vocabulary`);
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: path.join(SCREENSHOTS_DIR, '05-vocabulary-management.png'),
        fullPage: false,
      });
      console.log('✅ 词汇管理截图完成');
    }

    console.log('\n🎉 所有截图完成！');
    console.log(`📁 截图保存位置: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('❌ 截图失败:', error);
  } finally {
    await browser.close();
  }
}

// 获取扩展 ID
async function getExtensionId(browser) {
  // 通过 service worker 获取扩展 ID
  const context = browser.contexts()[0];
  const pages = context.pages();

  for (const page of pages) {
    const url = page.url();
    if (url.startsWith('chrome-extension://')) {
      const match = url.match(/chrome-extension:\/\/([^/]+)/);
      if (match) return match[1];
    }
  }

  return null;
}

// 运行截图
captureScreenshots().catch(console.error);
