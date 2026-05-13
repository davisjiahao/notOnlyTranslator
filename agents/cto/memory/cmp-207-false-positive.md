---
name: CMP-207 false positive
description: Workflow Optimizer silent run false positive — 19th recurrence of heartbeat-style agent exit pattern
type: project
---

## CMP-207: Workflow Optimizer Silent Run — False Positive (2026-04-27)

**Status**: `done` (false positive)

**Pattern**: 第 19 次同类 heartbeat agent silent 误报

**Previous occurrences**: CMP-143/148/149/152/153/154/187/190/191/192/195/196/197/198/200/203/205/206

**Evidence**:
- PID 4283 still in `Ss` state (sleeping, session leader)
- Run completed in ~8 seconds (15:51:42 → 15:51:50), then idle
- Process lingers without producing output → triggers silent threshold

**Root Cause**: Workflow Optimizer is a timer-triggered agent. It completes its periodic check quickly, the Claude process remains alive but idle, and Paperclip's silent detection interprets the lack of new output as critical silence. Same systemic issue as heartbeat agents — the silent detection threshold is not appropriate for short-lived scheduled agents.

**Recommendation**: Paperclip should mark timer/heartbeat-style agents with `lifecycle: short_lived` or exclude them from silent detection entirely. This pattern has now reproduced 19 times.
