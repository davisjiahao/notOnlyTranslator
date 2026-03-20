import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // 启用全局 API（describe, it, expect 等）
    globals: true,
    // 使用 jsdom 模拟浏览器环境
    environment: 'jsdom',
    // 测试文件匹配模式
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'tests/**/*.test.tsx', 'tests/**/*.spec.tsx'],
    // 排除目录
    exclude: ['node_modules', 'dist'],
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'tests/',
        '*.config.ts',
        '*.config.js',
        'scripts/',
        // JSON 数据文件
        'src/data/',
        // 类型定义文件（无运行时代码）
        '**/*.d.ts',
        // 纯类型导出文件
        'src/shared/types/vocabulary.ts',
        // 纯重新导出文件
        'src/shared/performance/index.ts',
      ],
      // 覆盖率阈值
      thresholds: {
        lines: 50,
        functions: 50,
        branches: 50,
        statements: 50,
      },
    },
    // 设置超时时间
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
