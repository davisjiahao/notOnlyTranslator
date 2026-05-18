/**
 * Slack Delivery Tests
 */

import assert from 'node:assert/strict';
import { buildRepSlackMessage, buildExecutiveSlackMessage, sendSlackMessages, deliverViaSlack } from './slack-delivery.js';

// ── Fixtures ──

const repReport = {
  repId: 'rep-001',
  representative: 'John Smith',
  territory: 'north',
  period: '2026-03',
  status: 'exceeding',
  metrics: {
    mtd: '$45,000',
    ytd: '$320,000',
    yearEnd: '$480,000',
    quota: '$400,000',
    pipeline: '$250,000',
    deals: 12,
    quotaAttainment: '120%',
    pipelineCoverage: '62.5%',
  },
  generatedAt: '2026-03-31T10:00:00.000Z',
};

const atRiskRep = {
  ...repReport,
  status: 'at-risk',
  metrics: { ...repReport.metrics, quotaAttainment: '35%', pipelineCoverage: '20%' },
};

const execSummary = {
  period: '2026-03',
  totalMTD: '$150,000',
  totalYTD: '$1,200,000',
  totalPipeline: '$800,000',
  totalDeals: 45,
  territories: [
    { name: 'north', quotaAttainment: '120%', pipelineCoverage: '62.5%', deals: 12 },
    { name: 'south', quotaAttainment: '85%', pipelineCoverage: '45%', deals: 15 },
    { name: 'east', quotaAttainment: '40%', pipelineCoverage: '20%', deals: 5 },
  ],
  topPerformers: [{ name: 'John Smith', territory: 'north', quotaAttainment: '120%' }],
  needsAttention: [{ name: 'Jane Doe', territory: 'east', quotaAttainment: '40%' }],
  generatedAt: '2026-03-31T10:00:00.000Z',
};

const config = {
  channels: {
    slack: { enabled: true, webhook: 'https://hooks.slack.com/fake' },
    email: { enabled: true },
  },
};

// ── Tests ──

function testRepSlackMessageStructure() {
  const msg = buildRepSlackMessage(repReport);
  assert.ok(msg.blocks);
  assert.ok(Array.isArray(msg.blocks));
  assert.strictEqual(msg.blocks[0].type, 'header');
  assert.ok(msg.blocks[0].text.text.includes('north'));
  assert.ok(msg.blocks[0].text.text.includes('trophy')); // exceeding emoji
  assert.ok(msg.blocks.some(b => b.type === 'section' && b.fields));
  assert.strictEqual(msg.channel, '#sales-north');
  console.log('  PASS: rep slack message structure');
}

function testRepSlackMessageStatuses() {
  const statuses = ['exceeding', 'on-track', 'needs-improvement', 'at-risk'];
  const emojis = ['trophy', 'chart_with_upwards_trend', 'warning', 'rotating_light'];

  for (let i = 0; i < statuses.length; i++) {
    const report = { ...repReport, status: statuses[i] };
    const msg = buildRepSlackMessage(report);
    const headerText = msg.blocks[0].text.text;
    assert.ok(headerText.includes(emojis[i]), `Expected ${emojis[i]} for ${statuses[i]}`);
  }
  console.log('  PASS: rep slack message all statuses');
}

function testRepSlackMessageFields() {
  const msg = buildRepSlackMessage(repReport);
  const fieldsSection = msg.blocks.find(b => b.type === 'section' && b.fields);
  assert.ok(fieldsSection);
  assert.strictEqual(fieldsSection.fields.length, 8);

  const fieldTexts = fieldsSection.fields.map(f => f.text);
  assert.ok(fieldTexts.some(t => t.includes('John Smith')));
  assert.ok(fieldTexts.some(t => t.includes('exceeding')));
  assert.ok(fieldTexts.some(t => t.includes('$45,000')));
  assert.ok(fieldTexts.some(t => t.includes('120%')));
  console.log('  PASS: rep slack message fields');
}

function testExecutiveSlackMessageStructure() {
  const msg = buildExecutiveSlackMessage(execSummary);
  assert.ok(msg.blocks);
  assert.strictEqual(msg.blocks[0].type, 'header');
  assert.ok(msg.blocks[0].text.text.includes('Executive'));
  assert.ok(msg.blocks[0].text.text.includes('2026-03'));
  assert.strictEqual(msg.channel, '#sales-leadership');
  console.log('  PASS: executive slack message structure');
}

