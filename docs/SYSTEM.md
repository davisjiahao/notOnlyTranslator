# NotOnlyTranslator 系统设计文档

## 1. 技术栈版本规范

### 1.1 核心依赖版本

| 包名 | 版本 | 说明 |
|------|------|------|
| node | >=18.0.0 | 运行时环境 |
| npm | >=9.0.0 | 包管理器 |
| typescript | ^5.3.3 | 类型系统 |
| vite | ^5.0.0 | 构建工具 |
| @crxjs/vite-plugin | ^2.0.0-beta.21 | Chrome 扩展开发 |
| react | ^18.2.0 | UI 框架 |
| zustand | ^4.5.0 | 状态管理 |
| tailwindcss | ^3.4.1 | CSS 框架 |

### 1.2 开发依赖版本

| 包名 | 版本 | 说明 |
|------|------|------|
| @types/chrome | ^0.0.268 | Chrome API 类型 |
| @types/react | ^18.2.0 | React 类型 |
| @typescript-eslint/* | ^6.18.0 | TypeScript ESLint |
| eslint | ^8.56.0 | 代码检查 |
| eslint-plugin-react-hooks | ^4.6.0 | React Hooks 规则 |
| autoprefixer | ^10.4.16 | CSS 前缀 |
| postcss | ^8.4.33 | CSS 处理 |
| playwright | ^1.41.0 | E2E 测试 |
| @playwright/test | ^1.41.0 | Playwright 测试框架 |

## 2. 项目结构规范

### 2.1 目录结构

```
notOnlyTranslator/
├── .github/                    # GitHub 配置
│   └── workflows/             # CI/CD 工作流
├── agents/                    # AI 代理配置
│   ├── ceo/                  # CEO 代理
│   ├── cto/                  # CTO 代理
│   └── founding-engineer/    # 工程师代理
├── docs/                      # 文档
│   ├── ARCHITECTURE.md       # 架构设计
│   ├── SYSTEM.md             # 系统设计（本文件）
│   └── USER_STORIES.md       # 用户故事
├── public/                    # 静态资源
│   └── icons/                # 扩展图标
├── src/
│   ├── background/           # 后台脚本 (Service Worker)
│   │   ├── index.ts         # 入口
│   │   ├── translation.ts   # 翻译服务
│   │   ├── storage.ts       # 存储管理
│   │   ├── userLevel.ts     # 用户等级
│   │   ├── vocabulary.ts    # 词汇管理
│   │   └── translationApi.ts # API 封装
│   ├── content/             # 内容脚本
│   │   ├── index.ts         # 主类
│   │   ├── highlighter.ts   # 高亮渲染
│   │   ├── tooltip.ts       # 提示框
│   │   ├── marker.ts        # 标记服务
│   │   ├── translationDisplay.ts # 翻译渲染
│   │   ├── viewportObserver.ts # 可视观察
│   │   ├── batchTranslationManager.ts # 批量翻译
│   │   ├── floatingButton.ts  # 浮动按钮
│   │   ├── navigationManager.ts # 导航管理
│   │   ├── pageScanner.ts    # 页面扫描
│   │   ├── hoverManager.ts   # 悬停管理
│   │   └── core/            # 核心模块
│   │       ├── index.ts
│   │       ├── elementPath.ts
│   │       ├── paragraphCache.ts
│   │       └── textExtractor.ts
│   ├── popup/                 # 弹出窗口
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.html
│   │   └── components/       # 弹窗组件
│   ├── options/               # 选项页面
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.html
│   │   └── components/       # 选项组件
│   ├── shared/                # 共享代码
│   │   ├── types/          # TypeScript 类型
│   │   │   └── index.ts
│   │   ├── constants/      # 常量定义
│   │   │   └── index.ts
│   │   └── utils/          # 工具函数
│   │       └── index.ts
│   └── manifest.json          # 扩展清单
├── tests/                     # 测试文件
│   └── e2e/                 # E2E 测试
├── .gitignore
├── .eslintrc.cjs           # ESLint 配置
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json           # TypeScript 配置
├── tsconfig.node.json
└── vite.config.ts          # Vite 配置

```

### 2.2 文件命名规范

| 类型 | 命名规则 | 示例 |
|------|----------|------|
| 组件文件 | PascalCase.tsx | `Tooltip.tsx`, `Highlighter.tsx` |
| 工具文件 | camelCase.ts | `storage.ts`, `userLevel.ts` |
| 类型文件 | camelCase.ts | `types.ts`, `constants.ts` |
| 钩子文件 | use + PascalCase.ts | `useSettings.ts`, `useTranslation.ts` |
| 样式文件 | camelCase.module.css | `tooltip.module.css` |

## 3. 代码规范

### 3.1 TypeScript 规范

#### 3.1.1 类型定义

```typescript
// ✅ 正确：明确类型定义
interface UserProfile {
  examType: ExamType;
  estimatedVocabulary: number;
  knownWords: string[];
}

// ❌ 错误：使用 any
type BadProfile = any;

// ✅ 正确：使用联合类型
type TranslationMode = 'inline-only' | 'bilingual' | 'full-translate';

// ✅ 正确：函数返回值类型
async function translateText(text: string): Promise<TranslationResult> {
  // ...
}
```

#### 3.1.2 接口与类型别名

```typescript
// ✅ 使用 interface 定义对象结构
interface ApiConfig {
  id: string;
  provider: ApiProvider;
  apiKey: string;
}

// ✅ 使用 type 定义联合类型或复杂类型
type ApiProvider = 'openai' | 'anthropic' | 'deepseek';
type Nullable<T> = T | null;

// ✅ 使用 enum 定义常量集合（谨慎使用，优先使用联合类型）
const enum MessageType {
  TRANSLATE_TEXT = 'TRANSLATE_TEXT',
  GET_SETTINGS = 'GET_SETTINGS',
}
```

### 3.2 React 组件规范

#### 3.2.1 函数组件

```tsx
// ✅ 正确：使用函数声明 + 类型化 Props
interface TooltipProps {
  word: string;
  translation: string;
  onMarkKnown: () => void;
  onMarkUnknown: () => void;
}

function Tooltip({ word, translation, onMarkKnown, onMarkUnknown }: TooltipProps): JSX.Element {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="tooltip">
      <span className="word">{word}</span>
      <span className="translation">{translation}</span>
      <button onClick={onMarkKnown}>已知</button>
      <button onClick={onMarkUnknown}>未知</button>
    </div>
  );
}

// ✅ 正确：默认导出使用命名函数
export default Tooltip;
```

#### 3.2.2 Hooks 使用规范

```tsx
// ✅ 正确：Hooks 在组件顶部调用
function useTranslation() {
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // ✅ 使用 useCallback 缓存函数
  const translate = useCallback(async (text: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await translationService.translate(text);
      setResult(result);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Translation failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  // ✅ 使用 useEffect 处理副作用
  useEffect(() => {
    return () => {
      // 清理逻辑
    };
  }, []);

  return { result, loading, error, translate };
}
```

### 3.3 代码风格

#### 3.3.1 ESLint 配置

```javascript
// .eslintrc.cjs
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/no-explicit-any': 'error',
  },
};
```

#### 3.3.2 命名规范

```typescript
// ✅ 变量命名
const userProfile: UserProfile = { ... };  // 名词 + 类型
const isTranslationEnabled = true;          // 布尔值前缀 is/has/should
const MAX_RETRY_COUNT = 3;                  // 常量全大写下划线
const handleButtonClick = () => { ... };  // 事件处理 handle + Event
const fetchUserData = async () => { ... }; // 异步操作 fetch/get/load

// ✅ 函数命名
function calculateVocabularyLevel(): number { ... }  // 动词 + 宾语
function validateApiConfig(config: ApiConfig): boolean { ... }
async function translateParagraph(text: string): Promise<TranslationResult> { ... }

// ✅ 类命名
class TranslationService { ... }      // 名词，首字母大写
class BatchTranslationManager { ... } // 名词 + Manager/Service/Controller
class ApiError extends Error { ... }   // 异常类

// ✅ 接口命名
interface UserProfile { ... }          // 名词
interface TranslationRequest { ... }   // 名词 + Request/Response/Config
interface Cacheable { ... }            // 形容词（能力接口）
```

## 4. Git 工作流

### 4.1 分支策略

```
main                    production 分支，稳定版本
  │
  ├── develop           开发分支，功能集成
  │     │
  │     ├── feature/translation-modes    功能分支
  │     ├── feature/batch-translation
  │     └── feature/multi-llm-support
  │
  ├── hotfix/security-fix   紧急修复
  └── release/v1.0.0        发布分支
```

### 4.2 提交规范

使用 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

#### 类型说明

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat: add batch translation support` |
| `fix` | Bug 修复 | `fix: resolve tooltip positioning issue` |
| `docs` | 文档更新 | `docs: update API documentation` |
| `style` | 代码格式 | `style: format with prettier` |
| `refactor` | 代码重构 | `refactor: simplify translation service` |
| `perf` | 性能优化 | `perf: improve cache hit rate` |
| `test` | 测试相关 | `test: add unit tests for utils` |
| `chore` | 构建/工具 | `chore: update dependencies` |

#### 示例提交

```bash
# 功能提交
git commit -m "feat(translation): add bilingual mode support

- Implement side-by-side translation display
- Add hover effects to link original and translation
- Update settings to include bilingual mode option

Co-Authored-By: Paperclip <noreply@paperclip.ing>"

# Bug 修复
git commit -m "fix(storage): resolve cache expiration issue

Cache entries were not being properly expired due to incorrect
timestamp comparison. Fixed by using Date.now() consistently.

Fixes #123"

# 文档更新
git commit -m "docs: add architecture design document

- Add system architecture diagram
- Document data flow and caching strategy
- Include security considerations"
```

### 4.3 代码审查流程

1. **创建 Pull Request**
   - 从功能分支提交到 `develop` 分支
   - 填写 PR 模板，包括：
     - 变更摘要
     - 测试计划
     - 相关 Issue

2. **自动化检查**
   - CI 构建必须通过
   - 单元测试覆盖率 > 80%
   - ESLint 无错误
   - TypeScript 类型检查通过

3. **人工审查**
   - 至少需要 1 名审查者批准
   - 检查：代码风格、架构合理性、安全性
   - 所有评论必须解决后才能合并

4. **合并策略**
   - 使用 `Squash and Merge` 保持历史整洁
   - 确保提交信息符合规范

## 5. 开发环境配置

### 5.1 环境要求

| 工具 | 最低版本 | 推荐版本 |
|------|----------|----------|
| Node.js | 18.0.0 | 20.x LTS |
| npm | 9.0.0 | 10.x |
| Git | 2.30.0 | 2.40+ |
| Chrome | 100+ | 最新 |

### 5.2 开发环境搭建

```bash
# 1. 克隆仓库
git clone https://github.com/username/notOnlyTranslator.git
cd notOnlyTranslator

# 2. 安装依赖
npm install

# 3. 安装 Playwright 浏览器（用于 E2E 测试）
npx playwright install chromium

# 4. 启动开发服务器
npm run dev

# 5. 构建扩展
npm run build

# 6. 加载到 Chrome
# - 打开 chrome://extensions/
# - 开启开发者模式
# - 点击「加载已解压的扩展程序」
# - 选择 dist 文件夹
```

### 5.3 环境变量

创建 `.env.local` 文件（不提交到版本控制）：

```bash
# 开发配置
VITE_DEV_MODE=true
VITE_LOG_LEVEL=debug

# 可选：测试 API Key（仅本地开发使用）
VITE_TEST_OPENAI_KEY=sk-...
```

### 5.4 VS Code 配置

推荐的 `.vscode/settings.json`：

```json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "files.exclude": {
    "**/node_modules": true,
    "**/dist": true
  }
}
```

推荐的 `.vscode/extensions.json`：

```json
{
  "recommendations": [
    "esbenp.prettier-vscode",
    "dbaeumer.vscode-eslint",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.vscode-typescript-next",
    "github.vscode-pull-request-github"
  ]
}
```

## 6. 测试策略

### 6.1 测试金字塔

```
        /\
       /  \
      / E2E \         # Playwright 端到端测试 (10%)
     /--------\
    /          \
   / Integration \    # 集成测试 (20%)
  /----------------\
 /                  \
