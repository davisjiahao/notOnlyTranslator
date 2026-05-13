# CMP-176 恢复 CMP-165 — 处理记录

## 时间
2026-04-26

## 问题诊断

CMP-165 最后一次运行失败：`adapter_failed - Invalid request Error`
Paperclip 自动恢复耗尽后创建 CMP-176。

## 根因分析

**与 CMP-168 结论一致**：CMP-165 的根因已在 commit `e72206a` 中系统性修复。

- 33 个 agent 目录有 `AGENTS.md` 但缺少 `agent-config.json`
- adapter 因找不到配置而报 400 Invalid request Error
- 已在 commit `e72206a` 中为 35 个 agent 批量补齐 config

## 本地验证

- ✅ 所有 41 个 agent 目录均有 `agent-config.json`
- ✅ 无缺失配置
- ✅ CMP-165 的 `adapter_failed` 根因已消除

## API 操作

- ❌ `GET /api/issues/CMP-165` → 502 Bad Gateway
- ❌ `PATCH /api/issues/CMP-165` → 502 Bad Gateway
- ❌ `PATCH /api/issues/CMP-176` → 502 Bad Gateway
- Paperclip API 持续间歇性 502，与 CMP-168/CMP-173 期间相同

## 2026-04-26 Heartbeat #1

- 🔴 API 测试：`GET /api/agents/me` → 502 Bad Gateway（持续间歇性故障）
- ✅ 本地 agent-config 验证：41/41 个 agent 目录均存在 `agent-config.json`
- ✅ CMP-165 的 adapter 根因已在 `e72206a` 中系统性修复
- ❌ 无法通过 API 更新 issue 状态（502）

## 2026-04-26 Heartbeat #2 (continuation)

- 🟡 API 测试：`GET /api/agents/me` → 401 Unauthorized（服务器已恢复，JWT 过期）
- ❌ `paperclipai agent local-cli` → 500 Internal Server Error
- 🔴 当前 run 的 JWT 已过期，无法获取新 token 更新 issue 状态
- ✅ 根因修复未变，只需下次 wake 时获取新 token 后更新

## 2026-04-26 Heartbeat #3 (continuation)

- 🔴 `PAPERCLIP_API_KEY` 环境变量**未设置**（local adapter 未注入 JWT）
- 🔴 无法通过 API 更新 issue 状态（无认证凭据）
- ✅ 根因修复未变：41/41 agent-config.json 齐全

## 2026-04-26 Heartbeat #4 (continuation)

- 🔴 API 测试：`GET /api/agents/me` → 502 Bad Gateway（API 再次故障）
- 🟡 `PAPERCLIP_API_KEY` 已存在，但 API 服务器不稳定
- ✅ 根因修复未变：41/41 agent-config.json 齐全

## 2026-04-26 Heartbeat #5 (continuation)

- 🔴 API 测试：`GET /api/agents/me` → 502 Bad Gateway
- ✅ 根因修复未变：41/41 agent-config.json 齐全

## 2026-04-26 Heartbeat #6 (continuation) — 成功

- 🟢 **关键发现**：`$PAPERCLIP_API_URL` (tailscale 域名) 走代理导致 502，直接用 `localhost:3100` 可正常访问 API
- 🟢 `GET localhost:3100/api/agents/me` → HTTP 200 ✅
- 🟢 `PATCH /api/issues/CMP-165` → status `todo` ✅
- 🟢 `PATCH /api/issues/CMP-176` → status `done` ✅

## 结论

**CMP-176 恢复完成。**

- [CMP-165](/CMP/issues/CMP-165) 根因（adapter_failed）已在 commit `e72206a` 中系统性修复
- 所有 41 个 agent 目录均有 `agent-config.json`
- [CMP-165](/CMP/issues/CMP-165) 已重置为 `todo`，可重新触发运行验证
- [CMP-176](/CMP/issues/CMP-176) 已标记为 `done`

## 建议

Paperclip 平台应改进：
1. 在 adapter 初始化时预检 agent-config.json 缺失
2. 恢复任务创建前检查源 issue 根因是否已被其他恢复任务修复
3. 避免同一源 issue 被多次恢复（CMP-165 已被 CMP-168 修复，又触发 CMP-176）
4. 修复 API 502 间歇性问题（已影响多个恢复任务）
