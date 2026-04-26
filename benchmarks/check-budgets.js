#!/usr/bin/env node
/**
 * 性能预算检查脚本
 *
 * 运行方式: node benchmarks/check-budgets.js
 * 检查当前构建是否满足性能预算要求
 *
 * 退出码:
 * - 0: 所有预算达标
 * - 1: 有预算超标
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(ROOT, 'dist');
const RESULTS_FILE = path.resolve(__dirname, 'results.json');

/**
 * 性能预算（硬性限制）
 */
const BUDGETS = {
  // 构建体积预算
  bundleSize: {
    totalJSKB: 2000,       // JS 总大小上限 2MB
    totalCSSKB: 200,       // CSS 总大小上限 200KB
    grandTotalKB: 2500,    // 总体积上限 2.5MB
    largestSingleFileKB: 500,  // 单个文件上限 500KB
  },

  // DOM 扫描预算（中位数，毫秒）
  domScanning: {
    small_median: 0.1,     // 100 词 < 0.1ms
    medium_median: 0.5,    // 1000 词 < 0.5ms
    large_median: 5.0,     // 5000 词 < 5ms
  },

  // 文本处理预算（中位数，毫秒）
  textProcessing: {
    singleWord_median: 0.01,
    paragraph_median: 0.1,
  },

  // Tooltip 操作预算（中位数，毫秒）
  tooltipOperations: {
    renderTemplate_median: 0.01,
    positionCalc_median: 0.01,
  },

  // 存储操作预算（中位数，毫秒）
  storageOperations: {
    vocabLookup_median: 0.005,
    cacheLookup_median: 0.005,
    cacheEviction_median: 0.1,
  },

  // Bayesian 更新预算（中位数，毫秒）
  bayesianUpdate: {
    small_sample_median: 0.005,
    medium_sample_median: 0.005,
    large_sample_median: 0.005,
  },
};

function checkBudget(budget, results) {
  const violations = [];

  for (const [key, limit] of Object.entries(budget)) {
    // 支持嵌套键（如 domScanning.small_median）
    const parts = key.split('.');
    let value = results;
    for (const part of parts) {
      if (value && typeof value === 'object') {
        value = value[part];
      } else {
        value = undefined;
        break;
      }
    }

    if (value === undefined) continue;

    const numeric = typeof value === 'number' ? value : (value.median ?? null);
    if (numeric === null) continue;

    if (numeric > limit) {
      violations.push({
        metric: key,
        actual: numeric,
        limit,
        overBy: ((numeric - limit) / limit * 100).toFixed(1),
      });
    }
  }

  return violations;
}

function main() {
  console.log('📊 NotOnlyTranslator 性能预算检查');
  console.log('='.repeat(50));

  // 检查 dist 是否存在
  if (!fs.existsSync(DIST)) {
    console.log('⚠️  dist/ 不存在，跳过体积检查');
    console.log('   请先运行: npm run build');
  } else {
    // 计算当前体积
    let totalJS = 0;
    let totalCSS = 0;
    let totalOther = 0;
    let largestFile = 0;

    function walk(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(full);
        } else {
          const stat = fs.statSync(full);
          const ext = path.extname(e.name);
          if (ext === '.js') totalJS += stat.size;
          else if (ext === '.css') totalCSS += stat.size;
          else totalOther += stat.size;
          if (stat.size > largestFile) largestFile = stat.size;
        }
      }
    }
    walk(DIST);

    const currentBundle = {
      totalJSKB: totalJS / 1024,
      totalCSSKB: totalCSS / 1024,
      grandTotalKB: (totalJS + totalCSS + totalOther) / 1024,
      largestSingleFileKB: largestFile / 1024,
    };

    const bundleViolations = checkBudget(BUDGETS.bundleSize, currentBundle);
    if (bundleViolations.length > 0) {
      console.log('\n❌ 构建体积超标:');
      for (const v of bundleViolations) {
        console.log(`  ${v.metric}: ${v.actual.toFixed(1)}KB (上限: ${v.limit}KB, 超出 ${v.overBy}%)`);
      }
    } else {
      console.log('\n✅ 构建体积: 达标');
      console.log(`   JS: ${currentBundle.totalJSKB.toFixed(1)}KB | CSS: ${currentBundle.totalCSSKB.toFixed(1)}KB | 总计: ${currentBundle.grandTotalKB.toFixed(1)}KB`);
    }
  }

  // 检查基准测试结果
  if (!fs.existsSync(RESULTS_FILE)) {
    console.log('\n⚠️  基准测试结果不存在: results.json');
    console.log('   请先运行: node benchmarks/run.js');
    process.exit(1);
  }

  const results = JSON.parse(fs.readFileSync(RESULTS_FILE, 'utf-8'));
  const benchmarks = results.benchmarks;

  let totalViolations = 0;

  // 检查各项预算
  const suites = [
    { name: 'DOM 扫描', key: 'domScanning', budget: BUDGETS.domScanning },
    { name: '文本处理', key: 'textProcessing', budget: BUDGETS.textProcessing },
    { name: 'Tooltip', key: 'tooltipOperations', budget: BUDGETS.tooltipOperations },
    { name: '存储操作', key: 'storageOperations', budget: BUDGETS.storageOperations },
    { name: 'Bayesian 更新', key: 'bayesianUpdate', budget: BUDGETS.bayesianUpdate },
  ];

  for (const { name, key, budget } of suites) {
    const data = benchmarks[key];
    if (!data) continue;

    const violations = checkBudget(budget, data);
    if (violations.length > 0) {
      console.log(`\n❌ ${name} 超标:`);
      for (const v of violations) {
        console.log(`  ${v.metric}: ${v.actual.toFixed(4)}ms (上限: ${v.limit}ms, 超出 ${v.overBy}%)`);
      }
      totalViolations += violations.length;
    } else {
      console.log(`\n✅ ${name}: 达标`);
    }
  }

  console.log();
  if (totalViolations === 0) {
    console.log('✅ 所有性能预算达标');
    process.exit(0);
  } else {
    console.log(`❌ ${totalViolations} 个性能预算超标`);
    process.exit(1);
  }
}

main();
