import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './specs',
  testMatch: [
    'local-first-reading.spec.ts', 'vocabulary-import.spec.ts', 'api-configs-revision.spec.ts',
    'hybrid-key-ownership.spec.ts', 'welcome-settings-revision.spec.ts', 'llm-translation-display.spec.ts',
    'mode-switching.spec.ts', 'mode-presentation-only.spec.ts', 'github-like-reading.spec.ts',
    'batch-streaming.spec.ts',
  ],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  outputDir: '../test-results/local-first',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'e2e-report/local-first', open: 'never' }],
    ['junit', { outputFile: 'test-results/local-first-results.xml' }],
  ],
  use: {
    // 独立 persistent context 由 fixture 收集截图与 trace。
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  globalSetup: fileURLToPath(new URL('./local-first.global-setup.ts', import.meta.url)),
});
