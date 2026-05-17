/**
 * Integration Tests — Distribution Engine + Email Delivery
 *
 * End-to-end tests that verify the full pipeline:
 *   Load Reports → Build Rep Reports → Generate Distribution → Build Emails → Validate
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { run, loadConfig, loadReports } from './distribution-engine.js';
import { buildRepEmail, buildExecutiveEmail } from './email-delivery.js';

// ── Pipeline Integration Tests ──

function testFullPipelineGeneratesAllReports() {
  const manifest = run();

  assert.strictEqual(manifest.territories.length, 4, 'Should have 4 territories');
  const totalReps = manifest.territories.reduce((s, t) => s + t.representatives.length, 0);
  assert.strictEqual(totalReps, 6, 'Should have 6 reps total');

  // Each territory should have at least one report
  for (const t of manifest.territories) {
    assert.ok(t.representatives.length >= 1, `${t.id} should have at least 1 rep`);
    for (const rep of t.representatives) {
      assert.ok(rep.name, `${t.id}/${rep.repId} should have name`);
      assert.ok(rep.reportFile, `${t.id}/${rep.repId} should have reportFile`);
      assert.ok(rep.status, `${t.id}/${rep.repId} should have status`);
    }
  }

  console.log('  PASS: full pipeline generates all reports');
}

function testPipelineEmailsMatchReports() {
  const manifest = run();
  const config = loadConfig();

  // Build emails from the generated reports
  const distDir = path.resolve(__dirname, '..', 'data', 'distributions');
  const emails = [];

  for (const territory of manifest.territories) {
    for (const rep of territory.representatives) {
      const reportPath = path.join(distDir, rep.reportFile);
      const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      const email = buildRepEmail(reportData, config);
      emails.push(email);
    }
  }

  // Executive email
  const execEmail = buildExecutiveEmail(manifest.executiveSummary, config);
  emails.push(execEmail);

  assert.strictEqual(emails.length, 7, 'Should have 7 emails (6 reps + 1 executive)');

  // Verify each email references the correct rep
  for (let i = 0; i < 6; i++) {
    assert.ok(emails[i].subject.length > 10, `Email ${i} subject should be descriptive`);
    assert.ok(emails[i].body.includes('METRICS'), `Email ${i} should have metrics section`);
  }

  // Executive email should have aggregate data
  assert.ok(execEmail.body.includes('TERRITORY OVERVIEW'));
  assert.ok(execEmail.body.includes('TOP PERFORMERS'));
  assert.ok(execEmail.body.includes('NEEDS ATTENTION'));

  console.log('  PASS: pipeline emails match reports');
}

function testTerritoryQuotaConsistency() {
  const reports = loadReports(['territory-summary-2026-03.json', 'rep-performance-2026-03.json']);
  const territorySummary = reports['territory-summary-2026-03.json'];
  const repPerformance = reports['rep-performance-2026-03.json'];

  // Verify territory totals match sum of rep metrics
  for (const territory of territorySummary.territories) {
    const repData = territory.repData;
    const sumMTD = repData.reduce((s, r) => s + r.metrics.mtd, 0);
    const sumYTD = repData.reduce((s, r) => s + r.metrics.ytd, 0);
    const sumDeals = repData.reduce((s, r) => s + r.metrics.deals, 0);

    assert.strictEqual(sumMTD, territory.mtdTotal,
      `${territory.id} MTD: ${sumMTD} should equal ${territory.mtdTotal}`);
    assert.strictEqual(sumYTD, territory.ytdTotal,
      `${territory.id} YTD: ${sumYTD} should equal ${territory.ytdTotal}`);
    assert.strictEqual(sumDeals, territory.dealsTotal,
      `${territory.id} deals: ${sumDeals} should equal ${territory.dealsTotal}`);
  }

  // Verify rep-performance byYTD ordering is correct
  const byYTD = repPerformance.byYTD;
  for (let i = 0; i < byYTD.length - 1; i++) {
    assert.ok(byYTD[i].ytd >= byYTD[i + 1].ytd,
      `byYTD[${i}].ytd (${byYTD[i].ytd}) >= byYTD[${i + 1}].ytd (${byYTD[i + 1].ytd})`);
  }

  console.log('  PASS: territory quota consistency');
}

function testGeneratedReportsHaveCorrectStatus() {
  const manifest = run();
  const distDir = path.resolve(__dirname, '..', 'data', 'distributions');

  for (const territory of manifest.territories) {
    for (const rep of territory.representatives) {
      const reportPath = path.join(distDir, rep.reportFile);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

      // Verify status matches quota attainment
      const qa = report.metrics.quotaAttainment;
      const qaNum = parseFloat(qa);

      if (qaNum >= 90) {
        assert.strictEqual(report.status, 'exceeding',
          `${rep.name} at ${qa} should be exceeding`);
      } else if (qaNum >= 75) {
        assert.strictEqual(report.status, 'on-track',
          `${rep.name} at ${qa} should be on-track`);
      } else if (qaNum >= 50) {
        assert.strictEqual(report.status, 'needs-improvement',
          `${rep.name} at ${qa} should be needs-improvement`);
      } else {
        assert.strictEqual(report.status, 'at-risk',
          `${rep.name} at ${qa} should be at-risk`);
      }
    }
  }

  console.log('  PASS: generated reports have correct status');
}

function testEmailSubjectMatchesReportStatus() {
  const manifest = run();
  const config = loadConfig();
  const distDir = path.resolve(__dirname, '..', 'data', 'distributions');

  for (const territory of manifest.territories) {
    for (const rep of territory.representatives) {
      const reportPath = path.join(distDir, rep.reportFile);
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      const email = buildRepEmail(report, config);

      // at-risk and exceeding have emoji prefixes
      if (report.status === 'at-risk') {
        assert.ok(email.subject.includes('🚨'), `at-risk email should have 🚨: ${email.subject}`);
      }
      if (report.status === 'exceeding') {
        assert.ok(email.subject.includes('🎉'), `exceeding email should have 🎉: ${email.subject}`);
      }
    }
  }

  console.log('  PASS: email subject matches report status');
}

function testDistributionManifestFileStructure() {
  const distDir = path.resolve(__dirname, '..', 'data', 'distributions');

  // Verify all expected files exist
  const expectedFiles = [
    'distribution-manifest.json',
    'executive-distribution-summary.json',
    'rep-rep-001-north-2026-03.json',
    'rep-rep-002-north-2026-03.json',
    'rep-rep-003-south-2026-03.json',
    'rep-rep-004-south-2026-03.json',
    'rep-rep-005-east-2026-03.json',
    'rep-rep-006-west-2026-03.json',
  ];

  for (const file of expectedFiles) {
    const filePath = path.join(distDir, file);
    assert.ok(fs.existsSync(filePath), `File should exist: ${file}`);

    // Verify valid JSON
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    assert.ok(typeof content === 'object', `${file} should be valid JSON object`);
  }

  console.log('  PASS: distribution manifest file structure');
}

function testConfigMatchesGeneratedData() {
  const config = loadConfig();
  const manifest = run();

  // Verify config territories match manifest territories
  for (const configTerritory of config.territories) {
    const match = manifest.territories.find(t => t.id === configTerritory.id);
    assert.ok(match, `Config territory "${configTerritory.id}" should be in manifest`);
    assert.strictEqual(match.channel, 'email', 'All territories should use email channel');
    assert.deepStrictEqual(match.recipients, configTerritory.representatives,
      `Recipients should match config for ${configTerritory.id}`);
  }

  console.log('  PASS: config matches generated data');
}

// ── Run All Tests ──

console.log('\nIntegration Tests — Distribution + Email');
console.log('='.repeat(40));

const tests = [
  testFullPipelineGeneratesAllReports,
  testPipelineEmailsMatchReports,
  testTerritoryQuotaConsistency,
  testGeneratedReportsHaveCorrectStatus,
  testEmailSubjectMatchesReportStatus,
  testDistributionManifestFileStructure,
  testConfigMatchesGeneratedData,
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
