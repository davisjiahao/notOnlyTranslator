# NotOnlyTranslator E2E 测试文档

本文档详细介绍如何使用 Playwright MCP 进行浏览器扩展的自动化测试。

## 📋 目录

- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [MCP 工具列表](#mcp-工具列表)
- [测试用例说明](#测试用例说明)
- [运行测试](#运行测试)
- [故障排除](#故障排除)

## 🚀 快速开始

### 1. 安装依赖

```bash
# 安装项目依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium
```

### 2. 构建扩展

```bash
npm run build
```

### 3. 运行测试

```bash
# 运行所有测试
npx playwright test

# UI 模式（可视化）
npx playwright test --ui

# 调试模式
npx playwright test --debug
```

## 📁 项目结构

```
e2e/
├── fixtures/                     # 测试夹具
│   ├── extension.ts               # 扩展操作工具函数（14个工具）
│   └── test-page.html             # 本地测试页面
├── specs/                         # 测试规范
│   ├── extension-install.spec.ts # 扩展安装测试（3个用例）
│   ├── translation-highlight.spec.ts # 翻译高亮测试（8个用例）
│   ├── translation-workflow.spec.ts # 翻译工作流测试（5个用例）
│   ├── popup-options.spec.ts     # Popup/Options测试（10个用例）
│   └── user-settings.spec.ts     # 用户设置测试（6个用例）
├── global-setup.ts                # 全局测试前设置
├── global-teardown.ts             # 全局测试后清理
└── README.md                      # 本文件
```

## 🛠️ MCP 工具列表

### 1. `browser_navigate`
导航到指定 URL。

**参数：**
- `url`: 目标 URL
- `wait_until`: 等待条件（'load' | 'domcontentloaded' | 'networkidle'）

**示例：**
```typescript
await browser_navigate({
  url: 'https://example.com',
  wait_until: 'domcontentloaded'
});
```

### 2. `browser_click`
点击页面元素。

**参数：**
- `element`: 元素选择器
- `timeout`: 超时时间（毫秒）

**示例：**
```typescript
await browser_click({
  element: '[data-translation-marker]:first-child',
  timeout: 5000
});
```

### 3. `browser_type`
在输入框中输入文本。

**参数：**
- `element`: 输入框选择器
- `text`: 要输入的文本
- `clear`: 是否先清空（默认 true）

**示例：**
```typescript
await browser_type({
  element: 'input[name="apiKey"]',
  text: 'sk-test-123456789',
  clear: true
});
```

### 4. `browser_screenshot`
截图保存。

**参数：**
- `path`: 保存路径
- `full_page`: 是否全页面截图
- `element`: 特定元素选择器（可选）

**示例：**
```typescript
await browser_screenshot({
  path: './test-results/screenshot.png',
  full_page: true
});
```

### 5. `browser_evaluate`
在页面中执行 JavaScript。

**参数：**
- `script`: 要执行的脚本
- `arg`: 传递给脚本的参数（可选）

**示例：**
```typescript
const result = await browser_evaluate({
  script: () => {
    return document.querySelectorAll('.translation-highlight').length;
  }
});
```

### 6. `browser_select_option`
选择下拉框选项。

**参数：**
- `element`: 下拉框选择器
- `value`: 选项值 或 `label`: 选项标签

**示例：**
```typescript
await browser_select_option({
  element: 'select[name="vocabulary-level"]',
  label: 'CET-6'
});
```

### 7. `browser_press_key`
按键操作。

**参数：**
- `key`: 按键名称（如 'Enter', 'Escape', 'Tab'）
- `element`: 目标元素（可选，默认 document）

**示例：**
```typescript
await browser_press_key({
  key: 'Escape'
});
```

### 8. `browser_drag`
拖拽元素。

**参数：**
- `element`: 要拖拽的元素
- `target`: 目标位置（x, y 坐标或目标元素）

**示例：**
```typescript
await browser_drag({
  element: '.draggable',
  target: { x: 100, y: 200 }
});
```

### 9. `browser_hover`
悬停在元素上。

**参数：**
- `element`: 目标元素
- `timeout`: 超时时间

**示例：**
```typescript
await browser_hover({
  element: '.tooltip-trigger',
  timeout: 5000
});
```

## 📊 测试用例说明

### 1. 扩展安装测试 (`extension-install.spec.ts`)

**测试用例：**
- ✅ 扩展 content script 应该成功注入到页面
- ✅ 扩展应该在页面加载后初始化完成
- ✅ 扩展的样式应该正确注入到页面

**目的：** 验证扩展的基本加载和注入功能

### 2. 翻译高亮测试 (`translation-highlight.spec.ts`)

**测试用例：**
- ✅ 应该识别并高亮页面中的难词
- ✅ 简单词汇不应该被高亮
- ✅ 点击标记单词应该显示翻译提示框
- ✅ 翻译提示框应该显示原文和翻译
- ✅ 点击页面其他区域应该关闭翻译提示框
- ✅ 页面滚动后翻译标记应该保持

**目的：** 验证核心翻译功能的正确性

### 3. 翻译工作流测试 (`translation-workflow.spec.ts`)

**测试用例：**
- ✅ 页面加载后应该自动分析并标记难词
- ✅ 点击标记单词应该显示翻译提示框
- ✅ 翻译提示框应该显示原文和翻译
- ✅ 点击页面其他区域应该关闭翻译提示框
- ✅ 长篇文章应该支持分批翻译处理

**目的：** 验证完整的翻译用户流程

### 4. Popup 和 Options 测试 (`popup-options.spec.ts`)

**测试用例：**

**Popup 页面：**
- ✅ Popup 页面应该正确加载
- ✅ Popup 应该显示用户词汇量级别
- ✅ Popup 的设置按钮应该可以打开选项页

**Options 页面：**
- ✅ Options 页面应该正确加载
- ✅ Options 页面应该包含 API 设置部分
- ✅ Options 页面应该包含词汇量设置
- ✅ 保存设置后应该显示成功提示

**目的：** 验证扩展 UI 组件的功能

### 5. 用户设置测试 (`user-settings.spec.ts`)

**测试用例：**

**词汇量级别设置：**
- ✅ 应该能够更改词汇量级别
- ✅ 词汇量级别更改应该持久化

**API 设置：**
- ✅ 应该能够输入 API 密钥
- ✅ API 提供商选择应该可用

**设置导入导出：**
- ✅ 应该有导出设置按钮
- ✅ 应该有导入设置按钮

**扩展状态同步：**
- ✅ Options 中的设置更改应该同步到 Popup

**目的：** 验证设置功能和数据持久化

## ▶️ 运行测试

### 基础命令

```bash
# 运行所有测试
npx playwright test

# 运行特定测试文件
npx playwright test extension-install
n
# 运行特定测试
npx playwright test -g "应该识别并高亮页面中的难词"
```

### 使用便捷脚本

```bash
# 基础运行
./scripts/run-e2e-tests.sh

# UI 模式
./scripts/run-e2e-tests.sh -u

# 调试模式
./scripts/run-e2e-tests.sh -d

# 生成报告
./scripts/run-e2e-tests.sh -r

# 运行特定测试
./scripts/run-e2e-tests.sh -s translation

# 组合选项
./scripts/run-e2e-tests.sh -u -r -s popup
```

### 查看结果

```bash
# 显示 HTML 报告
npx playwright show-report

# 显示痕迹（trace）
npx playwright show-trace trace.zip

# 打开 UI 模式回顾测试
npx playwright test --ui
```

## 🐛 故障排除

### 常见问题

**问题：扩展未加载**
```bash
# 解决方案：确保扩展已构建
npm run build
ls dist/manifest.json  # 验证构建输出
```

**问题：测试超时**
```bash
# 解决方案：增加超时时间
npx playwright test --timeout=60000

# 或在配置中修改
# playwright.config.ts: timeout: 60000
```

**问题：MCP 服务器连接失败**
```bash
# 解决方案：检查 MCP 配置
cat ~/.claude.json | grep -A 10 "mcpServers"

# 重新加载配置：重启 Claude Code
```

**问题：截图不匹配**
```bash
# 解决方案：更新快照
npx playwright test --update-snapshots

# 或忽略快照测试
npx playwright test --grep-invert "snapshot"
```

### 调试技巧

1. **使用 --headed 模式运行**：可以看到浏览器界面
2. **使用 --slowmo 参数**：减慢执行速度便于观察
3. **使用 await page.pause()**：在代码中设置断点
4. **查看 traces**：`npx playwright show-trace trace.zip`
5. **查看视频**：测试失败时自动录制视频

## 📚 相关文档

- [Playwright 官方文档](https://playwright.dev/docs/intro)
- [Chrome 扩展测试指南](https://playwright.dev/docs/chrome-extensions)
- [MCP 协议文档](https://modelcontextprotocol.io/)
- [Playwright MCP 仓库](https://github.com/anthropics/playwright-mcp)

---

**最后更新：** 2025年2月
**维护者：** Claude Code
