import { test as base, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page, TestInfo, Worker } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Message, MessageResponse, UserProfile, UserSettings } from '../../src/shared/types';

const directory = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(directory, '../../dist');
export const TEST_ORIGIN = 'http://localhost:8765';
export const TEST_PAGE_URL = `${TEST_ORIGIN}/local-first-reading.html`;

interface SeedState {
  knownWords?: string[];
  estimatedVocabulary?: number;
}

interface LocalFirstFixtures {
  extContext: BrowserContext;
  extensionId: string;
  seedUserState: (state?: SeedState) => Promise<void>;
  openTestPage: () => Promise<Page>;
  sendRuntimeMessage: <T = unknown>(message: Message) => Promise<MessageResponse<T>>;
  readLocalWordLists: () => Promise<Pick<UserProfile, 'knownWords' | 'unknownWords'>>;
}

async function getWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker', { timeout: 20000 });
}

async function recordBuildEvidence(context: BrowserContext, testInfo: TestInfo): Promise<void> {
  const worker = await getWorker(context);
  const identity = await worker.evaluate(async () => {
    const manifest = chrome.runtime.getManifest();
    const background = manifest.background;
    if (!background || !('service_worker' in background)) {
      throw new Error('扩展未声明后台 Service Worker');
    }
    const backgroundPath = background.service_worker;
    const backgroundUrl = chrome.runtime.getURL(backgroundPath);
    const response = await fetch(backgroundUrl);
    if (!response.ok) throw new Error('无法读取实际加载的后台入口');
    return {
      extensionId: chrome.runtime.id,
      version: manifest.version,
      backgroundPath,
      backgroundUrl,
      backgroundSource: await response.text(),
    };
  });
  const diskSource = await readFile(join(extensionPath, identity.backgroundPath), 'utf8');
  expect(identity.backgroundSource).toBe(diskSource);
  const bundlePath = /import\s+['"]\.\/([^'"]+)['"]/.exec(diskSource)?.[1];
  if (!bundlePath) throw new Error('无法定位构建后的后台 bundle');
  const bundleDigest = await worker.evaluate(async assetPath => {
    const response = await fetch(chrome.runtime.getURL(assetPath));
    if (!response.ok) throw new Error('无法读取实际加载的后台 bundle');
    const digest = await crypto.subtle.digest('SHA-256', await response.arrayBuffer());
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }, bundlePath);
  const diskDigest = createHash('sha256').update(await readFile(join(extensionPath, bundlePath))).digest('hex');
  expect(bundleDigest).toBe(diskDigest);
  const license = await readFile(join(extensionPath, 'ECDICT-LICENSE'));
  expect(license.equals(await readFile(resolve(extensionPath, '../src/data/ECDICT-LICENSE')))).toBe(true);
  const { backgroundSource, ...runtimeIdentity } = identity;
  const evidencePath = testInfo.outputPath('extension-build-evidence.json');
  await writeFile(evidencePath, JSON.stringify({
    ...runtimeIdentity,
    extensionPath,
    serviceWorkerUrl: worker.url(),
    entrySha256: createHash('sha256').update(backgroundSource).digest('hex'),
    bundlePath,
    bundleSha256: bundleDigest,
    dictionaryLicenseSha256: createHash('sha256').update(license).digest('hex'),
  }, null, 2));
  await testInfo.attach('extension-build-evidence', {
    path: evidencePath,
    contentType: 'application/json',
  });
}

async function capturePages(context: BrowserContext, testInfo: TestInfo): Promise<void> {
  for (const [index, page] of context.pages().entries()) {
    if (page.isClosed() || page.url() === 'about:blank') continue;
    try {
      const screenshot = testInfo.outputPath(`page-${index}.png`);
      await page.screenshot({ path: screenshot, fullPage: true, timeout: 5000 });
      await testInfo.attach(`page-${index}`, { path: screenshot, contentType: 'image/png' });
    } catch (error) {
      await testInfo.attach(`page-${index}-capture-error`, {
        body: String(error),
        contentType: 'text/plain',
      });
    }
  }
}

