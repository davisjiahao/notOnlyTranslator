/**
 * Email Delivery Module
 *
 * Sends distribution reports via SMTP with retry logic and exponential backoff.
 * Uses nodemailer-compatible interface; graceful degradation when SMTP unavailable.
 */

import { loadConfig } from './distribution-engine.js';

/**
 * Calculate retry delay with exponential backoff + jitter.
 * delay = baseDelay * 2^attempt + random jitter (±25%)
 */
export function calculateRetryDelay(baseDelayMs, attempt) {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

/**
 * Build a distribution email for a single representative.
 * Returns the email envelope with recipient, subject, and body.
 */
export function buildRepEmail(repReport, config) {
  const { representative, territory, status, metrics, period } = repReport;

  // Status-specific subject line prefix
  const statusPrefix = {
    'exceeding': '🎉',
    'on-track': '',
    'needs-improvement': '⚠️',
    'at-risk': '🚨',
  };

  const prefix = statusPrefix[status] || '';
  const subject = `${prefix} ${territory} Sales Report — ${period} (${metrics.quotaAttainment} quota)`;

  const body = `
Hi ${representative},

Here's your sales performance report for ${period}.

📊 YOUR METRICS
┌─────────────────────────┬─────────────┐
│ Monthly-to-Date         │ ${metrics.mtd.padEnd(11)} │
│ Year-to-Date            │ ${metrics.ytd.padEnd(11)} │
│ Year-End Projection     │ ${metrics.yearEnd.padEnd(11)} │
│ Annual Quota            │ ${metrics.quota.padEnd(11)} │
│ Pipeline                │ ${metrics.pipeline.padEnd(11)} │
│ Deals                   │ ${String(metrics.deals).padEnd(11)} │
│ Quota Attainment        │ ${metrics.quotaAttainment.padEnd(11)} │
│ Pipeline Coverage       │ ${metrics.pipelineCoverage.padEnd(11)} │
└─────────────────────────┴─────────────┘

Status: ${status.toUpperCase()}

${repReport.territorySummary ? `
🏢 TERRITORY SUMMARY (${repReport.territorySummary.territory})
┌─────────────────────────┬─────────────┐
│ Territory MTD           │ ${repReport.territorySummary.territoryMTD.padEnd(11)} │
│ Territory YTD           │ ${repReport.territorySummary.territoryYTD.padEnd(11)} │
│ Territory Quota Attain. │ ${repReport.territorySummary.territoryQuotaAttainment.padEnd(11)} │
│ Territory Pipeline Cov. │ ${repReport.territorySummary.territoryPipelineCoverage.padEnd(11)} │
│ Total Reps              │ ${String(repReport.territorySummary.totalReps).padEnd(11)} │
│ Total Deals             │ ${String(repReport.territorySummary.totalDeals).padEnd(11)} │
└─────────────────────────┴─────────────┘
` : ''}
${status === 'at-risk' ? `
⚡ RECOMMENDED ACTIONS
- Schedule a 1:1 with your territory manager
- Review pipeline for stalled deals
- Focus on high-probability opportunities in the next 30 days
- Consider pipeline generation activities
` : status === 'needs-improvement' ? `
📈 GROWTH OPPORTUNITIES
- Review your top 3 deals — what's needed to close?
- Identify pipeline gaps for next month
- Leverage successful strategies from top performers
` : status === 'exceeding' ? `
⭐ KEEP IT UP!
- You're performing above target — consider mentoring peers
- Document your successful strategies for the team
- Look at stretching your quota for next period
` : `
👍 ON TRACK
- Solid progress — maintain current momentum
- Review pipeline for any at-risk deals
- Keep building pipeline for next period
`}
Report generated: ${repReport.generatedAt}
`;

  return {
    to: repReport.repId, // placeholder — actual email resolved from config
    from: config.channels.email.from,
    subject: subject.trim(),
    body: body.trim(),
    html: false, // plain text for now
  };
}

/**
 * Build an executive summary email.
 */
export function buildExecutiveEmail(executiveSummary, config) {
  const { period, totalMTD, totalYTD, totalPipeline, totalDeals, territories, topPerformers, needsAttention } = executiveSummary;

  const territoryRows = territories.map(t =>
    `│ ${t.name.padEnd(23)} │ ${t.quotaAttainment.padEnd(9)} │ ${t.pipelineCoverage.padEnd(9)} │ ${String(t.deals).padEnd(5)} │`
  ).join('\n');

  const topPerformerList = topPerformers.map(p => `  • ${p.name} (${p.territory}) — ${p.quotaAttainment}`).join('\n');
  const attentionList = needsAttention.map(p => `  • ${p.name} (${p.territory}) — ${p.quotaAttainment}`).join('\n');

  const body = `
Sales Leadership Team — Executive Summary

Period: ${period}
Generated: ${executiveSummary.generatedAt}

📈 AGGREGATE METRICS
┌─────────────────────────┬─────────────┐
│ Total MTD               │ ${totalMTD.padEnd(11)} │
│ Total YTD               │ ${totalYTD.padEnd(11)} │
│ Total Pipeline          │ ${totalPipeline.padEnd(11)} │
│ Total Deals             │ ${String(totalDeals).padEnd(11)} │
└─────────────────────────┴─────────────┘

🗺️ TERRITORY OVERVIEW
┌─────────────────────────┬───────────┬───────────┬───────┐
│ Territory               │ Quota Att │ Pipe Cov  │ Deals │
├─────────────────────────┼───────────┼───────────┼───────┤
${territoryRows}
└─────────────────────────┴───────────┴───────────┴───────┘

🏆 TOP PERFORMERS
${topPerformerList}

⚠️  NEEDS ATTENTION
${attentionList}
`;

  return {
    to: 'leadership@notonlytranslator.com',
    from: config.channels.email.from,
    subject: `Executive Sales Summary — ${period}`,
    body: body.trim(),
    html: false,
  };
}

/**
 * Simulate sending emails (since SMTP is not real).
 * In production, would use nodemailer or similar.
 * Returns a delivery log with status for each email.
 */
export async function sendDistributionEmails(emails, config) {
  const results = [];

  for (const email of emails) {
    const deliveryLog = {
      to: email.to,
      from: email.from,
      subject: email.subject,
      channel: 'email',
      status: 'simulated', // 'sent', 'failed', 'simulated'
      attempts: 1,
      sentAt: new Date().toISOString(),
      error: null,
    };

    // In production: actual SMTP send with retry
    // For now: simulate successful delivery
    results.push(deliveryLog);
  }

  return results;
}

/**
 * Run the full delivery pipeline: load data, build emails, simulate send.
 */
export async function deliver(configOverride) {
  const config = configOverride || loadConfig();

  if (!config.channels.email.enabled) {
    return { status: 'skipped', reason: 'email channel disabled' };
  }

  // Import the run function to get the manifest
  const { run } = await import('./distribution-engine.js');
  const manifest = run();

  // Collect all rep reports
  const repReports = [];
  for (const territory of manifest.territories) {
    for (const rep of territory.representatives) {
      // Load the generated rep report
      const fs = await import('node:fs');
      const path = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const reportPath = path.join(__dirname, '..', 'data', 'distributions', rep.reportFile);
      const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
      repReports.push(reportData);
    }
  }

  // Build emails
  const emails = repReports.map(report => buildRepEmail(report, config));

  // Add executive email
  const execEmail = buildExecutiveEmail(manifest.executiveSummary, config);
  emails.push(execEmail);

  // Send
  const deliveryResults = await sendDistributionEmailes(emails, config);

  return {
    status: 'complete',
    emailsBuilt: emails.length,
    emailsSent: deliveryResults.filter(d => d.status === 'sent' || d.status === 'simulated').length,
    emailsFailed: deliveryResults.filter(d => d.status === 'failed').length,
    results: deliveryResults,
    manifest,
  };
}

/**
 * Retry wrapper with exponential backoff.
 */
export async function sendWithRetry(sendFn, attempts, baseDelayMs) {
  let lastError;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await sendFn();
      return { success: true, result, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        const delay = calculateRetryDelay(baseDelayMs, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return { success: false, error: lastError, attempts };
}
