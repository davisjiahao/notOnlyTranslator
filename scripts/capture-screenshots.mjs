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
    // 使用本地 demo 页面
    const demoPagePath = path.join(SCREENSHOTS_DIR, 'demo-page.html');
    await page.goto(`file://${demoPagePath}`);
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '01-main-interface.png'),
      fullPage: false,
    });
    console.log('✅ 主界面截图完成');

    // 2. 设置页面截图
    console.log('📸 拍摄: 设置页面...');
    await page.goto(`file://${demoPagePath}`);
    await page.evaluate(() => {
      // 模拟设置页面样式
      document.body.innerHTML = `
        <div style="max-width: 900px; margin: 40px auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <h1 style="color: #2563eb; margin-bottom: 30px;">⚙️ NotOnlyTranslator 设置</h1>
          <div style="margin-bottom: 25px;">
            <label style="display: block; font-weight: 600; margin-bottom: 8px;">翻译提供商</label>
            <select style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
              <option>OpenAI GPT-4o-mini</option>
              <option>Anthropic Claude Haiku</option>
              <option>DeepL</option>
              <option>Google Translate</option>
            </select>
          </div>
          <div style="margin-bottom: 25px;">
            <label style="display: block; font-weight: 600; margin-bottom: 8px;">API 密钥</label>
            <input type="password" value="sk-xxxxxxxxxxxxxxxx" style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px;">
          </div>
          <div style="margin-bottom: 25px;">
            <label style="display: block; font-weight: 600; margin-bottom: 8px;">英语水平</label>
            <input type="range" min="1" max="3" value="2" style="width: 100%;">
            <div style="display: flex; justify-content: space-between; color: #6b7280; font-size: 12px; margin-top: 5px;">
              <span>初级</span><span>中级</span><span>高级</span>
            </div>
          </div>
          <div style="margin-bottom: 25px;">
            <label style="display: block; font-weight: 600; margin-bottom: 8px;">主题</label>
            <div style="display: flex; gap: 10px;">
              <button style="padding: 8px 16px; background: #2563eb; color: white; border: none; border-radius: 6px;">浅色</button>
              <button style="padding: 8px 16px; background: #f3f4f6; color: #374151; border: none; border-radius: 6px;">深色</button>
            </div>
          </div>
          <button style="padding: 12px 24px; background: #10b981; color: white; border: none; border-radius: 6px; font-weight: 600;">保存设置</button>
        </div>
      `;
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '02-settings-page.png'),
      fullPage: false,
    });
    console.log('✅ 设置页面截图完成');

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