/     Unit Tests     \ # Jest/Vitest 单元测试 (70%)
/----------------------\
```

### 6.2 单元测试规范

```typescript
// utils/translation.test.ts
import { describe, it, expect, vi } from 'vitest';
import { generateCacheKey, normalizeText } from './translation';

describe('generateCacheKey', () => {
  it('应该为相同文本和模式生成相同的缓存键', () => {
    const key1 = generateCacheKey('Hello world', 'inline-only');
    const key2 = generateCacheKey('Hello world', 'inline-only');
    expect(key1).toBe(key2);
  });

  it('应该为不同模式生成不同的缓存键', () => {
    const key1 = generateCacheKey('Hello', 'inline-only');
    const key2 = generateCacheKey('Hello', 'bilingual');
    expect(key1).not.toBe(key2);
  });
});

describe('normalizeText', () => {
  it('应该去除多余空格', () => {
    expect(normalizeText('  Hello   world  ')).toBe('Hello world');
  });

  it('应该统一转为小写', () => {
    expect(normalizeText('HELLO')).toBe('hello');
  });
});
```

### 6.3 E2E 测试规范

```typescript
// tests/e2e/translation.spec.ts
import { test, expect } from '@playwright/test';

test.describe('翻译功能', () => {
  test.beforeEach(async ({ page, extensionId }) => {
    // 加载扩展并设置测试环境
    await page.goto('https://example.com/article');
    await page.waitForLoadState('networkidle');
  });

  test('应该高亮并翻译生僻词', async ({ page }) => {
    // 等待翻译完成
    await page.waitForSelector('.not-translator-highlight', { timeout: 10000 });

    // 验证高亮元素存在
    const highlights = await page.$$('.not-translator-highlight');
    expect(highlights.length).toBeGreaterThan(0);

    // 点击高亮词显示 Tooltip
    await highlights[0].click();
    await page.waitForSelector('.not-translator-tooltip', { timeout: 2000 });

    // 验证 Tooltip 内容
    const tooltipText = await page.textContent('.not-translator-tooltip');
    expect(tooltipText).toContain('翻译');
  });

  test('应该切换翻译模式', async ({ page, extensionId }) => {
    // 打开选项页面
    await page.goto(`chrome-extension://${extensionId}/options.html`);

    // 切换翻译模式
    await page.selectOption('[name="translationMode"]', 'bilingual');
    await page.click('button[type="submit"]');

    // 验证保存成功
    await expect(page.locator('.success-message')).toBeVisible();
  });
});
```

## 7. 性能监控

### 7.1 性能指标

| 指标 | 目标值 | 监控方式 |
|------|--------|----------|
| Content Script 注入 | < 50ms | `performance.now()` |
| 首屏翻译完成 | < 2s | 自定义打点 |
| API 响应时间 | < 3s | 日志记录 |
| 内存占用 | < 100MB | Chrome DevTools |
| 缓存命中率 | > 80% | 自定义统计 |

### 7.2 性能日志

```typescript
// shared/utils/performance.ts
export class PerformanceMonitor {
  private static marks: Map<string, number> = new Map();

