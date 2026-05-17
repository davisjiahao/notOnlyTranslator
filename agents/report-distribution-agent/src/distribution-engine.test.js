/**
 * Distribution Engine Tests
 *
 * Verifies report loading, rep report generation, territory filtering,
 * and executive summary building against known data fixtures.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  loadConfig,
  loadReports,
  buildRepReport,
  buildExecutiveSummary,
  run,
} = await import('./distribution-engine.js');

const REPORTS_DIR = path.resolve(__dirname, '..', '..', 'data-consolidation-agent', 'data', 'reports');

// ── Config Tests ──

function testLoadConfig() {
  const config = loadConfig();
  assert.strictEqual(config.territories.length, 4, 'Should have 4 territories');
  assert.ok(config.channels.email.enabled, 'Email should be enabled');
  assert.strictEqual(config.channels.email.port, 587, 'SMTP port should be 587');
  assert.strictEqual(config.retryAttempts, 3, 'Should have 3 retry attempts');
  assert.ok(config.distributionSchedule.enabled, 'Schedule should be enabled');
  assert.strictEqual(config.distributionSchedule.cron, '0 9 * * 1', 'Cron should be Mon 9am');
  console.log('  PASS: loadConfig');
}

// ── Report Loading Tests ──

function testLoadReportsAllAvailable() {
  const sources = [
    'territory-summary-2026-03.json',
    'rep-performance-2026-03.json',
    'pipeline-health-2026-03.json',
    'executive-summary-2026-03.json',
  ];
  const reports = loadReports(sources);
  const available = Object.values(reports).filter(r => r !== null);
  assert.strictEqual(available.length, sources.length, `All ${sources.length} reports should load`);
  console.log('  PASS: loadReports all available');
}

function testLoadReportsMissingFile() {
  const reports = loadReports(['nonexistent-report.json']);
  assert.strictEqual(reports['nonexistent-report.json'], null, 'Missing file should return null');
  console.log('  PASS: loadReports missing file');
}

function testLoadReportsFromConfig() {
  const config = loadConfig();
  const reports = loadReports(config.reportSources);
  const available = Object.values(reports).filter(r => r !== null);
  assert.ok(available.length >= 3, 'At least 3 config reports should be available');
  console.log('  PASS: loadReports from config');
}

// ── Rep Report Tests ──

function testBuildRepReport() {
  const rep = {
    id: 'rep-001',
    name: 'John Smith',
    territory: 'North',
    mtd: 45000,
    ytd: 320000,
    yearEnd: 580000,
    quota: 600000,
    pipeline: 120000,
    deals: 12,
    quotaAttainment: 0.5333,
    pipelineCoverage: 0.4285,
  };
  const reports = {
    'territory-summary-2026-03.json': { period: '2026-03' },
  };
  const report = buildRepReport(rep, null, reports);

  assert.strictEqual(report.representative, 'John Smith');
  assert.strictEqual(report.repId, 'rep-001');
  assert.strictEqual(report.territory, 'North');
  assert.strictEqual(report.metrics.mtd, '$45K');
  assert.strictEqual(report.metrics.ytd, '$320K');
  assert.strictEqual(report.metrics.quota, '$600K');
  assert.strictEqual(report.metrics.quotaAttainment, '53.3%');
  assert.strictEqual(report.metrics.pipelineCoverage, '42.9%');
  console.log('  PASS: buildRepReport');
}

function testRepReportStatusAtRisk() {
  const rep = {
    id: 'test-1',
    name: 'Test Rep',
    territory: 'West',
    mtd: 10000,
    ytd: 200000,
    yearEnd: 400000,
    quota: 550000,
    pipeline: 50000,
    deals: 5,
    quotaAttainment: 0.36,
    pipelineCoverage: 0.25,
  };
  const report = buildRepReport(rep, null, {});
  assert.strictEqual(report.status, 'at-risk');
  console.log('  PASS: rep report status at-risk');
}

function testRepReportStatusNeedsImprovement() {
  const rep = {
    id: 'test-2',
    name: 'Test Rep',
    territory: 'South',
    mtd: 30000,
    ytd: 280000,
    yearEnd: 500000,
    quota: 550000,
    pipeline: 90000,
    deals: 10,
    quotaAttainment: 0.60,
    pipelineCoverage: 0.40,
  };
  const report = buildRepReport(rep, null, {});
  assert.strictEqual(report.status, 'needs-improvement');
  console.log('  PASS: rep report status needs-improvement');
}

function testRepReportStatusOnTrack() {
  const rep = {
    id: 'test-ontrack',
    name: 'Steady Rep',
    territory: 'East',
    mtd: 50000,
    ytd: 400000,
    yearEnd: 550000,
    quota: 580000,
    pipeline: 150000,
    deals: 15,
    quotaAttainment: 0.78,
    pipelineCoverage: 0.60,
  };
  const report = buildRepReport(rep, null, {});
  assert.strictEqual(report.status, 'on-track');
  console.log('  PASS: rep report status on-track');
}

function testRepReportStatusExceeding() {
  const rep = {
    id: 'test-3',
    name: 'Top Performer',
    territory: 'North',
    mtd: 80000,
    ytd: 500000,
    yearEnd: 650000,
    quota: 600000,
    pipeline: 200000,
    deals: 20,
    quotaAttainment: 0.92,
    pipelineCoverage: 0.85,
  };
  const report = buildRepReport(rep, null, {});
  assert.strictEqual(report.status, 'exceeding');
  console.log('  PASS: rep report status exceeding');
}

function testRepReportWithTerritoryData() {
  const rep = {
    id: 'rep-001',
    name: 'John Smith',
    territory: 'North',
    mtd: 45000,
    ytd: 320000,
    yearEnd: 580000,
    quota: 600000,
    pipeline: 120000,
    deals: 12,
    quotaAttainment: 0.533,
    pipelineCoverage: 0.428,
  };
  const territoryData = {
    id: 'north',
    name: 'North',
    mtdTotal: 97000,
    ytdTotal: 705000,
    quotaTotal: 1200000,
    pipelineTotal: 270000,
    dealsTotal: 27,
    reps: 2,
    quotaAttainment: 0.5875,
    pipelineCoverage: 0.5454,
  };
  const report = buildRepReport(rep, territoryData, {});

  assert.ok(report.territorySummary, 'Should include territory summary');
  assert.strictEqual(report.territorySummary.territory, 'North');
  assert.strictEqual(report.territorySummary.territoryMTD, '$97K');
  assert.strictEqual(report.territorySummary.territoryYTD, '$705K');
  console.log('  PASS: rep report with territory data');
}

function testRepReportGeneratedAt() {
  const rep = { id: 'x', name: 'X', territory: 'N', mtd: 0, ytd: 0, yearEnd: 0, quota: 0, pipeline: 0, deals: 0, quotaAttainment: 0, pipelineCoverage: 0 };
  const report = buildRepReport(rep, null, {});
  assert.ok(report.generatedAt);
  // Verify it's a valid ISO date
  const parsed = new Date(report.generatedAt);
  assert.ok(!isNaN(parsed.getTime()));
  console.log('  PASS: rep report generatedAt');
}

// ── Executive Summary Tests ──

function testBuildExecutiveSummary() {
  const reports = {
    'territory-summary-2026-03.json': {
      period: '2026-03',
      territories: [
        { id: 'north', name: 'North', mtdTotal: 97000, ytdTotal: 705000, pipelineTotal: 270000, dealsTotal: 27, reps: 2, quotaAttainment: 0.5875, pipelineCoverage: 0.5454 },
        { id: 'south', name: 'South', mtdTotal: 80000, ytdTotal: 600000, pipelineTotal: 205000, dealsTotal: 21, reps: 2, quotaAttainment: 0.5454, pipelineCoverage: 0.41 },
      ],
    },
    'rep-performance-2026-03.json': {
      topPerformers: [
        { name: 'Sarah Johnson', territory: 'North', quotaAttainment: 0.6416 },
      ],
      needsAttention: [
        { name: 'Lisa Anderson', territory: 'West', quotaAttainment: 0.4818 },
      ],
    },
  };

  const summary = buildExecutiveSummary(reports);

  assert.strictEqual(summary.period, '2026-03');
  assert.strictEqual(summary.territories.length, 2);
  assert.ok(summary.topPerformers.length > 0);
  assert.ok(summary.needsAttention.length > 0);
  assert.ok(summary.generatedAt);
  console.log('  PASS: buildExecutiveSummary');
}

function testBuildExecutiveSummaryMissingData() {
  const summary = buildExecutiveSummary({});
  assert.ok(summary.error, 'Should return error when territory summary missing');
  console.log('  PASS: buildExecutiveSummary missing data');
}

function testBuildExecutiveSummaryLive() {
  const reports = loadReports(['territory-summary-2026-03.json', 'rep-performance-2026-03.json']);
  if (!reports['territory-summary-2026-03.json']) {
    console.log('  SKIP: buildExecutiveSummary live');
    return;
  }
  const summary = buildExecutiveSummary(reports);
  assert.strictEqual(summary.territories.length, 4);
  assert.strictEqual(summary.totalDeals, 71);
  assert.ok(summary.topPerformers.length >= 3);
  console.log('  PASS: buildExecutiveSummary live');
}

// ── Territory Filtering Tests ──

function testTerritoryFiltering() {
  const config = loadConfig();
  const reports = loadReports(config.reportSources);
  const territorySummary = reports['territory-summary-2026-03.json'];

  if (!territorySummary) {
    console.log('  SKIP: territoryFiltering (no data)');
    return;
  }

  for (const configTerritory of config.territories) {
    const match = territorySummary.territories.find(t => t.id === configTerritory.id);
    assert.ok(match, `Territory "${configTerritory.id}" should have matching data`);
    assert.ok(match.repData.length > 0, `Territory "${configTerritory.id}" should have rep data`);
  }

  const north = territorySummary.territories.find(t => t.id === 'north');
  assert.strictEqual(north.reps, 2);
  assert.strictEqual(north.repData.length, 2);

  const east = territorySummary.territories.find(t => t.id === 'east');
  assert.strictEqual(east.reps, 1);
  assert.strictEqual(east.repData.length, 1);

  const west = territorySummary.territories.find(t => t.id === 'west');
  assert.strictEqual(west.reps, 1);
  assert.strictEqual(west.repData.length, 1);

  console.log('  PASS: territoryFiltering');
}

// ── Distribution Output Tests ──

function testDistributionOutput() {
  const manifest = run();

  assert.ok(manifest.generatedAt);
  assert.ok(manifest.period);
  assert.strictEqual(manifest.territories.length, 4);
  assert.ok(manifest.executiveSummary);

  for (const territory of manifest.territories) {
    assert.ok(territory.id);
    assert.ok(territory.name);
    assert.ok(territory.representatives.length > 0);
    assert.ok(territory.channel === 'email' || territory.channel === 'none');

    for (const rep of territory.representatives) {
      assert.ok(rep.repId);
      assert.ok(rep.name);
      assert.ok(rep.reportFile);
      assert.ok(['at-risk', 'needs-improvement', 'on-track', 'exceeding'].includes(rep.status));

      const repPath = path.join(path.resolve(__dirname, '..', 'data', 'distributions'), rep.reportFile);
      assert.ok(fs.existsSync(repPath), `Report file should exist: ${rep.reportFile}`);

      const content = JSON.parse(fs.readFileSync(repPath, 'utf-8'));
      assert.strictEqual(content.repId, rep.repId);
      assert.ok(content.metrics);
      assert.ok(content.generatedAt);
    }
  }

  const manifestPath = path.resolve(__dirname, '..', 'data', 'distributions', 'distribution-manifest.json');
  assert.ok(fs.existsSync(manifestPath));

  const execPath = path.resolve(__dirname, '..', 'data', 'distributions', 'executive-distribution-summary.json');
  assert.ok(fs.existsSync(execPath));

  console.log('  PASS: distributionOutput');
}

// ── Currency Formatting Tests ──

function testFmtCurrencyIndirect() {
  const rep = {
    id: 'test-fmt',
    name: 'Fmt Test',
    territory: 'N',
    mtd: 1_500_000,
    ytd: 705_000,
    yearEnd: 1_230_000,
    quota: 600_000,
    pipeline: 270_000,
    deals: 27,
    quotaAttainment: 0.58,
    pipelineCoverage: 0.54,
  };
  const report = buildRepReport(rep, null, {});
  assert.strictEqual(report.metrics.mtd, '$1.5M');
  assert.strictEqual(report.metrics.ytd, '$705K');
  assert.strictEqual(report.metrics.yearEnd, '$1.2M');
  assert.strictEqual(report.metrics.pipeline, '$270K');
  console.log('  PASS: fmtCurrency indirect');
}

// ── Run All Tests ──

console.log('\nDistribution Engine Tests');
console.log('='.repeat(40));

const tests = [
  testLoadConfig,
  testLoadReportsAllAvailable,
  testLoadReportsMissingFile,
  testLoadReportsFromConfig,
  testBuildRepReport,
  testRepReportStatusAtRisk,
  testRepReportStatusNeedsImprovement,
  testRepReportStatusOnTrack,
  testRepReportStatusExceeding,
  testRepReportWithTerritoryData,
  testRepReportGeneratedAt,
  testBuildExecutiveSummary,
  testBuildExecutiveSummaryMissingData,
  testBuildExecutiveSummaryLive,
  testFmtCurrencyIndirect,
  testTerritoryFiltering,
  testDistributionOutput,
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
