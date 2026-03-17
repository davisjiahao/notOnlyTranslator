# Paperclip 状态同步工具

此目录包含用于维护项目状态文件同步的自动化脚本。

## 文件说明

| 文件 | 用途 |
|------|------|
| `status-sync.sh` | 主脚本 - 自动生成统一的项目状态报告 |
| `README.md` | 本文档 |

## 使用方法

### 手动运行

```bash
# 进入项目根目录
cd /Users/hungrywu/Documents/opensrc/notOnlyTranslator

# 运行状态同步脚本
bash .paperclip/scripts/status-sync.sh
```

### 输出

脚本将在 `.paperclip/board/` 目录下生成统一的状态文件，格式为：

```
YYYY-MM-DD-project-status.md
```

### 自动清理

脚本会自动清理 7 天以上的旧状态文件，保持目录整洁。

## 集成到工作流

### Git 提交钩子（推荐）

添加 Git post-commit 钩子，在每次提交后自动更新状态：

```bash
# 创建 post-commit 钩子
cat > .git/hooks/post-commit << 'EOF'
#!/bin/bash
# 在后台运行状态同步（不阻塞提交）
(
  cd "$(git rev-parse --show-toplevel)"
  bash .paperclip/scripts/status-sync.sh > /dev/null 2>&1
) &
EOF

chmod +x .git/hooks/post-commit
```

### Sprint 结束流程

在 Sprint 结束时运行脚本，生成最终的 Sprint 状态报告：

```bash
# Sprint 结束时
bash .paperclip/scripts/status-sync.sh

# 然后归档报告
cp .paperclip/board/$(date +%Y-%m-%d)-project-status.md \
   .paperclip/board/archive/sprint-N-final.md
```

## 状态文件结构

生成的状态文件包含以下部分：

1. **项目概览** - Sprint 状态、测试状态、代码分支
2. **活跃任务** - 当前进行中的任务
3. **已完成功能** - Sprint 2 完成的功能列表
4. **代码质量指标** - 测试、TypeScript、ESLint 状态
5. **下一步行动** - 待办事项列表

## 与 CMP-54 的关系

此脚本是 CMP-54「建立状态文件同步机制」的核心交付物，解决了以下问题：

- ❌ 状态文件分散在多个位置
- ❌ 文档和代码状态严重脱节
- ❌ 手动更新容易遗漏

通过此脚本实现：

- ✅ 自动生成统一格式的状态报告
- ✅ 每次提交后自动更新（通过 Git 钩子）
- ✅ Sprint 结束时强制更新流程
