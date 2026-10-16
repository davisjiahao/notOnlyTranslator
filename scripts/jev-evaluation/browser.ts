import { chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';

export async function readCredential(path?: string): Promise<string> {
  const config = process.env.XDG_CONFIG_HOME;
  const root = config && isAbsolute(config) ? config : join(homedir(), '.config');
  let raw: unknown;
  try { raw = JSON.parse(await readFile(path ?? join(root, 'jevgrep/credentials.json'), 'utf8')); }
  catch { throw new Error('CREDENTIALS_UNAVAILABLE'); }
  if (!raw || typeof raw !== 'object' || !('provider' in raw) || raw.provider !== 'typesafe') {
    throw new Error('UNSUPPORTED_PROVIDER');
  }
  if (!('apiKey' in raw) || typeof raw.apiKey !== 'string' || !raw.apiKey.trim() || /[\r\n]/u.test(raw.apiKey)) {
    throw new Error('INVALID_CREDENTIALS');
  }
  return raw.apiKey;
}

// 自包含函数由Playwright在真实扩展Service Worker内执行，不捕获Node变量。
export async function fetchFromWorker(input: { token: string; body: string; timeoutMs: number }) {
  const start = performance.now();
  const signal = AbortSignal.timeout(input.timeoutMs);
  let status: number | null = null;
  const result = (error: string | null, raw: unknown = null) => ({ status, error, raw, ms: Math.round(performance.now() - start) });
  try {
    const response = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', redirect: 'error', signal,
      headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' }, body: input.body,
    });
    status = response.status;
    if (!response.ok) { await response.body?.cancel(); return result('HTTP_ERROR'); }
    const reader = response.body?.getReader();
    if (!reader) return result('INVALID_JSON');
    let length = 0;
    let text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 65_536) { await reader.cancel(); return result('RESPONSE_TOO_LARGE'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    try { return result(null, JSON.parse(text + decoder.decode())); }
    catch { return result('INVALID_JSON'); }
  } catch { return result(signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR'); }
}

export async function openExtension(dist: string, live = false) {
  const temporary = await mkdtemp(join(tmpdir(), 'jev-browser-'));
  const extensionPath = join(temporary, 'extension');
  const cleanup = () => rm(temporary, { recursive: true, force: true });
  try {
    await cp(dist, extensionPath, { recursive: true });
    const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
    // 网络探针只修改临时副本；这不验收生产的可选权限弹窗。
    await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify({
      ...manifest, host_permissions: [...new Set([...manifest.host_permissions, 'https://api.typesafe.ai/*'])],
    }));
  } catch { await cleanup(); throw new Error('EXTENSION_COPY_FAILED'); }
  const context = await chromium.launchPersistentContext(join(temporary, 'profile'), {
    channel: 'chromium', headless: true, timeout: 20_000,
    // 离线测试使用拒绝代理；实时模式不覆盖浏览器的系统代理配置。
    ...(live ? {} : { proxy: { server: 'http://127.0.0.1:9' } }),
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`,
      '--disable-background-networking', '--disable-component-update', '--disable-sync'],
  }).catch(async () => { await cleanup(); throw new Error('BROWSER_START_FAILED'); });
  const close = async () => {
    try { await context.close(); } finally { await cleanup(); }
  };
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const version = await worker.evaluate(() => chrome.runtime.getManifest().version);
    const hasTypeSafePermission = () => worker.evaluate(() => chrome.permissions.contains({ origins: ['https://api.typesafe.ai/*'] }));
    return { worker, context, version, hasTypeSafePermission, close };
  } catch { await close(); throw new Error('EXTENSION_START_FAILED'); }
}
