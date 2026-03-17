import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'performance',
    include: ['benchmark/**/*.bench.{ts,js}'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    environment: 'node',
    // 性能测试特定配置
    benchmark: {
      // 最小样本数
      minSamples: 10,
      // 最大运行时间（毫秒）
      maxTime: 5000,
    },
    // 报告器配置
    reporters: ['verbose', 'json'],
    outputFile: {
      json: './benchmark/results/performance-report.json',
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
