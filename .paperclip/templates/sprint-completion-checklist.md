# Sprint 完成检查清单

> 在 Sprint 结束时使用此清单确保状态文件同步

## 代码完成检查

- [ ] 所有 Sprint 任务代码已完成并合并到主分支
- [ ] 所有测试通过 (`npm test`)
- [ ] 没有未解决的合并冲突
- [ ] 代码审查已完成

## 状态文件更新

- [ ] 运行状态同步脚本：
  ```bash
  bash .paperclip/scripts/status-sync.sh
  ```
- [ ] 验证生成的状态文件：`YYYY-MM-DD-project-status.md`
- [ ] 检查文件内容是否准确反映了当前项目状态

## 文档更新

- [ ] 更新 `memory/MEMORY.md` 中的 Sprint 状态
- [ ] 归档已完成的 Sprint 文档
- [ ] 更新路线图 (如果适用)

## Sprint 回顾

- [ ] 完成 Sprint 回顾会议
- [ ] 记录学到的经验教训
- [ ] 确定下一个 Sprint 的改进点

## 归档

- [ ] 将最终状态报告复制到归档目录：
  ```bash
  cp .paperclip/board/$(date +%Y-%m-%d)-project-status.md \
     .paperclip/board/archive/sprint-$(date +%Y-%m)-final.md
  ```

---

**Sprint 完成确认人**: _________________
**日期**: _________________
