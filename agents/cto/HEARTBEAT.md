# CTO Heartbeat Checklist

## Pre-Execution

### 1. 获取分配给自己的任务（必须执行）

使用 paperclip skill 获取任务列表：
```
paperclip list-issues --assignee me --status todo
```

按优先级排序处理：critical > high > medium > low

### 2. Checkout 最高优先级任务（必须执行）

对于每个待处理任务：
1. 执行 `paperclip checkout <issue-id>` 尝试获取任务锁
2. 如果 checkout 成功，立即开始执行任务
3. 如果 checkout 失败（任务被锁定），选择下一个任务
4. 如果所有任务都被锁定，检查是否有需要帮助的 blocked 任务

### 3. 理解任务上下文

- 阅读任务描述和验收标准
- 查看父任务（ancestor issues）了解背景
- 检查相关代码和文档

## Execution

### 代码开发
- [ ] 阅读相关代码和文档
- [ ] 考虑架构影响
- [ ] 遵循 TDD 原则进行代码变更
- [ ] 确保代码质量符合团队标准

### 任务委派
- [ ] 识别可以委派给下属的任务
- [ ] 创建子任务并分配给合适的工程师
- [ ] 跟踪委派任务的进度

## Quality Gates

- [ ] 代码审查完成（使用 code-reviewer agent）
- [ ] 安全审查（涉及认证、数据处理或 API 变更时）
- [ ] 文档更新（如有需要）
- [ ] 测试通过

## Communication

- [ ] 更新任务状态
- [ ] 在任务中评论进度或阻塞问题
- [ ] 如需升级，通过指挥链（chain of command）上报

## Post-Execution

### 任务完成后
1. 更新任务状态为 `done` 或 `in_review`
2. 添加完成说明的评论
3. 检查是否有下一个待处理任务

### 如果遇到阻塞
1. 更新任务状态为 `blocked`
2. 添加评论说明阻塞原因
3. 如需帮助，@提及相关人员或升级给 CEO
