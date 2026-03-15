# NotOnlyTranslator 技术设计文档 (TDD)

> 版本: 1.0.0
> 日期: 2026-03-14
> 作者: CTO

## 1. 概述

### 1.1 项目简介

NotOnlyTranslator 是一个 Chrome/Edge 浏览器扩展，根据用户的英语水平智能翻译英文内容。它只翻译超出用户当前水平的单词，帮助英语学习者自然地阅读，同时扩展词汇量。

### 1.2 核心价值主张

- **个性化学习**: 基于用户词汇量的智能翻译
- **上下文保留**: 保持原文语境，仅翻译必要词汇
- **渐进式学习**: 通过标记已学词汇跟踪进步

### 1.3 目标用户

- 中高级英语学习者
- 需要阅读英文内容但词汇量有限的用户
- 希望扩展词汇量的专业人士

---

## 2. 系统架构

### 2.1 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │   Popup UI  │  │  Options UI │  │     Content Script      │ │
│  │  (React)    │  │   (React)   │  │  (Page Injection)       │ │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘ │
│         │                │                     │               │
│         └────────────────┴─────────────────────┘               │
│                          │                                     │
│         ┌────────────────┴─────────────────────┐               │
│         │     Background Service Worker        │               │
│         │  ┌───────────┐ ┌───────────┐        │               │
│         │  │  Message  │ │  Storage  │        │               │
│         │  │  Routing  │ │  Manager  │        │               │
│         │  └─────┬─────┘ └─────┬─────┘        │               │
│         │        └─────────────┘               │               │
│         │  ┌───────────┐ ┌───────────┐        │               │
│         │  │Translation│ │  User     │        │               │
│         │  │  Service  │ │  Level    │        │               │
│         │  └───────────┘ └───────────┘        │               │
│         └────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                      External Services                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  OpenAI API  │  │ Anthropic API│  │  Chrome Storage API  │  │
│  │  (GPT-4o)    │  │ (Claude)     │  │  (Sync + Local)      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 组件说明

#### Content Script (内容脚本)
- **职责**: 页面内容扫描、DOM高亮、用户交互
- **关键类**: `NotOnlyTranslator` - 主控制器
- **生命周期**: `init()` → `scan()` → `highlight()` → `destroy()`

#### Background Service Worker
- **职责**: 消息路由、LLM API调用、存储管理
- **关键模块**:
  - `translation.ts` - 翻译服务
  - `storage.ts` - Chrome Storage封装
  - `userLevel.ts` - 用户水平估算

#### Popup/Options UI
- **职责**: 用户设置、状态显示
- **技术栈**: React + Tailwind CSS + Zustand

### 2.3 消息流

```
1. 页面扫描
   Content Script ──scan──> Background ──API──> LLM Service
                                      <─trans─
                        <─result─

2. 用户交互
   User Click ──> Content Script ──> Tooltip UI
                        │
                        └──> Background ──> Update User Level

3. 设置同步
   Options UI ──> Chrome Sync Storage ──> All Components
```

---

## 3. 技术栈

### 3.1 核心栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 运行时 | Chrome Extension Manifest V3 | - | 浏览器扩展框架 |
| 构建工具 | Vite | ^5.x | 构建和HMR |
| 插件 | @crxjs/vite-plugin | ^2.x | Chrome扩展打包 |
| 前端框架 | React | ^18.x | UI组件 |
| 语言 | TypeScript | ^5.x | 类型安全 |
| 样式 | Tailwind CSS | ^3.x | 原子化CSS |
| 状态管理 | Zustand | ^4.x | 全局状态 |

### 3.2 开发工具

| 工具 | 用途 |
|------|------|
| ESLint | 代码规范 |
| Prettier | 代码格式化 |
| Playwright | E2E测试 |
| Vitest | 单元测试 |

### 3.3 外部依赖

| 服务 | 用途 |
|------|------|
| OpenAI API (GPT-4o-mini) | 默认翻译服务 |
| Anthropic API (Claude) | 备选翻译服务 |
| Chrome Storage API | 数据持久化 |

---

## 4. 数据模型

### 4.1 用户配置

```typescript
interface UserProfile {
  id: string
  nativeLanguage: string        // 母语
  currentLevel: CEFRLevel       // CEFR等级 (A1-C2)
  estimatedVocabulary: number   // 估算词汇量
  learningGoal: LearningGoal     // 学习目标
  createdAt: number
  updatedAt: number
}

type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

interface LearningGoal {
  type: 'exam' | 'career' | 'travel' | 'general'
  targetLevel?: CEFRLevel
  deadline?: number
}
```

