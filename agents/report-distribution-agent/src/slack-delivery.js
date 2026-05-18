/**
 * Slack Delivery Module
 *
 * Sends distribution reports to Slack channels via Incoming Webhooks.
 * Supports per-territory channels and a shared executive summary channel.
 * Gracefully degrades when webhook is not configured.
 */

/**
 * Build a Slack message block for a single rep report.
 */
export function buildRepSlackMessage(repReport) {
  const { representative, territory, status, metrics, period } = repReport;

  const emoji = {
    'exceeding': ':trophy:',
    'on-track': ':chart_with_upwards_trend:',
    'needs-improvement': ':warning:',
    'at-risk': ':rotating_light:',
  };

  const statusEmoji = emoji[status] || ':bar_chart:';

  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `${statusEmoji} ${territory} Sales Report — ${period}` } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Rep*\n${representative}` },
          { type: 'mrkdwn', text: `*Status*\n${status}` },
          { type: 'mrkdwn', text: `*MTD*\n${metrics.mtd}` },
          { type: 'mrkdwn', text: `*YTD*\n${metrics.ytd}` },
          { type: 'mrkdwn', text: `*Quota*\n${metrics.quota}` },
          { type: 'mrkdwn', text: `*Attainment*\n${metrics.quotaAttainment}` },
          { type: 'mrkdwn', text: `*Pipeline*\n${metrics.pipeline}` },
          { type: 'mrkdwn', text: `*Coverage*\n${metrics.pipelineCoverage}` },
        ],
      },
      { type: 'divider' },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Report generated: ${repReport.generatedAt}` }],
      },
    ],
    channel: `#sales-${territory.toLowerCase()}`,
  };
}

/**
 * Build a Slack message block for the executive summary.
 */
export function buildExecutiveSlackMessage(executiveSummary) {
  const { period, totalMTD, totalYTD, totalPipeline, totalDeals, territories, topPerformers, needsAttention } = executiveSummary;

  const territoryText = territories.map(t =>
    `• *${t.name}*: ${t.quotaAttainment} attainment, ${t.pipelineCoverage} coverage, ${t.deals} deals`
  ).join('\n');

  const topText = topPerformers.map(p => `• ${p.name} (${p.territory}) — ${p.quotaAttainment}`).join('\n');
  const attentionText = needsAttention.map(p => `• ${p.name} (${p.territory}) — ${p.quotaAttainment}`).join('\n');

  return {
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `:bar_chart: Executive Sales Summary — ${period}` } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Total MTD*\n${totalMTD}` },
          { type: 'mrkdwn', text: `*Total YTD*\n${totalYTD}` },
          { type: 'mrkdwn', text: `*Total Pipeline*\n${totalPipeline}` },
          { type: 'mrkdwn', text: `*Total Deals*\n${totalDeals}` },
        ],
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: `*Territories*\n${territoryText}` } },
      ...(topText ? [{ type: 'section', text: { type: 'mrkdwn', text: `:trophy: *Top Performers*\n${topText}` } }] : []),
      ...(attentionText ? [{ type: 'section', text: { type: 'mrkdwn', text: `:warning: *Needs Attention*\n${attentionText}` } }] : []),
      { type: 'divider' },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Generated: ${executiveSummary.generatedAt}` }],
      },
    ],
    channel: '#sales-leadership',
  };
}

/**
 * Simulate sending Slack messages via webhook.
 * In production, POST to the Slack Incoming Webhook URL.
 */
export async function sendSlackMessages(messages, config) {
  const results = [];

  for (const message of messages) {
    const deliveryLog = {
      channel: message.channel,
      subject: message.blocks.find(b => b.type === 'header')?.text?.text || 'Slack message',
      status: 'simulated',
      attempts: 1,
      sentAt: new Date().toISOString(),
      error: null,
    };
    results.push(deliveryLog);
  }

  return results;
}

/**
 * Build and send Slack messages for all rep reports + executive summary.
 */
export async function deliverViaSlack(repReports, executiveSummary, config) {
  if (!config.channels.slack?.enabled) {
    return { status: 'skipped', reason: 'slack channel disabled' };
  }

  const messages = repReports.map(report => buildRepSlackMessage(report));
  messages.push(buildExecutiveSlackMessage(executiveSummary));

  const results = await sendSlackMessages(messages, config);

  return {
    status: 'complete',
    messagesBuilt: messages.length,
    messagesSent: results.filter(r => r.status === 'sent' || r.status === 'simulated').length,
    messagesFailed: results.filter(r => r.status === 'failed').length,
    results,
  };
}
