/**
 * Data Consolidation Agent - Consolidation Script
 * Processes incoming sales data and generates dashboard reports
 */

import * as fs from 'fs';
import * as path from 'path';

// Configuration
const CONFIG_PATH = './data-consolidation-config.json';
const INCOMING_DIR = './data/incoming';
const PROCESSED_DIR = './data/processed';
const REPORTS_DIR = './data/reports';

// Load configuration
function loadConfig() {
  const configPath = path.join(process.cwd(), CONFIG_PATH);
  if (!fs.existsSync(configPath)) {
    throw new Error('Configuration file not found: ' + configPath);
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// Load all incoming data files
function loadIncomingData() {
  const incomingPath = path.join(process.cwd(), INCOMING_DIR);
  if (!fs.existsSync(incomingPath)) {
    return [];
  }

  const files = fs.readdirSync(incomingPath).filter(f => f.endsWith('.json'));
  const data = [];

  for (const file of files) {
    const filePath = path.join(incomingPath, file);
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      data.push(content);
      // Move to processed
      const processedPath = path.join(process.cwd(), PROCESSED_DIR, file);
      fs.renameSync(filePath, processedPath);
    } catch (error) {
      console.error(`Error processing file ${file}:`, error);
    }
  }

  return data;
}

// Aggregate data by territory
function aggregateByTerritory(data) {
  const territories = {};

  for (const record of data) {
    const territory = record.territory;
    if (!territories[territory]) {
      territories[territory] = {
        id: territory.toLowerCase(),
        name: territory,
        mtdTotal: 0,
        ytdTotal: 0,
        yearEndTotal: 0,
        quotaTotal: 0,
        pipelineTotal: 0,
        dealsTotal: 0,
        reps: 0,
        repData: []
      };
    }

    const t = territories[territory];
    t.mtdTotal += record.metrics.mtd;
    t.ytdTotal += record.metrics.ytd;
    t.yearEndTotal += record.metrics.yearEnd;
    t.quotaTotal += record.metrics.quota;
    t.pipelineTotal += record.metrics.pipeline;
    t.dealsTotal += record.metrics.deals;
    t.reps++;
    t.repData.push(record);
  }

  // Calculate derived metrics
  for (const t of Object.values(territories)) {
    t.quotaAttainment = t.ytdTotal / t.quotaTotal;
    t.pipelineCoverage = t.pipelineTotal / (t.quotaTotal - t.ytdTotal);
    t.avgDealSize = t.ytdTotal / t.dealsTotal;
  }

  return Object.values(territories);
}

// Calculate rep rankings
function calculateRepRankings(data) {
  const reps = data.map(record => ({
    id: record.repId,
    name: record.representative,
    territory: record.territory,
    mtd: record.metrics.mtd,
    ytd: record.metrics.ytd,
    yearEnd: record.metrics.yearEnd,
    quota: record.metrics.quota,
    pipeline: record.metrics.pipeline,
    deals: record.metrics.deals,
    quotaAttainment: record.metrics.ytd / record.metrics.quota,
    pipelineCoverage: record.metrics.pipeline / (record.metrics.quota - record.metrics.ytd)
  }));

  // Sort by YTD performance
  const byYTD = [...reps].sort((a, b) => b.ytd - a.ytd);

  // Sort by quota attainment
  const byQuotaAttainment = [...reps].sort((a, b) => b.quotaAttainment - a.quotaAttainment);

  // Identify top performers and needs attention
  const topPerformers = byYTD.slice(0, 3);
  const needsAttention = reps
    .filter(r => r.quotaAttainment < 0.6)
    .sort((a, b) => a.quotaAttainment - b.quotaAttainment);

  return {
    all: reps,
    byYTD,
    byQuotaAttainment,
    topPerformers,
    needsAttention
  };
}

// Calculate pipeline health
function calculatePipelineHealth(data, territories) {
  const totalPipeline = data.reduce((sum, r) => sum + r.metrics.pipeline, 0);
  const totalQuota = data.reduce((sum, r) => sum + r.metrics.quota, 0);
  const totalYTD = data.reduce((sum, r) => sum + r.metrics.ytd, 0);
  const totalDeals = data.reduce((sum, r) => sum + r.metrics.deals, 0);

  return {
    totalPipeline,
    totalQuota,
    totalYTD,
    remainingQuota: totalQuota - totalYTD,
    pipelineCoverage: totalPipeline / (totalQuota - totalYTD),
    avgDealSize: totalYTD / totalDeals,
    avgPipelinePerRep: totalPipeline / data.length,
    byTerritory: territories.map(t => ({
      territory: t.name,
      pipeline: t.pipelineTotal,
      coverage: t.pipelineCoverage
    }))
  };
}

// Generate executive summary
function generateExecutiveSummary(data, territories, rankings, pipelineHealth) {
  const totalYTD = data.reduce((sum, r) => sum + r.metrics.ytd, 0);
  const totalQuota = data.reduce((sum, r) => sum + r.metrics.quota, 0);
  const totalMTD = data.reduce((sum, r) => sum + r.metrics.mtd, 0);
  const totalYearEnd = data.reduce((sum, r) => sum + r.metrics.yearEnd, 0);

  return {
    reportType: 'executive-summary',
    generatedAt: new Date().toISOString(),
    period: data[0]?.period || 'unknown',
    kpis: {
      mtd: totalMTD,
      ytd: totalYTD,
      yearEndProjection: totalYearEnd,
      quota: totalQuota,
      quotaAttainment: totalYTD / totalQuota,
      gapToQuota: totalQuota - totalYTD,
      activeReps: data.length,
      territories: territories.length
    },
    health: {
      overall: totalYTD / totalQuota >= 0.8 ? 'good' : totalYTD / totalQuota >= 0.6 ? 'warning' : 'critical',
      pipeline: pipelineHealth.pipelineCoverage >= 2 ? 'strong' : pipelineHealth.pipelineCoverage >= 1 ? 'adequate' : 'weak'
    },
    highlights: {
      topPerformer: rankings.topPerformers[0]?.name || 'N/A',
      topTerritory: territories.sort((a, b) => b.ytdTotal - a.ytdTotal)[0]?.name || 'N/A',
      attentionNeeded: rankings.needsAttention.length
    }
  };
}

// Main consolidation function
function consolidate() {
  console.log('Starting data consolidation...');

  // Load config
  const config = loadConfig();
  console.log('Configuration loaded:', config.dashboards.join(', '));

  // Load incoming data
  const data = loadIncomingData();
  console.log(`Loaded ${data.length} records from incoming data`);

  if (data.length === 0) {
    console.log('No new data to process');
    return;
  }

  // Process data
  const territories = aggregateByTerritory(data);
  const rankings = calculateRepRankings(data);
  const pipelineHealth = calculatePipelineHealth(data, territories);
  const executiveSummary = generateExecutiveSummary(data, territories, rankings, pipelineHealth);

  // Generate reports
  const reports = {
    'territory-summary': {
      reportType: 'territory-summary',
      generatedAt: new Date().toISOString(),
      period: data[0].period,
      territories
    },
    'rep-performance': {
      reportType: 'rep-performance',
      generatedAt: new Date().toISOString(),
      period: data[0].period,
      ...rankings
    },
    'pipeline-health': {
      reportType: 'pipeline-health',
      generatedAt: new Date().toISOString(),
      period: data[0].period,
      ...pipelineHealth
    },
    'executive-summary': executiveSummary
  };

  // Save reports
  const reportsPath = path.join(process.cwd(), REPORTS_DIR);
  if (!fs.existsSync(reportsPath)) {
    fs.mkdirSync(reportsPath, { recursive: true });
  }

  for (const [name, report] of Object.entries(reports)) {
    const reportFile = path.join(reportsPath, `${name}-${data[0].period}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`Generated report: ${reportFile}`);
  }

  // Save latest snapshot
  const snapshotFile = path.join(reportsPath, 'latest-dashboard.json');
  fs.writeFileSync(snapshotFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    period: data[0].period,
    reports
  }, null, 2));
  console.log('Dashboard snapshot saved');

  console.log('\nConsolidation complete!');
  console.log(`- Territories: ${territories.length}`);
  console.log(`- Active Reps: ${data.length}`);
  console.log(`- Top Performer: ${rankings.topPerformers[0]?.name}`);
  console.log(`- Needs Attention: ${rankings.needsAttention.length} reps`);
}

// Run consolidation
consolidate();
