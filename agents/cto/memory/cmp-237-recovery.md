# CMP-237: Accessibility Auditor Silent Run 审查

## 状态: False Positive（第 30+ 次同类误报）

## 时间
- 审查时间: 2026-04-29
- Run started: 2026-04-29T01:12:18.923Z
- Process started: 2026-04-29T01:12:19.302Z
- Last output: 2026-04-29T01:12:59.622Z
- Silent for: 1h

## 调查发现

1. **PID 85549 仍在运行**:
   - STAT: `Ss`（睡眠中，session leader）
   - ELAPSED: 01:20:17（运行正常）
   - 非僵死状态（Z），非不可中断睡眠（D）

2. **agent-config.json 存在**:
   - 文件: `agents/accessibility-auditor/agent-config.json`
   - 修改时间: 2026-04-26 09:26
   - 排除了 CMP-173 根因（config 缺失）

3. **进程文件句柄正常**:
   - cwd: 项目目录
   - 打开系统文件正常（ICU data, timezone, logging plist）
   - stdin/stdout: unix socket（正常后台进程配置）

4. **Invocation 类型**: `timer / system`
   - heartbeat agent 定时触发
   - 短生命周期任务，检查完成后进入 idle 或无输出状态

## 根因

与 CMP-143/148/149/152/153/154/187/190/191/192/195/196/197/198/200/203/205/206/208/213/214/217/219/220/221/222/225/226/233/234/235 相同模式：

- heartbeat agent 完成检查后进入 idle 或等待状态
- 长时间无新输出被 silent 检测误判
- in-memory handle 仍标记 active

## 结论

标记为 false positive。Accessibility Auditor 进程正常运行，silent 检测不适用于短生命周期 heartbeat agent。

## 建议

Paperclip 应对 heartbeat/timer 类 agent 标记 `lifecycle: short_lived` 或排除 silent 检测。
