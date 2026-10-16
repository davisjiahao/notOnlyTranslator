import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { fetchFromWorker } from './browser.ts';

const input = { token: 'jev-test-secret', body: '{"state":"synthetic"}', timeoutMs: 1000 };

test('后台请求仅向固定域发送凭据，禁止重定向且返回用时', async () => {
  const stub = mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(options.redirect, 'error');
    assert.equal((options.headers as Record<string, string>).Authorization, 'Bearer jev-test-secret');
    assert.equal(options.body, input.body);
    return new Response('{"answers":{}}', { status: 200 });
  });
  try {
    const result = await fetchFromWorker(input);
    assert.equal(result.status, 200);
    assert.equal(result.error, null);
    assert.deepEqual(result.raw, { answers: {} });
    assert.equal(typeof result.ms, 'number');
  } finally { stub.mock.restore(); }
});

test('HTTP错误不回显服务正文且不重试', async () => {
  const stub = mock.method(globalThis, 'fetch', async () => new Response(input.token, { status: 451 }));
  try {
    assert.deepEqual(await fetchFromWorker(input).then(({ ms: _ms, ...rest }) => rest),
      { status: 451, error: 'HTTP_ERROR', raw: null });
    assert.equal(stub.mock.callCount(), 1);
  } finally { stub.mock.restore(); }
});

test('解析错误和超大响应不得携带原始正文', async () => {
  for (const body of [input.token, ' '.repeat(65_537)]) {
    const stub = mock.method(globalThis, 'fetch', async () => new Response(body));
    try {
      const result = await fetchFromWorker(input);
      assert.equal(result.error, body.length > 65_536 ? 'RESPONSE_TOO_LARGE' : 'INVALID_JSON');
      assert.equal(result.raw, null);
      assert.equal(JSON.stringify(result).includes(input.token), false);
    } finally { stub.mock.restore(); }
  }
});

test('超时结束请求并返回固定错误', async () => {
  const stub = mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    await new Promise((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timer')), 1000);
      options.signal!.addEventListener('abort', () => { clearTimeout(timer); reject(new Error(input.token)); }, { once: true });
    });
    return new Response('{}');
  });
  try {
    assert.equal((await fetchFromWorker({ ...input, timeoutMs: 10 })).error, 'TIMEOUT');
    assert.equal(stub.mock.callCount(), 1);
  } finally { stub.mock.restore(); }
});

test('网络错误只返回固定代码', async () => {
  const stub = mock.method(globalThis, 'fetch', async () => { throw new Error(input.token); });
  try {
    const result = await fetchFromWorker(input);
    assert.equal(result.error, 'NETWORK_ERROR');
    assert.equal(JSON.stringify(result).includes(input.token), false);
  } finally { stub.mock.restore(); }
});
