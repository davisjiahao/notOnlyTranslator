import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import type { Sample } from './core.ts';

// 执行：node --experimental-strip-types --experimental-test-module-mocks --test scripts/jev-evaluation/run-audit.test.ts
// 仅替换文件系统、凭据和浏览器边界，真实入口及core逻辑保持不变。
const samples: Sample[] = Array.from({ length: 100 }, (_, group) => {
  const split = group < 30 ? 'calibration' as const : 'holdout' as const;
  const prefix = group < 30 ? 'cal' : 'hold';
  const shared = { groupId: `g${group}`, split, sentence: `They read word${group}.`,
    target: `word${group}`, occurrence: 0, rationale: '确定性阶段门禁样本' };
  return [
    { ...shared, id: `${prefix}-${group}-easy`, expected: false, category: 'common' as const },
    { ...shared, id: `${prefix}-${group}-hard`, expected: true, category: 'sense' as const },
  ];
}).flat();

type Scenario = 'worker-error' | 'success' | 'no-threshold' | 'smoke-success' |
  'credential-error' | 'permission-error' | 'http-error' | 'invalid-response' |
  'incomplete-usage' | 'missing-usage' | 'credential-persisted' | 'cleanup-error' |
  'invalid-argument' | 'invalid-dataset' | 'stale-label-review';
type Saved = { path: string; value: Record<string, unknown> };

async function runEntry(t: TestContext, scenario: Scenario) {
  const coreText = await readFile(new URL('./core.ts', import.meta.url), 'utf8');
  const sampleText = JSON.stringify(scenario === 'invalid-dataset' ? samples.slice(0, 198) : samples);
  const smokeOnly = !['success', 'no-threshold', 'invalid-dataset', 'stale-label-review'].includes(scenario);
  const token = 'jev-audit-synthetic-secret';
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;
  let complete!: (value: string) => void;
  const completed = new Promise<string>(resolve => { complete = resolve; });
  let saved: Saved[] = [];
  let dispatches: Array<{ ids: string[]; frozen: Saved | undefined; audited: boolean }> = [];
  let closes = 0;
  let opens = 0;
  let credentialReads = 0;
  t.mock.module('node:fs/promises', { namedExports: {
    readFile: async (path: string) => {
      if (path.endsWith('/core.ts')) return coreText;
      if (path.endsWith('/samples.json')) return sampleText;
      assert.match(path, /\/labels-review\.json$/u);
      return JSON.stringify({ status: 'reviewed-synthetic',
        samplesSHA256: scenario === 'stale-label-review' ? 'stale' : createHash('sha256').update(sampleText).digest('hex') });
    },
    mkdir: async () => undefined,
    mkdtemp: async () => '/in-memory/jev-audit',
    writeFile: async (path: string, text: string) => {
      saved = [...saved, { path, value: JSON.parse(text) }];
    },
  } });
  t.mock.module(new URL('./browser.ts', import.meta.url), { namedExports: {
    readCredential: async () => {
      credentialReads += 1;
      if (scenario === 'credential-error') throw new Error('CREDENTIALS_UNAVAILABLE');
      return token;
    },
    fetchFromWorker: () => assert.fail('禁止执行真实网络请求'),
    openExtension: async () => {
      opens += 1;
      return {
      context: { browser: () => ({ version: () => 'synthetic-browser' }) },
      hasTypeSafePermission: async () => scenario !== 'permission-error',
      close: async () => {
        closes += 1;
        if (scenario === 'cleanup-error') throw new Error(`清理失败：${token}`);
      },
      worker: { evaluate: async (_fn: unknown, input: string | { token: string; body: string }) => {
        if (typeof input === 'string') { assert.equal(input, token); return scenario === 'credential-persisted'; }
        assert.equal(input.token, token);
        const ids = Object.keys(JSON.parse(input.body).questions);
        dispatches = [...dispatches, { ids,
          frozen: saved.find(({ path }) => path.endsWith('/calibration.json')),
          audited: saved.some(({ value }) => JSON.stringify(value.ids) === JSON.stringify(ids)),
        }];
        // 模拟服务已接收请求，但worker退出导致Playwright未取得响应。
        if (scenario === 'worker-error') throw new Error(`worker失联：${token}`);
        if (scenario === 'http-error') return { status: 503, error: 'HTTP_ERROR', ms: 1, raw: null };
        if (scenario === 'invalid-response') return { status: 200, error: null, ms: 1, raw: token };
        // 替身只依赖固定ID，不读取标签；holdout分数不同以检测阈值是否被重算。
        const score = (id: string) => scenario === 'no-threshold' ? 0.5 :
          id.endsWith('-easy') ? 0.1 : id.startsWith('cal-') ? 0.8 : 0.9;
        return { status: 200, error: null, ms: 1, raw: {
          model: 'jev-1.13.0', answers: Object.fromEntries(ids.map(id => [id, { type: 'noul', noul: score(id) }])),
          usage: scenario === 'missing-usage' ? null : scenario === 'incomplete-usage' ?
            { input_tokens: 10 } : { input_tokens: 10, output_tokens: 1 },
        } };
      } },
    };
    },
  } });
  const stdout = t.mock.method(process.stdout, 'write', (chunk: string | Uint8Array) => {
    complete(String(chunk));
    return true;
  });
  try {
    process.argv = [process.execPath, 'run.ts', '--live', ...(smokeOnly ? ['--smoke'] : []),
      ...(scenario === 'invalid-argument' ? ['--invalid'] : [])];
    await import(new URL(`./run.ts?audit=${scenario}`, import.meta.url).href);
    const text = await completed;
    assert.equal(closes, opens);
    assert.equal(JSON.stringify(saved).includes(token), false);
    assert.equal(text.includes(token), false);
    return { report: JSON.parse(text), saved, dispatches, opens, credentialReads };
  } finally {
    stdout.mock.restore();
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
  }
}

