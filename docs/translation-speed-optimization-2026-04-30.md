# 翻译速度优化分析 (SUP-1157)

> 日期: 2026-04-30
> 状态: Phase 1 已实施 | Phase 2 待排期

---

## 问题描述

用户反馈：**页面滑动时多数都来不及获取译文**，LLM API 一次请求耗时过长。

---

## 当前翻译流水线分析

### 滑动翻译完整路径

```
用户滑动页面
  → IntersectionObserver 检测段落进入视口 (rootMargin: 800px)
  → ViewportObserver.handleIntersection()
  → debounce 300ms 后触发 notifyVisibleParagraphs()
  → BatchTranslationManager.handleVisibleParagraphs()
    → LIFO 队列入队
    → processNextBatches() (最大并发 3 批)
      → processBatch() (15 段落/批, 最大 10000 字符)
        → chrome.runtime.sendMessage BATCH_TRANSLATE_TEXT
          → BatchTranslationService.translateBatch()
            → 缓存查询 (并行)
            → 中文/简单段落过滤
            → TranslationApiService.callWithSystem()  ← LLM API 调用
              → retryWithBackoff (初始延迟 1.5s, 最大重试 3 次)
```

### 延迟拆解

| 阶段 | 耗时 | 说明 |
|------|------|------|
| IntersectionObserver 检测 | ~16ms (1 frame) | 浏览器原生，无法优化 |
| debounce 延迟 | **300ms** | 可优化 ↓ |
| 队列调度 | ~5ms | 可忽略 |
| chrome.runtime.sendMessage | ~5-10ms | 可忽略 |
| 缓存查询 | 5-20ms | 冷命中则跳过 |
| 简单段落过滤 | ~10ms | 可忽略 |
| **LLM API 调用** | **1000-5000ms** | 主要瓶颈 |
| retry 重试 (首次失败) | **1.5s - 20s** | 雪崩风险 |
| 结果渲染 | ~50-200ms | 可优化 |

**总延迟 (冷启动)**: 1.4s - 5.6s (无重试)
**总延迟 (含重试)**: 可达 25s+

### 根本原因

1. **LLM API 网络延迟是物理限制** — OpenAI/Anthropic 等云端 LLM 的响应时间通常在 1-5 秒，无法从客户端侧消除
2. **debounce 300ms 过于保守** — 滑动过程中用户期望更快的响应
3. **最大并发 3 批不够** — 快速滑动时容易堆积
4. **失败重试延迟过长** — 初始 1.5s 等待在批量翻译场景下太长
5. **没有预翻译机制** — 只在段落进入视口才开始翻译
6. **没有乐观渲染** — 用户看到空白直到翻译完成

---

## 优化方案

### Phase 1: 快速优化 (低风险, 高收益) — 本次实施

#### 1.1 缩短 debounce 延迟

- **当前**: `DEFAULT_BATCH_CONFIG.debounceDelay = 300ms`
- **目标**: `150ms`
- **收益**: 减少 150ms 启动延迟
- **风险**: 低 — 150ms 仍然足够合并快速滑动产生的多次事件

#### 1.2 增加最大并发批次数

- **当前**: `MAX_CONCURRENT_BATCHES = 3`
- **目标**: `5`
- **收益**: 快速滑动时可同时处理更多批次，减少排队等待
- **风险**: 低 — 增加 API 并发可能触发 rate limit，但 Chrome 扩展场景下通常不会

#### 1.3 扩大预加载视口

- **当前**: `rootMargin: '800px 0px 800px 0px'`
- **目标**: `'1200px 0px 400px 0px'` (上方更大，下方适中)
- **收益**: 更早开始翻译用户即将看到的內容
- **风险**: 低 — 可能增加少量不必要的翻译

#### 1.4 优化批量翻译重试延迟

- **当前**: `initialDelay: 1500ms, maxDelay: 20000ms`
- **目标**: `initialDelay: 800ms, maxDelay: 10000ms`
- **收益**: 失败重试时减少 40-50% 等待时间
- **风险**: 低 — 减少重试间隔但保留 3 次重试

#### 1.5 增加滑动中取消机制

- **新增**: 当段落离开可视区域且未开始翻译时，从队列中移除
- **收益**: 减少不必要的 API 调用，降低排队
- **风险**: 低

### Phase 2: 中级优化 (中等风险, 高收益) — 后续实施

#### 2.1 翻译结果乐观显示

- 显示 Loading 占位符而非空白
- 逐词显示翻译结果 (流式响应)
- 需要修改 LLM prompt 支持流式输出 + content script 流式渲染

#### 2.2 预翻译引擎

- 在后台静默预翻译页面中常见的高频段落
- 基于 URL 模式和页面结构缓存预测性翻译
- 用户到达前翻译已完成

#### 2.3 混合翻译默认启用

- 当前混合翻译默认 `enabled: false`
- 简单文本使用 DeepL/有道 (200-500ms) 而非 LLM (1-5s)
- 通过 `TextComplexityAnalyzer` 自动路由

### Phase 3: 长期优化

#### 3.1 本地 LLM (Ollama) 集成优化

- 本地 Ollama 模型延迟 < 500ms
- 适合简单词汇翻译
- 需要用户本地安装

#### 3.2 增量翻译

- 不等待整个段落翻译完成，逐词显示
- 需要流式 API 支持

---

## 实施计划

### Phase 1 变更文件

| 文件 | 变更内容 |
|------|---------|
| `src/shared/constants/index.ts` | `debounceDelay: 300 → 150` |
| `src/content/batchTranslationManager.ts` | `MAX_CONCURRENT_BATCHES: 3 → 5` + 队列取消逻辑 |
| `src/content/viewportObserver.ts` | `rootMargin: 800px → 1200px/400px` |
| `src/background/batchTranslation.ts` | `BATCH_RETRY_OPTIONS` 初始延迟优化 |

### 预期效果

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 启动延迟 (debounce) | 300ms | 150ms | -50% |
| 最大并发 | 3 批 | 5 批 | +67% |
| 预加载距离 | 800px | 1200px (上) | +50% |
| 重试初始延迟 | 1500ms | 800ms | -47% |
| **总首次渲染延迟** | ~2-6s | ~1.5-4.5s | **-25%** |

> **注意**: LLM API 本身的延迟 (1-5s) 是外部依赖，无法从客户端优化。上述优化主要减少"翻译开始前的等待时间"和"失败恢复时间"。
> 真正解决"来不及获取译文"的问题需要 Phase 2 的流式渲染和预翻译机制。

---

## 反模式 (明确不做的)

1. **不在客户端缓存 LLM 响应到内存** — 已有 enhancedCache (Chrome Storage)，重复缓存无意义
2. **不做并行 LLM 调用** — 已支持 3→5 并发，更多并发会触发 API rate limit
3. **不使用更激进的 prompt 压缩** — 当前 prompt 已较精简，进一步压缩可能降低翻译质量
