# 研发规范 (Development Standards)

本文档定义了 NotOnlyTranslator 项目的研发流程规范，涵盖分支管理、测试要求和代码提交流程。

## 分支管理策略

### 主分支

- `main` - 主分支，始终保持可发布状态
- `main` 分支只能通过 Pull Request 合并，禁止直接推送

### 功能分支

**所有新功能开发必须从 `main` 创建新分支。**

#### 分支命名规范

```
<type>/<short-description>
```

**类型 (type):**
- `feature/` - 新功能开发
- `fix/` - Bug 修复
- `refactor/` - 代码重构
- `docs/` - 文档更新
- `test/` - 测试相关
- `chore/` - 构建/工具配置

**示例:**
```bash
feature/vocabulary-import
fix/translation-cache-timeout
refactor/storage-adapter
docs/api-reference
```

### 分支创建流程

```bash
# 1. 确保本地 main 分支是最新的
git checkout main
git pull origin main

# 2. 创建并切换到新分支
git checkout -b feature/your-feature-name

# 3. 推送分支到远程
git push -u origin feature/your-feature-name
```

## 开发工作流

### 1. 开始新功能

```bash
# 从 main 创建分支
git checkout main
git pull origin main
git checkout -b feature/my-new-feature
```

### 2. 开发过程

- 保持提交粒度小而清晰
- 每个提交应该代表一个逻辑上的完整变更
- 定期从 main 同步，解决冲突

```bash
# 提交变更
git add .
git commit -m "feat: add vocabulary import feature"

# 同步 main 分支的最新更改
git fetch origin
git rebase origin/main
```

### 3. 完成开发

**在提交代码前，必须完成以下步骤：**

#### 代码质量检查

```bash
# TypeScript 类型检查
npm run type-check

# ESLint 检查
npm run lint

# 构建测试
npm run build
```

**以上检查必须全部通过，否则不允许提交 PR。**

## 测试要求

### 测试类型

#### 1. 单元测试 (Unit Tests)

- 测试独立的函数和组件
- 使用 Vitest 测试框架
- 覆盖率要求：**80%+**

```typescript
// 示例：测试工具函数
import { describe, it, expect } from 'vitest'
import { parseVocabularyLevel } from '../utils/level'

describe('parseVocabularyLevel', () => {
  it('should return beginner for level 1', () => {
    expect(parseVocabularyLevel(1)).toBe('beginner')
  })

  it('should return advanced for level 5', () => {
    expect(parseVocabularyLevel(5)).toBe('advanced')
  })
})
```

#### 2. 集成测试 (Integration Tests)

- 测试模块间的交互
- 测试 Chrome API 集成
- 测试 Storage 操作

#### 3. 手动测试 (Manual Testing)

在提交 PR 前，必须进行以下手动测试：

```bash
# 1. 构建扩展
npm run build

# 2. 在 Chrome 开发者模式加载 dist 目录
# 3. 测试核心功能：
#    - 页面翻译高亮
#    - 单词标记（已知/未知）
#    - Popup 设置页面
#    - Options 配置页面
```

### 测试命令

```bash
# 运行所有测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 运行特定测试文件
npm test -- src/utils/level.test.ts
```

### 测试通过标准

- [ ] 所有单元测试通过
- [ ] 代码覆盖率 >= 80%
- [ ] TypeScript 类型检查通过
- [ ] ESLint 无错误无警告
- [ ] 构建成功无错误
- [ ] Chrome 扩展手动测试通过

## Pull Request 流程

### 提交 PR 前的准备

1. **完成功能实现**
2. **本地测试全部通过**
3. **同步 main 分支**

```bash
git fetch origin
git rebase origin/main
```

### PR 提交

1. **推送到远程**

```bash
git push origin feature/your-feature-name
```

2. **创建 Pull Request**

在 GitHub 上创建 PR，遵循以下规范：

#### PR 标题格式

```
<type>: <简短描述>
```

**类型：**
- `feat:` - 新功能
- `fix:` - Bug 修复
- `refactor:` - 代码重构
- `docs:` - 文档更新
- `test:` - 测试相关
- `chore:` - 构建/配置变更