test('worker发起请求后异常仍保留尝试审计并将费用标为未知', { timeout: 10_000 }, async t => {
  const { report, dispatches } = await runEntry(t, 'worker-error');
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].audited, true);
  assert.equal(report.status, 'blocked');
  assert.equal(report.actualRequests, 1);
  assert.equal(report.calls.length, 1);
  assert.equal(report.calls[0].usage, null);
  assert.equal(report.usageKnown, false);
  assert.equal(report.estimatedUSD, null);
});

test('完整入口19次请求且holdout只在校准阈值持久冻结后执行', { timeout: 10_000 }, async t => {
  const { report, saved, dispatches } = await runEntry(t, 'success');
  assert.equal(report.status, 'complete');
  assert.equal(report.failure, null);
  assert.equal(report.actualRequests, 19);
  assert.equal(dispatches.length, 19);
  assert.deepEqual(dispatches.slice(0, 4).map(({ ids }) => ids.length), [16, 16, 16, 12]);
  assert.deepEqual(dispatches.slice(4, 10).map(({ ids }) => ids), [
    ['cal-0-easy'], ['cal-0-hard'], ['cal-1-easy'], ['cal-1-hard'], ['cal-2-easy'], ['cal-2-hard'],
  ]);
  assert.ok(dispatches.slice(0, 10).every(({ ids }) => ids.every(id => id.startsWith('cal-'))));
  const holdout = dispatches.slice(10);
  assert.equal(holdout.length, 9);
  assert.ok(holdout.every(({ ids }) => ids.every(id => id.startsWith('hold-'))));
  assert.equal(new Set(holdout.flatMap(({ ids }) => ids)).size, 140);
  for (const { frozen } of holdout) {
    assert.equal(frozen?.value.threshold, 0.8);
    assert.equal(frozen?.value.frozenBeforeHoldout, true);
    assert.equal(Object.keys(frozen?.value.scores as object).length, 60);
  }
  assert.equal(saved.filter(({ path }) => path.endsWith('/calibration.json')).length, 1);
  assert.equal(report.threshold, 0.8);
  assert.equal(report.metrics.holdout.gates.passed, true);
  assert.deepEqual(report.pairedHoldout, { correct: 70, count: 70 });
});

