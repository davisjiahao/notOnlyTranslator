#!/usr/bin/env node
/**
 * NotOnlyTranslator 性能基准测试套件
 *
 * 运行方式: node benchmarks/run.js
 * 输出: 控制台报告 + benchmarks/results.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const DIST = path.resolve(ROOT, 'dist');
const RESULTS_FILE = path.resolve(__dirname, 'results.json');

// ============================================================
// 工具函数
// ============================================================

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function bench(fn, iterations = 10) {
  // Warmup
  for (let i = 0; i < 3; i++) fn();

  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  return {
    min: Math.min(...times),
    max: Math.max(...times),
    median: median(times),
    mean: mean(times),
    stddev: stddev(times),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    iterations,
    unit: 'ms',
  };
}

// ============================================================
// 测试生成器：不同规模的测试数据
// ============================================================

function generateText(wordCount) {
  const words = 'the quick brown fox jumps over lazy dog is a natural language processing test sentence for benchmarking performance'.split(' ');
  const result = [];
  for (let i = 0; i < wordCount; i++) {
    result.push(words[i % words.length]);
  }
  return result.join(' ');
}

function generateHTML(wordCount) {
  const text = generateText(wordCount);
  const words = text.split(' ');
  let html = '<html><body><div class="content">';
  let chunk = '';
  for (let i = 0; i < words.length; i++) {
    chunk += words[i] + ' ';
    if ((i + 1) % 20 === 0) {
      html += `<p>${chunk.trim()}</p>`;
      chunk = '';
    }
  }
  if (chunk.trim()) html += `<p>${chunk.trim()}</p>`;
  html += '</div></body></html>';
  return html;
}

// ============================================================
// Benchmark 1: Bundle Size Analysis
// ============================================================

function benchBundleSizes() {
  if (!fs.existsSync(DIST)) {
    return { error: 'dist/ 不存在，请先运行 npm run build' };
  }

  const sizes = {};
  let totalJS = 0;
  let totalCSS = 0;
  let totalOther = 0;

  function walk(dir, prefix = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(full, rel);
      } else {
        const stat = fs.statSync(full);
        const ext = path.extname(e.name);
        sizes[rel] = stat.size;
        if (ext === '.js') totalJS += stat.size;
        else if (ext === '.css') totalCSS += stat.size;
        else totalOther += stat.size;
      }
    }
  }
  walk(DIST);

  return {
    totalJS: totalJS,
    totalJSKB: (totalJS / 1024).toFixed(1),
    totalCSS: totalCSS,
    totalCSSKB: (totalCSS / 1024).toFixed(1),
    totalOther,
    totalOtherKB: (totalOther / 1024).toFixed(1),
    grandTotal: totalJS + totalCSS + totalOther,
    grandTotalKB: ((totalJS + totalCSS + totalOther) / 1024).toFixed(1),
    fileCount: Object.keys(sizes).length,
    largestFiles: Object.entries(sizes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, size]) => ({ name, size, sizeKB: (size / 1024).toFixed(1) })),
  };
}

// ============================================================
// Benchmark 2: Content Script DOM Scanning Simulation
// ============================================================

function benchDOMScanning() {
  // Simulate the text extraction and word analysis pipeline
  // Uses regex-based extraction (no JSDOM dependency needed for benchmarking)

  const htmlSamples = {
    small: generateHTML(100),
    medium: generateHTML(1000),
    large: generateHTML(5000),
  };

  const results = {};

  for (const [size, html] of Object.entries(htmlSamples)) {
    // Simple text extraction simulation (without JSDOM, just regex-based)
    const stats = bench(() => {
      // Simulate: extract text nodes from HTML
      const textContent = html.replace(/<[^>]*>/g, ' ');
      // Simulate: split into words
      const words = textContent.split(/\s+/).filter(w => w.length > 0);
      // Simulate: analyze each word (vocabulary lookup simulation)
      const wordSet = new Set(words.map(w => w.toLowerCase()));
      return wordSet.size;
    }, 20);

    results[size] = {
      ...stats,
      wordCount: html.split(/\s+/).filter(w => w.length > 0 && !/<[^>]*>/.test(w)).length,
    };
  }

  return results;
}

// ============================================================
// Benchmark 3: Translation Text Processing Pipeline
// ============================================================

function benchTextProcessing() {
  // Text cleaning and normalization pipeline simulation

  const samples = {
    singleWord: 'algorithm',
    shortPhrase: 'machine learning algorithm',
    sentence: 'The quick brown fox jumps over the lazy dog near the river bank.',
    paragraph: generateText(200),
  };

  const results = {};

  for (const [name, text] of Object.entries(samples)) {
    // Simulate: text cleaning + normalization (what translation pipeline does)
    const stats = bench(() => {
      // Clean and normalize
      const cleaned = text.replace(/[^\w\s.,!?;:'"()-]/g, '').trim();
      // Split sentences (simulating what happens before translation)
      const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 0);
      // Word frequency analysis (for vocabulary lookup)
      const freq = {};
      for (const word of cleaned.toLowerCase().split(/\s+/)) {
        if (word.length > 0) freq[word] = (freq[word] || 0) + 1;
      }
      return { sentences: sentences.length, uniqueWords: Object.keys(freq).length };
    }, 50);

    results[name] = {
      ...stats,
      charCount: text.length,
    };
  }

  return results;
}

// ============================================================
// Benchmark 4: Tooltip UI Operations (simulated)
// ============================================================

function benchTooltipOperations() {
  // Simulate tooltip creation/destruction operations
  // In a real browser, this would measure DOM manipulation + rendering

  const tooltipData = {
    word: 'algorithm',
    translation: '算法 - 一种解决问题的步骤或方法',
    pronunciation: '/ˈælɡəˌrɪðəm/',
    partOfSpeech: 'noun',
    examples: ['The sorting algorithm runs in O(n log n) time.'],
  };

  const results = {};

  // Simulate: data serialization and template rendering
  results.renderTemplate = bench(() => {
    const template = `
      <div class="tooltip">
        <div class="word">${tooltipData.word}</div>
        <div class="translation">${tooltipData.translation}</div>
        <div class="pronunciation">${tooltipData.pronunciation}</div>
        <div class="pos">${tooltipData.partOfSpeech}</div>
        <div class="examples">${tooltipData.examples.join('<br>')}</div>
      </div>
    `;
    return template.length;
  }, 100);

  // Simulate: position calculation
  results.positionCalc = bench(() => {
    const rect = { x: 450, y: 300, width: 80, height: 20 };
    const tooltipWidth = 320;
    const tooltipHeight = 200;
    const viewportWidth = 1920;
    const viewportHeight = 1080;

    let x = rect.x;
    let y = rect.y + rect.height + 8;

    if (x + tooltipWidth > viewportWidth) x = viewportWidth - tooltipWidth - 8;
    if (y + tooltipHeight > viewportHeight) y = rect.y - tooltipHeight - 8;
    if (x < 8) x = 8;
    if (y < 8) y = 8;

    return { x, y };
  }, 200);

  return results;
}

// ============================================================
// Benchmark 5: Storage Operations Simulation
// ============================================================

function benchStorageOperations() {
  const vocabSize = 500;
  const cacheEntries = {};
  const vocab = {};

  // Pre-populate
  for (let i = 0; i < vocabSize; i++) {
    vocab[`word${i}`] = { translations: ['翻译'], frequency: Math.random(), lastSeen: Date.now() };
  }
  for (let i = 0; i < 100; i++) {
    cacheEntries[`phrase_${i}`] = { result: `翻译结果 ${i}`, timestamp: Date.now() };
  }

  const results = {};

  // Vocabulary lookup
  results.vocabLookup = bench(() => {
    return vocab['word250'] !== undefined;
  }, 500);

  // Cache lookup
  results.cacheLookup = bench(() => {
    return cacheEntries['phrase_42'] !== undefined;
  }, 500);

  // Vocabulary add
  results.vocabAdd = bench(() => {
    vocab[`bench_${Date.now()}_${Math.random()}`] = { translations: ['测试'], frequency: 0.5, lastSeen: Date.now() };
  }, 200);

  // Cache eviction simulation (limit to 100)
  results.cacheEviction = bench(() => {
    const cache = { ...cacheEntries };
    const keys = Object.keys(cache).sort((a, b) => cache[a].timestamp - cache[b].timestamp);
    while (keys.length > 100) {
      delete cache[keys.shift()];
    }
    return Object.keys(cache).length;
  }, 50);

  return results;
}

// ============================================================
// Benchmark 6: Bayesian Update (User Level Estimation)
// ============================================================

function benchBayesianUpdate() {
  // Simulate the Bayesian vocabulary estimation from src/background/userLevel.ts

  function estimateVocabulary(knownWords, testedWords, prior = { alpha: 1, beta: 1 }) {
    const alpha = prior.alpha + knownWords;
    const beta = prior.beta + (testedWords - knownWords);
    const mean = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    return { knownPercent: mean, variance, alpha, beta };
  }

  const scenarios = [
    { name: 'small_sample', known: 45, tested: 50 },
    { name: 'medium_sample', known: 450, tested: 500 },
    { name: 'large_sample', known: 4500, tested: 5000 },
  ];

  const results = {};

  for (const { name, known, tested } of scenarios) {
    results[name] = bench(() => {
      return estimateVocabulary(known, tested);
    }, 1000);
  }

  return results;
}

// ============================================================
// Benchmark 7: Concurrent Operation Stress Test
// ============================================================

function benchConcurrentOperations() {
  // Simulate multiple simultaneous operations
  // (e.g., multiple tooltip renders, concurrent cache lookups)

  const concurrentSizes = [5, 10, 25, 50];
  const results = {};

  for (const n of concurrentSizes) {
    // Simulate n concurrent tooltip operations
    results[`concurrent_${n}`] = bench(() => {
      const ops = [];
      for (let i = 0; i < n; i++) {
        const word = `word${i}`;
        ops.push({
          word,
          position: { x: 100 + i * 30, y: 200 },
          template: `<div class="tooltip">${word}</div>`,
        });
      }
      // Sort by position (simulating layout ordering)
      ops.sort((a, b) => a.position.y - b.position.y);
      return ops.length;
    }, 50);
  }

  return results;
}

// ============================================================
// 主运行器
// ============================================================

async function runAll() {
  console.log('🔍 NotOnlyTranslator 性能基准测试');
  console.log('='.repeat(50));
  console.log(`运行时间: ${new Date().toISOString()}`);
  console.log();

  const allResults = {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    benchmarks: {},
  };

  // 1. Bundle Size
  console.log('📦 Benchmark 1: Bundle Size Analysis...');
  allResults.benchmarks.bundleSize = benchBundleSizes();
  if (allResults.benchmarks.bundleSize.error) {
    console.log(`   ⚠️  ${allResults.benchmarks.bundleSize.error}`);
  } else {
    console.log(`   Total: ${allResults.benchmarks.bundleSize.grandTotalKB} KB`);
    console.log(`   JS: ${allResults.benchmarks.bundleSize.totalJSKB} KB | CSS: ${allResults.benchmarks.bundleSize.totalCSSKB} KB`);
  }

  // 2. DOM Scanning
  console.log('🔍 Benchmark 2: DOM Scanning Simulation...');
  allResults.benchmarks.domScanning = benchDOMScanning();
  for (const [size, r] of Object.entries(allResults.benchmarks.domScanning)) {
    console.log(`   ${size}: ${r.median.toFixed(3)} ms (median, ${r.iterations} iters)`);
  }

  // 3. Text Processing
  console.log('📝 Benchmark 3: Text Processing Pipeline...');
  allResults.benchmarks.textProcessing = benchTextProcessing();
  for (const [name, r] of Object.entries(allResults.benchmarks.textProcessing)) {
    console.log(`   ${name}: ${r.median.toFixed(3)} ms (median)`);
  }

  // 4. Tooltip Operations
  console.log('💬 Benchmark 4: Tooltip UI Operations...');
  allResults.benchmarks.tooltipOperations = benchTooltipOperations();
  for (const [name, r] of Object.entries(allResults.benchmarks.tooltipOperations)) {
    console.log(`   ${name}: ${r.median.toFixed(3)} ms (median)`);
  }

  // 5. Storage Operations
  console.log('💾 Benchmark 5: Storage Operations...');
  allResults.benchmarks.storageOperations = benchStorageOperations();
  for (const [name, r] of Object.entries(allResults.benchmarks.storageOperations)) {
    console.log(`   ${name}: ${r.median.toFixed(3)} ms (median)`);
  }

  // 6. Bayesian Update
  console.log('📊 Benchmark 6: Bayesian Vocabulary Estimation...');
  allResults.benchmarks.bayesianUpdate = benchBayesianUpdate();
  for (const [name, r] of Object.entries(allResults.benchmarks.bayesianUpdate)) {
    console.log(`   ${name}: ${r.median.toFixed(3)} ms (median, ${r.iterations} iters)`);
  }

  // 7. Concurrent Operations
  console.log('⚡ Benchmark 7: Concurrent Operation Stress Test...');
  allResults.benchmarks.concurrentOperations = benchConcurrentOperations();
  for (const [name, r] of Object.entries(allResults.benchmarks.concurrentOperations)) {
    console.log(`   ${name}: ${r.median.toFixed(3)} ms (median)`);
  }

  // Save results
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(allResults, null, 2));
  console.log();
  console.log(`📁 结果已保存到 ${RESULTS_FILE}`);

  return allResults;
}

runAll().catch(console.error);
