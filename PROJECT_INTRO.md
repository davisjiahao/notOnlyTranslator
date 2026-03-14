# NotOnlyTranslator 项目介绍

> 一款根据用户英语水平智能翻译的 Chrome/Edge 浏览器扩展

---

## 1. 项目概述

### 1.1 项目背景

**NotOnlyTranslator** 是一款创新的浏览器扩展，旨在解决传统翻译工具的痛点：

- **传统翻译工具的问题**：要么全翻译（失去学习英语的机会），要么不翻译（遇到生词阻碍阅读）
- **NotOnlyTranslator 的方案**：智能识别用户水平，只翻译超出当前水平的词汇，让用户在阅读中自然学习

### 1.2 目标用户

| 用户群体 | 使用场景 |
|---------|---------|
| 英语学习者 | 阅读英文文章时遇到生词 |
| 备考学生 | 四六级、托福、雅思、GRE 备考 |
| 开发者/研究者 | 阅读英文技术文档、论文 |
| 进阶学习者 | 希望扩大词汇量，提升阅读流畅度 |

### 1.3 核心价值主张

```
🎯 核心理念："在真实阅读场景中学习，而非刻意背单词"
```

- **个性化**：根据用户实际水平动态调整翻译内容
- **高效学习**：只在需要时提供翻译，最大化语言暴露
- **智能记忆**：自动记录生词，支持复习和追踪进度

---

## 2. 核心功能

### 2.1 智能翻译（三种模式）

| 模式 | 描述 | 适用场景 |
|-----|------|---------|
| **行内翻译** (inline-only) | 仅翻译生僻词汇，译文显示在原文后方括号内 | 日常阅读，保持原文流畅性 |
| **双语对照** (bilingual) | 英文段落下方显示中文翻译，对应词汇高亮联动 | 精读学习 |
| **全文翻译** (full-translate) | 整段翻译，生僻部分高亮标注 | 快速理解大意 |

### 2.2 水平评估系统

**初始评估方式**：
- 📊 **考试成绩录入**：支持 CET-4/6、托福、雅思、GRE 成绩换算
- 📝 **快速词汇测试**：20 题自适应测试，动态评估词汇量

**水平等级参考**：
| 词汇量 | 等级 | 对应考试 |
|-------|------|---------|
| < 3000 | 初级 | - |
| 3000-5000 | 中级 | CET-4 |
| 5000-8000 | 中高级 | CET-6、IELTS |
| 8000-12000 | 高级 | TOEFL |
| > 12000 | 专家级 | GRE |

### 2.3 动态学习系统

```
┌─────────────────────────────────────────────────────┐
│  用户行为 → 贝叶斯更新 → 调整词汇量估计 → 优化翻译    │
└─────────────────────────────────────────────────────┘
```

**用户交互**：
- ✅ **标记为认识**：该词不再高亮，词汇量估计可能上调
- ❌ **标记为不认识**：加入生词本，词汇量估计可能下调
- 📚 **加入生词本**：保存词汇、翻译和上下文

### 2.4 生词本管理

- **自动收集**：标记为"不认识"的词汇自动收录
- **上下文保存**：记录词汇出现的原文句子
- **复习提醒**：基于间隔重复算法计算复习优先级
- **导出功能**：支持导出生词本为多种格式

### 2.5 批量翻译与缓存

**批量翻译优势**：
- 合并多个段落为单次 API 调用（最多15个段落/批次）
- 大幅减少 API 请求次数，降低成本
- 智能缓存机制，避免重复翻译

**缓存策略**：
- **段落级缓存**：相同内容的段落直接从缓存读取
- **LRU 淘汰**：500条缓存上限，自动淘汰最久未使用
- **7天过期**：缓存自动过期，确保翻译时效性

---

## 3. 技术架构

