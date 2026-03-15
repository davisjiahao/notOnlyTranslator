import { chromium, FullConfig } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

/**
 * Playwright 全局设置
 * 在所有测试之前运行一次，启动 HTTP 服务器并提供扩展加载
 */

// ES 模块中获取 __dirname 的替代方案
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 存储服务器实例和端口
export let server: ReturnType<typeof createServer>;
export const TEST_SERVER_PORT = 8765;
export const TEST_SERVER_URL = `http://localhost:${TEST_SERVER_PORT}`;

async function globalSetup(config: FullConfig) {
  console.log('[Global Setup] Starting...');

  // 启动 HTTP 服务器提供测试页面
  server = createServer(async (req, res) => {
    const url = req.url || '/';
    // 去除开头的 /，否则 resolve 会将其视为绝对路径
    const relativePath = url === '/' ? 'test-page.html' : url.replace(/^\//, '');
    const filePath = resolve(__dirname, './fixtures', relativePath);

    // 安全检查：确保请求的文件在 fixtures 目录内
    if (!filePath.startsWith(resolve(__dirname, './fixtures'))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    try {
      const content = await readFile(filePath);
      const ext = filePath.split('.').pop();
      const contentType = {
        html: 'text/html',
        js: 'application/javascript',
        css: 'text/css',
        json: 'application/json',
      }[ext || ''] || 'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(TEST_SERVER_PORT, () => {
      console.log(`[Global Setup] Test server running at ${TEST_SERVER_URL}`);
      resolve();
    });
  });

  // 将服务器 URL 写入环境变量供测试使用
  process.env.TEST_SERVER_URL = TEST_SERVER_URL;

  // 验证扩展构建是否存在
  const extensionPath = resolve(__dirname, '../dist');
  console.log(`[Global Setup] Extension path: ${extensionPath}`);

  // 预启动浏览器验证扩展是否加载成功
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
