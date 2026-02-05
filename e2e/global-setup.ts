import { chromium, FullConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

/**
 * Playwright 全局设置
 * 在所有测试之前运行一次
 */

// ES 模块中获取 __dirname 的替代方案
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function globalSetup(config: FullConfig) {
  console.log('[Global Setup] Starting...');

  // 验证扩展构建是否存在
  const extensionPath = resolve(__dirname, '../dist');
  console.log(`[Global Setup] Extension path: ${extensionPath}`);

  // 可选：预启动浏览器验证扩展是否加载成功
  const browser = await chromium.launch({
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    headless: false,
  });

  // 等待一下让扩展初始化
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('[Global Setup] Extension loaded successfully');

  await browser.close();
  console.log('[Global Setup] Completed');
}

export default globalSetup;