### 3.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         Chrome Extension                        │
│                   (Manifest V3 + React + TypeScript)            │
├─────────────────┬─────────────────┬─────────────────┬───────────┤
│   Background    │    Content      │      Popup      │  Options  │
│  (Service       │   (注入页面)     │   (点击图标)     │  (设置页)  │
│   Worker)       │                 │                 │           │
├─────────────────┼─────────────────┼─────────────────┼───────────┤
│ • 消息路由       │ • DOM 高亮      │ • 快速操作      │ • API配置  │
│ • LLM API调用   │ • 翻译展示      │ • 统计概览      │ • 水平设置 │
│ • 用户水平管理   │ • 交互事件      │ • 生词列表      │ • 偏好设置 │
│ • 存储管理       │ • 批量翻译管理   │                 │ • 词汇管理 │
└─────────────────┴─────────────────┴─────────────────┴───────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Data Storage                            │
├─────────────────────────┬───────────────────────────────────────┤
│   Chrome Sync Storage   │         Chrome Local Storage          │
│   (云端同步)             │            (本地存储)                  │
├─────────────────────────┼───────────────────────────────────────┤
│ • 用户档案               │ • 认识的词汇列表                       │
│ • 设置配置               │ • 不认识的词汇列表                     │
│ • API 密钥               │ • 翻译缓存 (500条上限)                 │
└─────────────────────────┴───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      External Services                          │
├─────────────────────────────────────────────────────────────────┤
│  OpenAI    Anthropic    国内大模型    本地部署    自定义API      │
│ (GPT-4o)   (Claude)    (DeepSeek等)   (Ollama)   (OpenAI兼容)   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 技术栈详解

| 层级 | 技术 | 说明 |
|-----|------|------|
| **框架** | React 18 + TypeScript | 类型安全的前端开发 |
| **构建** | Vite + @crxjs/vite-plugin | Chrome 扩展打包 |
| **样式** | Tailwind CSS | 原子化 CSS 框架 |
| **状态** | Zustand | 轻量级状态管理，支持 Chrome Storage 持久化 |
| **通信** | Chrome Message API | 组件间消息传递 |
| **存储** | Chrome Storage API | Sync + Local 双存储策略 |
| **测试** | Vitest + Playwright | 单元测试 + E2E 测试 |

---

## 4. 工作流程

### 4.1 完整数据流

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   用户访问    │────▶│   页面扫描    │────▶│  可视区域检测 │
│   英文网页    │     │  识别段落     │     │  批量处理     │
└──────────────┘     └──────────────┘     └──────────────┘
                                                   │
                                                   ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  展示翻译     │◀────│  LLM 翻译     │◀────│   缓存查询    │
│  高亮生词     │     │  智能分析     │     │  命中检查     │
└──────────────┘     └──────────────┘     └──────────────┘
         │                                            ▲
         ▼                                            │
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   用户交互    │────▶│  标记词汇     │────▶│   更新缓存    │
│  点击/悬停   │     │  认识/不认识  │     │  存储结果     │
└──────────────┘     └──────────────┘     └──────────────┘
                              │
                              ▼
                       ┌──────────────┐
                       │  贝叶斯更新   │
                       │  调整水平估计 │
                       └──────────────┘
```

### 4.2 页面加载流程

```
用户访问英文网页
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Content Script 初始化                                        │
│ ├─ 检查页面语言（中文页面跳过）                               │
│ ├─ 检查黑名单                                                │
│ └─ 加载用户设置                                              │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 扫描页面段落                                                 │
│ └─ 注册到可视区域观察器                                       │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
用户滚动页面 ──▶ 段落进入可视区域
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ 批量翻译处理                                                 │
│ ├─ 检查本地缓存（命中则直接显示）                            │
│ ├─ 过滤中文占比过高的段落                                    │
│ ├─ 本地词频过滤（行内模式）                                  │
│ ├─ 组装批量请求（最多15段）                                  │
│ ├─ 调用 LLM API                                              │
│ └─ 缓存并应用翻译                                            │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
用户点击高亮词汇 ──▶ 显示 Tooltip
       │
       ▼