### 4.2 词汇表

```typescript
interface VocabularyEntry {
  word: string
  normalized: string          // 标准化形式（小写、原形）
  level: CEFRLevel          // CEFR等级
  frequency: number          // 使用频率 (0-1)
  translations: Translation[]
  addedAt: number
  lastReviewedAt?: number
  reviewCount: number
  masteryLevel: number      // 0-5，基于复习历史
}

interface Translation {
  language: string
  meaning: string
  context?: string
  partOfSpeech?: string
}
```

### 4.3 翻译缓存

```typescript
interface TranslationCache {
  id: string
  sourceText: string
  sourceHash: string          // SHA256(sourceText)
  userLevel: CEFRLevel
  result: TranslationResult
  createdAt: number
  expiresAt: number           // 默认30天
}

interface TranslationResult {
  translatedText: string
  translatedSegments: TranslatedSegment[]
  detectedLevel?: CEFRLevel
  confidence: number
}

interface TranslatedSegment {
  original: string
  translation?: string
  isTranslated: boolean
  wordLevel?: CEFRLevel
}
```

### 4.4 用户词汇追踪

```typescript
interface UserWordTracking {
  userId: string
  word: string
  status: 'known' | 'learning' | 'unknown'
  firstEncounteredAt: number
  markedAt: number
  updatedAt: number
  encounterCount: number
  contextExamples: ContextExample[]
}

interface ContextExample {
  url: string
  surroundingText: string
  timestamp: number
}
```

---

## 5. API 设计

### 5.1 Chrome 消息协议

```typescript
// 消息类型定义
enum MessageType {
  // 翻译相关
  TRANSLATE_TEXT = 'TRANSLATE_TEXT',
  TRANSLATE_BATCH = 'TRANSLATE_BATCH',

  // 词汇管理
  MARK_WORD_KNOWN = 'MARK_WORD_KNOWN',
  MARK_WORD_UNKNOWN = 'MARK_WORD_UNKNOWN',
  ADD_TO_VOCABULARY = 'ADD_TO_VOCABULARY',
  REMOVE_FROM_VOCABULARY = 'REMOVE_FROM_VOCABULARY',

  // 用户配置
  GET_USER_PROFILE = 'GET_USER_PROFILE',
  UPDATE_USER_PROFILE = 'UPDATE_USER_PROFILE',

  // 设置
  GET_SETTINGS = 'GET_SETTINGS',
  UPDATE_SETTINGS = 'UPDATE_SETTINGS',

  // 词汇表
  GET_VOCABULARY = 'GET_VOCABULARY',
  GET_WORD_STATUS = 'GET_WORD_STATUS'
}

// 通用消息格式
interface ChromeMessage<T = unknown> {
  type: MessageType
  payload?: T
  requestId?: string
  timestamp?: number
}

// 响应格式
interface ChromeResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  requestId?: string
  timestamp: number
}
```

### 5.2 消息处理示例

```typescript
// Content Script 发送消息
async function translateText(text: string): Promise<TranslationResult> {
  const response = await chrome.runtime.sendMessage({
    type: 'TRANSLATE_TEXT',
    payload: { text, targetLevel: userLevel }
  })

  if (!response.success) {
    throw new Error(response.error)
  }

  return response.data
}

// Background 处理消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message }))

  return true // 保持通道开放
})
```

---

## 6. 存储策略

### 6.1 Chrome Storage 分区

| 存储区域 | 用途 | 配额 | 同步 |
|---------|------|------|------|
| `chrome.storage.sync` | 用户配置、API密钥 | 100KB | 是 |
| `chrome.storage.local` | 词汇表、翻译缓存 | 5MB | 否 |
| `IndexedDB` | 大型缓存数据 | 可用空间 | 否 |

### 6.2 存储键名规范

```typescript
const StorageKeys = {
  // Sync Storage
  USER_PROFILE: 'not_only_translator:user_profile',
  SETTINGS: 'not_only_translator:settings',
  API_KEY: 'not_only_translator:api_key',

  // Local Storage
  VOCABULARY_KNOWN: 'not_only_translator:vocabulary:known',
  VOCABULARY_LEARNING: 'not_only_translator:vocabulary:learning',
  TRANSLATION_CACHE: 'not_only_translator:cache:translations',
  CACHE_METADATA: 'not_only_translator:cache:metadata'
} as const
```

### 6.3 缓存策略

