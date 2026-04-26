# NotOnlyTranslator 性能基准测试报告

> 基准日期: 2026-04-26
> 测试环境: macOS Darwin 25.2.0, Node.js v25.8.1
> 扩展版本: 45f0190 (main)

---

## 概要

| 指标 | 结果 | 评级 |
|------|------|------|
| 总包体积 | 1,956 KB | ⚠️ 偏大 |
| JS 体积 | 1,761 KB | ⚠️ 偏大 |
| CSS 体积 | 166 KB | ✅ 合理 |
| 页面扫描 (5000 词) | 0.9 ms | ✅ 优秀 |
| 文本处理 (200 词) | 0.04 ms | ✅ 优秀 |
| 词汇查找 | < 0.01 ms | ✅ 优秀 |
| Bayesian 估算 | < 0.01 ms | ✅ 优秀 |
| 频率分析 (14 词) | 0.005 ms | ✅ 优秀 |

---

## 基准测试体系

项目包含两套基准测试系统：

### 1. Node.js 模拟基准测试 (`benchmarks/run.js`)

模拟扩展核心操作在不同规模下的性能表现，覆盖 7 大套件：

- Bundle Size Analysis（构建体积分析）
- DOM Scanning Simulation（DOM 扫描模拟）
- Text Processing Pipeline（文本处理管道）
- Tooltip UI Operations（Tooltip 操作）
- Storage Operations（存储操作）
- Bayesian Vocabulary Estimation（Bayesian 词汇估算）
- Concurrent Operation Stress Test（并发压力测试）

### 2. Vitest 真实基准测试 (`vitest bench`)

直接引用项目源码的真实性能测试，覆盖 4 大套件：

- **text-processing.bench.ts** — 文本归一化、上下文提取、中文比例、JSON 提取、翻译结果合并、Debounce/Throttle
- **vocabulary.bench.ts** — 词汇量计算、Bayesian 更新、词频预测、缓存键生成
- **frequency-analysis.bench.ts** — 词汇难度查找、简单词检测、频率排名、翻译需求检测
- **lru-cache.bench.ts** — LRU 缓存的 O(1) 操作、批量查询、淘汰
- **algorithms.bench.ts** — Diff 算法、字符串操作

### Vitest 基准测试结果摘要

| 测试套件 | 最快操作 (mean) | 最慢操作 (mean) |
|----------|----------------|-----------------|
| 文本归一化 | 0.0004 ms (short) | 0.001 ms (long) |
| 上下文提取 | 0.0001 ms (center) | 0.0001 ms (end) |
| 中文比例 | 0.0002 ms (empty) | 0.0008 ms (mixed) |
| JSON 提取 | 0.0002 ms (plain) | 0.0007 ms (repair) |
| 词汇量计算 | 0.0001 ms (CET-4) | 0.0002 ms (GRE) |
| Bayesian 更新 | 0.0002 ms (medium) | 0.0003 ms (low conf) |
| 词汇难度查找 | 0.0002 ms (TOEFL) | 0.0002 ms (CET-6) |
| 翻译需求检测 | 0.0051 ms (simple) | 0.0062 ms (complex) |
| LRU 缓存操作 | 见下方 | 见下方 |

---

## 1. Bundle Size 分析

### 总体

- **总包体积**: 1,956 KB
- **JS**: 1,761 KB (89.9%)
- **CSS**: 166 KB (8.5%)
- **其他**: 33 KB (1.6%)
- **文件数**: 35+

### 最大文件 (Top 10)

| 文件 | 大小 (KB) | 类型 |
|------|-----------|------|
| options-DhVZbYRb.js | 437 | Options 页面 |
| with-selector-BE381vd-.js | 297 | 选择器组件 |
| index.ts-D2g4mQ6d.js | 117 | 共享工具 |
| index.ts-370oVde2.js | 91 | 背景脚本 |
| popup-CMbT0K6E.js | 86 | Popup 页面 |
| MasteryOverview-CAijYZHL.js | 59 | 掌握度面板 |
| GeneralSettings-nAb5TKH_.js | 57 | 设置面板 |
| ApiSettings-5RyrJ_ha.js | 47 | API 设置 |
| LearningStatistics-OsxUKRh5.js | 42 | 统计面板 |
| CostDashboard-DKiSpv4L.js | 39 | 费用面板 |

### 优化建议

- Options 页面 (437 KB) 可能包含未 tree-shake 的组件
- Popup 页面 86 KB 属于可接受范围
- `with-selector` (297 KB) 包含选择器逻辑，可评估是否按需加载

---

## 2. DOM 扫描性能

模拟 Content Script 的 DOM 文本提取和处理流程：

| 页面规模 | 词数 | 中位数延迟 | 95 百分位 | 评级 |
|----------|------|------------|-----------|------|
| 小页面 | ~100 | 0.029 ms | 0.034 ms | ✅ 优秀 |
| 中页面 | ~1,000 | 0.172 ms | 0.181 ms | ✅ 优秀 |
| 大页面 | ~5,000 | 1.139 ms | 1.316 ms | ✅ 优秀 |

### 分析

- 扫描耗时与词数呈线性关系 (~0.2ms/1000 词)
- 对于绝大多数网页 (< 5000 词)，扫描延迟 < 2ms
- **瓶颈不在 CPU，而在 DOM API 调用次数**

