import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(__dirname, 'dist');

async function testPopup() {
  const context = await chromium.launchPersistentContext('', {
    headless: false, // 必须为 false 才能加载扩展
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }

  // 获取插件 ID
  const extensionId = background.url().split('/')[2];
  console.log(`Extension ID: ${extensionId}`);

  const page = await context.newPage();

  // 访问 Popup 页面
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);

  // 等待渲染完成并模拟一些数据（如果有的话）
  await page.waitForTimeout(2000);

  // 设置视图大小以匹配 Popup
  await page.setViewportSize({ width: 360, height: 600 });

  // 截图
  await page.screenshot({ path: 'popup-test-result.png' });
  console.log('Screenshot saved as popup-test-result.png');

  await context.close();
}

testPopup().catch(console.error);
