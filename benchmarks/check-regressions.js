#!/usr/bin/env node
/**
 * 性能回归检测脚本
 *
 * 运行方式: node benchmarks/check-regressions.js
 * 对比当前基准测试结果与基线数据，检测性能回归
 *
 * 退出码:
 * - 0: 无回归
 * - 1: 发现回归
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASELINE_FILE = path.resolve(__dirname, 'results.json');
const CURRENT_FILE = path.resolve(__dirname, '..', 'benchmark', 'results', 'performance-report.json');
const REGRESSION_THRESHOLD = 0.15; // 15% 回归阈值

function extractMedian(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'median' in value) {
    return value.median;
  }
  return null;
}

/**
 * 提取指标：支持两种格式
 * - 旧格式（benchmarks/run.js）：递归提取 median, totalJS, totalCSS, grandTotal
 * - 新格式（vitest --outputJson）：files[].groups[].benchmarks[]，提取 hz（越高越快）和 period
 */
function extractMetrics(obj, prefix = '', results = new Map()) {
  if (obj === null || obj === undefined) return results;

  // 新格式：vitest --outputJson
  if (obj.files && Array.isArray(obj.files)) {
    for (const file of obj.files) {
      const fileName = path.basename(file.filepath || '');
      for (const group of (file.groups || [])) {
        const suiteName = (group.fullName || group.name || '').replace(/.*>\s*/, '');
        for (const bench of (group.benchmarks || [])) {
          const key = `${fileName}:${suiteName}:${bench.name}`;
          // hz = operations per second (higher is better)
          if (typeof bench.hz === 'number') {
            results.set(`${key}:hz`, bench.hz);
          }
          // period = ms per operation (lower is better)
          if (typeof bench.period === 'number') {
            results.set(`${key}:period`, bench.period);
          }
        }
      }
    }
    return results;
  }

  // 旧格式：递归遍历
  if (typeof obj === 'number') {
    results.set(prefix, obj);
    return results;
  }
  if (typeof obj !== 'object') return results;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      extractMetrics(obj[i], `${prefix}[${i}]`, results);
    }
    return results;
  }

  for (const [key, val] of Object.entries(obj)) {
    const newPrefix = prefix ? `${prefix}.${key}` : key;
    if (key === 'median' && typeof val === 'number') {
      results.set(newPrefix, val);
    } else if (key === 'totalJS' || key === 'totalCSS' || key === 'grandTotal') {
      results.set(newPrefix, val);
    } else if (typeof val === 'object' && val !== null) {
      extractMetrics(val, newPrefix, results);
    }
  }

  return results;
}

/**
 * 对比两组指标，找出回归
 * - 对于 period/latency 类指标（越小越好）：增长 = 回归
 * - 对于 hz/throughput 类指标（越大越好）：下降 = 回归
 */
function findRegressions(baseline, current) {
  const regressions = [];

  for (const [metric, baselineValue] of baseline) {
    const currentValue = current.get(metric);
    if (currentValue === undefined) continue;
    if (baselineValue === 0) continue;

    // Determine direction: hz means higher is better, period means lower is better
    const isHigherBetter = metric.endsWith(':hz');

    if (isHigherBetter) {
      // For hz: decline means regression
      const change = (baselineValue - currentValue) / baselineValue;
      if (change > REGRESSION_THRESHOLD) {
        regressions.push({
          metric,
          baseline: baselineValue,
          current: currentValue,
          change,
          direction: 'slower',
        });
      }
    } else {
      // For period/latency: increase means regression
      const change = (currentValue - baselineValue) / baselineValue;
      if (change > REGRESSION_THRESHOLD) {
        regressions.push({
          metric,
          baseline: baselineValue,
          current: currentValue,
          change,
          direction: 'slower',
        });
      }
    }
  }

  return regressions;
}

function main() {
  console.log('🔍 NotOnlyTranslator 性能回归检测');
  console.log('='.repeat(50));

  if (!fs.existsSync(BASELINE_FILE)) {
    console.log(`⚠️  基线文件不存在: ${BASELINE_FILE}`);
    console.log('   请先运行: node benchmarks/run.js');
    process.exit(1);
  }

  let currentData;
  if (fs.existsSync(CURRENT_FILE)) {
    console.log(`📊 使用 Vitest 基准测试结果: ${CURRENT_FILE}`);
    currentData = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf-8'));

    // Skip regression check if Vitest results contain only failures (old format)
    if (currentData.success === false && currentData.numTotalTests === 0) {
      console.log('⚠️  Vitest 基准测试未成功运行，跳过回归检测');
      console.log('   请先运行: npm run benchmark');
      process.exit(0);
    }

    // New format: check if files array exists and has content
    if (currentData.files && currentData.files.length > 0) {
      const totalBenches = currentData.files.reduce(
        (sum, f) => sum + (f.groups || []).reduce((s, g) => s + (g.benchmarks || []).length, 0),
        0
      );
      if (totalBenches === 0) {
        console.log('⚠️  Vitest 基准测试无结果数据，跳过回归检测');
        console.log('   请先运行: npm run benchmark');
        process.exit(0);
      }
    }
  } else {
    console.log(`⚠️  当前结果不存在: ${CURRENT_FILE}`);
    console.log('   请先运行: npm run benchmark');
    process.exit(1);
  }

  const baselineData = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf-8'));

  const baselineMetrics = extractMetrics(baselineData);
  const currentMetrics = extractMetrics(currentData);

  console.log(`📈 基线指标: ${baselineMetrics.size} 个`);
  console.log(`📈 当前指标: ${currentMetrics.size} 个`);
  console.log();

  const regressions = findRegressions(baselineMetrics, currentMetrics);

  if (regressions.length === 0) {
    console.log('✅ 无性能回归');
    process.exit(0);
  }

  console.log(`❌ 发现 ${regressions.length} 个性能回归:`);
  console.log();

  for (const r of regressions) {
    const pctChange = (r.change * 100).toFixed(1);
    const isHz = r.metric.endsWith(':hz');
    const isPeriod = r.metric.endsWith(':period');
    let desc = '';
    if (isHz) {
      desc = `${r.baseline.toFixed(2)} → ${r.current.toFixed(2)} ops/sec (${pctChange}% 变慢)`;
    } else if (isPeriod) {
      desc = `${r.baseline.toFixed(4)} → ${r.current.toFixed(4)} ms (${pctChange}% 变慢)`;
    } else {
      desc = `${r.baseline.toFixed(3)} → ${r.current.toFixed(3)} (${pctChange}% 变差)`;
    }
    console.log(`  ${r.metric}`);
    console.log(`    基线: ${desc}`);
    console.log();
  }

  process.exit(1);
}

main();
