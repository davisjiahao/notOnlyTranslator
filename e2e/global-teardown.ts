import { FullConfig } from '@playwright/test';

/**
 * Playwright 全局清理
 * 在所有测试之后运行一次
 */
async function globalTeardown(config: FullConfig) {
  console.log('[Global Teardown] Starting cleanup...');

  // 这里可以添加清理逻辑，例如：
  // - 清理测试数据
  // - 关闭共享资源
  // - 生成测试报告

  console.log('[Global Teardown] Cleanup completed');
}

export default globalTeardown;
