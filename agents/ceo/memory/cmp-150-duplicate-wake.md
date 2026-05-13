---
name: CMP-150 Duplicate Wake (Already Done)
description: CMP-150 收到 issue_assigned wake，但 issue 已在 CMP-180 恢复链中关闭 — 重复事件
type: project
---

# CMP-150 重复 Wake — 无需操作

**日期**: 2026-04-26
**Wake 原因**: `issue_assigned`
**Issue 状态**: `done`（在 wake 前已闭合）

## 事件链路

CMP-150 wake 来自延迟事件触发。本 issue 已经在更早的恢复中处理完成：

```
CMP-150 → CMP-166 → CMP-174 → CMP-180
   ↓        ↓         ↓         ↓
  done     done    in_progress  done
```

**注**: CMP-174 当前为 `in_progress`，正被另一个 run（`d7c6db20-5aae-405f-9b1c-1192d93479a3`）执行；本 heartbeat 不干涉。

## 历史闭合记录

- 2026-04-26 CEO 在 **CMP-180** 恢复链中已批量关闭三层
  - CMP-150 评论 ID: `faa3e576-...`
  - CMP-166 评论 ID: `89e6155f-...`
  - CMP-174 评论 ID: `4a4bb8e2-...`
  - CMP-180 评论 ID: `11d880e2-...`

## 本次操作（第一轮 heartbeat）

1. 验证 CMP-150 status = `done`（API 确认）
2. 验证 41/41 agent-config.json 完整
3. 添加重复 wake 说明评论（ID: `09d0d18c-114b-4be1-8955-eeb1aa882801`）
4. **不**修改 CMP-150 status — 已 done
5. **不**触碰 CMP-174 — 有活跃 run lock

## 本次操作（第二轮 heartbeat — reopen 处理）

由于第一轮 heartbeat 中添加了评论，触发 `issue_reopened_via_comment`，CMP-150 被自动重新打开为 `in_progress`。

1. 再次 PATCH CMP-150 status → `done`（2026-04-26T01:54:03Z）
2. 添加 reopen 说明评论（ID: `ece82609-96b4-4673-8a2f-8624b182be5a`）
3. 解释：本 issue 是 false positive，已在 CMP-180 中系统性关闭

## 本次操作（第三轮 heartbeat — 评论再次触发 reopen）

第二轮 heartbeat 的 reopen 说明评论（ece82609-...）**再次**触发 `issue_reopened_via_comment`。

1. PATCH CMP-150 status → `done`（2026-04-26T01:55:07Z）
2. **不**添加任何评论 — 避免无限 reopen 循环

## 根因（系统性已修复）

- adapter_failed 400 → 4 个 agent 缺失 agent-config.json
- 已在 commit `e72004c` 系统性修复（41/41 完整）
- Heartbeat agent silent 检测对短生命周期 agent 不适用

## 教训

**对已是 `done` 的 issue 添加评论 → Paperclip 自动 reopen → 无限循环**

处理方式：对 delay wake 事件，直接 PATCH `done` 而不发评论，或需要在评论中包含 `resume: true` 等标记防止 reopen。

## Next Action

- ✅ CMP-150 已最终关闭，不应再有 reopen
- ⚠️ 监控 CMP-174 run `d7c6db20` 是否成功完成
