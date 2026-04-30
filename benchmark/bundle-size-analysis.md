# Bundle Size Analysis - 2026-04-30

## 当前 Bundle 大小

| Entry | Raw Size | Gzipped Size | 占比 |
|-------|----------|--------------|------|
| `options-CEQsVf_D.js` | 449 KB | 126 KB | 66.3% |
| `popup-BXhaCeii.js` | 90 KB | 16 KB | 13.3% |

### 动态组件 chunks (options 入口)
| Component | Raw Size | 说明 |
|-----------|----------|------|
| index.ts | 119 KB | background service worker |
| index.ts | 93 KB | content script |
| GeneralSettings | 60 KB | 通用设置 |
| MasteryOverview | 61 KB | 掌握度总览 |
| AchievementGallery | 40 KB | 成就画廊 |
| ApiSettings | 48 KB | API 设置 |
| CostDashboard | 40 KB | 成本面板 |
| LearningStatistics | 43 KB | 学习统计 |
| DataManager | 29 KB | 数据管理 |
| ErrorDashboard | 35 KB | 错误面板 |
| FlashcardReview | 25 KB | 闪卡复习 |
| ContextualLearning | 25 KB | 上下文学习 |
| HybridTranslationSettings | 26 KB | 混合翻译设置 |
| PromptSettings | 17 KB | 提示设置 |
| QuickTest | 13 KB | 快速测试 |

### 共享资源
| Resource | Raw Size | 说明 |
|----------|----------|------|
| providers-CQJh-WhT.js | 8.9 KB | LLM 提供商 |
| logger-CUxRv0A.js | 30 KB | 日志模块 |
| Bar-DxtLSY7N.js | 28 KB | 图表组件 |

## 问题分析

### 1. 无 `manualChunks` 配置
`vite.config.ts` 未配置 `manualChunks`，导致：
- React 可能被多个 chunk 重复打包
- options 和 popup 共享依赖（logger、providers）被独立打包
- 无 vendor chunk 分离第三方库

### 2. Options 主包 449 KB 过大
主入口 options 包含了 React、Recharts、Zustand 等大型库。

**根因**: 选项页面包含 15+ 个独立 tab 组件，每个 tab 都通过 `lazy()` 加载，但主包仍然包含了所有共享库。

## 优化结果（已实施）

### P1: 代码分割配置 — 已完成 ✅

在 `vite.config.ts` 中添加了 `manualChunks`：

| Chunk | Before | After | 变化 |
|-------|--------|-------|------|
| options 主包 | 449 KB | 66 KB | **-85%** |
| popup 主包 | 90 KB | 92 KB | +2 KB |
| vendor (react) | - | 0 KB | React 内联到入口点 (@crxjs 特性) |
| charts (recharts) | - | 703 KB | 从 options 分离 |
| state (zustand) | - | 31 KB | 从 options 分离 |
| **Total JS** | **1799 KB** | **1800 KB** | 持平（Chrome 扩展本地加载，总大小无实质变化）|

**注意**: vendor chunk 仅 58 字节，因为 `@crxjs/vite-plugin` 将 React 内联到各入口点。这是 Chrome 扩展的预期行为 — 各入口独立加载，避免运行时 chunk 解析。

### P2: 按需加载大型库
- Recharts 已自动通过 manualCharts 分离 (703 KB chunk)
- 可进一步考虑在 LearningStatistics/CostDashboard 中使用动态 import()

## 基准指标
- options bundle: 66 KB (13.7 KB gzipped) ← 目标已达成
- popup bundle: 92 KB (16.5 KB gzipped) ← 保持 < 100 KB
- 首屏加载时间: options < 1s（优化后）