test('校准无可行阈值只执行10次请求且不触碰holdout', { timeout: 10_000 }, async t => {
  const { report, saved, dispatches } = await runEntry(t, 'no-threshold');
  assert.equal(report.status, 'no-feasible-threshold');
  assert.equal(report.failure, null);
  assert.equal(report.actualRequests, 10);
  assert.equal(dispatches.length, 10);
  assert.ok(dispatches.every(({ ids }) => ids.every(id => id.startsWith('cal-'))));
  assert.equal(report.threshold, null);
  assert.equal(report.metrics, null);
  assert.equal(saved.find(({ path }) => path.endsWith('/calibration.json'))?.value.threshold, null);
});

for (const [scenario, failure, expectedOpens] of [
  ['credential-error', 'CREDENTIALS_UNAVAILABLE', 0],
  ['permission-error', 'HOST_PERMISSION_MISSING', 1],
] as const) {
  test(`${failure}在发送请求前停止`, { timeout: 10_000 }, async t => {
    const { report, dispatches, opens, credentialReads } = await runEntry(t, scenario);
    assert.equal(report.status, 'blocked');
    assert.equal(report.failure, failure);
    assert.equal(report.actualRequests, 0);
    assert.equal(dispatches.length, 0);
    assert.equal(opens, expectedOpens);
    assert.equal(credentialReads, 1);
  });
}

for (const [scenario, failure] of [
  ['http-error', 'HTTP_ERROR'],
  ['invalid-response', 'INVALID_RESPONSE'],
  ['incomplete-usage', 'INVALID_USAGE'],
] as const) {
  test(`${failure}保留一次未知费用尝试且不继续`, { timeout: 10_000 }, async t => {
    const { report, saved, dispatches } = await runEntry(t, scenario);
    assert.equal(report.status, 'blocked');
    assert.equal(report.failure, failure);
    assert.equal(report.actualRequests, 1);
    assert.equal(dispatches.length, 1);
    assert.equal(report.calls[0].usage, null);
    assert.equal(report.usageKnown, false);
    assert.equal(report.estimatedUSD, null);
    assert.equal(saved.some(({ path }) => path.endsWith('/answer-1.json')), false);
    assert.equal(saved.some(({ path }) => path.endsWith('/calibration.json')), false);
  });
}

for (const [scenario, failure, persistenceChecked] of [
  ['credential-persisted', 'CREDENTIAL_PERSISTED', false],
  ['cleanup-error', 'BROWSER_CLEANUP_FAILED', true],
] as const) {
  test(`${failure}不得报告成功`, { timeout: 10_000 }, async t => {
    const { report, dispatches } = await runEntry(t, scenario);
    assert.equal(report.status, 'blocked');
    assert.equal(report.failure, failure);
    assert.equal(report.actualRequests, 1);
    assert.equal(dispatches.length, 1);
    assert.equal(report.credentialPersistenceChecked, persistenceChecked);
  });
}

for (const scenario of ['smoke-success', 'missing-usage'] as const) {
  test(`${scenario}完成烟雾流程且缺失用量不猜测费用`, { timeout: 10_000 }, async t => {
    const { report, dispatches } = await runEntry(t, scenario);
    assert.equal(report.status, 'complete');
    assert.equal(report.failure, null);
    assert.equal(report.actualRequests, 1);
    assert.equal(dispatches.length, 1);
    assert.equal(report.threshold, null);
    assert.equal(report.credentialPersistenceChecked, true);
    assert.equal(report.usageKnown, scenario === 'smoke-success');
    assert.equal(report.estimatedUSD, scenario === 'smoke-success' ? 10 * 0.042 / 1_000_000 : null);
  });
}

for (const [scenario, failure] of [
  ['invalid-argument', 'INVALID_ARGUMENT'],
  ['invalid-dataset', 'INVALID_DATASET'],
  ['stale-label-review', 'LABEL_REVIEW_REQUIRED'],
] as const) {
  test(`${failure}在读取凭据或启动浏览器前拒绝`, { timeout: 10_000 }, async t => {
    const { report, saved, dispatches, opens, credentialReads } = await runEntry(t, scenario);
    assert.equal(report.status, 'blocked');
    assert.equal(report.failure, failure);
    assert.equal(dispatches.length, 0);
    assert.equal(opens, 0);
    assert.equal(credentialReads, 0);
    assert.equal(saved.length, 0);
  });
}