```typescript
interface CacheConfig {
  maxEntries: number        // 最大条目数
  ttl: number              // 生存时间 (毫秒)
  evictionPolicy: 'lru' | 'fifo' | 'lfu'
}

const DEFAULT_CACHE_CONFIG: CacheConfig = {
  maxEntries: 1000,
  ttl: 30 * 24 * 60 * 60 * 1000, // 30天
  evictionPolicy: 'lru'
}
```

---

## 7. 开发流程

### 7.1 Git 工作流

```
main (protected)
  │
  ├── feature/user-authentication
  ├── feature/translation-cache
  ├── bugfix/memory-leak
  │
  └── (merged via PR)
```

**分支命名规范**:
- `feature/` - 新功能
- `bugfix/` - 错误修复
- `refactor/` - 代码重构
- `docs/` - 文档更新

### 7.2 提交信息规范

```
<type>: <subject>

<body>

<footer>
```

**Type 类型**:
- `feat`: 新功能
- `fix`: 修复
- `docs`: 文档
- `style`: 格式
- `refactor`: 重构
- `test`: 测试
- `chore`: 构建

### 7.3 代码审查流程

1. 开发者创建 PR
2. 自动化检查 (CI/CD)
3. 代码审查 (至少1人)
4. 测试通过
5. 合并到主分支

---

## 8. 测试策略

### 8.1 测试金字塔

```
    /\
   /  \
  / E2E \     <- 少量关键路径测试
 /________\
/          \
/ Integration \  <- 组件/服务集成
/________________\
/                  \
/    Unit Tests      \  <- 大量单元测试
/______________________\
```

### 8.2 测试覆盖目标

| 类型 | 目标覆盖率 | 工具 |
|------|-----------|------|
| 单元测试 | 80%+ | Vitest |
| 集成测试 | 60%+ | Vitest |
| E2E测试 | 关键路径 | Playwright |

### 8.3 关键测试场景

**单元测试**:
- 词汇级别估算算法
- 翻译结果解析
- 存储操作
- 消息处理

**集成测试**:
- Chrome消息传递
- 存储读写
- API调用（mock）

**E2E测试**:
- 扩展安装和初始化
- 页面翻译流程
- 设置修改
- 词汇标记

---

## 9. 部署和发布

### 9.1 构建流程

```bash
# 开发构建
npm run dev

# 生产构建
npm run build

# 类型检查
npm run type-check

# 代码检查
npm run lint
```

### 9.2 发布流程

**Chrome Web Store**:
1. 构建生产版本
2. 打包 `dist/` 目录
3. 上传到 Chrome Web Store Developer Dashboard
4. 提交审核
5. 发布

**Edge Add-ons**:
1. 打包扩展
2. 上传到 Microsoft Partner Center
3. 提交审核
4. 发布

### 9.3 版本号规范

遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/):

```
主版本号.次版本号.修订号
```

- **主版本号**: 不兼容的API修改
- **次版本号**: 向下兼容的功能添加
- **修订号**: 向下兼容的问题修复

---

## 10. 安全和隐私

### 10.1 安全考量

| 类别 | 措施 |
|------|------|
| API密钥 | 加密存储在 Chrome Storage |
| 数据传输 | HTTPS -only |
| 内容安全 | CSP 策略 |
| 权限最小化 | 仅申请必要权限 |

### 10.2 隐私保护

- 用户数据本地存储，不上传服务器
- 翻译内容仅在翻译时发送至LLM API
- 不收集用户浏览历史
- 提供数据导出/删除功能

### 10.3 权限清单

```json
{
  "permissions": [
    "storage",           // 数据存储
    "activeTab",         // 当前标签页
    "contextMenus",      // 右键菜单
    "scripting"          // 脚本注入
  ],
  "host_permissions": [
    "https://api.openai.com/*",
    "https://api.anthropic.com/*"
  ]
}
```

---

## 11. 附录

### 11.1 术语表

| 术语 | 解释 |
|------|------|
| CEFR | 欧洲语言共同参考框架 (A1-C2) |
| LLM | 大语言模型 (如 GPT-4o, Claude) |
| MV3 | Chrome Extension Manifest V3 |
| CSP | 内容安全策略 |

### 11.2 参考资源

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [CEFR Level Descriptors](https://www.coe.int/en/web/common-european-framework-reference-languages/level-descriptions)

### 11.3 变更历史

| 版本 | 日期 | 作者 | 变更内容 |
|------|------|------|----------|
| 1.0.0 | 2026-03-14 | CTO | 初始版本 |

---

**文档结束**

*本文档由 NotOnlyTranslator CTO 维护。如有问题，请通过 Paperclip 联系。*