---

## 3. 文本处理管道

| 输入规模 | 字符数 | 中位数延迟 | 评级 |
|----------|--------|------------|------|
| 单词 | 9 | 0.001 ms | ✅ 优秀 |
| 短语 | 24 | 0.002 ms | ✅ 优秀 |
| 句子 | 69 | 0.005 ms | ✅ 优秀 |
| 段落 | ~1,200 | 0.048 ms | ✅ 优秀 |

### 分析

- 文本清洗 + 句子分割 + 词频分析总计 < 0.05ms
- 不会成为性能瓶颈

---

## 4. Tooltip UI 操作

| 操作 | 中位数延迟 | 评级 |
|------|------------|------|
| 模板渲染 | < 0.01 ms | ✅ 优秀 |
| 位置计算 | < 0.01 ms | ✅ 优秀 |

### 分析

- CPU 计算部分可忽略不计
- 实际延迟来自浏览器渲染管线（layout + paint）
- 后续应使用浏览器性能 API 测量实际渲染延迟

---

## 5. 存储操作

| 操作 | 样本量 | 中位数延迟 | 评级 |
|------|--------|------------|------|
| 词汇查找 | 500 词 | < 0.01 ms | ✅ 优秀 |
| 缓存查找 | 100 条目 | < 0.01 ms | ✅ 优秀 |
| 词汇添加 | 500 词 | 0.002 ms | ✅ 优秀 |
| 缓存淘汰 | 100→100 | 0.046 ms | ✅ 优秀 |

### 分析

- 内存中的操作非常快
- 实际性能瓶颈是 Chrome Storage API 的异步调用
- Chrome Storage 写入延迟通常 5-50ms

---

## 6. Bayesian 词汇量估算

| 样本量 | 已掌握/已测试 | 中位数延迟 | 评级 |
|--------|--------------|------------|------|
| 小 | 45/50 | < 0.01 ms | ✅ 优秀 |
| 中 | 450/500 | < 0.01 ms | ✅ 优秀 |
| 大 | 4500/5000 | < 0.01 ms | ✅ 优秀 |

### 分析

- Bayesian 估算的计算复杂度为 O(1)
- 不会成为性能瓶颈

---

## 7. 并发操作压力测试

| 并发数 | 中位数延迟 | 评级 |
|--------|------------|------|
| 5 | 0.002 ms | ✅ 优秀 |
| 10 | 0.003 ms | ✅ 优秀 |
| 25 | 0.006 ms | ✅ 优秀 |
| 50 | 0.003 ms | ✅ 优秀 |

### 分析

- 内存中并发操作处理非常快
- 实际限制因素是浏览器单线程事件循环

---

## 性能瓶颈总结

基于基准测试结果，CPU 计算**不是**该扩展的性能瓶颈。

### 实际瓶颈预期（待浏览器测量验证）

1. **Chrome Storage 异步 I/O** — 每次读写 5-50ms
2. **LLM API 调用延迟** — 网络延迟主导（通常 500ms-3s）
3. **DOM 操作次数** — 高亮大量单词时的 DOM 写入次数
4. **页面重排/重绘** — 频繁操作 DOM 时的浏览器渲染开销

### 后续验证计划

1. 使用 Chrome DevTools Performance API 测量实际渲染延迟
2. 使用 Performance Observer 测量 Service Worker 内存占用
3. 使用 Lighthouse 评估扩展对页面加载性能的影响

---

## 运行方法

```bash
# Node.js 模拟基准测试
npm run build                    # 确保 dist/ 是最新的
node benchmarks/run.js           # 运行 7 大套件基准测试

# Vitest 真实代码基准测试
npm run benchmark                # 运行 Vitest 基准测试（引用真实源码）

# 性能预算检查
npm run perf:check               # 运行基准测试 + 预算达标检查

# 性能回归检测
npm run perf:regression          # 对比当前结果与基线，检测回归
```

### 输出文件

| 文件 | 来源 | 用途 |
|------|------|------|
| `benchmarks/results.json` | Node.js 基准测试 | 基线数据 + 回归对比 |
| `benchmark/results/performance-report.json` | Vitest 基准测试 | 详细性能报告 |

### CI 集成

在 CI/CD 流水线中添加性能门禁：

```yaml
# 示例 GitHub Actions
- name: Performance Budget Check
  run: npm run perf:check
  # 退出码 1 = 预算超标，CI 失败

- name: Performance Regression Check
  run: npm run perf:regression
  # 退出码 1 = 发现回归，需要审批
```

### 性能预算阈值

| 指标 | 上限 | 说明 |
|------|------|------|
| 总包体积 | 2,500 KB | 硬性限制 |
| JS 总体积 | 2,000 KB | 硬性限制 |
| DOM 扫描 (5000 词) | 5.0 ms | 中位数 |
| 词汇查找 | 0.005 ms | 中位数 |
| 缓存淘汰 | 0.1 ms | 中位数 |

### 回归检测

回归阈值设为 **15%**。任何指标超过基线 15% 将被标记为回归，需：
1. 确认是否为真实的性能退化
2. 分析退化原因（新功能、重构、依赖升级）
3. 如果是预期的改进空间，更新基线
4. 如果是意外退化，修复后再合并
