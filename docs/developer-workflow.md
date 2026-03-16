# 开发者工作流程指南

## 概述

本文档定义了 NotOnlyTranslator 项目的标准化开发工作流程，旨在提高代码质量、协作效率和发布可靠性。

## 开发环境设置

### 前置要求

- Node.js 18+
- npm 9+
- Git
- Chrome/Edge 浏览器（用于测试扩展）

### 初始设置

```bash
# 克隆仓库
git clone <repository-url>
cd notOnlyTranslator

# 安装依赖
npm install

# 生成图标资源
npm run generate-icons
```

## 分支策略

### 分支类型

- `main` - 生产分支，保持稳定可发布状态
- `feature/*` - 功能分支，用于新功能开发
- `fix/*` - 修复分支，用于 bug 修复
- `refactor/*` - 重构分支，用于代码重构

### 工作流程

1. 从 `main` 创建功能分支：`git checkout -b feature/CMP-XX-short-description`
2. 在分支上进行开发
3. 提交前运行完整检查
4. 发起 Pull Request 到 `main`
5. 通过代码审查后合并

## 开发命令

### 常用命令

```bash
# 开发模式（热重载）
npm run dev

# 生产构建
npm run build

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 运行测试
npm run test

# 运行测试（覆盖率）
npm run test:coverage
```

### 扩展测试流程

1. 运行 `npm run build` 生成生产版本
2. 打开 Chrome/Edge 扩展管理页面 (`chrome://extensions/`)
3. 启用开发者模式
4. 点击"加载已解压的扩展程序"
5. 选择项目中的 `dist` 文件夹
6. 测试扩展功能
7. 修改代码后，点击扩展卡片上的刷新按钮重新加载

## 代码规范

### TypeScript 规范

- 严格类型检查启用
- 避免使用 `any` 类型
- 接口命名使用 `PascalCase`
- 类型定义放在 `src/types/` 目录

### 代码风格

- 使用单引号
- 缩进 2 个空格
- 最大行宽 100 字符
- 尾随逗号（多行对象/数组）

### 命名规范

- 组件：PascalCase（如 `FlashcardReview.tsx`）
- 工具函数：camelCase（如 `formatDate.ts`）
- 常量：UPPER_SNAKE_CASE
- 类型/接口：PascalCase 前缀 I（可选）

## 测试规范

### 测试结构

```typescript
describe('FeatureName', () => {
  describe('methodName', () => {
    it('should do something when condition', () => {
      // 测试代码
    });

    it('should handle error case', () => {
      // 错误处理测试
    });
  });
});
```

### 测试覆盖率要求

- 语句覆盖率：≥ 80%
- 分支覆盖率：≥ 80%
- 函数覆盖率：≥ 80%
- 行覆盖率：≥ 80%

### 测试类型

1. **单元测试** - 测试独立函数和组件
2. **集成测试** - 测试模块间交互
3. **E2E 测试** - 使用 Playwright 测试完整用户流程

## Git 工作流

### 提交信息规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

类型（type）：
- `feat`: 新功能
- `fix`: Bug 修复
- `docs`: 文档更新
- `style`: 代码格式调整（不影响功能）
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建/工具/依赖更新

示例：
```
feat(flashcard): 添加闪卡复习动画效果

- 添加翻转动画
- 添加进度指示器
- 优化移动端体验

Closes CMP-21
```

### 提交前检查清单

- [ ] 代码通过 TypeScript 类型检查
- [ ] ESLint 无警告
- [ ] 所有测试通过
- [ ] 新增功能包含测试
- [ ] 提交信息符合规范

## CI/CD 流程

### GitHub Actions 工作流

**CI 工作流**（`.github/workflows/ci.yml`）：
1. 代码检出
2. Node.js 环境设置
3. 依赖安装
4. 类型检查
5. ESLint 检查
6. 测试运行
7. 生产构建

### 发布流程

1. 更新版本号（`package.json`）
2. 更新 `CHANGELOG.md`
3. 创建发布分支
4. 运行完整测试
5. 构建生产版本
6. 打包扩展（`zip -r extension.zip dist/`）
7. 上传到 Chrome Web Store
8. 打标签并合并到 main

## 调试技巧

### 扩展调试

1. **查看背景脚本日志**：
   - 打开 `chrome://extensions/`
   - 找到扩展，点击"背景页"链接
   - 查看 Console 标签

2. **查看内容脚本日志**：
   - 在网页上按 F12 打开开发者工具
   - 查看 Console 标签

3. **弹出窗口调试**：
   - 右键点击扩展图标
   - 选择"检查弹出内容"

### 常见问题

**问题：扩展无法加载**
- 检查 `dist` 文件夹是否存在
- 检查 `manifest.json` 是否有效
- 检查文件路径是否正确

**问题：热重载不工作**
- 确保 `npm run dev` 正在运行
- 检查 Vite 配置
- 手动刷新扩展

**问题：API 调用失败**
- 检查 API 密钥配置
- 查看背景脚本日志
- 检查网络连接

## 相关资源

- [Chrome Extension 文档](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 迁移指南](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Vite 文档](https://vitejs.dev/guide/)
- [Vitest 文档](https://vitest.dev/guide/)
- [项目 Wiki](./wiki/)

---

*最后更新：2026-03-16*
