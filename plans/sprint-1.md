# Sprint 1 Plan - NotOnlyTranslator

## 目标
完成 Must Have User Stories (#1-4)，交付可工作的翻译演示。

## 时间盒
2 周 (2026-03-14 ~ 2026-03-28)

## 任务列表

### US-001: 智能分级翻译
- **编号**: CMP-11
- **优先级**: Critical
- **描述**: 基于用户英语水平（CET-4/6、托福、雅思等），仅翻译超出用户能力范围的单词
- **技术要点**: PageScanner、ViewportObserver、LLM API、缓存策略

### US-002: 点击查看翻译详情
- **编号**: CMP-12
- **优先级**: Critical
- **描述**: 点击高亮词汇显示 Tooltip，包含释义、音标、例句
- **技术要点**: Tooltip 组件、悬停延迟、键盘导航

### US-003: 标记已知/未知单词
- **编号**: CMP-13
- **优先级**: Critical
- **描述**: 标记单词为已知/未知，更新用户词汇量模型（贝叶斯算法）
- **技术要点**: MarkerService、UserLevelManager、Chrome Storage

### US-004: 选择英语水平
- **编号**: CMP-14
- **优先级**: Critical
- **描述**: Options 页面选择英语水平和翻译模式，配置 API Key
- **技术要点**: React + Tailwind、Zustand、Chrome Sync Storage

## 依赖关系
```
US-004 (设置) → US-001 (翻译) → US-002 (详情) → US-003 (标记)
```

## 分配给
Founding Engineer

## 验收标准
- [ ] 页面英文内容根据用户水平智能翻译
- [ ] 点击生僻词显示详细翻译信息
- [ ] 可标记单词为已知/加入生词本
- [ ] Options 页面可配置水平和 API Key
