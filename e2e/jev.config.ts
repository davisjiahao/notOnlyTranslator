import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'jev.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  outputDir: '../test-results/jev',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e-report/jev', open: 'never' }],
    ['json', { outputFile: 'test-results/jev-results.json' }],
  ],
});
