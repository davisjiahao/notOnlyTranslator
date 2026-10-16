import { test as base, expect, chromium } from '@playwright/test';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import { readFile, mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openExtension } from '../scripts/jev-evaluation/browser';
import type { JevConfig, Message, MessageResponse } from '../src/shared/types';
import { DEFAULT_JEV_CONFIG } from '../src/shared/utils/jevConfig';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const SENTINEL = 'e2e-only-jev-sentinel-not-a-real-key';
const CUSTOM_SENTINEL = 'e2e-only-custom-jev-sentinel-not-a-real-key';
const CUSTOM_CONFIG: JevConfig = {
  provider: 'custom', apiUrl: 'https://jev-recognition-e2e.invalid/custom/v2/systemone',
  model: 'offline-custom-jev', threshold: 0.65,
};
const PAGE_URL = 'http://localhost:8765/jev-reading.html';
const MODEL_URL = 'https://jev-gloss-e2e.invalid/v1/chat/completions';
const TEXT = 'The plant beside the window is green, while the plant near the river makes steel for bridges and supplies durable materials to neighboring towns, where engineers carefully inspect every shipment before allowing construction teams to begin their work.';
const HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Jev contextual reading</title>
<style>body{font:22px/2.2 Georgia;margin:72px auto;max-width:850px;color:#222}h1{font:28px sans-serif}</style></head>
<body><main><h1>Contextual vocabulary</h1><p id="reading">  ${TEXT.replace('the plant near', 'the <em>pla</em><strong>nt</strong> near')}  </p></main></body></html>`;

interface JevItem { id: string; target: string; sentence: string; start: number; end: number }
interface HttpCall {
  kind: 'recognition' | 'gloss' | 'legacy'; items: JevItem[]; aborted: boolean; completed: boolean;
  url: string; model: string; credentialMatches: boolean;
}
interface HttpState {
  calls: HttpCall[];
  blocked: string[];
  hold?: 'recognition' | 'gloss';
  releases: Array<() => void>;
  messages: Array<{ type: string; requestId?: string; intent?: string }>;
}
type Scope = typeof globalThis & { __jevE2E: HttpState };

type Fixtures = {
  context: BrowserContext;
  worker: Worker;
  options: Page;
  nativePermissions: boolean;
  customPermissions: boolean;
};

async function openCustomExtension() {
  const temporary = await mkdtemp(join(tmpdir(), 'jev-custom-permissions-'));
  try {
    const dist = join(temporary, 'dist');
    await cp(DIST, dist, { recursive: true });
    const manifestPath = join(dist, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // 精确额外主机只写入临时测试副本，生产 manifest 和原生授权实现保持不变。
    await writeFile(manifestPath, JSON.stringify({
      ...manifest, host_permissions: [...new Set([
        ...manifest.host_permissions, `${new URL(CUSTOM_CONFIG.apiUrl).origin}/*`,
      ])],
    }));
    const extension = await openExtension(dist);
    return { context: extension.context, close: async () => {
      try { await extension.close(); } finally { await rm(temporary, { recursive: true, force: true }); }
    } };
  } catch (error) { await rm(temporary, { recursive: true, force: true }); throw error; }
}

const test = base.extend<Fixtures>({
  nativePermissions: [false, { option: true }],
  customPermissions: [false, { option: true }],
  context: [async ({ nativePermissions, customPermissions }, use, info) => {
    // 临时副本只增加 TypeSafe 和按需自定义精确主机；不代表生产可选权限弹窗已验收。
    const extension = await test.step('启动独立离线 Chromium 并加载扩展', () => nativePermissions
      ? chromium.launchPersistentContext('', {
        channel: 'chromium', headless: true, proxy: { server: 'http://127.0.0.1:9' },
        args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-background-networking'],
      }).then(context => ({ context, close: () => context.close() }))
      : customPermissions ? openCustomExtension() : openExtension(DIST));
    const context = extension.context;
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(20_000);
    const loadedWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const runtimeBuild = await test.step('核对实际 worker bundle 摘要', () => loadedWorker.evaluate(async () => {
      const manifest = chrome.runtime.getManifest();
      const entry = (manifest.background as { service_worker: string }).service_worker;
      const source = await (await fetch(chrome.runtime.getURL(entry))).text();
      const bundle = /import\s+['"]\.\/([^'"]+)['"]/.exec(source)?.[1];
      if (!bundle) throw new Error('无法定位后台构建');
      const digest = await crypto.subtle.digest('SHA-256', await (await fetch(chrome.runtime.getURL(bundle))).arrayBuffer());
      return { entry, bundle, hash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') };
    }));
    expect(runtimeBuild.hash).toBe(createHash('sha256').update(await readFile(join(DIST, runtimeBuild.bundle))).digest('hex'));
    await info.attach('runtime-build-identity', { contentType: 'application/json', body: JSON.stringify({
      ...runtimeBuild, nativePermissions, customPermissions,
      externalNetwork: 'rejecting-proxy', httpBoundary: 'worker-fetch-substitute',
      productionPermissionPromptVerified: false,
    }) });
    await context.route(/^https?:\/\//, route => route.request().url() === PAGE_URL
      ? route.fulfill({ contentType: 'text/html', body: HTML }) : route.abort('blockedbyclient'));
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    try { await use(context); }
    finally {
      if (info.status !== info.expectedStatus) {
        for (const [index, page] of context.pages().entries()) {
          if (!page.isClosed() && page.url() !== 'about:blank') {
            await page.screenshot({ path: info.outputPath(`failure-${index}.png`), fullPage: true, timeout: 5000 }).catch(() => {});
          }
        }
      }
      await context.tracing.stop({ path: info.outputPath('trace.zip') });
      await info.attach('trace', { path: info.outputPath('trace.zip'), contentType: 'application/zip' });
      await extension.close();
    }
  }, { scope: 'test', timeout: 120_000 }],
  worker: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      await chrome.storage.local.set({ knownWords: [], unknownWords: [] });
      await chrome.storage.sync.set({
        settings: {
          enabled: true, autoHighlight: true, vocabHighlightEnabled: true, translationMode: 'inline-only',
          phraseTranslationEnabled: false, grammarTranslationEnabled: false, blacklist: [], hoverDelay: 0,
          apiProvider: 'custom', apiConfigs: [{ id: 'jev-e2e', name: '离线释义', provider: 'custom',
            apiKey: 'e2e-only-gloss-not-a-real-key', apiUrl: 'https://jev-gloss-e2e.invalid/v1/chat/completions',
            modelName: 'offline-gloss', tested: true, createdAt: 1 }], activeApiConfigId: 'jev-e2e',
          hybridTranslation: { enabled: false, defaultEngine: 'llm' },
        },
        userProfile: { examType: 'custom', estimatedVocabulary: 3000, levelConfidence: 0.8, createdAt: 1, updatedAt: 1 },
      });
    });
    await use(worker);
  },
  options: async ({ context, worker }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/src/options/index.html`);
    await use(page);
  },
});

async function send<T = unknown>(page: Page, message: Message): Promise<MessageResponse<T>> {
  return page.evaluate(message => chrome.runtime.sendMessage(message), message);
}

async function installHttp(worker: Worker, hold?: HttpState['hold']) {
  await worker.evaluate(({ modelURL, sentinel, customSentinel, customURL, hold }) => {
    const scope = globalThis as Scope;
    scope.__jevE2E = { calls: [], blocked: [], releases: [], messages: [], hold };
    chrome.runtime.onMessage.addListener(message => {
      scope.__jevE2E = { ...scope.__jevE2E, messages: [...scope.__jevE2E.messages, {
        type: message.type, requestId: message.requestId, intent: message.payload?.intent,
      }] };
      return false;
    });
    const original = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith(chrome.runtime.getURL(''))) return original(input, init);
      if (!['https://api.typesafe.ai/v1/systemone', customURL, modelURL].includes(url)) {
        scope.__jevE2E = { ...scope.__jevE2E, blocked: [...scope.__jevE2E.blocked, url] };
        throw new Error('E2E 禁止外网');
      }
      const body = JSON.parse(String(init?.body));
      const recognition = url !== modelURL;
      const credentialMatches = !recognition || new Headers(init?.headers).get('Authorization')
        === `Bearer ${url === customURL ? customSentinel : sentinel}`;
      let document: { items?: JevItem[] } | undefined;
      if (recognition) {
        if (!credentialMatches) throw new Error('Jev 未使用当前服务绑定的 IDB 凭据');
        document = JSON.parse(body.state);
      } else {
        const prompt = body.messages.filter((message: { role: string }) => message.role === 'user')
          .map((message: { content: string }) => message.content).join('\n');
        if (prompt.startsWith('候选词：\n')) {
          document = { items: JSON.parse(prompt.split('\n')[1]) };
        }
      }
      const items = document?.items ?? [];
      const kind: HttpCall['kind'] = recognition ? 'recognition' : document?.items ? 'gloss' : 'legacy';
      const index = scope.__jevE2E.calls.length;
      const update = (patch: Partial<HttpCall>) => {
        scope.__jevE2E = { ...scope.__jevE2E, calls: scope.__jevE2E.calls.map((call, i) => i === index ? { ...call, ...patch } : call) };
      };
      scope.__jevE2E = { ...scope.__jevE2E, calls: [...scope.__jevE2E.calls, {
        kind, items, aborted: false, completed: false, url, model: body.model, credentialMatches,
      }] };
      init?.signal?.addEventListener('abort', () => update({ aborted: true }), { once: true });
      if (scope.__jevE2E.hold === kind) {
        // 故意让取消后的 HTTP 结果晚到，验证生产取消链不会继续释义或回填。
        await new Promise<void>(resolve => {
          scope.__jevE2E = { ...scope.__jevE2E, releases: [...scope.__jevE2E.releases, resolve] };
        });
      }
      update({ completed: true, aborted: init?.signal?.aborted ?? false });
      const json = recognition ? {
        model: body.model, answers: Object.fromEntries(items.map(item => [item.id, {
          type: 'noul', noul: item.target.toLowerCase() === 'plant' && item.start === item.sentence.lastIndexOf('plant')
            ? url === customURL ? 0.6 : 0.9 : 0.01,
        }])), usage: { input_tokens: 10, output_tokens: 2 },
      } : { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
        words: items.map(item => ({ id: item.id, translation: '工厂' })), sentences: [],
        paragraphs: [...String(body.messages.at(-1)?.content).matchAll(/\[(PARA_\d+)\]/g)]
          .map(match => ({ id: match[1], words: [], sentences: [], fullText: '窗边的植物是绿色的，河边的工厂为桥梁制造钢材。' })),
        fullText: '窗边的植物是绿色的，河边的工厂为桥梁制造钢材。',
      }) } }] };
      return new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
  }, { modelURL: MODEL_URL, sentinel: SENTINEL, customSentinel: CUSTOM_SENTINEL,
    customURL: CUSTOM_CONFIG.apiUrl, hold });
}

async function releaseHttp(worker: Worker) {
  await worker.evaluate(() => {
    const scope = globalThis as Scope;
    const releases = scope.__jevE2E.releases;
    scope.__jevE2E = { ...scope.__jevE2E, releases: [], hold: undefined };
    releases.forEach(release => release());
  });
}

async function httpEvidence(worker: Worker) {
  const evidence = await worker.evaluate(() => {
    const { releases: _releases, ...evidence } = (globalThis as Scope).__jevE2E;
    return evidence;
  });
  expect(evidence.blocked).toEqual([]);
  await test.info().attach('worker-http-and-message-assertions', {
    contentType: 'application/json', body: JSON.stringify(evidence, null, 2),
  });
  return evidence;
}

async function enableJev(options: Page) {
  await saveKey(options);
  expect(await send(options, { type: 'UPDATE_SETTINGS', payload: { vocabularyAssessmentProvider: 'jev' } }))
    .toMatchObject({ success: true });
}

async function openReading(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await expect(page.locator('body')).toHaveAttribute('data-extension-loaded', 'true');
  return page;
}

async function preciseMarks(page: Page) {
  return page.locator('#reading').evaluate(paragraph => {
    const clone = paragraph.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.not-translator-inline-translation,.not-translator-grammar-annotation').forEach(node => node.remove());
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    let offset = 0;
    let marks: Array<{ text: string; start: number; end: number; translation: string | null }> = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent ?? '';
      const mark = node.parentElement?.closest('mark.not-translator-highlight');
      if (mark) marks = [...marks, { text, start: offset, end: offset + text.length, translation: mark.getAttribute('data-translation') }];
      offset += text.length;
    }
    return { source: clone.textContent, marks };
  });
}

async function saveKey(options: Page) {
  const response = await send(options, { type: 'SET_JEV_API_KEY', payload: { apiKey: SENTINEL } });
  expect(response.success, response.error).toBe(true);
  expect(await send(options, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: true } });
}

async function expectNoKeyInPublicData(options: Page, worker: Worker) {
  const data = await worker.evaluate(async () => ({
    sync: await chrome.storage.sync.get(null), local: await chrome.storage.local.get(null),
  }));
  expect(JSON.stringify(data)).not.toContain(SENTINEL);
  expect(JSON.stringify(await send(options, { type: 'GET_SETTINGS' }))).not.toContain(SENTINEL);
  await options.getByRole('tab', { name: '数据管理', exact: true }).click();
  const downloadPromise = options.waitForEvent('download');
  await options.getByRole('button', { name: '导出 JSON 备份' }).click();
  const download = await downloadPromise;
  expect(await readFile((await download.path())!, 'utf8')).not.toContain(SENTINEL);
}

async function saveKeyThroughUI(options: Page, key: string) {
  await options.getByLabel('Jev API 密钥', { exact: true }).fill(key);
  await options.getByRole('button', { name: '保存密钥', exact: true }).click();
  await expect(options.getByText('已保存密钥', { exact: true })).toBeVisible();
  await expect(options.getByLabel('Jev API 密钥', { exact: true })).toHaveValue('');
}

async function fillRecognitionConfig(options: Page, config: JevConfig) {
  await options.getByRole('combobox', { name: /^识别供应商/ }).selectOption(config.provider);
  await options.getByLabel('识别 API URL', { exact: true }).fill(config.apiUrl);
  await options.getByLabel('识别模型', { exact: true }).fill(config.model);
  await options.getByLabel('识别阈值', { exact: true }).fill(String(config.threshold));
}

async function saveRecognitionConfig(options: Page, config: JevConfig) {
  await options.getByRole('button', { name: '保存识别配置', exact: true }).click();
  await expect(options.getByText('识别配置已保存', { exact: true })).toBeVisible();
  expect(await send(options, { type: 'GET_SETTINGS' })).toMatchObject({ success: true, data: { jevConfig: config } });
}

async function enableJevThroughUI(options: Page) {
  await options.getByRole('switch', { name: '启用 Jev 词汇评估' }).click();
  await expect(options.getByRole('switch', { name: '启用 Jev 词汇评估' })).toHaveAttribute('aria-checked', 'true');
}

// 两项都使用真实 Chrome 权限判断，精确额外 host 仅由隔离夹具声明。
test.describe('自定义识别配置', () => {
  test.use({ customPermissions: true });

  test('UI 保存跨主机 URL 和模型后隔离旧密钥，自定义阈值控制真实阅读结果并可恢复预设', async ({ context, worker, options }) => {
    await installHttp(worker);
    await options.getByRole('tab', { name: 'API 设置', exact: true }).click();
    await saveKeyThroughUI(options, SENTINEL);
    await fillRecognitionConfig(options, CUSTOM_CONFIG);
    await saveRecognitionConfig(options, CUSTOM_CONFIG);
    await expect(options.getByText('未配置密钥', { exact: true })).toBeVisible();
    expect(await send(options, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: false } });
    await options.reload();
    await options.getByRole('tab', { name: 'API 设置', exact: true }).click();
    await expect(options.getByRole('combobox', { name: /^识别供应商/ })).toHaveValue('custom');
    await expect(options.getByLabel('识别 API URL', { exact: true })).toHaveValue(CUSTOM_CONFIG.apiUrl);
    await expect(options.getByLabel('识别模型', { exact: true })).toHaveValue(CUSTOM_CONFIG.model);
    await expect(options.getByLabel('识别阈值', { exact: true })).toHaveValue('0.65');
    await expect(options.getByLabel('Jev API 密钥', { exact: true })).toHaveValue('');
    expect(await worker.evaluate(origin => chrome.permissions.contains({ origins: [origin] }),
      `${new URL(CUSTOM_CONFIG.apiUrl).origin}/*`)).toBe(true);
    await saveKeyThroughUI(options, CUSTOM_SENTINEL);
    await enableJevThroughUI(options);

    const page = await openReading(context);
    await expect(page.locator('#reading')).toHaveClass(/not-translator-processed/);
    await expect(page.locator('#reading mark.not-translator-highlight')).toHaveCount(0);
    const highThreshold = await httpEvidence(worker);
    expect(highThreshold.calls.length).toBeGreaterThan(0);
    expect(highThreshold.calls.every(call => call.kind === 'recognition' && call.completed)).toBe(true);
    // 固定分数 0.6 应被 0.65 排除，但被 0.5 接纳，避免只核对配置持久化却漏测阈值生效。
    await options.getByLabel('识别阈值', { exact: true }).fill('0.5');
    await saveRecognitionConfig(options, { ...CUSTOM_CONFIG, threshold: 0.5 });
    await expect(page.locator('#reading mark.not-translator-highlight').first()).toBeVisible();
    const marks = await preciseMarks(page);
    expect(marks.source).toBe(`  ${TEXT}  `);
    expect(marks.marks.map(mark => mark.text).join('')).toBe('plant');
    expect(marks.marks[0].start).toBe(TEXT.lastIndexOf('plant') + 2);
    expect(marks.marks.every(mark => mark.translation === '工厂')).toBe(true);
    const http = await httpEvidence(worker);
    const recognition = http.calls.filter(call => call.kind === 'recognition');
    expect(recognition.length).toBeGreaterThan(highThreshold.calls.length);
    for (const call of recognition) expect(call).toMatchObject({
      url: CUSTOM_CONFIG.apiUrl, model: CUSTOM_CONFIG.model, credentialMatches: true,
    });
    expect(http.calls.filter(call => call.kind === 'gloss').flatMap(call => call.items)).toHaveLength(1);
    expect(http.calls.filter(call => call.kind === 'legacy')).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('custom-threshold-reading.png'), fullPage: true });
    await page.close();

    await options.getByRole('button', { name: '恢复 TypeSafe 预设', exact: true }).click();
    await saveRecognitionConfig(options, { ...DEFAULT_JEV_CONFIG });
    await expect(options.getByRole('combobox', { name: /^识别供应商/ })).toHaveValue('typesafe');
    await expect(options.getByLabel('识别 API URL', { exact: true })).toHaveValue(DEFAULT_JEV_CONFIG.apiUrl);
    await expect(options.getByLabel('识别模型', { exact: true })).toHaveValue(DEFAULT_JEV_CONFIG.model);
    await expect(options.getByLabel('识别阈值', { exact: true })).toHaveValue(String(DEFAULT_JEV_CONFIG.threshold));
    await expect(options.getByText('未配置密钥', { exact: true })).toBeVisible();
    expect(await send(options, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: false } });
  });

  test('UI 保存新模型和阈值会取消旧识别，迟到结果不得释义或回填页面', async ({ context, worker, options }) => {
    await installHttp(worker, 'recognition');
    await options.getByRole('tab', { name: 'API 设置', exact: true }).click();
    const initial = { ...CUSTOM_CONFIG, threshold: 0.5 };
    const next = { ...CUSTOM_CONFIG, model: 'offline-custom-jev-next' };
    await fillRecognitionConfig(options, initial);
    await saveRecognitionConfig(options, initial);
    await saveKeyThroughUI(options, CUSTOM_SENTINEL);
    await enableJevThroughUI(options);
    // 先填好草稿，识别发出后只点保存，取消时序不依赖输入耗时或延长真实预算。
    await fillRecognitionConfig(options, next);
    const page = await openReading(context);
    await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.releases.length)).toBeGreaterThan(0);
    const held = await httpEvidence(worker);
    expect(held.calls.every(call => call.model === initial.model && !call.aborted && !call.completed)).toBe(true);
    await saveRecognitionConfig(options, next);
    await expect.poll(() => worker.evaluate(model => (globalThis as Scope).__jevE2E.calls
      .filter(call => call.model === model).every(call => call.aborted), initial.model)).toBe(true);
    await releaseHttp(worker);
    await expect(page.locator('#reading')).toHaveClass(/not-translator-processed/);
    await expect.poll(() => worker.evaluate(model => (globalThis as Scope).__jevE2E.calls
      .some(call => call.model === model && call.completed && !call.aborted), next.model)).toBe(true);
    await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls.every(call => call.completed))).toBe(true);
    await expect(page.locator('#reading mark.not-translator-highlight')).toHaveCount(0);
    await expect(page.locator('.not-translator-loading-spinner, .not-translator-paragraph-loading')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await preciseMarks(page)).source).toBe(`  ${TEXT}  `);
    const http = await httpEvidence(worker);
    expect(http.calls.every(call => call.kind === 'recognition' && call.url === CUSTOM_CONFIG.apiUrl && call.credentialMatches)).toBe(true);
    expect(http.calls.filter(call => call.model === initial.model).every(call => call.aborted && call.completed)).toBe(true);
    expect(http.calls.filter(call => call.model === next.model).every(call => !call.aborted && call.completed)).toBe(true);
    await page.screenshot({ path: test.info().outputPath('custom-config-cancelled.png'), fullPage: true });
  });
});

test('设置卡片保存、刷新不回填密钥、测试与清除均走真实后台', async ({ worker, options }) => {
  await installHttp(worker);
  await options.getByRole('tab', { name: 'API 设置', exact: true }).click();
  const card = options.locator('div').filter({ has: options.getByRole('heading', { name: 'Jev 词汇评估', exact: true }) })
    .filter({ has: options.getByLabel('Jev API 密钥', { exact: true }) }).last();
  await expect(card.getByRole('switch', { name: '启用 Jev 词汇评估' })).toHaveAttribute('aria-checked', 'false');
  await card.getByLabel('Jev API 密钥', { exact: true }).fill(SENTINEL);
  await card.getByRole('button', { name: '保存密钥', exact: true }).click();
  await expect(card.getByText('已保存密钥', { exact: true })).toBeVisible();
  await expect(card.getByLabel('Jev API 密钥', { exact: true })).toHaveValue('');
  await card.getByRole('switch', { name: '启用 Jev 词汇评估' }).click();
  await expect(card.getByRole('switch', { name: '启用 Jev 词汇评估' })).toHaveAttribute('aria-checked', 'true');
  await card.getByRole('button', { name: '测试连接', exact: true }).click();
  await expect(card.getByText('连接测试成功', { exact: true })).toBeVisible();
  await options.reload();
  await options.getByRole('tab', { name: 'API 设置', exact: true }).click();
  await expect(card.getByText('已保存密钥', { exact: true })).toBeVisible();
  await expect(card.getByLabel('Jev API 密钥', { exact: true })).toHaveValue('');
  await card.screenshot({ path: test.info().outputPath('jev-settings-card.png') });
  await options.setViewportSize({ width: 375, height: 812 });
  await card.scrollIntoViewIfNeeded();
  const geometry = await card.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, viewport: innerWidth,
      cardScrollWidth: element.scrollWidth, cardClientWidth: element.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(375);
  expect(geometry.cardScrollWidth).toBeLessThanOrEqual(geometry.cardClientWidth);
  expect(geometry.pageScrollWidth).toBeLessThanOrEqual(375);
  await test.info().attach('mobile-card-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
  await card.screenshot({ path: test.info().outputPath('jev-settings-card-375.png') });
  await card.getByRole('button', { name: '清除密钥', exact: true }).click();
  await expect(card.getByText('未配置密钥', { exact: true })).toBeVisible();
  expect(await send(options, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: false } });
  const http = await httpEvidence(worker);
  expect(http.calls.filter(call => call.kind === 'recognition')).toHaveLength(1);
});

test('同句第二个 plant 跨 inline 节点且含首尾空白时只高亮工厂义', async ({ context, worker, options }) => {
  await installHttp(worker);
  await enableJev(options);
  const page = await openReading(context);
  await expect(page.locator('#reading mark.not-translator-highlight').first()).toBeVisible();
  const evidence = await preciseMarks(page);
  expect(evidence.source).toBe(`  ${TEXT}  `);
  expect(evidence.marks.map(mark => mark.text).join('')).toBe('plant');
  expect(evidence.marks[0].start).toBe(TEXT.lastIndexOf('plant') + 2);
  expect(evidence.marks[evidence.marks.length - 1].end).toBe(TEXT.lastIndexOf('plant') + 7);
  expect(evidence.marks.every(mark => mark.translation === '工厂')).toBe(true);
  await page.screenshot({ path: test.info().outputPath('precise-second-plant.png'), fullPage: true });
  await test.info().attach('exact-dom-offsets', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  const http = await httpEvidence(worker);
  const plants = http.calls.filter(call => call.kind === 'recognition').flatMap(call => call.items)
    .filter(item => item.target === 'plant');
  expect(plants).toHaveLength(2);
  expect(plants.map(item => item.start)).toEqual([TEXT.indexOf('plant') + 2, TEXT.lastIndexOf('plant') + 2]);
  expect(plants.every(item => item.sentence === `  ${TEXT}  `)).toBe(true);
  const gloss = http.calls.filter(call => call.kind === 'gloss').flatMap(call => call.items);
  expect(gloss).toHaveLength(1);
  expect(gloss[0].id).toBe(plants[1].id);
  expect(http.calls.filter(call => call.kind === 'legacy')).toEqual([]);
});

test('释义迟到时已标记认识的词不会重新高亮', async ({ context, worker, options }) => {
  await installHttp(worker, 'gloss');
  await enableJev(options);
  const page = await openReading(context);
  await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls.some(call => call.kind === 'gloss'))).toBe(true);
  expect(await send(options, { type: 'MARK_WORD_KNOWN', payload: { word: 'plant', context: TEXT, isKnown: true } }))
    .toMatchObject({ success: true });
  await releaseHttp(worker);
  await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls.every(call => call.completed))).toBe(true);
  await expect(page.getByRole('alert')).toContainText('批量翻译失败');
  await expect(page.locator('.not-translator-loading-spinner, .not-translator-paragraph-loading')).toHaveCount(0);
  await expect(page.locator('#reading mark.not-translator-highlight[data-word="plant"]')).toHaveCount(0);
  expect((await preciseMarks(page)).source).toBe(`  ${TEXT}  `);
  await httpEvidence(worker);
});

test('取消识别请求后迟到 HTTP 不得触发释义或原流程兜底', async ({ worker, options }) => {
  await installHttp(worker, 'recognition');
  await enableJev(options);
  const pending = send(options, { type: 'TRANSLATE_TEXT', requestId: 'jev-cancel', payload: {
    text: TEXT, context: TEXT, intent: 'reading', mode: 'inline-only',
  } });
  await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls.length)).toBeGreaterThan(0);
  expect(await send(options, { type: 'CANCEL_TRANSLATION', payload: { requestId: 'jev-cancel' } })).toMatchObject({ success: true });
  expect(await pending).toMatchObject({ success: false });
  await releaseHttp(worker);
  await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls.every(call => call.completed))).toBe(true);
  const http = await httpEvidence(worker);
  expect(http.calls.every(call => call.kind === 'recognition' && call.aborted)).toBe(true);
});

for (const change of ['engine', 'mode'] as const) {
  test(`${change} 切换取消页面在途 Jev 识别并丢弃迟到结果`, async ({ context, worker, options }) => {
    await installHttp(worker, 'recognition');
    await enableJev(options);
    const page = await openReading(context);
    await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls.length)).toBeGreaterThan(0);
    const payload = change === 'engine' ? { vocabularyAssessmentProvider: 'legacy' } : { translationMode: 'bilingual' };
    expect(await send(options, { type: 'UPDATE_SETTINGS', payload })).toMatchObject({ success: true });
    await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls
      .filter(call => call.kind === 'recognition').every(call => call.aborted))).toBe(true);
    await releaseHttp(worker);
    await expect.poll(() => worker.evaluate(() => (globalThis as Scope).__jevE2E.calls.every(call => call.completed))).toBe(true);
    await expect(page.locator('#reading')).toHaveClass(/not-translator-processed/);
    await expect(page.locator('#reading mark.not-translator-highlight[data-word="plant"]')).toHaveCount(0);
    const http = await httpEvidence(worker);
    expect(http.calls.filter(call => call.kind === 'gloss')).toEqual([]);
    expect(http.calls.filter(call => call.kind === 'recognition').every(call => call.aborted)).toBe(true);
    const requests = http.messages.filter(message => message.type === 'BATCH_TRANSLATE_TEXT');
    expect(new Set(requests.map(message => message.requestId)).size).toBeGreaterThan(1);
  });
}

test.describe('原始 manifest 未授权主机', () => {
  test.use({ nativePermissions: true });
  test('默认关闭和权限未授权均不调用 Jev 并保留原识别链', async ({ worker, options }) => {
    await installHttp(worker);
    expect(await worker.evaluate(() => chrome.permissions.contains({ origins: ['https://api.typesafe.ai/*'] }))).toBe(false);
    await options.getByRole('tab', { name: 'API 设置', exact: true }).click();
    await options.evaluate(() => {
      // 只在测试页面模拟用户拒绝；生产原生权限弹窗仍未验收。
      chrome.permissions.request = async permission => {
        if (JSON.stringify(permission.origins) !== JSON.stringify(['https://api.typesafe.ai/*'])) throw new Error('非精确权限请求');
        return false;
      };
    });
    await options.getByRole('switch', { name: '启用 Jev 词汇评估' }).click();
    await expect(options.getByText('未获得所需站点权限，仍使用原有词汇评估', { exact: true })).toBeVisible();
    await expect(options.getByRole('switch', { name: '启用 Jev 词汇评估' })).toHaveAttribute('aria-checked', 'false');
    const request = { type: 'TRANSLATE_TEXT', payload: { text: TEXT, context: TEXT, mode: 'inline-only', intent: 'reading' } } as Message;
    expect(await send(options, request)).toMatchObject({ success: true });
    expect((await httpEvidence(worker)).calls.filter(call => call.kind === 'recognition')).toEqual([]);
    await enableJev(options);
    expect(await send(options, { type: 'TEST_JEV_CONNECTION' })).toMatchObject({ success: false, error: 'JEV_HOST_PERMISSION_REQUIRED' });
    expect(await send(options, { ...request, payload: { ...(request.payload as object), text: `Today ${TEXT}` } })).toMatchObject({ success: true });
    const http = await httpEvidence(worker);
    expect(http.calls.filter(call => call.kind === 'recognition')).toEqual([]);
    expect(http.calls.some(call => call.kind === 'legacy')).toBe(true);
  });
});

test('凭据只进真实 IndexedDB，浏览器与 worker 重启保留，导出不泄漏且清空数据删除', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'jev-credential-persistence-'));
  const launch = () => chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, proxy: { server: 'http://127.0.0.1:9' },
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--disable-background-networking'],
  });
  let context: BrowserContext | undefined;
  try {
    context = await launch();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const optionsURL = `chrome-extension://${new URL(worker.url()).hostname}/src/options/index.html`;
    const options = await context.newPage();
    await options.goto(optionsURL);
    const welcome = options.getByRole('dialog', { name: '欢迎使用 NotOnlyTranslator' });
    await expect(welcome).toBeVisible();
    await welcome.getByRole('button', { name: '稍后再说' }).click();
    expect(await send(options, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: false } });
    await saveKey(options);
    await expectNoKeyInPublicData(options, worker);
    await worker.evaluate(() => { (globalThis as typeof globalThis & { __restartSentinel?: boolean }).__restartSentinel = true; });
    await context.close();
    context = await launch();
    const newWorker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const restored = await context.newPage();
    await restored.goto(optionsURL);
    expect(newWorker).not.toBe(worker);
    expect(await newWorker.evaluate(() => '__restartSentinel' in globalThis)).toBe(false);
    expect(await send(restored, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: true } });
    expect(await send(restored, { type: 'CLEAR_ALL_DATA' })).toMatchObject({ success: true });
    expect(await newWorker.evaluate(async () => (await indexedDB.databases()).some(db => db.name === 'notOnlyTranslatorJevCredentials'))).toBe(false);
    expect(await send(restored, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: false } });
    await test.info().attach('credential-assertions', { contentType: 'application/json', body: JSON.stringify({
      realIndexedDB: true, browserAndWorkerRestarted: true, publicStorageAndExportExcluded: true, clearAllDeletedCredential: true,
    }) });
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('非精确 options URL 和 content sender 均不能读取或改写 Jev 凭据', async ({ context, worker, options }) => {
  await saveKey(options);
  const baseURL = `chrome-extension://${new URL(worker.url()).hostname}`;
  for (const path of ['/src/popup/index.html', '/src/options/index.html?tab=engine', '/src/options/index.html#engine']) {
    const page = await context.newPage();
    await page.goto(`${baseURL}${path}`);
    for (const message of [
      { type: 'GET_JEV_STATUS' }, { type: 'SET_JEV_API_KEY', payload: { apiKey: 'e2e-untrusted-replacement' } },
      { type: 'DELETE_JEV_API_KEY' }, { type: 'TEST_JEV_CONNECTION' },
      { type: 'UPDATE_SETTINGS', payload: { vocabularyAssessmentProvider: 'jev' } },
    ] as Message[]) {
      expect(await send(page, message)).toMatchObject({ success: false, error: 'JEV_UNTRUSTED_SENDER' });
    }
    await page.close();
  }
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  let executionContexts: Array<{ id: number; origin: string; name: string }> = [];
  cdp.on('Runtime.executionContextCreated', event => {
    executionContexts = [...executionContexts, event.context];
  });
  await cdp.send('Runtime.enable');
  await page.goto(PAGE_URL);
  await expect.poll(() => executionContexts.some(item => item.origin === baseURL)).toBe(true);
  const isolated = executionContexts.find(item => item.origin === baseURL)!;
  const response = await cdp.send('Runtime.evaluate', { contextId: isolated.id, awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const messages = [{ type: 'GET_JEV_STATUS' }, { type: 'SET_JEV_API_KEY', payload: { apiKey: 'e2e-rejected-key' } },
        { type: 'DELETE_JEV_API_KEY' }, { type: 'TEST_JEV_CONNECTION' },
        { type: 'UPDATE_SETTINGS', payload: { vocabularyAssessmentProvider: 'jev' } }];
      return {
        messages: await Promise.all(messages.map(message => chrome.runtime.sendMessage(message))),
        credentialDatabaseVisible: (await indexedDB.databases()).some(database => database.name === 'notOnlyTranslatorJevCredentials'),
      };
    })()`,
  });
  expect(response.exceptionDetails).toBeUndefined();
  const denied = response.result.value as { messages: MessageResponse[]; credentialDatabaseVisible: boolean };
  expect(denied!.messages).toHaveLength(5);
  for (const result of denied!.messages) expect(result).toMatchObject({ success: false, error: 'JEV_UNTRUSTED_SENDER' });
  expect(denied!.credentialDatabaseVisible).toBe(false);
  expect(await worker.evaluate(async () => (await indexedDB.databases()).some(database => database.name === 'notOnlyTranslatorJevCredentials'))).toBe(true);
  await test.info().attach('content-origin-isolation', { body: JSON.stringify(denied), contentType: 'application/json' });
  expect(await send(options, { type: 'GET_JEV_STATUS' })).toMatchObject({ success: true, data: { hasKey: true } });
});
