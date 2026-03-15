# Sprint 1 Plan - NotOnlyTranslator

## 目标
完成 Must Have User Stories (#1-4)，交付可工作的翻译演示。

## 时间盒
2 周 (2026-03-14 ~ 2026-03-28)

## 进度总览

| 状态 | 数量 | 任务 |
|-----|------|-----|
| ✅ 已完成 | 7 | US-001-T1~T3, US-002-T1, US-003, US-004, Background SW |
| 🔄 进行中 | 1 | US-002-T2 (测试修复) |
| ⏳ 待开始 | 0 | - |

## 已完成的任务

### ✅ US-001-T1: PageScanner 页面扫描器
- TreeWalker DOM 遍历
- 智能段落检测与去重
- 动态内容监听 (MutationObserver)
- 52 个单元测试通过

### ✅ US-001-T2: VocabularyFilter 词汇过滤服务
- 基于用户水平的词汇难度过滤
- 停用词过滤与去重
- 集成 FrequencyManager
- 29 个单元测试通过

### ✅ US-001-T3: Highlighter 高亮渲染器
- 单词高亮与 CSS 类管理
- 已知/未知单词标记
- 高亮清理与列表获取
- 9 个单元测试通过

### ✅ US-002-T1: Tooltip 组件
- 单词/句子/语法说明展示
- 智能定位与视口检测
- 钉住功能与滚动跟随
- 快捷键支持 (K/U/A/P/Esc)
- 38 个测试 (35 通过, 3 个待修复)

### ✅ US-003: 标记已知/未知单词 (CMP-13)
- **状态**: 已实现
- **实现文件**: `src/background/index.ts`, `src/content/marker.ts`
- **功能**: 通过 Tooltip 快捷键 (K/U) 标记单词，更新用户档案
- **技术实现**: Background 消息路由 `MARK_WORD_KNOWN` / `MARK_WORD_UNKNOWN`

### ✅ US-004: Background Service Worker (CMP-14)
- **状态**: 已实现完成
- **实现文件**: `src/background/index.ts` (386 行)
- **功能**: 23 种消息类型，翻译服务，词汇管理，掌握度系统
- **测试**: 204/204 单元测试通过

## 进行中/待修复的任务

### 🔄 US-002-T2: Tooltip 测试修复
- **问题**: 3 个测试用例缺少 `vi.useFakeTimers()`
- **预计工时**: 30 分钟
- **优先级**: Medium

## 依赖关系
```
US-004 (设置) → US-001 (翻译) → US-002 (详情) → US-003 (标记)
```

## 验收标准
- [x] 页面英文内容根据用户水平智能翻译
- [x] 点击生僻词显示详细翻译信息
- [x] 可标记单词为已知/加入生词本 (US-003) ✅ 已实现
- [x] Options 页面可配置水平和 API Key (US-004) ✅ 已实现

## 当前进度
**Sprint 1 完成度: 95%** (7/7 核心功能完成，仅 3 个测试待修复)

---

## CTO 状态更新 (2026-03-15)

**发现**: US-004 Background Service Worker 在代码审查中确认已完整实现。

- 23 种消息类型全部实现
- 204 个单元测试全部通过
- 额外包含：批量翻译、掌握度系统、词频管理、增强缓存

**调整**: 无需重新开发 US-004，仅需完成 US-002-T2 的 3 个测试修复即可宣布 Sprint 1 完成。
