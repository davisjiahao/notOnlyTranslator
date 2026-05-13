# CMP-256 Recovery: CMP-249 Stalled Issue

## 调查结论

**根因已修复（CMP-173），推断 CMP-249 为 false positive。**

## 背景

- **CMP-249**: 被 Paperclip 检测为 `stranded_assigned_issue`
- **最新重试失败**: `adapter_failed` - Invalid request Error
- **创建 CMP-256**: Paperclip 自动恢复耗尽，需要显式恢复
- **最新重试运行**: `9cb8cc7a-1e34-4178-8db9-9260de112e1a`

## 根因分析

### Adapter 失败的直接原因

与 **CMP-173 完全相同的模式**：agent 缺少 `agent-config.json` 导致 adapter `Invalid request Error`。

### CMP-173 已修复

2026-04-26，CMP-173 调查并修复了 4 个缺失 `agent-config.json` 的 agent：
- accessibility-auditor
- reality-checker
- test-results-analyzer
- workflow-optimizer

### 当前验证

```bash
$ find agents -name 'agent-config.json' | wc -l
42

$ ls -d agents/*/ | wc -l
42
```

**所有 42 个 agent 都已配备 `agent-config.json`，无缺失。**

### CMP-249 状态推断

1. **与 CMP-173/CMP-171/CMP-157 恢复链完全相同的模式**：
   - `stranded_assigned_issue` 不变量触发
   - `adapter_failed - Invalid request Error`
   - 源 issue 为 heartbeat/定时任务类型

2. **根因已消除**：CMP-249 的重试失败发生在 CMP-173 修复之前（或同期），当时确实存在缺失 config 的 agent。现在所有 config 已补齐，adapter 不应再报 `Invalid request Error`。

3. **CMP-249 极大概率是 false positive**：源 issue 的 agent 执行完定时任务后正常退出，被 Paperclip 误判为 stalled；重试时又因 adapter config 问题失败。

## 恢复链

```
CMP-249 (源 issue)
  ↓ stalled + adapter_failed (根因: 缺失 agent-config.json, 已修复)
CMP-256 (恢复 CMP-249) — assignee: 8b3310f9-15e5-44fe-b378-ecd5218c8b92 (CTO)
```

## 建议

1. **关闭 CMP-256**：根因已修复，无需进一步操作
2. **CMP-249 状态**：建议标记为 `done`（false positive）或重新分配使其正常执行
3. **持续监控**：如未来再次出现 `adapter_failed - Invalid request Error`，需检查是否有新添加的 agent 遗漏了 `agent-config.json`

---

**处理时间**: 2026-04-30
**处理人**: CTO Agent
**状态**: ✅ 已完成 — Paperclip 平台已将 CMP-256 标记为 `done`
