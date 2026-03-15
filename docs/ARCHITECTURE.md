# NotOnlyTranslator 技术架构设计

## 1. 系统概述

NotOnlyTranslator 是一个基于 Chrome/Edge 浏览器的智能翻译扩展，根据用户的英语水平和词汇量，仅翻译超出用户能力范围的单词，帮助英语学习者在阅读英文内容时自然提升词汇量。

### 1.1 核心特性

- **智能分级翻译**：基于用户英语水平（CET-4/6、托福、雅思等）决定翻译哪些词汇
- **多种翻译模式**：
  - 行内翻译（仅生僻词）
  - 双文对照（原文+译文）
  - 全文翻译（高亮生僻词）
- **批量翻译优化**：基于 IntersectionObserver 的可视区域批量翻译
- **词汇学习系统**：标记已知/未知单词，生词本管理
- **多 LLM 支持**：OpenAI、Anthropic、Gemini、DeepSeek、智谱等国内外供应商

## 2. 架构设计

### 2.1 总体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Browser Page                                │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    Content Script                             │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐     │   │
│  │  │Page Scanner │ │Highlighter  │ │Translation Display │     │   │
│  │  │Viewport Obs │ │Tooltip      │ │Batch Manager       │     │   │
│  │  │Nav Manager  │ │Marker Service│ │Hover Manager       │     │   │
│  │  └─────────────┘ └─────────────┘ └──────────────────────┘     │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ Chrome Messaging API
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Background Service Worker                        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                     Message Router                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│       │              │              │              │                │
│       ▼              ▼              ▼              ▼                │
│  ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────────────┐      │
│  │Translation│   │Storage  │   │User Level│   │Context Menu    │      │
│  │Service  │   │Manager  │   │Manager  │   │Setup           │      │
│  │(LLM API)│   │         │   │         │   │                │      │
│  └─────────┘   └─────────┘   └─────────┘   └─────────────────┘      │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ HTTPS/REST API
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     External LLM APIs                               │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ OpenAI  │ │Anthropic│ │ DeepSeek│ │ 智谱    │ │ 其他    │       │
│  │ GPT-4o  │ │ Claude  │ │ V3      │ │ GLM-4  │ │供应商  │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责

#### 2.2.1 Content Script (内容脚本)

| 模块 | 职责 |
|------|------|
| `NotOnlyTranslator` | 主类，协调所有功能模块，处理生命周期 |
| `PageScanner` | 扫描页面段落，提取可翻译内容 |
| `ViewportObserver` | 基于 IntersectionObserver 的可视区域监听 |
| `Highlighter` | 高亮显示翻译后的词汇 |
| `Tooltip` | 翻译详情提示框，词汇操作入口 |
| `TranslationDisplay` | 三种翻译模式的渲染逻辑 |
| `BatchTranslationManager` | 批量翻译队列管理和调度 |
| `NavigationManager` | 键盘导航（J/K 上下高亮词） |
| `HoverManager` | 悬停延迟触发 Tooltip |
| `MarkerService` | 标记词汇为已知/未知，生词本操作 |

#### 2.2.2 Background Service Worker

| 模块 | 职责 |
|------|------|
| `Message Router` | 路由 Content Script 消息到对应处理器 |
| `TranslationService` | 调用 LLM API，处理翻译请求 |
| `TranslationApiService` | 统一多供应商 API 调用层 |
| `StorageManager` | Chrome Storage API 封装，缓存管理 |
| `UserLevelManager` | 词汇量估算，贝叶斯更新算法 |
| `ContextMenuSetup` | 右键菜单注册和处理 |

### 2.3 数据流设计

#### 2.3.1 翻译请求流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   用户浏览   │────▶│  可视区域   │────▶│  批量翻译   │────▶│  Content    │
│   英文页面   │     │  段落检测   │     │  队列管理   │     │  Script     │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                   │
                              Chrome Messaging API                   │
                                                                   ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  缓存结果   │◀────│  翻译服务   │◀────│  Background │◀────│   发送消息   │
