/**
 * Delivery Log — tracks distribution runs over time.
 *
 * Each distribution run appends an entry to a JSON log file,
 * enabling audit trails, delivery status tracking, and trend analysis.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOG_DIR = path.resolve(__dirname, '..', 'data', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'delivery-log.json');

/**
 * Ensure the log directory and file exist.
 */
function ensureLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, JSON.stringify({ runs: [] }, null, 2));
  }
}

/**
 * Append a distribution run to the delivery log.
 */
export function logRun(runEntry) {
  ensureLog();

  const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  log.runs.push({
    ...runEntry,
    loggedAt: new Date().toISOString(),
  });

  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
  return log;
}

/**
 * Get the last N delivery runs.
 */
export function getRecentRuns(n = 10) {
  ensureLog();
  const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  return log.runs.slice(-n);
}

/**
 * Get delivery statistics.
 */
export function getStats() {
  ensureLog();
  const log = JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
  const runs = log.runs;

  if (runs.length === 0) {
    return { totalRuns: 0, totalEmailsSent: 0, totalEmailsFailed: 0 };
  }

  return {
    totalRuns: runs.length,
    totalEmailsSent: runs.reduce((s, r) => s + (r.emailsSent || 0), 0),
    totalEmailsFailed: runs.reduce((s, r) => s + (r.emailsFailed || 0), 0),
    lastRun: runs[runs.length - 1]?.loggedAt,
    periods: [...new Set(runs.map(r => r.period))],
  };
}

/**
 * Clear the delivery log.
 */
export function clearLog() {
  ensureLog();
  fs.writeFileSync(LOG_FILE, JSON.stringify({ runs: [] }, null, 2));
}
