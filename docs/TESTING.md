# 浏览器扩展测试流程

本文档定义了 notOnlyTranslator 浏览器扩展的标准测试流程，确保每次代码提交前都经过充分的浏览器验证。

## 📋 测试流程概览

```
代码变更
    ↓
构建扩展 (npm run build)
    ↓
单元测试 (npm test)
    ↓
E2E 自动化测试 (npm run test:e2e)
    ↓
手动验证 (可选)
    ↓
提交代码
```

## 🚀 快速测试命令

### 完整测试套件
```bash
# 运行所有测试（推荐在提交前执行）
npm run test:full
```

### 分阶段测试

#### 1. 单元测试
```bash
# 运行单元测试
npm test

# 带覆盖率报告
npm run test:coverage
```

#### 2. 构建验证
```bash
# 构建扩展
npm run build

# 验证构建输出
ls dist/manifest.json
ls dist/background.js
```

#### 3. E2E 测试
```bash
# 运行所有 E2E 测试
npm run test:e2e

# UI 模式（可视化调试）
npm run test:e2e:ui

# 调试模式
npm run test:e2e:debug

# 仅运行特定测试
npx playwright test extension-install
npx playwright test translation-highlight
```

## 🧪 测试分类

### 1. 单元测试 (Unit Tests)

**位置**: `tests/unit/`

**覆盖模块**:
- 背景脚本逻辑
- 内容脚本功能
- 存储管理
- 翻译 API
- 提示词系统
- 性能监控

**运行**:
```bash
npm test
```

### 2. E2E 测试 (End-to-End)

**位置**: `e2e/specs/`

**测试场景**:
| 测试文件 | 用例数 | 描述 |
|----------|--------|------|
| extension-install.spec.ts | 3 | 扩展安装和注入 |
| translation-highlight.spec.ts | 8 | 翻译高亮功能 |
| translation-workflow.spec.ts | 5 | 完整翻译流程 |
| popup-options.spec.ts | 10 | Popup/Options 页面 |
| user-settings.spec.ts | 6 | 用户设置功能 |

**运行**:
```bash
npm run test:e2e
```

### 3. 手动测试清单

在以下情况需要手动验证：
- 新功能首次实现
- UI 重大变更
- 涉及浏览器特定行为

**手动测试步骤**:
1. 构建扩展: `npm run build`
2. 打开 Chrome/Edge 开发者模式
3. 加载已解压的扩展 (dist 目录)
4. 访问测试页面验证功能
5. 验证 Popup 和 Options 页面

## 🔧 测试环境配置

### 环境要求
- Node.js 18+
- Chrome 或 Edge 浏览器
- Playwright 已安装

### 安装 Playwright
```bash
npx playwright install chromium
```

### 验证测试环境
```bash
# 检查 Playwright 安装
npx playwright --version

# 检查 Chromium 可用性
npx playwright chromium --version
```

## 📝 提交前检查清单

在提交代码前，必须完成以下检查：

- [ ] 代码已保存并通过 ESLint
- [ ] TypeScript 编译无错误 (`npm run type-check`)
- [ ] 单元测试全部通过 (`npm test`)
- [ ] 扩展成功构建 (`npm run build`)
- [ ] E2E 测试通过 (`npm run test:e2e`)
- [ ] 关键功能已手动验证 (如需要)

## 🐛 故障排除

### 扩展未加载
```bash
# 重新构建
npm run build

# 验证 manifest.json 存在
cat dist/manifest.json
```

### E2E 测试失败
```bash
# 更新 Playwright
npx playwright install chromium

# 清除缓存重新运行
rm -rf e2e-report test-results
npm run test:e2e
```

### 测试超时
```bash
# 增加超时时间
npx playwright test --timeout=60000
```

## 📊 测试报告

测试完成后，可以查看以下报告：

- **单元测试覆盖率**: `coverage/index.html`
- **E2E HTML 报告**: `e2e-report/index.html`
- **性能报告**: `benchmark/results/performance-report.json`

```bash
# 查看 E2E 报告
npx playwright show-report
```

## 🔄 CI/CD 集成

在持续集成环境中，使用以下命令：

```bash
# 完整测试流程
npm ci
npm run type-check
npm run lint
npm test
npm run build
npm run test:e2e
```

## 📚 相关文档

- [E2E 测试详细文档](./e2e/README.md)
- [Playwright 配置](../playwright.config.ts)
- [CLAUDE.md](../CLAUDE.md) - 项目开发指南

---

**最后更新**: 2026-03-21
**维护者**: CTO
