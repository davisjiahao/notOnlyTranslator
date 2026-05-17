/**
 * Email Delivery Module Tests
 */

import assert from 'node:assert/strict';
import {
  buildRepEmail,
  buildExecutiveEmail,
  sendDistributionEmails,
  sendWithRetry,
  calculateRetryDelay,
} from './email-delivery.js';
import { loadConfig } from './distribution-engine.js';

const testConfig = loadConfig();

// ── Rep Email Tests ──

function testBuildRepEmailExceeding() {
  const report = {
    representative: 'Sarah Johnson',
    repId: 'rep-002',
    territory: 'North',
    status: 'exceeding',
    metrics: {
      mtd: '$52K', ytd: '$385K', yearEnd: '$650K', quota: '$600K',
      pipeline: '$150K', deals: 15, quotaAttainment: '108.3%', pipelineCoverage: '25.0%',
    },
    period: '2026-03',
    generatedAt: '2026-03-16T10:00:00Z',
  };
  const email = buildRepEmail(report, testConfig);

  assert.ok(email.subject.includes('North'));
  assert.ok(email.subject.includes('108.3%'));
  assert.ok(email.subject.includes('2026-03'));
  assert.ok(email.body.includes('Sarah Johnson'));
  assert.ok(email.body.includes('KEEP IT UP'));
  assert.ok(email.from === 'reports@notonlytranslator.com');
  console.log('  PASS: buildRepEmail exceeding');
}

function testBuildRepEmailAtRisk() {
  const report = {
    representative: 'Lisa Anderson',
    repId: 'rep-006',
    territory: 'West',
    status: 'at-risk',
    metrics: {
      mtd: '$35K', ytd: '$265K', yearEnd: '$490K', quota: '$550K',
      pipeline: '$85K', deals: 9, quotaAttainment: '48.2%', pipelineCoverage: '15.5%',
    },
    period: '2026-03',
    generatedAt: '2026-03-16T10:00:00Z',
  };
  const email = buildRepEmail(report, testConfig);

  assert.ok(email.body.includes('RECOMMENDED ACTIONS'));
  assert.ok(email.body.includes('Schedule a 1:1'));
  assert.ok(email.body.includes('AT-RISK'));
  console.log('  PASS: buildRepEmail at-risk');
}

function testBuildRepEmailNeedsImprovement() {
  const report = {
    representative: 'Michael Chen',
    repId: 'rep-003',
    territory: 'South',
    status: 'needs-improvement',
    metrics: {
      mtd: '$38K', ytd: '$290K', yearEnd: '$520K', quota: '$550K',
      pipeline: '$95K', deals: 10, quotaAttainment: '52.7%', pipelineCoverage: '17.3%',
    },
    period: '2026-03',
    generatedAt: '2026-03-16T10:00:00Z',
  };
  const email = buildRepEmail(report, testConfig);

  assert.ok(email.body.includes('GROWTH OPPORTUNITIES'));
  assert.ok(email.body.includes('top 3 deals'));
  console.log('  PASS: buildRepEmail needs-improvement');
}

function testBuildRepEmailOnTrack() {
  const report = {
    representative: 'Robert Wilson',
    repId: 'rep-005',
    territory: 'East',
    status: 'on-track',
    metrics: {
      mtd: '$48K', ytd: '$340K', yearEnd: '$610K', quota: '$580K',
      pipeline: '$135K', deals: 14, quotaAttainment: '58.6%', pipelineCoverage: '23.3%',
    },
    period: '2026-03',
    generatedAt: '2026-03-16T10:00:00Z',
  };
  const email = buildRepEmail(report, testConfig);

  assert.ok(email.body.includes('ON TRACK'));
  assert.ok(email.body.includes('Solid progress'));
  console.log('  PASS: buildRepEmail on-track');
}

function testBuildRepEmailWithTerritorySummary() {
  const report = {
    representative: 'John Smith',
    repId: 'rep-001',
    territory: 'North',
    status: 'on-track',
    metrics: {
      mtd: '$45K', ytd: '$320K', yearEnd: '$580K', quota: '$600K',
      pipeline: '$120K', deals: 12, quotaAttainment: '96.7%', pipelineCoverage: '20.0%',
    },
    territorySummary: {
      territory: 'North',
      territoryMTD: '$97K',
      territoryYTD: '$705K',
      territoryQuotaAttainment: '58.8%',
      territoryPipelineCoverage: '54.5%',
      totalReps: 2,
      totalDeals: 27,
    },
    period: '2026-03',
    generatedAt: '2026-03-16T10:00:00Z',
  };
  const email = buildRepEmail(report, testConfig);

  assert.ok(email.body.includes('TERRITORY SUMMARY'));
  assert.ok(email.body.includes('$97K'));
  assert.ok(email.body.includes('North'));
  console.log('  PASS: buildRepEmail with territory summary');
}

