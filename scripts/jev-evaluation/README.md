# Jev 浏览器评估

此目录只用于阶段一评估，不接管生产阅读流程。需要现有 Node 25 和已安装的 Playwright Chromium；复用项目依赖，不安装新测试栈。

```bash
npm run build
node --experimental-strip-types --experimental-test-module-mocks --test scripts/jev-evaluation/*.test.ts
node --experimental-strip-types scripts/jev-evaluation/run.ts --smoke
node --experimental-strip-types scripts/jev-evaluation/run.ts
```

默认只冻结请求和哈希，不读取凭据、不联网。显式添加 `--live` 才从已配置的 `$XDG_CONFIG_HOME/jevgrep/credentials.json`（或 `~/.config/jevgrep/credentials.json`）读取 TypeSafe 凭据并发送合成文本。`--live --smoke` 仅发一次合成请求；正式评估最多 20 次，失败即停，不自动重试。

```bash
node --experimental-strip-types scripts/jev-evaluation/run.ts --live --smoke
node --experimental-strip-types scripts/jev-evaluation/run.ts --live
```

正式评估需 `labels-review.json` 的样本 SHA-256 与文件一致，状态为 `reviewed-synthetic`。标签经独立代理复核仍属于合成参考标签，未经教师认证。

请求从隔离 Chromium 的真实 MV3 Service Worker 发出。脚本复制 `dist` 到临时目录，只在副本预声明精确 TypeSafe 主机权限；实时运行沿用系统代理，不设置 Node 或浏览器代理。该探针不验证生产 `chrome.permissions.request` 的首次授权弹窗，也不改变日常 Chrome。结束后关闭临时浏览器并删除临时副本/profile。

200 条样本按 100 个词元组拆为 60 条校准、140 条留出，组间互斥。校准先执行最多 16 条一批的请求和预选六条单问对照；仅校准集选择阈值并持久冻结，随后才调用留出集。没有满足常用义误标约束且有正召回的阈值时，不运行留出。对照验证的是多句批处理协议和初步一致性，不代表生产同段多词位或整页质量已验收。

标签规则：`common` 是所有不高于 B1 的阴性例，包含熟词配对中的常用义；`sense` 是熟词特殊义阳性例，`advanced` 是高级词阳性例。常用义误标率不能漏算配对阴性。该集刻意富集词义对照，同词元的两例相关，不能把成绩外推为真实网页词汇分布的准确率；“同句同词不同义且只选第二次”的场景仍需后续集成验收。

输出在忽略提交的 `test-results/jev-evaluation/`。清单冻结样本、核心代码与请求体哈希；每次发送前记录尝试，未知用量不报成零费用。结果只保留预期 ID 的分数、固定模型和白名单用量，不保留原始响应、凭据或 HTTP 错误正文。

`productionReady` 始终为 false：数值门槛通过也不替代标签复核、完整插件同集基线、真实阅读高亮和权限交互验收。公开价估算仅计本次有用量的输入 token，不是账单证明。

入口测试用 query 动态重载同一源码；Node 内置覆盖报告可能只统计部分实例，须保留原始 `NODE_V8_COVERAGE` 并归并同源 URL 后计算。浏览器内执行的回调另由真实 MV3 断言验证，不能只看 Node 函数覆盖。

## 2026-10-13 冻结结果

样本 SHA-256：`c8aff6cd7be3cffe26aa8fbdc62c3d310aa571dcab705b925895065641fbd0db`。正式运行 `2026-10-13T15-31-55-653Z-vVFBYC` 的19次请求全部成功；仅校准集选择阈值0.26并落盘，之后执行140条留出。独立复算确认样本、核心和19个请求体哈希一致。

| 留出指标 | 结果 | 预定点估计门槛 |
| --- | --- | --- |
| 总召回 | 63/71（88.73%） | ≥85% |
| 熟词生义召回 | 31/35（88.57%） | ≥80% |
| 常用义误标 | 0/69（0%） | ≤5% |
| 词元两例均正确 | 62/70（88.57%） | 未设门槛 |

按70个词元组进行50,000次有放回bootstrap（seed=20261013，固定阈值）的95%总召回区间为81.25%–95.45%，熟词生义为77.14%–97.37%；区间下界低于门槛，因此点估计通过不能证明稳定达标。零误标bootstrap退化为零，不作为总体误标率为零的证据。结论仅支持继续默认关闭的实验实现。

19次请求输入29,583／输出3,990 token，按当时输入单价估$0.001242486；单请求p50 250ms、p95 951ms。另一次通路smoke输入374／输出21 token、1444ms，不计入质量指标。六个单问对照分类均与批量一致，概率最大差0.14；不据此推断同段多词或整页延迟。详见该run目录的`manifest.json`、`calibration.json`、`summary.json`与`assessment.json`。
