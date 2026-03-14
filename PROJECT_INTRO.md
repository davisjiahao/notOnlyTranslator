# NotOnlyTranslator 项目介绍

## 目录

- [项目概述](#项目概述)
- [核心功能](#核心功能)
- [技术架构](#技术架构)
- [工作流程](#工作流程)
- [组件说明](#组件说明)
- [数据流](#数据流)
- [LLM 集成](#llm-集成)
- [存储策略](#存储策略)
- [开发指南](#开发指南)

---

## 项目概述

**NotOnlyTranslator** 是一款基于用户英语水平智能翻译的 Chrome/Edge 浏览器扩展。与传统翻译工具翻译所有内容不同，它仅翻译超出用户当前英语水平的单词和短语，帮助英语学习者在自然阅读中扩展词汇量。

### 核心价值主张

- **个性化学习**: 根据用户的英语水平（四六级、托福、雅思、GRE 等）提供定制化翻译
- **渐进式学习**: 只翻译"超出当前水平"的内容，避免信息过载
- **智能适应**: 通过贝叶斯更新算法动态调整用户词汇量估计
- **上下文学习**: 在真实语境中学习新词汇，而非孤立背单词

---

## 核心功能

### 1. 自适应翻译

- **三种翻译模式**:
  - `inline-only`: 仅翻译生僻部分，译文高亮显示在原文后
  - `bilingual`: 双文对照，译文在原文下方
  - `full-translate`: 全文翻译，生僻部分高亮

- **智能难度识别**: LLM 分析文本，识别超出用户词汇范围的单词、短语和复杂语法结构

### 2. 水平评估系统

- **考试成绩输入**: 支持 CET-4/6、TOEFL、IELTS、GRE 等主流英语考试
- **词汇量估算**: 基于考试成绩估算词汇量（如 CET-4 ≈ 4500 词）
- **快速词汇测试**: 20 题快速测评，动态评估真实水平

### 3. 动态学习机制

- **词汇标记**: 用户可以标记单词为"认识"或"不认识"
- **贝叶斯更新**: 基于用户标记行为动态调整词汇量估计和置信度
- **生词本**: 保存不认识的单词，附带上下文和翻译

### 4. 智能交互

- **悬停触发**: 鼠标悬停高亮词汇显示翻译提示框
- **键盘导航**: 支持 J/K 或上下箭头快速导航高亮词汇
- **右键菜单**: 支持"翻译选中内容"、"标记为认识/不认识"、"加入生词本"

### 5. 多 API 支持

- **国外模型**: OpenAI (GPT-4o-mini)、Anthropic (Claude)、Gemini、Groq
- **国内模型**: DeepSeek、智谱、阿里通义千问、百度文心
- **本地部署**: Ollama 本地模型支持
- **自定义 API**: 支持任何 OpenAI 兼容的 API 端点

---

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Chrome Extension                          │
├─────────────┬─────────────┬─────────────┬───────────────────────┤
│  Background │   Content   │    Popup    │       Options         │
│  Service    │   Script    │    UI       │        UI             │
│   Worker    │             │             │                       │
├─────────────┼─────────────┼─────────────┼───────────────────────┤
│ • Message   │ • Page      │ • Quick     │ • Full Settings       │
│   Routing   │   Scanning  │   Toggle    │ • API Configuration   │
│ • LLM API   │ • DOM       │ • Stats     │ • Level Assessment    │
│   Calls     │   Injection │             │ • Vocabulary Book     │
│ • Storage   │ • Tooltip   │             │                       │
│   Manager   │   UI        │             │                       │
│ • Bayesian  │ • Event     │             │                       │
│   Updates   │   Handling  │             │                       │
└─────────────┴─────────────┴─────────────┴───────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌──────────────┐    ┌──────────────┐
            │ Chrome Sync  │    │ Chrome Local │
            │   Storage    │    │   Storage    │
            │  (Cloud)     │    │  (Device)    │
            └──────────────┘    └──────────────┘
                    │                   │
            ┌───────┴───────┐    ┌──────┴──────┐
            ▼               ▼    ▼             ▼
       User Profile    Settings   Known     Translation
       (词汇量估计)     API Keys   Words       Cache
                              Unknown
                              Words
```

### 技术栈

| 类别 | 技术 |
|------|------|
| **框架** | React 18 + TypeScript 5.x |
| **构建工具** | Vite 5.x + @crxjs/vite-plugin |
| **样式** | Tailwind CSS 3.x |
| **状态管理** | Zustand (with Chrome Storage persistence) |
| **浏览器 API** | Chrome Extension Manifest V3 |
| **LLM APIs** | OpenAI, Anthropic, Gemini, DeepSeek, etc. |
| **测试** | Playwright (E2E), Vitest (Unit) |

---

## 工作流程

### 核心翻译流程

```
1. 页面加载
        │
        ▼
2. Content Script 初始化
   ├─ 加载用户设置
   ├─ 检查页面语言（跳过中文页面）
   └─ 检查黑名单
        │
        ▼
3. 可视区域观察器启动
   └─ 注册页面段落到 Intersection Observer
        │
        ▼
4. 用户滚动 → 段落进入可视区域
        │
        ▼
5. 批量翻译管理器处理
   ├─ 检查缓存
   ├─ 分批发送翻译请求
   └─ 应用翻译结果到 DOM
        │
        ▼
6. 用户交互
   ├─ 悬停 → 显示翻译提示框
   ├─ 点击 → 显示详细操作
   ├─ 标记 → 更新用户画像
   └─ 导航 → J/K 切换高亮词
```

### 批量翻译优化流程

```
┌─────────────────┐
│ 段落进入可视区域 │
└────────┬────────┘
         │
         ▼
┌─────────────────┐     命中    ┌─────────────┐
│  检查本地缓存   │ ───────────→ │ 直接显示译文 │
└────────┬────────┘              └─────────────┘
         │ 未命中
         ▼
┌─────────────────┐
│  加入待翻译队列  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   防抖处理      │ (300ms)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  分批组装请求   │ (最多15段/批)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  LLM API 调用   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  解析响应结果   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  缓存并应用翻译 │
└─────────────────┘
```

---

## 组件说明

### Background Service Worker (`src/background/`)

| 文件 | 职责 |
|------|------|
| `index.ts` | 消息路由中心、上下文菜单设置、事件监听 |
| `translation.ts` | 翻译服务，构建 Prompt、调用 LLM、解析响应 |
| `translationApi.ts` | 统一 API 服务，处理多供应商 API 调用 |
| `batchTranslation.ts` | 批量翻译服务，管理批量请求队列和响应聚合 |
| `storage.ts` | Chrome Storage 封装，读写用户数据和缓存 |
| `userLevel.ts` | 用户水平管理，贝叶斯更新算法实现 |
| `enhancedCache.ts` | 增强缓存管理，支持段落级 LRU 缓存 |
| `frequencyManager.ts` | 词频管理器，优化词汇难度评估 |

### Content Script (`src/content/`)

| 文件 | 职责 |
|------|------|
| `index.ts` | 内容脚本主入口，协调各组件工作 |
| `highlighter.ts` | 文本高亮逻辑，管理高亮样式和状态 |
| `tooltip.ts` | 翻译提示框 UI，显示翻译和操作按钮 |
| `marker.ts` | 词汇标记服务，处理认识/不认识标记 |
| `translationDisplay.ts` | 翻译展示管理，应用不同模式译文到 DOM |
| `viewportObserver.ts` | 可视区域观察器，使用 Intersection Observer |
| `batchTranslationManager.ts` | 批量翻译管理器，协调批量请求和显示 |
| `floatingButton.ts` | 浮动模式切换按钮，快速切换翻译模式 |

### Core 模块 (`src/content/core/`)

| 文件 | 职责 |
|------|------|
| `pageScanner.ts` | 页面扫描器，识别可翻译段落 |
| `navigationManager.ts` | 导航管理器，键盘导航高亮词 |
| `hoverManager.ts` | 悬停管理器，处理悬停延迟触发 |

### Shared 模块 (`src/shared/`)

| 文件 | 职责 |
|------|------|
| `types/index.ts` | TypeScript 类型定义 |
| `constants/index.ts` | 常量定义、Prompt 模板、配置默认值 |
| `constants/providers.ts` | API 供应商配置 |
| `utils/index.ts` | 通用工具函数 |
| `utils/logger.ts` | 日志工具 |
| `hooks/useStore.ts` | Zustand Store Hooks |

### UI 组件

| 目录 | 职责 |
|------|------|
| `src/popup/` | 扩展图标点击弹窗，快速开关和统计 |
| `src/options/` | 完整设置页面，API 配置、水平评估、生词本 |

---

## 数据流

### 消息通信架构

```
┌──────────────┐         Chrome Runtime Messaging          ┌──────────────┐
│              │ ◄────────────────────────────────────────► │              │
│   Content    │    Message Type: TRANSLATE_TEXT            │  Background  │
│   Script     │    Payload: { text, mode, userLevel }      │  Service     │
│              │ ◄────────────────────────────────────────► │   Worker     │
│              │    Response: { words, sentences,           │              │
│              │              grammarPoints, fullText }      │              │
└──────────────┘                                            └──────────────┘
       │                                                           │
       │                                                           │
       │ DOM 操作                                                   │ LLM API
       ▼                                                           ▼
┌──────────────┐                                            ┌──────────────┐
│   Web Page   │                                            │   LLM API    │
│   (Display)  │                                            │ (OpenAI/etc) │
└──────────────┘                                            └──────────────┘
```

### 核心消息类型

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `TRANSLATE_TEXT` | C → B | 请求翻译单个段落 |
| `BATCH_TRANSLATE_TEXT` | C → B | 批量翻译多个段落 |
| `MARK_WORD_KNOWN` | C → B | 标记单词为认识 |
| `MARK_WORD_UNKNOWN` | C → B | 标记单词为不认识 |
| `GET_USER_PROFILE` | C → B | 获取用户画像 |
| `UPDATE_USER_PROFILE` | C → B | 更新用户画像 |
| `GET_SETTINGS` | C → B | 获取设置 |
| `UPDATE_SETTINGS` | C → B | 更新设置 |
| `SHOW_TRANSLATION` | B → C | 右键菜单触发翻译 |
| `WORD_MARKED` | B → C | 标记结果通知 |
| `SETTINGS_UPDATED` | B → C | 设置更新通知 |

### 数据流向图

```
                    ┌──────────────────┐
                    │   User Actions   │
                    └────────┬─────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Mark Known/    │ │   Change        │ │   Scroll/       │
│  Unknown        │ │   Settings      │ │   Navigate      │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Bayesian       │ │  Save to        │ │  Batch          │
│  Update         │ │  Sync Storage   │ │  Translation    │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│  Update         │ │  Notify All     │ │  Cache Results  │
│  Vocabulary     │ │  Tabs           │ │  in Local       │
│  Estimate       │ │                 │ │  Storage        │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

---

## LLM 集成

### 支持的 API 供应商

| 供应商 | 默认模型 | 区域 |
|--------|----------|------|
| OpenAI | gpt-4o-mini | 国际 |
| Anthropic | claude-3-haiku | 国际 |
| Gemini | gemini-pro | 国际 |
| Groq | llama-3.1-70b | 国际 |
| DeepSeek | deepseek-chat | 国内 |
| 智谱 | glm-4 | 国内 |
| 阿里 | qwen-turbo | 国内 |
| 百度 | ernie-bot | 国内 |
| Ollama | 本地模型 | 本地 |
| Custom | 自定义 | 灵活 |

### Prompt 工程

翻译 Prompt 模板结构：

```
你是一个英语学习助手。用户的英语水平约为 {vocabulary_size} 词汇量
（相当于 {exam_level} 水平）。

请分析以下英文文本，找出可能超出用户水平的：
1. 单词（超出 {exam_level} 词汇范围的）
2. 短语/习语
3. 复杂语法结构（如倒装句、虚拟语气、复杂从句等）

对于每个识别出的内容，提供：
- 中文翻译
- 难度等级（1-10）

同时提供整段文本的完整中文翻译。

请以 JSON 格式返回结果...
```

### API 统一封装

`TranslationApiService` 提供统一的 API 调用接口：

```typescript
// 多供应商支持，统一调用方式
const content = await TranslationApiService.call(prompt, apiKey, settings);

// 内部处理不同供应商的：
// - 请求格式转换
// - 认证头设置
// - 响应解析
// - 错误处理
```

---

## 存储策略

### Chrome Sync Storage（云同步）

存储用户配置，跨设备同步：

```typescript
interface SyncStorageData {
  userProfile: UserProfile;      // 用户画像（不含词汇列表）
  settings: UserSettings;        // 用户设置
  apiKey: string;                // API 密钥
}
```

### Chrome Local Storage（本地存储）

存储大量数据，仅当前设备可用：

```typescript
interface LocalStorageData {
  knownWords: string[];                    // 认识的单词列表
  unknownWords: UnknownWordEntry[];        // 生词本
  translationCache: Record<string, TranslationResult>;  // 翻译缓存
}
```

### 缓存策略

```typescript
// 段落级缓存
interface ParagraphCacheEntry {
  textHash: string;           // 文本内容哈希
  result: TranslationResult;  // 翻译结果
  mode: TranslationMode;      // 翻译模式
  pageUrl: string;            // 页面 URL
  createdAt: number;          // 创建时间
  lastAccessedAt: number;     // 最后访问时间（LRU）
}

// 默认缓存配置
const DEFAULT_BATCH_CONFIG = {
  maxParagraphsPerBatch: 15,  // 单批最大段落数
  maxCharsPerBatch: 10000,    // 单批最大字符数
  debounceDelay: 300,         // 防抖延迟（毫秒）
  maxCacheEntries: 500,       // 缓存最大条目数
  cacheExpireTime: 7 * 24 * 60 * 60 * 1000,  // 7天过期
};
```

---

## 开发指南

### 项目结构

```
notOnlyTranslator/
├── src/
│   ├── background/          # Service Worker
│   │   ├── index.ts         # 消息路由、上下文菜单
│   │   ├── translation.ts   # 翻译服务
│   │   ├── translationApi.ts # API 统一封装
│   │   ├── batchTranslation.ts # 批量翻译
│   │   ├── storage.ts       # 存储管理
│   │   ├── userLevel.ts     # 用户水平管理
│   │   ├── enhancedCache.ts # 增强缓存
│   │   └── frequencyManager.ts # 词频管理
│   │
│   ├── content/             # Content Script
│   │   ├── index.ts         # 主入口
│   │   ├── highlighter.ts   # 文本高亮
│   │   ├── tooltip.ts       # 翻译提示框
│   │   ├── marker.ts        # 词汇标记
│   │   ├── translationDisplay.ts # 翻译展示
│   │   ├── viewportObserver.ts   # 可视区域观察
│   │   ├── batchTranslationManager.ts # 批量翻译管理
│   │   ├── floatingButton.ts     # 浮动按钮
│   │   └── core/            # 核心模块
│   │       ├── pageScanner.ts
│   │       ├── navigationManager.ts
│   │       └── hoverManager.ts
│   │
│   ├── popup/               # 扩展弹窗 UI
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── options/             # 设置页面 UI
│   │   ├── App.tsx
│   │   └── components/
│   │
│   ├── shared/              # 共享代码
│   │   ├── types/           # TypeScript 类型
│   │   ├── constants/       # 常量、配置
│   │   ├── utils/           # 工具函数
│   │   └── hooks/           # React Hooks
│   │
│   └── data/                # 静态数据
│       └── vocabulary/      # 词汇表
│
├── public/
│   ├── manifest.json        # 扩展清单（Manifest V3）
│   └── icons/               # 图标资源
│
├── e2e/                     # E2E 测试
├── plans/                   # 架构文档
└── vite.config.ts           # Vite 配置
```

### 开发命令

```bash
# 安装依赖
npm install

# 启动开发服务器（热重载）
npm run dev

# 生产构建
npm run build

# 代码检查
npm run lint

# 类型检查
npm run type-check
```

### 代码规范

- **语言**: 中文注释，英文代码
- **类型**: 严格 TypeScript，无 `any`
- **路径**: 使用 `@/` 别名映射到 `src/`
- **样式**: Tailwind CSS，禁止内联样式
- **未使用变量**: 前缀 `_`（ESLint 配置）

### 调试技巧

1. **查看日志**: 扩展管理页面 → 背景页 → Console
2. **Content Script**: 网页 F12 → Console → 筛选 `NotOnlyTranslator`
3. **网络请求**: 背景页 → Network → 查看 LLM API 调用
4. **Storage**: 扩展管理 → 存储 → 查看 Local/Sync 数据

---

## 总结

NotOnlyTranslator 是一款面向英语学习者的智能翻译扩展，通过 LLM 技术实现个性化、上下文感知的翻译体验。其核心创新在于：

1. **水平自适应**: 只翻译超出用户当前水平的词汇
2. **动态学习**: 贝叶斯更新持续优化用户画像
3. **批量优化**: 智能分批、缓存机制降低 API 成本
4. **多模式支持**: 行内、双文对照、全文翻译满足不同场景

技术实现上采用 Chrome Extension Manifest V3 架构，React + TypeScript + Vite 技术栈，支持多供应商 LLM API，具备良好的扩展性和可维护性。
