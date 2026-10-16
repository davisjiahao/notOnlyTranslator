import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join, resolve } from 'node:path';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fetchFromWorker, openExtension, readCredential } from './browser.ts';

const dist = resolve(import.meta.dirname, '../../dist');

test('凭据损坏只报告固定错误且不回显内容', async () => {
  await assert.rejects(readCredential('/不存在的Jev凭据.json'), { message: 'CREDENTIALS_UNAVAILABLE' });
  const temp = await mkdtemp(join(tmpdir(), 'jev-credential-test-'));
  try {
    const path = join(temp, 'credential.json');
    await writeFile(path, 'jev-test-secret{');
    await assert.rejects(readCredential(path), { message: 'CREDENTIALS_UNAVAILABLE' });
    await writeFile(path, JSON.stringify({ provider: 'unsupported', apiKey: 'jev-test-secret' }));
    await assert.rejects(readCredential(path), { message: 'UNSUPPORTED_PROVIDER' });
    await writeFile(path, JSON.stringify({ provider: 'typesafe', apiKey: 'jev-test-secret\n' }));
    await assert.rejects(readCredential(path), { message: 'INVALID_CREDENTIALS' });
    await writeFile(path, JSON.stringify({ provider: 'typesafe', apiKey: 'jev-test-secret' }));
    assert.equal(await readCredential(path), 'jev-test-secret');
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('隔离MV3网络探针只增加精确主机权限且未保存凭据', { timeout: 30_000 }, async () => {
  const extension = await openExtension(dist);
  try {
    const original = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
    assert.equal(extension.version, original.version);
    assert.equal(await extension.hasTypeSafePermission(), true);
    const permissions = await extension.worker.evaluate(() => chrome.runtime.getManifest().host_permissions);
    assert.deepEqual(permissions, [...new Set([...original.host_permissions, 'https://api.typesafe.ai/*'])]);
    const response = await extension.worker.evaluate(fetchFromWorker, {
      token: 'jev-test-secret', body: '{}', timeoutMs: 2_000,
    });
    assert.notEqual(response.error, null);
    const stored = await extension.worker.evaluate(async () => ({
      local: await chrome.storage.local.get(null),
      sync: await chrome.storage.sync.get(null),
    }));
    assert.equal(JSON.stringify(stored).includes('jev-test-secret'), false);
    assert.match(extension.worker.url(), /^chrome-extension:\/\//u);
  } finally {
    await extension.close();
  }
});
