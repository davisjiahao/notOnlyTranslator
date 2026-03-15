import { FullConfig } from '@playwright/test';
import { server } from './global-setup';

/**
 * Playwright 全局清理
 * 在所有测试之后运行一次
 */
async function globalTeardown(config: FullConfig) {
  console.log('[Global Teardown] Starting cleanup...');

  // 关闭 HTTP 服务器
  if (server) {
    server.close(() => {
      console.log('[Global Teardown] HTTP server closed');
    });
  }

  console.log('[Global Teardown] Cleanup completed');
}

export default globalTeardown;
