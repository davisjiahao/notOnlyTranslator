#!/usr/bin/env node
/**
 * Report Distribution CLI
 *
 * Runs the full distribution pipeline:
 *   1. Load consolidated reports from Data Consolidation Agent
 *   2. Generate per-rep distribution reports
 *   3. Build email templates for each representative + executive summary
 *   4. Simulate email delivery (or send if SMTP configured)
 *   5. Output distribution manifest and delivery log
 *
 * Usage:
 *   node src/distribute.js                    # Run full pipeline
 *   node src/distribute.js --dry-run          # Generate reports only, skip email
 *   node src/distribute.js --json             # Output manifest as JSON
 *   node src/distribute.js --verbose          # Show detailed progress
 */

import { run, loadConfig, loadReports } from './distribution-engine.js';
import { buildRepEmail, buildExecutiveEmail, sendDistributionEmails } from './email-delivery.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = {
    dryRun: false,
    json: false,
    verbose: false,
    help: false,
  };

  for (const arg of argv.slice(2)) {
    switch (arg) {
      case '--dry-run': args.dryRun = true; break;
      case '--json': args.json = true; break;
      case '--verbose': args.verbose = true; break;
      case '--help': case '-h': args.help = true; break;
    }
  }

  return args;
}

function showHelp() {
  console.log(`
Report Distribution Agent — CLI

Usage: node src/distribute.js [options]

Options:
  --dry-run    Generate reports only, skip email building
  --json       Output distribution manifest as JSON to stdout
  --verbose    Show detailed progress during execution
  --help, -h   Show this help message

Examples:
  node src/distribute.js              # Full pipeline
  node src/distribute.js --dry-run    # Reports only
  node src/distribute.js --json       # JSON output
`);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  const log = (msg) => console.log(msg);
  const verbose = (msg) => { if (args.verbose) console.log(`  ${msg}`); };

  log('📊 Report Distribution Agent');
  log('='.repeat(40));

  // Step 1: Load config
  verbose('Loading configuration...');
  const config = loadConfig();
  verbose(`  ${config.territories.length} territories, email: ${config.channels.email.enabled ? 'enabled' : 'disabled'}`);
  verbose(`  Schedule: ${config.distributionSchedule.cron} (${config.distributionSchedule.timezone})`);

  // Step 2: Load reports
  verbose('Loading report sources...');
  const reports = loadReports(config.reportSources);
  const available = Object.entries(reports).filter(([, v]) => v !== null).length;
  verbose(`  ${available}/${config.reportSources.length} reports available`);

  // Step 3: Run distribution pipeline
  verbose('Running distribution pipeline...');
  const manifest = run();

  if (args.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  log(`\n📋 Distribution Summary`);
  log(`  Period: ${manifest.period}`);
  log(`  Territories: ${manifest.territories.length}`);
  log(`  Representatives: ${manifest.territories.reduce((s, t) => s + t.representatives.length, 0)}`);

  for (const territory of manifest.territories) {
    log(`\n  ${territory.name.toUpperCase()}`);
    for (const rep of territory.representatives) {
      const icon = rep.status === 'exceeding' ? '⭐' : rep.status === 'at-risk' ? '🚨' : rep.status === 'needs-improvement' ? '⚠️' : '📊';
      log(`    ${icon} ${rep.name} (${rep.quotaAttainment} quota — ${rep.status})`);
    }
  }

  if (args.dryRun) {
    log('\n🔒 Dry run — email delivery skipped');
    log(`Reports generated in: ${path.resolve(__dirname, '..', 'data', 'distributions')}`);
    return;
  }

  // Step 4: Build emails
  verbose('Building email templates...');
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

  const execEmail = buildExecutiveEmail(manifest.executiveSummary, config);
  emails.push(execEmail);

  verbose(`  ${emails.length} emails built (${emails.length - 1} rep + 1 executive)`);

  // Step 5: Send (simulated)
  verbose('Sending emails...');
  const deliveryResults = await sendDistributionEmails(emails, config);

  const sent = deliveryResults.filter(d => d.status === 'sent' || d.status === 'simulated').length;
  const failed = deliveryResults.filter(d => d.status === 'failed').length;

  log(`\n📧 Email Delivery`);
  log(`  Built: ${emails.length}`);
  log(`  Sent: ${sent}`);
  log(`  Failed: ${failed}`);

  if (args.verbose) {
    for (const result of deliveryResults) {
      log(`    ${result.status}: ${result.subject}`);
    }
  }

  log(`\n✅ Distribution complete`);
}

main().catch(err => {
  console.error('Distribution failed:', err.message);
  process.exit(1);
});
