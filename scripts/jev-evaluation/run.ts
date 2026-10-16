import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { buildRequest, evaluate, getThreshold, parseResponse, validateSamples, type Sample, type Scores } from './core.ts';
import { fetchFromWorker, openExtension, readCredential } from './browser.ts';

const directory = import.meta.dirname;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const save = (path: string, value: unknown) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
const smoke: Sample = {
  id: 'smoke', groupId: 'smoke', split: 'calibration', sentence: 'She bought a book.',
  target: 'book', occurrence: 0, expected: false, category: 'common', rationale: '只验证通路，不计入校准。',
};
const SAFE_ERRORS = new Set(['INVALID_ARGUMENT', 'INVALID_DATASET', 'LABEL_REVIEW_REQUIRED', 'CREDENTIALS_UNAVAILABLE',
  'UNSUPPORTED_PROVIDER', 'INVALID_CREDENTIALS', 'EXTENSION_COPY_FAILED', 'BROWSER_START_FAILED', 'EXTENSION_START_FAILED',
  'HOST_PERMISSION_MISSING', 'HTTP_ERROR', 'NETWORK_ERROR', 'TIMEOUT', 'INVALID_JSON', 'RESPONSE_TOO_LARGE',
  'INVALID_RESPONSE', 'INVALID_USAGE', 'REQUEST_BUDGET_EXCEEDED', 'CREDENTIAL_PERSISTED']);
const safeError = (error: unknown) => error instanceof Error && SAFE_ERRORS.has(error.message) ? error.message : 'LOCAL_OR_VALIDATION_ERROR';
const batches = (samples: readonly Sample[]) => Array.from({ length: Math.ceil(samples.length / 16) }, (_, i) => samples.slice(i * 16, i * 16 + 16));

function validateDataset(samples: readonly Sample[]) {
  const groups = [...new Set(samples.map(row => row.groupId))];
  if (samples.length !== 200 || groups.length !== 100 || samples.filter(row => row.split === 'calibration').length !== 60 ||
    groups.some(group => samples.filter(row => row.groupId === group).length !== 2) ||
    groups.some(group => new Set(samples.filter(row => row.groupId === group).map(row => row.target.toLowerCase())).size !== 1) ||
    new Set(samples.map(row => row.target.toLowerCase())).size !== 100) throw new Error('INVALID_DATASET');
}

