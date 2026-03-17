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
    await page.goto(`file://${demoPagePath}`);
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="max-width: 1000px; margin: 40px auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <h1 style="color: #2563eb; margin-bottom: 30px;">📊 学习统计</h1>
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 40px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
              <div style="font-size: 2em; font-weight: bold;">247</div>
              <div style="font-size: 14px; opacity: 0.9;">已掌握单词</div>
            </div>
            <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
              <div style="font-size: 2em; font-weight: bold;">89</div>
              <div style="font-size: 14px; opacity: 0.9;">学习中单词</div>
            </div>
            <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
              <div style="font-size: 2em; font-weight: bold;">15</div>
              <div style="font-size: 14px; opacity: 0.9;">连续学习天数</div>
            </div>
            <div style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
              <div style="font-size: 2em; font-weight: bold;">89%</div>
              <div style="font-size: 14px; opacity: 0.9;">翻译准确率</div>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 30px;">
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px;">
              <h3 style="margin-bottom: 15px; color: #374151;">📈 词汇量增长曲线</h3>
              <div style="height: 200px; background: linear-gradient(to top, #dbeafe 0%, transparent 100%); border-radius: 4px; position: relative;">
                <svg viewBox="0 0 400 200" style="width: 100%; height: 100%;">
                  <polyline fill="none" stroke="#2563eb" stroke-width="3" points="0,180 50,160 100,150 150,130 200,110 250,90 300,70 350,50 400,30"/>
                  <circle cx="400" cy="30" r="6" fill="#2563eb"/>
                </svg>
              </div>
            </div>
            <div style="background: #f9fafb; padding: 20px; border-radius: 8px;">
              <h3 style="margin-bottom: 15px; color: #374151;">🎯 掌握程度分布</h3>
              <div style="display: flex; flex-direction: column; gap: 10px;">
                <div><span style="color: #10b981;">●</span> 已掌握 73%</div>
                <div><span style="color: #f59e0b;">●</span> 学习中 27%</div>
                <div><span style="color: #6b7280;">●</span> 未标记 0%</div>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '03-statistics-dashboard.png'),
      fullPage: false,
    });
    console.log('✅ 统计面板截图完成');

    // 4. 闪卡复习截图
    console.log('📸 拍摄: 闪卡复习...');
    await page.goto(`file://${demoPagePath}`);
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="max-width: 900px; margin: 40px auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); text-align: center;">
          <h1 style="color: #2563eb; margin-bottom: 30px;">🎯 闪卡复习</h1>
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 60px; border-radius: 20px; margin: 40px 0; cursor: pointer; box-shadow: 0 10px 30px rgba(102,126,234,0.3);">
            <div style="font-size: 3em; font-weight: bold; margin-bottom: 20px;">Serendipity</div>
            <div style="font-size: 1.5em; opacity: 0.9;">/ˌserənˈdɪpɪti/</div>
            <div style="margin-top: 30px; padding-top: 30px; border-top: 1px solid rgba(255,255,255,0.3);">
              <div style="font-size: 1.8em;">意外发现珍奇事物的能力</div>
              <div style="font-size: 1em; opacity: 0.8; margin-top: 15px;">The occurrence of events by chance in a happy way</div>
            </div>
          </div>
          <div style="color: #6b7280; margin-bottom: 20px;">点击卡片翻转 | 使用键盘 1-5 评分</div>
          <div style="display: flex; justify-content: center; gap: 10px;">
            <button style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid #ef4444; background: white; color: #ef4444; font-weight: bold;">1</button>
            <button style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid #f97316; background: white; color: #f97316; font-weight: bold;">2</button>
            <button style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid #eab308; background: white; color: #eab308; font-weight: bold;">3</button>
            <button style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid #22c55e; background: white; color: #22c55e; font-weight: bold;">4</button>
            <button style="width: 50px; height: 50px; border-radius: 50%; border: 2px solid #10b981; background: white; color: #10b981; font-weight: bold;">5</button>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '04-flashcard-review.png'),
      fullPage: false,
    });
    console.log('✅ 闪卡复习截图完成');

    // 5. 词汇管理截图
    console.log('📸 拍摄: 词汇管理...');
    await page.goto(`file://${demoPagePath}`);
    await page.evaluate(() => {
      document.body.innerHTML = `
        <div style="max-width: 900px; margin: 40px auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <h1 style="color: #2563eb; margin-bottom: 30px;">📚 词汇管理</h1>
          <div style="display: flex; gap: 20px; margin-bottom: 30px; border-bottom: 2px solid #e5e7eb;">
            <div style="padding: 10px 20px; border-bottom: 2px solid #2563eb; color: #2563eb; font-weight: 600;">已掌握 (247)</div>
            <div style="padding: 10px 20px; color: #6b7280;">学习中 (89)</div>
            <div style="padding: 10px 20px; color: #6b7280;">全部 (336)</div>
          </div>
          <div style="margin-bottom: 20px;">
            <input type="text" placeholder="搜索单词..." style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px;">
          </div>
          <div style="display: grid; gap: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 15px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              <div>
                <div style="font-weight: 600; font-size: 1.1em;">Algorithm</div>
                <div style="color: #6b7280; font-size: 0.9em;">算法；计算程序</div>
              </div>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 12px;">已掌握</span>
                <button style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; font-size: 12px;">删除</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 15px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              <div>
                <div style="font-weight: 600; font-size: 1.1em;">Neural Network</div>
                <div style="color: #6b7280; font-size: 0.9em;">神经网络</div>
              </div>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 12px;">已掌握</span>
                <button style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; font-size: 12px;">删除</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 15px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              <div>
                <div style="font-weight: 600; font-size: 1.1em;">Machine Learning</div>
                <div style="color: #6b7280; font-size: 0.9em;">机器学习</div>
              </div>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 12px;">已掌握</span>
                <button style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; font-size: 12px;">删除</button>
              </div>
            </div>
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 15px; background: #f9fafb; border-radius: 8px; border-left: 4px solid #10b981;">
              <div>
                <div style="font-weight: 600; font-size: 1.1em;">Deep Learning</div>
                <div style="color: #6b7280; font-size: 0.9em;">深度学习</div>
              </div>
              <div style="display: flex; gap: 10px; align-items: center;">
                <span style="background: #d1fae5; color: #065f46; padding: 4px 12px; border-radius: 12px; font-size: 12px;">已掌握</span>
                <button style="padding: 6px 12px; background: #ef4444; color: white; border: none; border-radius: 4px; font-size: 12px;">删除</button>
              </div>
            </div>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb;">
            <button style="padding: 10px 20px; background: #f3f4f6; border: none; border-radius: 6px;">导出数据</button>
            <div style="color: #6b7280;">显示 1-4 共 247 个单词</div>
          </div>
        </div>
      `;
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, '05-vocabulary-management.png'),
      fullPage: false,
    });
    console.log('✅ 词汇管理截图完成');

    console.log('\n🎉 所有截图完成！');
    console.log(`📁 截图保存位置: ${SCREENSHOTS_DIR}`);

  } catch (error) {
    console.error('❌ 截图失败:', error);
  } finally {
    await browser.close();
  }
}

// 运行截图
captureScreenshots().catch(console.error);