用户标记"认识"/"不认识" ──▶ 贝叶斯更新词汇量估计
```

---

## 5. 组件说明

### 5.1 Background (Service Worker)

**文件位置**: `src/background/`

| 文件 | 职责 | 关键功能 |
|------|------|---------|
| `index.ts` | 消息路由中心 | 处理所有组件发来的消息，分发到对应处理器 |
| `translation.ts` | 翻译服务 | 调用 LLM API，解析响应，缓存结果 |
| `batchTranslation.ts` | 批量翻译 | 合并多个段落，单次 API 调用 |
| `userLevel.ts` | 用户水平管理 | 贝叶斯更新算法，词汇量估计 |
| `storage.ts` | 存储封装 | Chrome Storage 读写封装 |
| `translationApi.ts` | API 统一层 | 支持多供应商的通用 API 调用 |
| `enhancedCache.ts` | 增强缓存 | 段落级缓存，LRU 淘汰策略 |
| `frequencyManager.ts` | 词频管理 | 本地词频表，静态难度评估 |

### 5.2 Content Script (页面注入)

**文件位置**: `src/content/`

| 文件 | 职责 | 关键功能 |
|------|------|---------|
| `index.ts` | 主控制器 | 初始化所有模块，协调工作流程 |
| `highlighter.ts` | 高亮渲染 | DOM 高亮，样式应用 |
| `tooltip.ts` | 悬浮提示 | 词汇详情展示，操作按钮 |
| `marker.ts` | 标记服务 | 处理"认识/不认识"标记逻辑 |
| `translationDisplay.ts` | 翻译展示 | 三种模式渲染实现 |
| `viewportObserver.ts` | 可视观察 | Intersection Observer 封装 |
| `batchTranslationManager.ts` | 批量管理 | 段落队列，防抖处理 |
| `floatingButton.ts` | 浮动按钮 | 模式切换快捷入口 |
| `core/` | 核心模块 | PageScanner, NavigationManager, HoverManager |

### 5.3 Popup (扩展图标页面)

**文件位置**: `src/popup/`

| 组件 | 功能 |
|------|------|
| `StatsCard` | 显示词汇量、掌握单词数等统计 |
| `QuickActions` | 快速开关、模式切换 |
| `VocabularyList` | 最近添加的生词预览 |
| `ApiSwitcher` | 快速切换 API 配置 |

### 5.4 Options (设置页面)

**文件位置**: `src/options/`

| 组件 | 功能 |
|------|------|
| `ApiSettings` | 多供应商 API 配置，密钥管理 |
| `LevelSelector` | 水平评估，考试选择，快速测试 |
| `GeneralSettings` | 翻译模式、高亮样式、黑名单 |
| `VocabularySettings` | 生词本管理，复习功能 |
| `StatsCharts` | 学习进度图表（Recharts） |
| `QuickTest` | 20 题词汇测试 |

### 5.5 Shared (共享模块)

**文件位置**: `src/shared/`

| 目录 | 内容 |
|------|------|
| `types/` | TypeScript 类型定义，消息类型，API 类型 |
| `constants/` | 常量，提示词模板，配置默认值 |
| `utils/` | 工具函数，贝叶斯计算，缓存哈希，重试机制 |
| `hooks/` | React Hooks，Store 集成 |

---

## 6. 数据流设计

### 6.1 消息传递机制

**Chrome Message API** 是组件间通信的核心方式：

```typescript
// 消息类型定义
export type MessageType =
  | 'TRANSLATE_TEXT'           // 单段翻译
  | 'BATCH_TRANSLATE_TEXT'     // 批量翻译
  | 'MARK_WORD_KNOWN'          // 标记认识
  | 'MARK_WORD_UNKNOWN'        // 标记不认识
  | 'GET_USER_PROFILE'         // 获取档案
  | 'UPDATE_USER_PROFILE'      // 更新档案
  | 'GET_SETTINGS'             // 获取设置
  | 'UPDATE_SETTINGS'          // 更新设置
  | 'GET_VOCABULARY'           // 获取生词本
  | 'ADD_TO_VOCABULARY'        // 添加到生词本
  | 'REMOVE_FROM_VOCABULARY'   // 从生词本移除
  | 'SETTINGS_UPDATED';        // 设置更新通知

// 消息结构
interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

// 响应结构
interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
```

### 6.2 状态管理

**Zustand + Chrome Storage** 双状态管理：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  React UI   │◀───▶│   Zustand   │◀───▶│ Chrome      │
│   Layer     │     │   Store     │     │ Storage     │
└─────────────┘     └─────────────┘     └─────────────┘
```

**持久化策略**：
- **Sync Storage** (云端同步)：用户档案、设置、API 配置
- **Local Storage** (本地存储)：词汇列表、翻译缓存

### 6.3 存储策略

| 数据类型 | 存储位置 | 容量限制 | 同步 |
|---------|---------|---------|------|
| 用户档案 | Sync | ~100KB | 跨设备同步 |
| 设置配置 | Sync | ~100KB | 跨设备同步 |
| API 密钥 | Sync | ~100KB | 跨设备同步 |
| 认识词汇 | Local | ~5MB | 仅本地 |
| 不认识词汇 | Local | ~5MB | 仅本地 |
| 翻译缓存 | Local | 500条 LRU | 仅本地 |

---

## 7. LLM 集成

### 7.1 多供应商支持

支持 10+ 个大模型供应商：

