# Founding Engineer 任务分配

## 当前任务: 待分配 📋

暂无进行中的任务。请查看下方的待办任务列表。

---

## 待办任务

### 📋 US-004: 实现 Background Service Worker 核心功能
**描述**: 实现后台服务工作线程的核心功能，包括消息路由、翻译API调用、词汇管理等。
**优先级**: High
**估计工时**: 8 小时
**依赖**: US-003 已完成

---

## 已完成的任务

### ✅ US-003: 整合 Content Script 模块
**状态**: 已完成 ✓
**实际工时**: 6 小时
**完成时间**: 2026-03-15

将 PageScanner、VocabularyFilter、Highlighter 和 Tooltip 整合到主 Content Script 入口，实现完整的页面翻译功能。

**完成的功能**:
- ✅ 整合 PageScanner 页面扫描器
- ✅ 整合 VocabularyFilter 词汇过滤
- ✅ 整合 Highlighter 高亮渲染器
- ✅ 整合 Tooltip 翻译提示框
- ✅ 实现消息通信处理
- ✅ 实现页面扫描和翻译流程
- ✅ 编写单元测试 (37 个测试全部通过)

**文件位置**:
- 主入口: `src/content/index.ts` (1285 行)
- 测试: `tests/unit/content/index.test.ts` (37 个测试通过)

---

---

## 待办任务

### 📋 US-003: 整合 Content Script 模块
**描述**: 将 PageScanner、VocabularyFilter、Highlighter 和 Tooltip 整合到主 Content Script 中。
**优先级**: High
**估计工时**: 6 小时
**依赖**: US-001, US-002 已完成

---

## 已完成的任务

### ✅ US-002-T1: Tooltip 组件
**状态**: 已完成 ✓
**实际工时**: 4 小时
**完成时间**: 2026-03-15

实现 Tooltip 组件，当用户悬停或点击高亮单词时显示翻译详情。

**完成的功能**:
- ✅ 悬停高亮单词时显示 Tooltip
- ✅ 显示单词翻译、难度等级（简单/中等/困难）
- ✅ 提供"标记已知"(K)、"标记未知"(U)、"加入生词本"(A)按钮
- ✅ 支持点击外部关闭 Tooltip
- ✅ 自动定位（避免超出视口，支持上下翻转）
- ✅ 钉住功能（滚动时保持可见）
- ✅ 快捷键帮助面板
- ✅ 句子翻译和语法说明支持

**文件位置**:
- 实现: `src/content/tooltip.ts` (705 行)
- 测试: `tests/unit/content/tooltip.test.ts` (47 个测试全部通过)

---

### ✅ US-001-T2: VocabularyFilter 词汇过滤服务
**状态**: 已完成 ✓
**实际工时**: 3 小时
**完成时间**: 2026-03-14

实现一个词汇过滤服务，根据用户的英语水平，从扫描的段落中筛选出需要翻译的生僻词。

**完成的功能**:
- ✅ 接收 `Paragraph[]` 和 `UserProfile`，返回应高亮的单词列表
- ✅ 使用 `FrequencyManager` 判断单词难度
- ✅ 只返回难度高于用户水平的单词
- ✅ 支持词汇去重（同一单词在页面中只高亮一次）
- ✅ 支持已知词汇过滤（用户已标记为已知的单词跳过）

**文件位置**:
- 实现: `src/content/vocabularyFilter.ts` (292 行)
- 测试: `tests/unit/content/vocabularyFilter.test.ts` (29 个测试通过)

---

### ✅ US-001-T3: Highlighter 高亮渲染器
**状态**: 已完成 ✓
**实际工时**: 2 小时
**完成时间**: 2026-03-14

实现高亮渲染器，在 DOM 中高亮显示筛选出的单词。

**完成的功能**:
- ✅ 高亮单词（使用 span 包裹并添加 CSS 类）
- ✅ 支持大小写不敏感匹配
- ✅ 标记单词为已知/未知（添加不同 CSS 类）
- ✅ 移除单个单词高亮
- ✅ 清除所有高亮
- ✅ 获取已高亮单词列表

**文件位置**:
- 实现: `src/content/highlighter.ts` (232 行)
- 测试: `tests/unit/content/highlighter.test.ts` (9 个测试通过)

---

## 提交规范

提交时使用以下格式:
```
feat(content): implement VocabularyFilter service

- Add VocabularyFilter class to filter words based on user level
- Implement stop word exclusion and word deduplication
- Integrate with FrequencyManager for difficulty calculation
- Include unit tests

Refs: US-001-T2
Co-Authored-By: Paperclip <noreply@paperclip.ing>
```

---

## 下一步

完成此任务后，继续:
- **US-001-T3**: 实现高亮渲染器 (Highlighter)