**示例：**
```
feat: add vocabulary import from CSV
fix: resolve translation cache timeout issue
refactor: simplify storage adapter implementation
```

#### PR 描述模板

```markdown
## 变更内容
- 实现了 XXX 功能
- 修复了 YYY 问题
- 优化了 ZZZ 性能

## 测试情况
- [ ] 单元测试通过
- [ ] 覆盖率 >= 80%
- [ ] 手动测试通过

## 相关 Issue
Closes #123

## 截图（如适用）
[功能截图]
```

### PR 审查

- 至少需要 **1 个审查者** 批准
- 审查者应该检查：
  - 代码逻辑正确性
  - 是否符合代码规范
  - 测试覆盖是否充分
  - 是否有潜在问题

### 合并到 main

PR 审查通过后：

1. **使用 "Squash and Merge" 方式合并**
2. **删除功能分支**

```bash
# 本地删除已合并的分支
git checkout main
git pull origin main
git branch -d feature/your-feature-name

# 删除远程分支
git push origin --delete feature/your-feature-name
```

## 提交信息规范

### 格式

```
<type>: <subject>

<body>

<footer>
```

### 类型

| 类型 | 说明 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式调整（不影响功能） |
| `refactor` | 代码重构 |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `chore` | 构建/工具变更 |
| `ci` | CI/CD 配置 |

### 示例

```bash
feat: add vocabulary level estimation

Implement Bayesian estimation for user vocabulary level
based on word interaction history.

Closes #45
```

## 代码规范

### 必须遵守

1. **使用 TypeScript** - 所有新代码必须是 TypeScript
2. **类型注解** - 函数参数和返回值必须有类型注解
3. **不可变性** - 创建新对象，禁止直接修改
4. **错误处理** - 必须处理所有可能的错误
5. **Tailwind CSS** - 使用 Tailwind 进行样式设置

### ESLint 配置

项目使用严格的 ESLint 配置：

```bash
# 检查代码
npm run lint

# 自动修复可修复的问题
npm run lint:fix
```

**零容忍政策：** 任何 ESLint 错误都会阻止构建。

## 快速检查清单

### 提交 PR 前

- [ ] 从最新的 `main` 分支创建
- [ ] 代码已完成实现
- [ ] 本地测试全部通过 (`npm test`)
- [ ] 覆盖率 >= 80% (`npm run test:coverage`)
- [ ] TypeScript 类型检查通过 (`npm run type-check`)
- [ ] ESLint 检查通过 (`npm run lint`)
- [ ] 构建成功 (`npm run build`)
- [ ] Chrome 扩展手动测试通过
- [ ] 提交信息符合规范

### 代码审查时

- [ ] 代码逻辑正确
- [ ] 符合代码规范
- [ ] 测试覆盖充分
- [ ] 无潜在安全问题
- [ ] 性能无显著下降

## 示例工作流

### 完整示例：添加新功能

```bash
# 1. 开始开发
git checkout main
git pull origin main
git checkout -b feature/word-highlight-animation

# 2. 开发...（编写代码和测试）

# 3. 提交代码
git add .
git commit -m "feat: add word highlight animation"

# 4. 质量检查
npm run type-check
npm run lint
npm run build
npm test

# 5. 同步 main
git fetch origin
git rebase origin/main

# 6. 推送并创建 PR
git push -u origin feature/word-highlight-animation

# 7. 在 GitHub 创建 PR，等待审查

# 8. 审查通过后合并
```

## 紧急情况处理

### 发现 main 分支有 Bug

```bash
# 1. 从 main 创建 hotfix 分支
git checkout main
git pull origin main
git checkout -b fix/critical-bug-name

# 2. 修复 Bug

# 3. 快速测试后提交 PR
```

### 需要回滚

```bash
# 使用 git revert 创建回滚提交
git revert <commit-hash>
git push origin main
```

---

**最后更新：** 2026-03-15

如有疑问，请在 Issue 中提出。
