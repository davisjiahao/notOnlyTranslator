import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'performance',
    include: ['benchmark/**/*.bench.{ts,js}'],
    exclude: ['node_modules', 'dist'],
    globals: true,
    environment: 'node',
    benchmark: {
      minSamples: 10,
      maxTime: 5000,
      outputJson: 'benchmark/results/performance-report.json',
    },
    reporters: ['verbose'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
