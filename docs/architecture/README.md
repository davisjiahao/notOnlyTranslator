# 系统架构文档

## 概述

NotOnlyTranslator 是一个基于 Chrome Extension Manifest V3 的浏览器扩展，用于帮助英语学习者智能翻译英文内容。

## 系统架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser Page                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Content Script (src/content/)                 │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌─────────────────────┐  │  │
│  │  │ Page Scanner│  │Highlighter│  │  Translation Tooltip│  │  │
│  │  └─────────────┘  └──────────┘  └─────────────────────┘  │  │
│  │  ┌─────────────┐  ┌──────────┐  ┌─────────────────────┐  │  │
│  │  │Hover Manager│  │BatchTrans│  │  Viewport Observer  │  │  │
│  │  └─────────────┘  └──────────┘  └─────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Background Service Worker (src/background/)         │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ Message      │  │ Translation  │  │    Storage Manager      │ │
│  │ Router       │  │ Service      │  │    (Static Class)       │ │
│  └──────────────┘  └──────────────┘  └─────────────────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐ │
│  │ User Level   │  │ Context Menu │  │    Vocabulary Manager   │ │
│  │ Estimator    │  │ Handler      │  │                           │ │
│  └──────────────┘  └──────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         External APIs                           │
│     OpenAI GPT-4o-mini │ Anthropic Claude │ Custom Endpoint      │
└─────────────────────────────────────────────────────────────────┘
```

## 模块说明

### Content Script (内容脚本)

内容脚本是扩展的核心用户界面层，负责页面文本分析和翻译展示。

| 模块 | 职责 | 文件 |
|------|------|------|
| `NotOnlyTranslator` | 主类，协调所有模块 | `index.ts` |
| `PageScanner` | 扫描页面文本段落 | `core/pageScanner.ts` |
| `Highlighter` | 高亮标记已知/未知单词 | `highlighter.ts` |
| `Tooltip` | 显示翻译结果的浮动提示 | `tooltip.ts` |
| `HoverManager` | 处理鼠标悬停事件 | `core/hoverManager.ts` |
| `BatchTranslationManager` | 批量翻译管理 | `batchTranslationManager.ts` |
| `ViewportObserver` | 观察可见区域段落 | `viewportObserver.ts` |
| `TranslationDisplay` | 翻译结果展示 | `translationDisplay.ts` |

### Background Service Worker (后台服务)

后台服务负责处理LLM API调用、存储管理和消息路由。

| 模块 | 职责 | 文件 |
|------|------|------|
| `StorageManager` | 静态类，管理所有存储操作 | `storage.ts` |
| `TranslationService` | 调用LLM API进行翻译 | `translation.ts` |
| `UserLevelEstimator` | 基于贝叶斯更新的词汇量估算 | `userLevel.ts` |
| `FrequencyManager` | 词频数据管理 | `frequencyManager.ts` |
| `VocabularyManager` | 词汇库管理 | `vocabularyManager.ts` |

## 消息通信

Content Script 和 Background 之间通过 Chrome Runtime Messaging 通信：

```
Content Script                          Background
     │                                      │
     │  chrome.runtime.sendMessage()      │
     │ ─────────────────────────────────>   │
     │                                      │
     │         {type, payload}              │
     │                                      │ 处理请求
     │                                      │
     │   sendResponse()                     │
     │ <─────────────────────────────────   │
     │                                      │
     │        {success, data}                 │
```

### 主要消息类型

| 消息类型 | 发送方 | 接收方 | 说明 |
|---------|--------|--------|------|
| `TRANSLATE_TEXT` | Content | Background | 请求翻译文本 |
| `GET_USER_PROFILE` | Popup | Background | 获取用户档案 |
| `UPDATE_USER_PROFILE` | Popup | Background | 更新用户档案 |
| `GET_SETTINGS` | Content/Popup | Background | 获取设置 |
| `UPDATE_SETTINGS` | Popup | Background | 更新设置 |
| `MARK_WORD_KNOWN` | Content | Background | 标记单词为已掌握 |
| `MARK_WORD_UNKNOWN` | Content | Background | 标记单词为生词 |
| `GET_VOCABULARY` | Popup | Background | 获取词汇表 |

## 存储架构

### Chrome Storage 分区

```
┌─────────────────────────────────────────────────────────┐
│  chrome.storage.sync (云同步)                             │
│  ├─ userProfile (考试类型、分数、词汇量估算)              │
│  ├─ settings (设置选项)                                  │
│  ├─ apiKey (加密存储的API密钥)                           │
│  └─ 限制: 100KB 总计                                     │
├─────────────────────────────────────────────────────────┤
│  chrome.storage.local (本地存储)                          │
│  ├─ knownWords[] (已掌握单词列表，10K-50K个)              │
│  ├─ unknownWords[] (生词表，含翻译和例句)                 │
│  ├─ translationCache{} (翻译缓存，最多1000条)              │
│  └─ 限制: 约5MB 或更多                                     │
└─────────────────────────────────────────────────────────┘
```

### 存储管理策略

1. **词频分级缓存**: 高频词缓存在内存中，低频词按需加载
2. **LRU缓存策略**: 翻译缓存使用LRU算法，保持最多1000条
3. **压缩存储**: 单词列表使用前缀压缩存储
4. **增量同步**: 只同步变更数据，减少云存储使用

## 技术栈

| 类别 | 技术 | 说明 |
|------|------|------|
| 运行时 | Chrome Extension Manifest V3 | 浏览器扩展API |
| 构建工具 | Vite 6.x | 快速构建和HMR |
| 打包插件 | @crxjs/vite-plugin | Chrome扩展专用插件 |
| 前端框架 | React 18 | UI组件 |
| 样式 | Tailwind CSS | 原子化CSS |
| 状态管理 | Zustand | 轻量级状态管理 |
| 语言 | TypeScript | 类型安全 |
| 测试 | Vitest | 单元测试框架 |
| E2E测试 | Playwright | 端到端测试 |

## 安全考虑

1. **API密钥存储**: API密钥加密存储在chrome.storage.sync中
2. **内容安全策略**: 使用CSP限制脚本来源
3. **跨域限制**: 扩展只能访问声明的域名
4. **最小权限原则**: 只请求必要的权限
5. **输入验证**: 所有用户输入都经过验证和清理

## 性能优化

1. **虚拟滚动**: 词汇列表使用虚拟滚动显示大量数据
2. **懒加载**: 词频数据按需加载
3. **防抖处理**: 鼠标移动和滚动事件使用防抖
4. **批量操作**: 批量翻译减少API调用次数
5. **缓存策略**: 多级缓存减少重复计算

## 未来扩展

1. **多语言支持**: 支持从其他语言翻译
2. **语音功能**: 添加单词发音
3. **学习模式**: 基于间隔重复的单词复习
4. **统计面板**: 学习进度可视化
5. **社区功能**: 分享和导入词汇表

---

**最后更新**: 2026-03-14
**版本**: v0.1.1
**作者**: NotOnlyTranslator Team