│  返回展示   │     │  LLM API   │     │  Service     │     │              │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
```

#### 2.3.2 缓存策略

| 缓存层级 | 存储位置 | 内容 | TTL |
|----------|----------|------|-----|
| 内存缓存 | TranslationService | 最近翻译结果 | 5分钟 |
| Chrome Local Storage | 段落级缓存 | 翻译结果哈希 | 7天 |
| Session Storage | 页面会话 | 当前页翻译 | 页面关闭 |

缓存键生成：
```typescript
// 基于文本哈希 + 翻译模式 + 用户等级
function generateCacheKey(text: string, mode: TranslationMode): string {
  const normalized = normalizeText(text);
  const hash = simpleHash(normalized);
  return `${hash}_${mode}`;
}
```

## 3. 技术栈与工具

### 3.1 核心技术栈

| 层级 | 技术 | 版本 | 说明 |
|------|------|------|------|
| 语言 | TypeScript | 5.x | 类型安全 |
| 构建 | Vite | 5.x | 快速构建 |
| 扩展 | CRXJS | 2.x | Chrome 扩展开发 |
| 框架 | React | 18.x | UI 组件 |
| 状态 | Zustand | 4.x | 状态管理 |
| 样式 | Tailwind CSS | 3.x | 原子 CSS |
| 测试 | Playwright | 1.x | E2E 测试 |

### 3.2 浏览器兼容性

| 浏览器 | 版本 | 支持状态 |
|--------|------|----------|
| Chrome | 100+ | ✅ 完全支持 |
| Edge | 100+ | ✅ 完全支持 |
| Firefox | 支持 Manifest V3 | ⚠️ 待测试 |
| Safari | 16+ | ⚠️ 待测试 |

## 4. 安全设计

### 4.1 API 密钥安全

| 存储位置 | 数据 | 加密方式 |
|----------|------|----------|
| Chrome Sync Storage | API Key | Chrome 原生加密 |
| 内存 | 临时 API Key | 使用后立即清除 |
| 日志 | 无 API Key | 脱敏处理 |

### 4.2 内容安全策略 (CSP)

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

## 5. 性能优化

### 5.1 加载性能

| 指标 | 目标值 | 优化策略 |
|------|--------|----------|
| Content Script 注入 | < 50ms | 延迟非关键代码 |
| 首屏翻译 | < 2s | 可视区域优先 |
| 内存占用 | < 100MB | LRU 缓存管理 |

### 5.2 运行时性能

```typescript
// 批量处理策略
const BATCH_CONFIG = {
  maxParagraphsPerBatch: 5,      // 每批最多段落数
  maxCharsPerBatch: 3000,        // 每批最大字符数
  debounceDelay: 300,            // 防抖延迟
  intersectionThreshold: 0.1,    // 可视阈值
};
```

## 6. 扩展性设计

### 6.1 LLM 供应商扩展

```typescript
// 供应商配置接口
interface ProviderConfig {
  id: ApiProvider;
  apiFormat: ApiFormat;
  defaultEndpoint: string;
  authHeaderName: string;
  modelsSupported: boolean;
  // ...
}

// 支持的新供应商只需添加配置，无需修改核心代码
```

### 6.2 翻译模式扩展

```typescript
type TranslationMode =
  | 'inline-only'
  | 'bilingual'
  | 'full-translate'
  | 'future-mode'; // 新模式
```

## 7. 部署与发布

### 7.1 构建流程

```bash
# 开发模式
npm run dev

# 生产构建
npm run build

# 类型检查
npm run type-check

# 代码检查
npm run lint
```

### 7.2 发布渠道

| 渠道 | 平台 | 状态 |
|------|------|------|
| Chrome Web Store | Google | 计划中 |
| Edge Add-ons | Microsoft | 计划中 |
| Firefox Add-ons | Mozilla | 待评估 |
| 手动安装 | GitHub Releases | 支持 |

---

## 8. 附录

### 8.1 术语表

| 术语 | 说明 |
|------|------|
| Content Script | 注入网页上下文的脚本，可访问 DOM |
| Service Worker | 后台脚本，处理 API 请求和跨域通信 |
| LLM | 大语言模型 (Large Language Model) |
| CET | 大学英语考试 (College English Test) |
| LRU | 最近最少使用 (Least Recently Used) 缓存策略 |

### 8.2 参考资料

- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Zustand State Management](https://docs.pmnd.rs/zustand)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)
