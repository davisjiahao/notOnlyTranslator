/**
 * Capture demo screenshots for README
 * This script launches Chrome with the extension, configures it with a custom API,
 * and captures screenshots showing the translation effect.
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const EXTENSION_PATH = path.resolve(__dirname, '../dist');
const OUTPUT_DIR = path.resolve(__dirname, '../docs');

async function main() {
  console.log('[Demo Capture] Starting...');

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Launch Chrome with the extension
  const context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1280,800',
    ],
  });

  console.log('[Demo Capture] Browser launched with extension');

  // Wait for service worker
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    console.log('[Demo Capture] Waiting for service worker...');
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
  }
  console.log('[Demo Capture] Service worker found');

  // Get extension ID
  const extensionId = await getExtensionId(context);
  console.log(`[Demo Capture] Extension ID: ${extensionId}`);

  // Configure the extension with the custom API
  await configureExtension(serviceWorker);
  console.log('[Demo Capture] Extension configured');

  // Create a new page for the demo
  const page = await context.newPage();
  await page.setViewportSize({ width: 1200, height: 800 });

  // Set up demo content
  await page.setContent(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <title>NotOnlyTranslator Demo</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 20px;
          line-height: 1.8;
          font-size: 18px;
          color: #333;
          background: #fff;
        }
        h1 {
          color: #1a1a1a;
          font-size: 28px;
          margin-bottom: 30px;
          border-bottom: 2px solid #3b82f6;
          padding-bottom: 10px;
        }
        .article {
          background: #f8fafc;
          padding: 30px;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        p {
          margin-bottom: 20px;
        }
        .highlight-tip {
          margin-top: 30px;
          padding: 15px;
          background: #eff6ff;
          border-left: 4px solid #3b82f6;
          border-radius: 4px;
          font-size: 14px;
          color: #1e40af;
        }
      </style>
    </head>
    <body>
      <h1>The Future of Technology</h1>
      <div class="article">
        <p>
          The ubiquitous nature of smartphones has revolutionized modern communication.
          People from all walks of life now carry powerful computing devices in their pockets.
          This democratization of technology has both advantages and challenges.
        </p>
        <p>
          The proliferation of misinformation through social media platforms has become a significant concern.
          Users must develop critical thinking skills to navigate the complex information landscape effectively.
        </p>
        <p>
          The ephemeral nature of digital content creates unique archival challenges.
          Institutions must grapple with the juxtaposition of rapid technological advancement with long-term preservation.
        </p>
      </div>
      <div class="highlight-tip">
        💡 <strong>Tip:</strong> Difficult words are highlighted in yellow. Click any highlighted word to see its translation!
      </div>
    </body>
    </html>
  `);

  console.log('[Demo Capture] Demo page loaded');

  // Wait for extension to process the page
  console.log('[Demo Capture] Waiting for extension to process...');
  await page.waitForTimeout(3000);

  // Wait for extension to load
  try {
    await page.waitForFunction(() => {
      const loadedAttr = document.body?.getAttribute('data-extension-loaded');
      return loadedAttr !== null && loadedAttr !== '';
    }, { timeout: 10000 });
    console.log('[Demo Capture] Extension loaded on page');
  } catch (e) {
    console.log('[Demo Capture] Extension load check timeout, continuing...');
  }

  // Wait more for highlighting to complete
  await page.waitForTimeout(5000);

  // Check if there are highlighted words
  const highlightedWords = await page.evaluate(() => {
    const elements = document.querySelectorAll('.not-translator-highlight, [data-word]');
    return Array.from(elements).map(el => el.textContent || '');
  });
  console.log(`[Demo Capture] Found ${highlightedWords.length} highlighted words:`, highlightedWords);

  // Capture screenshot of the full page
  const screenshotPath = path.join(OUTPUT_DIR, 'demo-screenshot.png');
  await page.screenshot({ 
    path: screenshotPath, 
    fullPage: true,
    animations: 'disabled'
  });
  console.log(`[Demo Capture] Screenshot saved to: ${screenshotPath}`);

  // If there are highlighted words, click on one and capture the tooltip
  if (highlightedWords.length > 0) {
    const firstHighlighted = await page.locator('.not-translator-highlight, [data-word]').first();
    if (await firstHighlighted.count() > 0) {
      // Click to show tooltip
      await firstHighlighted.click();
      await page.waitForTimeout(1000);

      // Capture screenshot with tooltip
      const tooltipScreenshotPath = path.join(OUTPUT_DIR, 'demo-tooltip.png');
      await page.screenshot({ 
        path: tooltipScreenshotPath, 
        clip: { x: 0, y: 0, width: 1200, height: 400 },
        animations: 'disabled'
      });
      console.log(`[Demo Capture] Tooltip screenshot saved to: ${tooltipScreenshotPath}`);
    }
  }

  // Close browser
  await context.close();
  console.log('[Demo Capture] Done!');
}

async function getExtensionId(context: any): Promise<string> {
  // Method 1: Get from service worker
  const serviceWorkers = context.serviceWorkers();
  if (serviceWorkers.length > 0) {
    const id = await serviceWorkers[0].evaluate(() => chrome.runtime.id);
    if (id) return id;
  }

  // Method 2: Get from extensions page
  const page = await context.newPage();
  await page.goto('chrome://extensions');
  await page.waitForSelector('extensions-item', { timeout: 10000 });

  const items = await page.$$('extensions-item');
  for (const item of items) {
    const name = await item.$eval('#name', el => el.textContent).catch(() => null);
    if (name?.includes('NotOnlyTranslator')) {
      const id = await item.$eval('#extension-id', el => el.textContent).catch(() => null);
      if (id) {
        await page.close();
        return id.trim();
      }
    }
  }

  await page.close();
  throw new Error('Could not get extension ID');
}

async function configureExtension(serviceWorker: any): Promise<void> {
  const configId = 'demo-config-' + Date.now();

  // Configure with custom API (using anthropic protocol with custom URL)
  const settings = {
    enabled: true,
    autoHighlight: true,
    vocabHighlightEnabled: true,
    translationMode: 'inline-only',
    showDifficulty: true,
    highlightColor: '#fef08a',
    fontSize: 14,
    apiProvider: 'anthropic',
    customApiUrl: 'http://127.0.0.1:5000/v1/messages',
    customModelName: '',
    blacklist: [],
    apiConfigs: [
      {
        id: configId,
        name: 'Demo Config',
        provider: 'anthropic',
        apiUrl: 'http://127.0.0.1:5000/v1/messages',
        modelName: 'claude-3-5-haiku-latest',
        apiKey: 'PROXY_MANAGED',
      },
    ],
    activeApiConfigId: configId,
  };

  await serviceWorker.evaluate((settingsData) => {
    return new Promise<void>((resolve, reject) => {
      chrome.storage.sync.set(
        {
          settings: settingsData,
          userProfile: {
            examType: 'cet6',
            examScore: 550,
            estimatedVocabulary: 6000,
            levelConfidence: 0.8,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            console.log('[Demo] Extension settings configured');
            resolve();
          }
        }
      );
    });
  }, settings);
}

main().catch(console.error);