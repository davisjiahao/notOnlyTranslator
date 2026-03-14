# Sprint 1 Plan - NotOnlyTranslator

## 目标
完成 Must Have User Stories (#1-4)，交付可工作的翻译演示。

## 时间盒
2 周 (2026-03-14 ~ 2026-03-28)

## 进度总览

| 状态 | 数量 | 任务 |
|-----|------|-----|
| ✅ 已完成 | 4 | US-001-T1, US-001-T2, US-001-T3, US-002-T1 |
| 🔄 进行中 | 1 | US-002-T2 (测试修复) |
| ⏳ 待开始 | 2 | US-003, US-004 |

## 已完成的任务

### ✅ US-001-T1: PageScanner 页面扫描器
- TreeWalker DOM 遍历
- 智能段落检测与去重
- 动态内容监听 (MutationObserver)
- 52 个单元测试通过

### ✅ US-001-T2: VocabularyFilter 词汇过滤服务
- 基于用户水平的词汇难度过滤
- 停用词过滤与去重
- 集成 FrequencyManager
- 29 个单元测试通过

### ✅ US-001-T3: Highlighter 高亮渲染器
- 单词高亮与 CSS 类管理
- 已知/未知单词标记
- 高亮清理与列表获取
- 9 个单元测试通过

### ✅ US-002-T1: Tooltip 组件
- 单词/句子/语法说明展示
- 智能定位与视口检测
- 钉住功能与滚动跟随
- 快捷键支持 (K/U/A/P/Esc)
- 38 个测试 (35 通过, 3 个待修复)

## 进行中/待开始的任务

### 🔄 US-002-T2: Tooltip 测试修复
- **问题**: 3 个测试用例缺少 `vi.useFakeTimers()`
- **预计工时**: 30 分钟
- **优先级**: Medium

### ⏳ US-003: 标记已知/未知单词
- **编号**: CMP-13
- **优先级**: Critical
- **描述**: 标记单词为已知/未知，更新用户词汇量模型（贝叶斯算法）
- **技术要点**: MarkerService、UserLevelManager、Chrome Storage
- **估计工时**: 6 小时

### ⏳ US-004: 选择英语水平
- **编号**: CMP-14
- **优先级**: Critical
- **描述**: Options 页面选择英语水平和翻译模式，配置 API Key
- **技术要点**: React + Tailwind、Zustand、Chrome Sync Storage
- **估计工时**: 4 小时

## 依赖关系
```
US-004 (设置) → US-001 (翻译) → US-002 (详情) → US-003 (标记)
```

## 验收标准
- [x] 页面英文内容根据用户水平智能翻译
- [x] 点击生僻词显示详细翻译信息
- [ ] 可标记单词为已知/加入生词本 (US-003)
- [ ] Options 页面可配置水平和 API Key (US-004)

## 当前进度
**Sprint 1 完成度: 60%** (4/5 核心功能完成，3 个待修复)