export const test = base.extend<LocalFirstFixtures>({
  extContext: async ({ browserName }, use, testInfo) => {
    expect(browserName).toBe('chromium');
    const userDataDir = await mkdtemp(join(tmpdir(), 'not-lfr-e2e-'));
    // 扩展 SW 请求不一定经过 Playwright route；本地拒绝代理不向任何上游转发。
    const proxy = createServer((_request, response) => {
      response.writeHead(502);
      response.end('External network disabled for E2E');
    });
    proxy.on('connect', (_request, socket) => {
      // 浏览器取消 CONNECT 时可能复位套接字，不能让拒绝代理中断测试进程。
      socket.on('error', () => socket.destroy());
      socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    });
    await new Promise<void>((done, reject) => {
      proxy.once('error', reject);
      proxy.listen(0, '127.0.0.1', done);
    });
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('断网代理未启动');
    let context: BrowserContext | undefined;
    try {
      context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 900 },
        args: [
          `--disable-extensions-except=${extensionPath}`,
          `--load-extension=${extensionPath}`,
          `--proxy-server=http://127.0.0.1:${address.port}`,
          '--proxy-bypass-list=localhost:8765',
          '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
          '--no-first-run',
          '--no-default-browser-check',
        ],
      });
      await context.route(/^https?:\/\//, route =>
        new URL(route.request().url()).origin === TEST_ORIGIN
          ? route.continue()
          : route.abort('blockedbyclient')
      );
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      await recordBuildEvidence(context, testInfo);
      await use(context);
    } finally {
      try {
        if (context) {
          await capturePages(context, testInfo);
          const trace = testInfo.outputPath('trace.zip');
          await context.tracing.stop({ path: trace });
          await testInfo.attach('trace', { path: trace, contentType: 'application/zip' });
        }
      } finally {
        await context?.close();
        proxy.closeAllConnections();
        await new Promise<void>(done => proxy.close(() => done()));
        await rm(userDataDir, { recursive: true, force: true });
      }
    }
  },

  extensionId: async ({ extContext }, use) => {
    const worker = await getWorker(extContext);
    await use(new URL(worker.url()).hostname);
  },

  seedUserState: async ({ extContext }, use) => {
    await use(async ({ knownWords = [], estimatedVocabulary = 2000 } = {}) => {
      const worker = await getWorker(extContext);
      await worker.evaluate(async state => {
        const settings = {
          enabled: true,
          autoHighlight: true,
          vocabHighlightEnabled: true,
          translationMode: 'inline-only',
          blacklist: [],
          apiConfigs: [],
          hoverDelay: 0,
        } satisfies Partial<UserSettings>;
        await chrome.storage.local.set({ knownWords: state.knownWords, unknownWords: [] });
        await chrome.storage.sync.set({
          settings,
          apiKey: '',
          userProfile: {
            examType: 'cet4',
            examScore: 425,
            estimatedVocabulary: state.estimatedVocabulary,
            levelConfidence: 0.5,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        });
      }, { knownWords, estimatedVocabulary });
      const stored = await worker.evaluate(() => chrome.storage.local.get('knownWords'));
      expect(stored.knownWords).toEqual(knownWords);
    });
  },

  openTestPage: async ({ extContext }, use) => {
    await use(async () => {
      const page = await extContext.newPage();
      await page.goto(TEST_PAGE_URL, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('body')).toHaveAttribute('data-extension-loaded', 'true');
      return page;
    });
  },

  sendRuntimeMessage: async ({ extContext, extensionId }, use) => {
    // SW 不接收自己发出的 runtime 消息，因此由真实扩展页请求后台。
    const popup = await extContext.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
    await use(<T>(message: Message) => popup.evaluate(
      msg => chrome.runtime.sendMessage(msg) as Promise<MessageResponse<T>>,
      message
    ));
  },

  readLocalWordLists: async ({ extContext }, use) => {
    await use(async () => {
      const worker = await getWorker(extContext);
      return worker.evaluate(async () => {
        const stored = await chrome.storage.local.get(['knownWords', 'unknownWords']);
        return {
          knownWords: stored.knownWords ?? [],
          unknownWords: stored.unknownWords ?? [],
        } as Pick<UserProfile, 'knownWords' | 'unknownWords'>;
      });
    });
  },
});

export { expect };
