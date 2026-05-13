# CMP-138: Recover stalled issue CMP-135

## Status
Done — 2026-04-25

## Objective
修复 CMP-135（恢复 CMP-134）的 adapter_failed 错误，终止恢复链。

## Root Cause
CTO agent (`8b3310f9`) adapterConfig 为空 `{}`，缺少 `instructionsFilePath`。
Claude adapter 报 `Invalid request Error` (400)。

## Fix
创建 `agents/cto/agent-config.json`：
```json
{
  "name": "CTO",
  "nameKey": "cto",
  "adapter": "claude-local",
  "instructionsPath": "agents/cto/AGENTS.md"
}
```

## Recovery Chain
```
CMP-134 (WCAG修复) ← blocked
  → CMP-135 (恢复CMP-134) ← done
    → CMP-136 (恢复CMP-135) ← done
      → CMP-137 (恢复CMP-136) ← done
        → CMP-138 (恢复CMP-135) ← done
```

## Board Approval
[71e1fc7d](/CMP/approvals/71e1fc7d-d897-4c32-bf7f-4ddf1e885b82) — pending