async function main() {
  const args = process.argv.slice(2);
  if (new Set(args).size !== args.length || args.some(arg => !['--live', '--smoke'].includes(arg))) throw new Error('INVALID_ARGUMENT');
  const live = args.includes('--live');
  const smokeOnly = args.includes('--smoke');
  const sampleText = smokeOnly ? JSON.stringify([smoke]) : await readFile(join(directory, 'samples.json'), 'utf8');
  const samples = validateSamples(JSON.parse(sampleText));
  if (!smokeOnly) validateDataset(samples);
  const sampleHash = hash(sampleText);
  if (live && !smokeOnly) {
    const review = JSON.parse(await readFile(join(directory, 'labels-review.json'), 'utf8'));
    if (review.samplesSHA256 !== sampleHash || review.status !== 'reviewed-synthetic') throw new Error('LABEL_REVIEW_REQUIRED');
  }
  const calibration = samples.filter(row => row.split === 'calibration');
  const holdout = samples.filter(row => row.split === 'holdout');
  // 在看分数前固定六条校准对照；生产同段多个词位仍需另外验收。
  const comparison = smokeOnly ? [] : calibration.slice(0, 6);
  const plans = [...batches(calibration), ...comparison.map(row => [row]), ...batches(holdout)];
  const bodies = plans.map(group => JSON.stringify(buildRequest(group)));
  const coreHash = hash(await readFile(join(directory, 'core.ts'), 'utf8'));
  const root = resolve(directory, '../../test-results/jev-evaluation');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const runDirectory = await mkdtemp(join(root, `${new Date().toISOString().replace(/[:.]/gu, '-')}-`));
  const manifest = {
    samplesSHA256: sampleHash, coreSHA256: coreHash, model: 'jev-1.13.0', maxRequests: 20, retries: 0,
    timeoutMs: 12_000, batchSize: 16, comparisonIds: comparison.map(row => row.id),
    requestBodySHA256: bodies.map(hash), plannedRequests: plans.length,
    thresholdRule: 'observed calibration scores; maximize recall with common FPR <= .05; ties choose higher threshold',
    labels: smokeOnly ? 'synthetic connectivity probe; not a quality evaluation' :
      live ? 'independently-reviewed synthetic reference, not teacher-validated' : 'synthetic reference; independent review required before live',
    browserPath: 'isolated MV3 copy; exact TypeSafe host permission predeclared; system proxy unchanged',
    productionPermissionUIValidated: false, productionReady: false,
  };
  if (plans.length > manifest.maxRequests) throw new Error('REQUEST_BUDGET_EXCEEDED');
  await save(join(runDirectory, 'manifest.json'), manifest);
  if (!live) { output({ status: 'dry-run', runDirectory, ...manifest }); return; }
  let calls: Array<{ ids: readonly string[]; stage: string; status: number | null; error: string | null; ms: number | null; usage: Record<string, number> | null }> = [];
  let scores: Scores = {};
  let singleScores: Scores = {};
  let threshold: number | null = null;
  let failure: string | null = null;
  let browserVersion: string | null = null;
  let extension: Awaited<ReturnType<typeof openExtension>> | null = null;
  let credentialPersistenceChecked = false;
  try {
    const token = await readCredential();
    extension = await openExtension(resolve(directory, '../../dist'), true);
    browserVersion = extension.context.browser()?.version() ?? null;
    if (!await extension.hasTypeSafePermission()) throw new Error('HOST_PERMISSION_MISSING');
    const request = async (group: readonly Sample[], stage: string) => {
      if (calls.length >= manifest.maxRequests) throw new Error('REQUEST_BUDGET_EXCEEDED');
      const body = JSON.stringify(buildRequest(group));
      calls = [...calls, { ids: group.map(row => row.id), stage, status: null, error: 'ATTEMPT_OUTCOME_UNKNOWN', ms: null, usage: null }];
      // 发送前持久记录尝试，后台中途退出时不把可能已计费的请求报成零。
      await save(join(runDirectory, `attempt-${calls.length}.json`), calls.at(-1));
      const wire = await extension!.worker.evaluate(fetchFromWorker, { token, body, timeoutMs: manifest.timeoutMs });
      calls = calls.map((row, index) => index === calls.length - 1 ? { ...row, status: wire.status, error: wire.error, ms: wire.ms } : row);
      await save(join(runDirectory, `call-${calls.length}.json`), calls.at(-1));
      if (wire.error) throw new Error(wire.error);
      const parsed = parseResponse(wire.raw, group.map(row => row.id));
      calls = calls.map((row, index) => index === calls.length - 1 ? { ...row, usage: parsed.usage } : row);
      await save(join(runDirectory, `answer-${calls.length}.json`), { stage, ...parsed, ms: wire.ms });
      return parsed.scores;
    };
    for (const group of batches(calibration)) scores = { ...scores, ...await request(group, smokeOnly ? 'smoke' : 'calibration') };
    for (const sample of comparison) singleScores = { ...singleScores, ...await request([sample], 'single-control') };
    threshold = smokeOnly ? null : getThreshold(calibration, scores);
    await save(join(runDirectory, 'calibration.json'), {
      threshold, scores, singleScores,
      metrics: threshold === null ? null : evaluate(calibration, scores, threshold),
      frozenBeforeHoldout: true,
    });
    if (threshold !== null) for (const group of batches(holdout)) scores = { ...scores, ...await request(group, 'holdout') };
    const persisted = await extension.worker.evaluate(async key => {
      const values = [await chrome.storage.local.get(null), await chrome.storage.sync.get(null)];
      return JSON.stringify(values).includes(key);
    }, token);
    if (persisted) throw new Error('CREDENTIAL_PERSISTED');
    credentialPersistenceChecked = true;
  } catch (error) { failure = safeError(error); }
  finally { if (extension) await extension.close().catch(() => { failure ??= 'BROWSER_CLEANUP_FAILED'; }); }
  const complete = !failure && (smokeOnly || threshold !== null && samples.every(row => Object.hasOwn(scores, row.id)));
  const metrics = !smokeOnly && complete && threshold !== null ? evaluate(samples, scores, threshold) : null;
  const usageKnown = calls.every(row => row.usage !== null);
  const inputTokens = calls.reduce((sum, row) => sum + (row.usage?.input_tokens ?? 0), 0);
  const outputTokens = calls.reduce((sum, row) => sum + (row.usage?.output_tokens ?? 0), 0);
  const sortedMs = calls.flatMap(row => row.ms === null ? [] : [row.ms]).toSorted((a, b) => a - b);
  const percentile = (p: number) => sortedMs.length ? sortedMs[Math.ceil(sortedMs.length * p) - 1] : null;
  const groupIds = [...new Set(holdout.map(row => row.groupId))];
  const pairedCorrect = metrics && threshold !== null ? groupIds.filter(group => holdout.filter(row => row.groupId === group)
    .every(row => row.expected === (scores[row.id] >= threshold!))).length : null;
  const summary = {
    status: failure ? 'blocked' : complete ? 'complete' : 'no-feasible-threshold', failure,
    sampleHash, threshold, browserVersion, credentialPersistenceChecked,
    actualRequests: calls.length, usageKnown, inputTokens, outputTokens,
    estimatedUSD: usageKnown ? inputTokens * 0.042 / 1_000_000 : null,
    p50Ms: percentile(.5), p95Ms: percentile(.95), metrics, pairedHoldout: { correct: pairedCorrect, count: groupIds.length },
    singleControl: comparison.map(row => ({ id: row.id, batched: scores[row.id] ?? null, single: singleScores[row.id] ?? null })),
    productionReady: false, labelsTeacherValidated: false, fullPluginBaselineCompared: false,
    productionPermissionUIValidated: false, calls,
  };
  await save(join(runDirectory, 'summary.json'), summary);
  output({ runDirectory, ...summary });
  if (failure || !complete) process.exitCode = 1;
}

main().catch(error => { output({ status: 'blocked', failure: safeError(error) }); process.exitCode = 1; });