| 分类 | 供应商 | 默认模型 | 特点 |
|------|-------|---------|------|
| **国际** | OpenAI | gpt-4o-mini | 稳定，响应快 |
| | Anthropic | claude-3-haiku | 质量高 |
| | Gemini | gemini-pro | Google 生态 |
| | Groq | mixtral-8x7b | 速度快 |
| **国内** | DeepSeek | deepseek-chat | 性价比高 |
| | Zhipu | chatglm3 | 中文优化 |
| | Alibaba | qwen-turbo | 阿里云 |
| | Baidu | ernie-bot | 百度文心 |
| **本地** | Ollama | llama2 | 隐私保护 |
| **自定义** | Custom | 任意 | OpenAI 兼容接口 |

### 7.2 API 统一层

**TranslationApiService** (`src/background/translationApi.ts`) 提供统一的 API 调用接口：

```typescript
// 统一的调用接口，自动处理不同供应商的格式差异
static async call(
  prompt: string,
  apiKey: string,
  settings: UserSettings,
  retryOptions?: RetryOptions
): Promise<string>

// 支持的 API 格式
export type ApiFormat =
  | 'openai'     // OpenAI / DeepSeek / Zhipu 等
  | 'anthropic'  // Anthropic Claude
  | 'gemini'     // Google Gemini
  | 'dashscope'  // 阿里云
  | 'baidu'      // 百度文心
  | 'ollama';    // Ollama 本地部署
```

### 7.3 翻译提示词设计

**提示词模板** (`src/shared/constants/index.ts`)：

```
你是一个英语学习助手。用户的英语水平约为 {vocabulary_size} 词汇量
（相当于{exam_level}水平）。

请分析以下英文文本，找出可能超出用户水平的：
1. 单词（超出{exam_level}词汇范围的）
2. 短语/习语
3. 复杂语法结构

返回格式：
{
  "fullText": "完整中文翻译",
  "words": [{"original": "", "translation": "", "difficulty": 1-10}],
  "sentences": [{"original": "", "translation": "", "grammarNote": ""}],
  "grammarPoints": [{"original": "", "explanation": "", "type": ""}]
}
```

### 7.4 响应解析

**JSON 解析容错机制**：
1. 提取 Markdown 代码块中的 JSON
2. 尝试修复常见的 JSON 语法错误（如末尾逗号）
3. 兼容不同的返回格式（直接数组或包装对象）
4. 按 ID 匹配段落，顺序回退

---

## 8. 特色设计

### 8.1 贝叶斯水平估计

**算法核心** (`src/shared/utils/index.ts`)：

```typescript
export function updateVocabularyEstimate(
  currentEstimate: number,    // 当前词汇量估计
  wordDifficulty: number,    // 单词难度 1-10
  isKnown: boolean,          // 用户是否认识
  confidence: number         // 当前置信度
): { newEstimate: number; newConfidence: number }
```

**更新逻辑**：
- 认识一个难度高于当前水平的词 → 上调词汇量估计
- 不认识一个难度低于当前水平的词 → 下调词汇量估计
- 置信度随交互次数增加而提高

### 8.2 词频驱动的本地过滤

**频率管理器** (`src/background/frequencyManager.ts`)：

```
┌────────────────────────────────────────┐
│         COCA-like 词频表              │
├────────────────────────────────────────┤
│  难度1 (最常见) │ the, be, to, of...  │
│  难度5         │ analyze, concept... │
│  难度10 (罕见)  │ serendipity, ...    │
└────────────────────────────────────────┘
```

**本地静态过滤**：在行内翻译模式下，先本地判断段落是否可能包含生词，避免不必要的 API 调用。

### 8.3 智能视口管理

**ViewportObserver** (`src/content/viewportObserver.ts`)：

- 使用 `IntersectionObserver` 高效检测段落进入视口
- 防抖处理避免频繁触发
- 批量处理减少 API 调用次数

**优势**：
- 只翻译用户看到的段落，节省 API 成本
- 避免初始加载时大量并发请求
- 平滑滚动时逐步加载翻译

### 8.4 中文页面检测

**多维度检测** (`src/content/index.ts`)：

1. **HTML lang 属性**：检查 `<html lang="zh">`
2. **Content-Language Meta**：检查 meta 标签
3. **内容采样**：取页面内容计算中文字符比例 (>30% 视为中文页面)

### 8.5 键盘导航

**快捷键支持**：

| 快捷键 | 功能 |
|-------|------|
| `J` / `↓` | 跳转到下一个高亮词汇 |
| `K` / `↑` | 跳转到上一个高亮词汇 |
| `Esc` | 关闭 Tooltip |

---

## 9. 项目结构

