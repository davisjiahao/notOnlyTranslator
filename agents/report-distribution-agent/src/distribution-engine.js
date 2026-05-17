/**
 * Report Distribution Engine
 *
 * Reads consolidated reports from Data Consolidation Agent,
 * filters by territory, and creates per-rep distribution packages.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AGENT_DIR = path.resolve(__dirname, '..');
const REPORTS_DIR = path.resolve(AGENT_DIR, '..', 'data-consolidation-agent', 'data', 'reports');
const OUTPUT_DIR = path.resolve(AGENT_DIR, 'data', 'distributions');

/**
 * Load and parse distribution config.
 */
export function loadConfig() {
  const configPath = path.join(AGENT_DIR, 'report-distribution-config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * Load all report sources. Skips missing files gracefully.
 */
export function loadReports(sources) {
  const reports = {};
  for (const sourcePath of sources) {
    const filename = path.basename(sourcePath);
    const fullPath = path.join(REPORTS_DIR, filename);
    try {
      const raw = fs.readFileSync(fullPath, 'utf-8');
      reports[filename] = JSON.parse(raw);
    } catch {
      reports[filename] = null;
    }
  }
  return reports;
}

/**
 * Format currency as human-readable string.
 */
function fmt(amount) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount}`;
}

/**
 * Format percentage as readable string.
 */
function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Build a personalized report for a single representative.
 */
export function buildRepReport(rep, territoryData, reports) {
  const repTerritory = territoryData?.name || rep.territory;
  const quotaAtt = rep.quotaAttainment || 0;
  const pipeCov = rep.pipelineCoverage || 0;

  let status = 'on-track';
  if (quotaAtt < 0.5) status = 'at-risk';
  else if (quotaAtt < 0.75) status = 'needs-improvement';
  else if (quotaAtt >= 0.9) status = 'exceeding';

  const territorySummary = territoryData ? {
    territory: repTerritory,
    territoryMTD: fmt(territoryData.mtdTotal),
    territoryYTD: fmt(territoryData.ytdTotal),
    territoryQuotaAttainment: pct(territoryData.quotaAttainment),
    territoryPipelineCoverage: pct(territoryData.pipelineCoverage),
    totalReps: territoryData.reps,
    totalDeals: territoryData.dealsTotal,
  } : null;

  return {
    representative: rep.name,
    repId: rep.id,
    territory: repTerritory,
    status,
    period: reports['territory-summary-2026-03.json']?.period || 'unknown',
    metrics: {
      mtd: fmt(rep.mtd),
      ytd: fmt(rep.ytd),
      yearEnd: fmt(rep.yearEnd),
      quota: fmt(rep.quota),
      pipeline: fmt(rep.pipeline),
      deals: rep.deals,
      quotaAttainment: pct(quotaAtt),
      pipelineCoverage: pct(pipeCov),
    },
    territorySummary,
    pipelineHealth: reports['pipeline-health-2026-03.json']?.[rep.id] ?? null,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Build an executive distribution summary (territory-level only).
 */
export function buildExecutiveSummary(reports) {
  const territoryReport = reports['territory-summary-2026-03.json'];
  const repReport = reports['rep-performance-2026-03.json'];

  if (!territoryReport) {
    return { error: 'Territory summary not available' };
  }

  const territories = territoryReport.territories.map(t => ({
    id: t.id,
    name: t.name,
    mtd: fmt(t.mtdTotal),
    ytd: fmt(t.ytdTotal),
    quotaAttainment: pct(t.quotaAttainment),
    pipelineCoverage: pct(t.pipelineCoverage),
    deals: t.dealsTotal,
    reps: t.reps,
  }));

  return {
    period: territoryReport.period,
    generatedAt: new Date().toISOString(),
    totalMTD: fmt(territoryReport.territories.reduce((s, t) => s + t.mtdTotal, 0)),
    totalYTD: fmt(territoryReport.territories.reduce((s, t) => s + t.ytdTotal, 0)),
    totalPipeline: fmt(territoryReport.territories.reduce((s, t) => s + t.pipelineTotal, 0)),
    totalDeals: territoryReport.territories.reduce((s, t) => s + t.dealsTotal, 0),
    territories,
    topPerformers: repReport?.topPerformers?.map(r => ({ name: r.name, territory: r.territory, quotaAttainment: pct(r.quotaAttainment) })) || [],
    needsAttention: repReport?.needsAttention?.slice(0, 3).map(r => ({ name: r.name, territory: r.territory, quotaAttainment: pct(r.quotaAttainment) })) || [],
  };
}

/**
 * Run the full distribution pipeline.
 */
export function run() {
  const config = loadConfig();
  console.log(`Distribution Engine — period ${config.distributionSchedule.enabled ? 'SCHEDULED' : 'MANUAL'}`);
  console.log(`Config: ${config.territories.length} territories, email ${config.channels.email.enabled ? 'enabled' : 'disabled'}`);

  const reports = loadReports(config.reportSources);
  const availableReports = Object.entries(reports).filter(([, v]) => v !== null);
  console.log(`Reports loaded: ${availableReports.length}/${config.reportSources.length}`);

  const territorySummary = reports['territory-summary-2026-03.json'];
  const repPerformance = reports['rep-performance-2026-03.json'];

  if (!territorySummary || !repPerformance) {
    console.warn('WARNING: Core reports missing. Distribution will be partial.');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const distributionManifest = {
    generatedAt: new Date().toISOString(),
    period: territorySummary?.period || 'unknown',
    territories: [],
    executiveSummary: null,
  };

  distributionManifest.executiveSummary = buildExecutiveSummary(reports);

  for (const territory of config.territories) {
    const territoryData = territorySummary?.territories?.find(t => t.id === territory.id);
    const reps = territoryData?.repData || [];

    const territoryManifest = {
      id: territory.id,
      name: territoryData?.name || territory.id,
      representatives: [],
      reports: [],
      channel: config.channels.email.enabled ? 'email' : 'none',
      recipients: territory.representatives,
    };

    for (const rep of reps) {
      // Normalize repData fields (uses repId/representative) to match buildRepReport expectations (id/name)
      const normalizedRep = {
        id: rep.repId,
        name: rep.representative,
        territory: rep.territory,
        mtd: rep.metrics.mtd,
        ytd: rep.metrics.ytd,
        yearEnd: rep.metrics.yearEnd,
        quota: rep.metrics.quota,
        pipeline: rep.metrics.pipeline,
        deals: rep.metrics.deals,
        quotaAttainment: rep.metrics.quota > 0 ? rep.metrics.yearEnd / rep.metrics.quota : 0,
        pipelineCoverage: rep.metrics.quota > 0 ? rep.metrics.pipeline / rep.metrics.quota : 0,
      };
      const repReport = buildRepReport(normalizedRep, territoryData, reports);
      const repFile = `rep-${rep.repId}-${territory.id}-${territorySummary.period}.json`;
      const repPath = path.join(OUTPUT_DIR, repFile);

      fs.writeFileSync(repPath, JSON.stringify(repReport, null, 2));

      territoryManifest.representatives.push({
        name: normalizedRep.name,
        repId: normalizedRep.id,
        reportFile: repFile,
        status: repReport.status,
        quotaAttainment: repReport.metrics.quotaAttainment,
      });
    }

    distributionManifest.territories.push(territoryManifest);
    console.log(`  Territory "${territory.id}": ${reps.length} rep(s), ${territoryManifest.representatives.length} report(s)`);
  }

  const manifestPath = path.join(OUTPUT_DIR, 'distribution-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(distributionManifest, null, 2));

  const execPath = path.join(OUTPUT_DIR, 'executive-distribution-summary.json');
  fs.writeFileSync(execPath, JSON.stringify(distributionManifest.executiveSummary, null, 2));

  const totalReps = distributionManifest.territories.reduce((s, t) => s + t.representatives.length, 0);
  console.log(`\nDistribution complete: ${totalReps} rep reports across ${distributionManifest.territories.length} territories`);
  console.log(`Output: ${OUTPUT_DIR}`);

  return distributionManifest;
}
