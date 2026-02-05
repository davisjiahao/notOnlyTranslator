import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

/**
 * Playwright 配置用于 Chrome 扩展 E2E 测试
 * @see https://playwright.dev/docs/test-configuration
 */

// ES 模块中获取 __dirname 的替代方案
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  testDir: './e2e',

  /* 并行运行测试 */
  fullyParallel: true,

  /* 失败时保留输出 */
  forbidOnly: !!process.env.CI,

  /* 重试配置 */
  retries: process.env.CI ? 2 : 0,

  /* 并行 workers */
  workers: process.env.CI ? 1 : undefined,

  /* 报告器配置 */
  reporter: [
    ['html', { outputFolder: 'e2e-report' }],
    ['list'],
  ],

  /* 共享快照配置 */
  snapshotPathTemplate: 'e2e/snapshots/{projectName}/{testFilePath}/{arg}{ext}',

  /* 全局测试配置 */
  use: {
    /* 基础 URL */
    baseURL: 'https://example.com',

    /* 收集追踪信息 */
    trace: 'on-first-retry',

    /* 截图配置 */
    screenshot: 'only-on-failure',

    /* 视频录制 */
    video: 'on-first-retry',
  },

  /* 项目配置 */
  projects: [
    {
      name: 'chromium-extension',
      use: {
        ...devices['Desktop Chrome'],
        /* 加载已编译的扩展 */
        launchOptions: {
          args: [
            `--disable-extensions-except=${resolve(__dirname, 'dist')}`,
            `--load-extension=${resolve(__dirname, 'dist')}`,
            '--no-first-run',
            '--no-default-browser-check',
          ],
        },
      },
    },
  ],

  /* 全局设置 */
  globalSetup: resolve(__dirname, 'e2e/global-setup.ts'),
  globalTeardown: resolve(__dirname, 'e2e/global-teardown.ts'),
});