// ── Executive Email Tests ──

function testBuildExecutiveEmail() {
  const summary = {
    period: '2026-03',
    generatedAt: '2026-03-16T10:00:00Z',
    totalMTD: '$260K',
    totalYTD: '$1.9M',
    totalPipeline: '$695K',
    totalDeals: 71,
    territories: [
      { name: 'North', quotaAttainment: '96.7%', pipelineCoverage: '54.5%', deals: 27 },
      { name: 'South', quotaAttainment: '92.7%', pipelineCoverage: '41.0%', deals: 21 },
      { name: 'East', quotaAttainment: '58.6%', pipelineCoverage: '56.3%', deals: 14 },
      { name: 'West', quotaAttainment: '48.2%', pipelineCoverage: '29.8%', deals: 9 },
    ],
    topPerformers: [
      { name: 'Sarah Johnson', territory: 'North', quotaAttainment: '108.3%' },
      { name: 'Robert Wilson', territory: 'East', quotaAttainment: '58.6%' },
    ],
    needsAttention: [
      { name: 'Lisa Anderson', territory: 'West', quotaAttainment: '48.2%' },
    ],
  };

  const email = buildExecutiveEmail(summary, testConfig);

  assert.ok(email.subject.includes('Executive'));
  assert.ok(email.subject.includes('2026-03'));
  assert.ok(email.body.includes('$260K'));
  assert.ok(email.body.includes('$1.9M'));
  assert.ok(email.body.includes('Sarah Johnson'));
  assert.ok(email.body.includes('Lisa Anderson'));
  assert.ok(email.body.includes('TERRITORY OVERVIEW'));
  console.log('  PASS: buildExecutiveEmail');
}

// ── Delivery Tests ──

async function testSendDistributionEmails() {
  const emails = [
    { to: 'rep-001', from: 'reports@notonlytranslator.com', subject: 'Test', body: 'Test', html: false },
    { to: 'rep-002', from: 'reports@notonlytranslator.com', subject: 'Test 2', body: 'Test 2', html: false },
  ];

  const results = await sendDistributionEmails(emails, testConfig);

  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].status, 'simulated');
  assert.strictEqual(results[1].status, 'simulated');
  assert.ok(results[0].sentAt);
  assert.strictEqual(results[0].attempts, 1);
  console.log('  PASS: sendDistributionEmails');
}

// ── Retry Tests ──

async function testSendWithRetrySuccess() {
  const result = await sendWithRetry(async () => 'ok', 3, 10);
  assert.ok(result.success);
  assert.strictEqual(result.attempts, 1);
  console.log('  PASS: sendWithRetry success');
}

async function testSendWithRetryFailures() {
  let calls = 0;
  const result = await sendWithRetry(
    async () => { calls++; throw new Error('boom'); },
    3, 10
  );
  assert.ok(!result.success);
  assert.strictEqual(calls, 3); // should retry 3 times
  assert.ok(result.error.message === 'boom');
  console.log('  PASS: sendWithRetry failures');
}

async function testSendWithRetryRecovers() {
  let calls = 0;
  const result = await sendWithRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error('not yet');
      return 'recovered';
    },
    3, 10
  );
  assert.ok(result.success);
  assert.strictEqual(result.attempts, 3);
  console.log('  PASS: sendWithRetry recovers');
}

// ── Retry Delay Tests ──

function testRetryDelayExponential() {
  const base = 1000;
  const d0 = calculateRetryDelay(base, 0);
  const d1 = calculateRetryDelay(base, 1);
  const d2 = calculateRetryDelay(base, 2);

  // Exponential: 1x, 2x, 4x base with ±25% jitter
  assert.ok(d0 >= 750 && d0 <= 1250, `delay[0] ${d0} should be ~1000ms`);
  assert.ok(d1 >= 1500 && d1 <= 2500, `delay[1] ${d1} should be ~2000ms`);
  assert.ok(d2 >= 3000 && d2 <= 5000, `delay[2] ${d2} should be ~4000ms`);
  console.log('  PASS: retryDelay exponential');
}

// ── Run All Tests ──

console.log('\nEmail Delivery Tests');
console.log('='.repeat(40));

const tests = [
  testBuildRepEmailExceeding,
  testBuildRepEmailAtRisk,
  testBuildRepEmailNeedsImprovement,
  testBuildRepEmailOnTrack,
  testBuildRepEmailWithTerritorySummary,
  testBuildExecutiveEmail,
  testSendDistributionEmails,
  testSendWithRetrySuccess,
  testSendWithRetryFailures,
  testSendWithRetryRecovers,
  testRetryDelayExponential,
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    await test();
    passed++;
  } catch (err) {
    console.log(`  FAIL: ${test.name} — ${err.message}`);
    failed++;
  }
}

console.log('\n' + '='.repeat(40));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);

if (failed > 0) {
  process.exit(1);
}
