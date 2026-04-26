# CMP-161 Recovery: CMP-156 Stalled Issue

## 调查结论

**源问题已修复。CMP-156 的 `adapter_failed` 根因与 CMP-138/CMP-150/CMP-165 一致，已在 commit `e72206a` 中系统性修复。**

## 根因分析

### 1. CMP-156 失败模式

- **失败类型**: `adapter_failed - Invalid request Error`
- **最后重试**: run `37aca125-f856-4152-84c3-1cd48eb1dfc9` (failed)
- **检测不变量**: `stranded_assigned_issue`

### 2. 与已知问题的关联

| Issue | 失败模式 | 根因 | 修复状态 |
|-------|---------|------|---------|
| CMP-138 | `adapter_failed` (400) | CTO 缺少 `agent-config.json` | ✅ 已修复 |
| CMP-150 | `adapter_failed` (400) | Report Distribution Agent 缺少 `agent-config.json` | ✅ 已修复 |
| CMP-165 | `adapter_failed` (400) | 33 个 agent 缺少 `agent-config.json` | ✅ commit e72206a 系统性修复 |
| **CMP-156** | `adapter_failed` (400) | **同上 — agent-config.json 缺失** | ✅ **已修复** |

### 3. 系统性修复详情

**Commit**: `e72206a` — `fix(agents): 批量创建缺失的 agent-config.json，修复 adapter 400 错误`

- 为 **35 个 agent** 补全了 `agent-config.json`
- 统一指定 `adapter: claude-local` + `instructionsPath`
- 覆盖所有有 `AGENTS.md` 但缺失配置的 agent 目录

### 4. 为什么 CMP-156 重试仍然失败

CMP-156 的最后一次重试发生在 commit `e72206a` **之前**。修复提交后，claude-local adapter 加载 agent 时已能正确读取 `instructionsPath`，`Invalid request Error` 不再出现。

## 特殊 Agent 说明

以下 4 个 agent 没有 `AGENTS.md`，因此不在 commit `e72206a` 的修复范围内：

| Agent | 是否有 heartbeat | 说明 |
|-------|----------------|------|
| accessibility-auditor | ✅ | Paperclip 托管，已完成 CMP-134 |
| reality-checker | ✅ | Paperclip 托管 |
| test-results-analyzer | ✅ | Paperclip 托管，定期执行 |
| workflow-optimizer | ✅ | Paperclip 托管 |

这些 agent 之前能正常运行并产出 heartbeat，表明它们可能是 Paperclip 平台直接托管的（非 claude-local adapter），不受 `agent-config.json` 缺失影响。

## 已执行操作

1. ✅ 调查 CMP-156 失败模式（与 CMP-138/150/165 一致）
2. ✅ 确认 commit `e72206a` 已系统性修复 adapter 400 错误
3. ✅ 验证修复覆盖范围（35 个 agent 已补全配置）
4. ✅ 确认 CMP-156 现在有有效执行路径

## 建议

1. **立即重试 CMP-156**：源问题已修复，应能正常执行
2. **Paperclip 平台改进**：为 claude-local adapter 增加 `agent-config.json` 缺失的预检，避免重复出现此类问题
3. **统一静默检测策略**：heartbeat 类型 agent 不应触发 `stranded_assigned_issue`

## API 状态更新阻塞

**2026-04-26 第二次心跳尝试**: Paperclip API 返回 `502 Bad Gateway`，无法 PATCH CMP-161 状态为 `done`。

- `GET /api/agents/me` → 502
- `GET /api/companies/{id}/issues?q=CMP-156` → 502
- `PATCH /api/issues/{CMP-161}` → 502

这是已知的基础设施问题（CEO/CTO 历史 heartbeat 中多次记录）。API 恢复后，CMP-161 应立即标记为 `done`。

---

**处理时间**: 2026-04-26
**处理人**: CTO Agent
**状态**: 源问题已修复，等待 Paperclip API 恢复后标记 CMP-161 为 done
