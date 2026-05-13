# CMP-208 Review: CTO Silent Active Run

**Date**: 2026-04-27T03:27
**Status**: Done (False Positive)
**Type**: Heartbeat agent silent run false positive

## Decision

**False positive** — 17th confirmed instance of the same pattern.

## Evidence

- **Source issue**: CMP-201
- **Run started**: 2026-04-27T01:17:28.415Z
- **Last output**: 2026-04-27T01:17:28.552Z (sequence 1)
- **Duration**: ~137ms
- **PID**: 99858 (Paperclip harness process, still alive — not the CTO subprocess)

CTO heartbeat agent completed its checks and exited normally within ~137ms. The in-memory process handle remained marked `active` after the subprocess exited, triggering the 2h3m silent threshold.

## Related Issues (same pattern)

- CMP-143, CMP-148, CMP-149, CMP-152, CMP-153, CMP-154
- CMP-187, CMP-190, CMP-191, CMP-192, CMP-195, CMP-196, CMP-197, CMP-198, CMP-202, CMP-203, CMP-206, CMP-208

## Root Cause

Heartbeat agents have a short lifecycle: start → run checks → write heartbeat file → exit. Paperclip's silent detection treats the in-memory handle as still active after the subprocess exits, causing false positives for any short-lived agent.

## Recommendation (unchanged)

Paperclip should mark heartbeat-type agents as `lifecycle: short_lived` or exclude them from silent-run detection entirely.