```
notOnlyTranslator/
├── src/
│   ├── background/              # Background Service Worker
│   │   ├── index.ts             # 消息路由，入口
│   │   ├── translation.ts       # 单段翻译服务
│   │   ├── batchTranslation.ts  # 批量翻译服务
│   │   ├── translationApi.ts    # 多供应商 API 封装
│   │   ├── userLevel.ts         # 用户水平管理（贝叶斯更新）
│   │   ├── storage.ts           # Chrome Storage 封装
│   │   ├── enhancedCache.ts     # 段落级增强缓存
│   │   └── frequencyManager.ts  # 词频管理
│   │
│   ├── content/                 # Content Script（注入页面）
│   │   ├── index.ts             # 主控制器
│   │   ├── highlighter.ts       # DOM 高亮渲染
│   │   ├── tooltip.ts           # 悬浮提示框
│   │   ├── marker.ts            # 词汇标记逻辑
│   │   ├── translationDisplay.ts # 翻译展示（三种模式）
│   │   ├── viewportObserver.ts  # 可视区域观察器
│   │   ├── batchTranslationManager.ts # 批量翻译管理
│   │   ├── floatingButton.ts    # 浮动模式切换按钮
│   │   ├── core/                # 核心模块
│   │   │   ├── pageScanner.ts   # 页面段落扫描
│   │   │   ├── navigationManager.ts # 键盘导航
│   │   │   └── hoverManager.ts  # 悬停触发管理
│   │   └── styles.css           # 样式文件
│   │
│   ├── popup/                   # Popup UI（点击图标）
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── StatsCard.tsx
│   │   │   ├── QuickActions.tsx
│   │   │   ├── VocabularyList.tsx
│   │   │   └── ApiSwitcher.tsx
│   │   └── index.tsx
│   │
│   ├── options/                 # Options UI（设置页）
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ApiSettings.tsx
│   │   │   ├── LevelSelector.tsx
│   │   │   ├── GeneralSettings.tsx
│   │   │   ├── VocabularySettings.tsx
│   │   │   ├── StatsCharts.tsx
│   │   │   └── QuickTest.tsx
│   │   └── index.tsx
│   │
│   └── shared/                  # 共享代码
│       ├── types/
│       │   └── index.ts         # TypeScript 类型定义
│       ├── constants/
│       │   ├── index.ts         # 常量，提示词模板
│       │   └── providers.ts     # 供应商配置
│       ├── utils/
│       │   ├── index.ts         # 工具函数
│       │   └── logger.ts        # 日志服务
│       ├── hooks/
│       │   └── useStore.ts      # Zustand Store
│       └── services/
│           └── modelService.ts  # 模型列表获取
│
├── public/
│   ├── manifest.json            # 扩展清单（MV3）
│   └── icons/                   # 图标资源
│
├── scripts/
│   └── create-icons.cjs         # 图标生成脚本
│
├── package.json                 # 依赖配置
├── vite.config.ts               # Vite 配置
├── tsconfig.json                # TypeScript 配置
├── tailwind.config.js           # Tailwind 配置
├── eslint.config.js             # ESLint 配置
├── README.md                    # 项目说明
└── CLAUDE.md                    # 开发指南
```

---

## 10. 开发指南

### 10.1 常用命令

```bash
# 安装依赖（会自动生成图标）
npm install

# 开发模式（热更新）
npm run dev

# 生产构建
npm run build

# 代码检查
npm run lint

# 类型检查
npm run type-check

# 单元测试
npm run test

# E2E 测试
npm run test:e2e
```

### 10.2 本地加载测试

1. 执行 `npm run build` 生成 `dist` 目录
2. 打开 Chrome，访问 `chrome://extensions/`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择 `dist` 文件夹

### 10.3 调试技巧

| 调试目标 | 方法 |
|---------|------|
| Background | 扩展管理页 → 查看 Service Worker 控制台 |
| Content | 网页 DevTools → Console 面板 |
| Popup | 右键扩展图标 →「检查弹出内容」 |
| Options | 设置页面 → F12 打开 DevTools |

---

## 11. 贡献指南

欢迎提交 Pull Request！请遵循以下规范：

1. **代码风格**：遵循 ESLint 配置，零警告提交
2. **类型安全**：所有代码使用 TypeScript，避免 `any`
3. **注释**：关键逻辑添加中文注释
4. **测试**：新功能需配套单元测试

---

## 12. 许可证

MIT License

---

> 📚 **快速开始**：如果您是项目新人，建议先阅读 `CLAUDE.md` 开发指南，然后查看 `src/background/index.ts` 和 `src/content/index.ts` 了解核心流程。
