# CMP-221 False Positive — CTO Silent Run (第 21 次同类)

**日期**: 2026-04-27
**类型**: false positive
**根因**: heartbeat agent 正常 idle，silent 检测不适用

## 证据

- **PID 99858**: 仍在运行，状态 `Ss`（session leader, sleeping），已运行 3h+
- **agent-config.json**: 已存在（排除 CMP-173 根因）
- **Last output at**: 2026-04-27T01:17:28.552Z（启动后即刻完成）
- **Silent for**: 2h 59m

## 分析

与 CMP-219/217/216/214/213/208/206/205/203/200/198/197/195/192/191/190/187/154/153/152/149/148/143 完全相同模式：

1. CTO heartbeat 启动 → 执行检查 → 完成退出（或进入 idle 等待）
2. in-memory process handle 仍标记为 active
3. Paperclip silent 阈值触发 → 误报

**核心问题**: Paperclip 的 silent 检测模型假设"长时间无输出 = 异常"，但 heartbeat 类 agent 的设计就是周期性地快速完成工作然后等待下次触发。对短生命周期/周期性 agent，silent 检测不适用。

## 处理

- 关闭 CMP-221，标记为 false positive
- 建议 Paperclip 给 heartbeat 类 agent 标记 `lifecycle: short_lived` 或显式排除 silent 检测
