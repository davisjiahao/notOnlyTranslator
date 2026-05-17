/**
 * Delivery Log Tests
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { logRun, getRecentRuns, getStats, clearLog } from './delivery-log.js';

// Reset log before each test
function resetLog() {
  clearLog();
}

function testLogRunAppendsEntry() {
  resetLog();

  const entry = {
    period: '2026-03',
    totalReps: 6,
    emailsBuilt: 7,
    emailsSent: 7,
    emailsFailed: 0,
    status: 'complete',
  };

  const log = logRun(entry);
  assert.strictEqual(log.runs.length, 1);
  assert.strictEqual(log.runs[0].period, '2026-03');
  assert.strictEqual(log.runs[0].status, 'complete');
  assert.ok(log.runs[0].loggedAt, 'Should have loggedAt timestamp');

  console.log('  PASS: logRun appends entry');
}

function testLogRunAccumulates() {
  resetLog();

  logRun({ period: '2026-03', emailsSent: 7, emailsFailed: 0, status: 'complete' });
  logRun({ period: '2026-04', emailsSent: 7, emailsFailed: 1, status: 'partial' });
  logRun({ period: '2026-05', emailsSent: 7, emailsFailed: 0, status: 'complete' });

  const recent = getRecentRuns(10);
  assert.strictEqual(recent.length, 3);
  assert.strictEqual(recent[0].period, '2026-03');
  assert.strictEqual(recent[2].period, '2026-05');

  console.log('  PASS: logRun accumulates');
}

function testGetRecentRunsLimit() {
  resetLog();

  // Add 15 runs
  for (let i = 0; i < 15; i++) {
    logRun({ period: `2026-${String(i + 1).padStart(2, '0')}`, emailsSent: 7, emailsFailed: 0, status: 'complete' });
  }

  const recent5 = getRecentRuns(5);
  assert.strictEqual(recent5.length, 5);
  assert.strictEqual(recent5[0].period, '2026-11'); // last 5 of 15

  const recent10 = getRecentRuns(10);
  assert.strictEqual(recent10.length, 10);
  assert.strictEqual(recent10[0].period, '2026-06'); // last 10 of 15

  console.log('  PASS: getRecentRuns limit');
}

function testGetStatsEmpty() {
  resetLog();
  const stats = getStats();
  assert.strictEqual(stats.totalRuns, 0);
  assert.strictEqual(stats.totalEmailsSent, 0);
  assert.strictEqual(stats.totalEmailsFailed, 0);
  console.log('  PASS: getStats empty');
}

function testGetStatsWithRuns() {
  resetLog();

  logRun({ period: '2026-03', emailsSent: 7, emailsFailed: 0, status: 'complete' });
  logRun({ period: '2026-04', emailsSent: 6, emailsFailed: 1, status: 'partial' });
  logRun({ period: '2026-05', emailsSent: 7, emailsFailed: 0, status: 'complete' });

  const stats = getStats();
  assert.strictEqual(stats.totalRuns, 3);
  assert.strictEqual(stats.totalEmailsSent, 20);
  assert.strictEqual(stats.totalEmailsFailed, 1);
  assert.ok(stats.lastRun);
  assert.strictEqual(stats.periods.length, 3);
  assert.ok(stats.periods.includes('2026-03'));
  assert.ok(stats.periods.includes('2026-05'));

  console.log('  PASS: getStats with runs');
}

function testClearLog() {
  resetLog();

  logRun({ period: '2026-03', emailsSent: 7, emailsFailed: 0, status: 'complete' });
  logRun({ period: '2026-04', emailsSent: 7, emailsFailed: 0, status: 'complete' });

  clearLog();
  const stats = getStats();
  assert.strictEqual(stats.totalRuns, 0);

  console.log('  PASS: clearLog');
}

function testLogFileStructure() {
  resetLog();

  logRun({ period: '2026-03', emailsSent: 7, emailsFailed: 0, status: 'complete' });

  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'data', 'logs', 'delivery-log.json'), 'utf-8'));
  assert.ok(raw.runs);
  assert.ok(Array.isArray(raw.runs));
  assert.strictEqual(raw.runs.length, 1);

  console.log('  PASS: log file structure');
}

// ── Run All Tests ──

console.log('\nDelivery Log Tests');
console.log('='.repeat(40));

const tests = [
  testLogRunAppendsEntry,
  testLogRunAccumulates,
  testGetRecentRunsLimit,
  testGetStatsEmpty,
  testGetStatsWithRuns,
  testClearLog,
  testLogFileStructure,
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    test();
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
