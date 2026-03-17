# {ROLE} 状态报告 - {DATE}

## 元数据
- **报告日期**: {DATE}
- **报告人**: {ROLE}
- **Sprint**: {SPRINT_NUMBER}
- **对应代码版本**: {GIT_COMMIT}

---

## 执行摘要

| 指标 | 数值 | 状态 |
|------|------|------|
| 测试通过率 | {TEST_PASS}/{TEST_TOTAL} | {TEST_STATUS} |
| TypeScript 错误 | {TS_ERRORS} | {TS_STATUS} |
| ESLint 警告 | {LINT_WARNINGS} | {LINT_STATUS} |
| 构建状态 | {BUILD_STATUS} | {BUILD_ICON} |

---

## 已完成工作

### Sprint {SPRINT_NUMBER} 完成项

- [x] **{TASK_ID}**: {TASK_TITLE}
  - 提交: {GIT_COMMIT_SHORT}
  - 测试: {TEST_COUNT} 个通过

---

## 进行中工作

- [ ] **{IN_PROGRESS_TASK}**: {IN_PROGRESS_DESC}
  - 进度: {PROGRESS_PERCENT}%
  - 阻塞项: {BLOCKERS}

---

## 风险与问题

| 优先级 | 问题 | 影响 | 缓解措施 | 负责人 |
|--------|------|------|----------|--------|
| {RISK_PRIORITY} | {RISK_DESC} | {RISK_IMPACT} | {RISK_MITIGATION} | {RISK_OWNER} |

---

## 下一步行动

1. **{ACTION_1}** - 负责人: {ACTION_1_OWNER} - 截止: {ACTION_1_DUE}
2. **{ACTION_2}** - 负责人: {ACTION_2_OWNER} - 截止: {ACTION_2_DUE}

---

## 自动化生成信息

- **生成时间**: {GENERATED_AT}
- **生成脚本**: {SCRIPT_NAME}
- **数据版本**: v{DATA_VERSION}

---

*此报告由自动化脚本生成，如有疑问请联系 {ROLE}*