function testExecutiveSlackMessageMetrics() {
  const msg = buildExecutiveSlackMessage(execSummary);
  const metricsSection = msg.blocks.find(b => b.type === 'section' && b.fields);
  assert.ok(metricsSection);
  const texts = metricsSection.fields.map(f => f.text);
  assert.ok(texts.some(t => t.includes('$150,000')));
  assert.ok(texts.some(t => t.includes('$1,200,000')));
  assert.ok(texts.some(t => t.includes('$800,000')));
  assert.ok(texts.some(t => t.includes('45')));
  console.log('  PASS: executive slack message metrics');
}

function testExecutiveSlackMessageTopAndAttention() {
  const msg = buildExecutiveSlackMessage(execSummary);
  const hasTop = msg.blocks.some(b => b.text?.text?.includes('Top Performers'));
  const hasAttention = msg.blocks.some(b => b.text?.text?.includes('Needs Attention'));
  assert.ok(hasTop, 'Should have top performers section');
  assert.ok(hasAttention, 'Should have needs attention section');
  console.log('  PASS: executive slack message top + attention sections');
}

function testExecutiveSlackMessageNoTopOrAttention() {
  const summary = {
    ...execSummary,
    topPerformers: [],
    needsAttention: [],
  };
  const msg = buildExecutiveSlackMessage(summary);
  const hasTop = msg.blocks.some(b => b.text?.text?.includes('Top Performers'));
  const hasAttention = msg.blocks.some(b => b.text?.text?.includes('Needs Attention'));
  assert.ok(!hasTop, 'Should not have top performers section when empty');
  assert.ok(!hasAttention, 'Should not have needs attention section when empty');
  console.log('  PASS: executive slack message omits empty sections');
}

async function testSendSlackMessagesSimulation() {
  const messages = [
    buildRepSlackMessage(repReport),
    buildExecutiveSlackMessage(execSummary),
  ];

  const results = await sendSlackMessages(messages);
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].status, 'simulated');
  assert.strictEqual(results[1].status, 'simulated');
  assert.ok(results[0].sentAt);
  console.log('  PASS: sendSlackMessages simulation');
}

async function testDeliverViaSlackEnabled() {
  const result = await deliverViaSlack([repReport], execSummary, config);
  assert.strictEqual(result.status, 'complete');
  assert.strictEqual(result.messagesBuilt, 2);
  assert.strictEqual(result.messagesSent, 2);
  assert.strictEqual(result.messagesFailed, 0);
  console.log('  PASS: deliverViaSlack enabled');
}

async function testDeliverViaSlackDisabled() {
  const disabledConfig = { channels: { slack: { enabled: false } } };
  const result = await deliverViaSlack([repReport], execSummary, disabledConfig);
  assert.strictEqual(result.status, 'skipped');
  assert.ok(result.reason);
  console.log('  PASS: deliverViaSlack disabled');
}

async function testDeliverViaSlackMultipleReps() {
  const reps = [
    repReport,
    { ...repReport, repId: 'rep-002', representative: 'Jane Doe', territory: 'south' },
    { ...repReport, repId: 'rep-003', representative: 'Bob Lee', territory: 'east', status: 'at-risk' },
  ];
  const result = await deliverViaSlack(reps, execSummary, config);
  assert.strictEqual(result.messagesBuilt, 4); // 3 reps + 1 exec
  assert.strictEqual(result.messagesSent, 4);
  console.log('  PASS: deliverViaSlack multiple reps');
}

// ── Run All Tests ──

console.log('\nSlack Delivery Tests');
console.log('='.repeat(40));

const syncTests = [
  testRepSlackMessageStructure,
  testRepSlackMessageStatuses,
  testRepSlackMessageFields,
  testExecutiveSlackMessageStructure,
  testExecutiveSlackMessageMetrics,
  testExecutiveSlackMessageTopAndAttention,
  testExecutiveSlackMessageNoTopOrAttention,
];

const asyncTests = [
  testSendSlackMessagesSimulation,
  testDeliverViaSlackEnabled,
  testDeliverViaSlackDisabled,
  testDeliverViaSlackMultipleReps,
];

let passed = 0;
let failed = 0;

async function runTests(tests) {
  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (err) {
      console.log(`  FAIL: ${test.name} — ${err.message}`);
      failed++;
    }
  }
}

runTests(syncTests).then(() => runTests(asyncTests)).then(() => {
  console.log('\n' + '='.repeat(40));
  console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) process.exit(1);
});
