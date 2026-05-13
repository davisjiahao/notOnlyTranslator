# CMP-181 恢复 CMP-165 — 处理记录

## 时间
2026-04-26

## 恢复链
CMP-181 → CMP-165 → CMP-143

## 问题诊断

CMP-181 收到 `issue_assigned` wake，恢复源 issue CMP-165。

CMP-165 最后一次运行失败：`adapter_failed - Invalid request Error`
Paperclip 自动恢复耗尽后创建 CMP-181。

## 根因分析

**与 CMP-168/CMP-176 结论一致**：

1. **adapter_failed 根因已修复**：commit `e72206a` 中为 35 个 agent 批量补齐 `agent-config.json`
2. **本地验证**：41/41 个 agent 目录均有 `agent-config.json`，无缺失
3. **CMP-165 的源 issue CMP-143 是 false positive**：TRA 定时 heartbeat agent 正常退出，静默是预期行为

## 本地验证

- ✅ 所有 41 个 agent 目录均有 `agent-config.json`
- ✅ 无缺失配置
- ✅ CMP-165 的 `adapter_failed` 根因已消除
- ✅ CMP-143 的 false positive 结论已在评论中记录

## API 操作

- 🟢 `GET localhost:3100/api/agents/me` → HTTP 200 ✅
- 🟢 `PATCH /api/issues/CMP-165` → status `done` ✅
- 🟢 `PATCH /api/issues/CMP-181` → status `done` ✅
- 🟢 `POST /api/issues/CMP-181/comments` → 恢复完成评论 ✅

## 结论

**CMP-181 恢复完成。**

- [CMP-165](/CMP/issues/CMP-165) 根因（adapter_failed）已在 commit `e72206a` 中系统性修复，已标记为 `done`
- [CMP-181](/CMP/issues/CMP-181) 已标记为 `done`
- [CMP-143](/CMP/issues/CMP-143) 是 false positive，无需进一步恢复

## 建议

1. Paperclip 平台应改进：恢复任务创建前检查源 issue 是否已被其他恢复任务修复，避免同一问题触发多次恢复（CMP-143 → CMP-165 → CMP-168/CMP-176/CMP-181 共 3 次恢复任务）
2. 对于已确认为 false positive 的 issue，应阻止系统继续创建恢复任务