  static start(markName: string): void {
    this.marks.set(markName, performance.now());
  }

  static end(markName: string): number | null {
    const start = this.marks.get(markName);
    if (!start) return null;

    const duration = performance.now() - start;
    this.marks.delete(markName);

    // 记录性能指标
    logger.info(`[Performance] ${markName}: ${duration.toFixed(2)}ms`);

    // 慢操作警告
    if (duration > 1000) {
      logger.warn(`[Performance] Slow operation detected: ${markName} took ${duration.toFixed(2)}ms`);
    }

    return duration;
  }
}

// 使用示例
async function translateParagraph(text: string): Promise<TranslationResult> {
  PerformanceMonitor.start('translateParagraph');

  try {
    const result = await translationService.translate(text);
    return result;
  } finally {
    PerformanceMonitor.end('translateParagraph');
  }
}
```

## 8. 错误处理规范

### 8.1 错误分类

| 错误类型 | HTTP 状态 | 处理策略 |
|----------|-----------|----------|
| 网络错误 | 0/Network Error | 重试 3 次，失败后提示用户 |
| API 限流 | 429 | 指数退避重试，最大 60s |
| API 错误 | 4xx/5xx | 显示详细错误信息 |
| 超时错误 | Timeout | 提示用户检查网络 |

### 8.2 错误处理模式

```typescript
// 带重试的异步操作
async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    shouldRetry?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    shouldRetry = () => true,
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries || !shouldRetry(lastError)) {
        throw lastError;
      }

      // 指数退避
      const delay = retryDelay * Math.pow(2, attempt);
      logger.info(`Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// 使用示例
async function translateWithRetry(text: string): Promise<TranslationResult> {
  return withRetry(
    () => translationService.translate(text),
    {
      maxRetries: 3,
      retryDelay: 1000,
      shouldRetry: (error) => {
        // 只重试网络错误和 5xx 错误
        return error.message.includes('network') ||
               error.message.includes('timeout') ||
               error.message.includes('500');
      },
    }
  );
}
```

## 9. 安全规范

### 9.1 API 密钥安全

```typescript
// ✅ 正确：安全的 API Key 存储
class SecureApiKeyManager {
  // API Key 只存储在 Chrome Sync Storage（加密）
  async saveApiKey(configId: string, apiKey: string): Promise<void> {
    // 加密存储（Chrome 自动加密）
    await chrome.storage.sync.set({
      [`apiKey_${configId}`]: apiKey,
    });
  }

  async getApiKey(configId: string): Promise<string | null> {
    const result = await chrome.storage.sync.get(`apiKey_${configId}`);
    return result[`apiKey_${configId}`] || null;
  }

  // 内存中不长期保存 API Key
  async clearMemoryCache(): Promise<void> {
    // 清除任何内存中的缓存
  }
}

// ❌ 错误：不安全的做法
const badExample = {
  // 不要硬编码 API Key
  apiKey: 'sk-1234567890',

  // 不要存储在 localStorage（明文）
  saveToLocalStorage: (key: string) => {
    localStorage.setItem('apiKey', key);
  },

  // 不要在日志中打印 API Key
  logConfig: (config: ApiConfig) => {
    console.log('Config:', config); // 可能包含 API Key
  },
};
```

### 9.2 内容安全策略

```json
{
  "manifest_version": 3,
  "name": "NotOnlyTranslator",
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; connect-src 'self' https://api.openai.com https://api.anthropic.com https://*.deepseek.com https://*.zhipu.ai"
  }
}
```

### 9.3 输入验证

```typescript
import { z } from 'zod';

// 定义验证 Schema
const translationRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  mode: z.enum(['inline-only', 'bilingual', 'full-translate']),
  context: z.string().max(5000).optional(),
});

const apiConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'deepseek', 'zhipu']),
  apiKey: z.string().min(10).regex(/^sk-/), // OpenAI 格式示例
  modelName: z.string().optional(),
});

// 使用验证
async function handleTranslationRequest(
  payload: unknown
): Promise<TranslationResult> {
  // 验证输入
  const result = translationRequestSchema.safeParse(payload);

  if (!result.success) {
    // 记录详细错误但不暴露给客户端
    logger.error('Invalid translation request:', result.error);
    throw new Error('Invalid request format');
  }

  const { text, mode, context } = result.data;

  // 继续处理...
  return await translationService.translate({ text, mode, context });
}
```

## 10. 监控与日志

### 10.1 日志级别

```typescript
// shared/utils/logger.ts
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...args);
    }
  }

  error(message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...args);

      // 可以在这里上报到错误监控服务
      this.reportError(message, args);
    }
  }

  private reportError(message: string, args: unknown[]): void {
    // 实现错误上报逻辑
    // 例如：发送到 Sentry、LogRocket 等
  }
}

export const logger = new Logger();
```

### 10.2 性能监控

```typescript
// shared/utils/performance.ts
export class PerformanceMonitor {
  private static marks = new Map<string, number>();
  private static metrics: Array<{
    name: string;
    duration: number;
    timestamp: number;
  }> = [];

  static start(markName: string): void {
    this.marks.set(markName, performance.now());
  }

  static end(markName: string): number | null {
    const start = this.marks.get(markName);
    if (!start) return null;

    const duration = performance.now() - start;
    this.marks.delete(markName);

    // 记录指标
    this.metrics.push({
      name: markName,
      duration,
      timestamp: Date.now(),
    });

    // 清理旧数据（只保留最近 100 条）
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }

    // 慢操作警告
    if (duration > 1000) {
      logger.warn(`[Performance] Slow operation: ${markName} took ${duration.toFixed(2)}ms`);
    } else {
      logger.debug(`[Performance] ${markName}: ${duration.toFixed(2)}ms`);
    }

    return duration;
  }

  static getMetrics(): Array<{ name: string; duration: number; timestamp: number }> {
    return [...this.metrics];
  }

  static getAverageTime(markName: string): number {
    const relevantMetrics = this.metrics.filter(m => m.name === markName);
    if (relevantMetrics.length === 0) return 0;

    const total = relevantMetrics.reduce((sum, m) => sum + m.duration, 0);
    return total / relevantMetrics.length;
  }

  static clearMetrics(): void {
    this.metrics = [];
    this.marks.clear();
  }
}

// 装饰器模式（可选）
export function measurePerformance(target: unknown, propertyKey: string, descriptor: PropertyDescriptor) {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: unknown[]) {
    const markName = `${target.constructor.name}.${propertyKey}`;
    PerformanceMonitor.start(markName);

    try {
      const result = await originalMethod.apply(this, args);
      return result;
    } finally {
      PerformanceMonitor.end(markName);
    }
  };

  return descriptor;
}
```

## 11. 文档维护

### 11.1 文档结构

```
docs/
├── README.md              # 项目介绍和快速开始
├── ARCHITECTURE.md        # 架构设计文档（已创建）
├── SYSTEM.md              # 系统设计文档（本文件）
├── USER_STORIES.md        # 用户故事
├── API.md                 # API 文档（如需要）
├── DEPLOYMENT.md          # 部署指南
├── TROUBLESHOOTING.md     # 故障排除
└── CHANGELOG.md           # 变更日志
```

### 11.2 文档更新规范

1. **架构变更**：修改代码前更新 ARCHITECTURE.md
2. **新功能**：提交 PR 时更新相关文档
3. **Bug 修复**：在 CHANGELOG.md 记录
4. **版本发布**：更新版本号和发布说明

---

## 12. 附录

### 12.1 常用命令速查

```bash
# 开发
npm run dev              # 启动开发服务器
npm run build            # 生产构建
npm run preview          # 预览生产构建

# 代码质量
npm run lint             # ESLint 检查
npm run lint:fix         # 自动修复
npm run type-check       # TypeScript 类型检查

# 测试
npm run test             # 运行单元测试
npm run test:e2e         # 运行 E2E 测试
npm run test:coverage    # 生成覆盖率报告

# 版本管理
npm version patch        # 补丁版本 +1
npm version minor        # 次版本 +1
npm version major        # 主版本 +1
```

### 12.2 参考资源

- [Chrome Extension API 文档](https://developer.chrome.com/docs/extensions/reference/)
- [React 官方文档](https://react.dev/)
- [TypeScript 手册](https://www.typescriptlang.org/docs/)
- [Tailwind CSS 文档](https://tailwindcss.com/docs)
- [Zustand 文档](https://docs.pmnd.rs/zustand)

---

**文档版本**: 1.0.0
**最后更新**: 2026-03-14
**维护者**: CTO Agent
