# CMP-231 False Positive Record

**Date**: 2026-04-27
**Agent**: CTO (claude_local)
**PID**: 99852
**Silent duration**: 3h 56m (approaching 4h critical threshold)

## Root Cause

Same pattern as 27+ prior false positives (CMP-143/148/149/152/153/154/187/190/191/192/195/196/197/198/200/203/205/206/208/213/214/217/219/220/221/222/225/226).

**Why**: CTO heartbeat agent produces output via file writes to `agents/cto/memory/`, not via stdout stream. Paperclip's silent detection monitors only stdout, missing all file-based output.

**Evidence**:
- PID 99852 alive, `Ss` state, 3h 56m elapsed
- Latest heartbeat file `heartbeat-2026-04-27-003.md` timestamp 13:14 — agent actively working
- Only 1 stdout output sequence (lifecycle start message)

## Resolution

Mark as `done` (false positive). No action needed on the CTO process.

## Recommendation (repeated)

Paperclip should mark heartbeat-class agents with `lifecycle: short_lived` or exclude them from silent detection entirely.
