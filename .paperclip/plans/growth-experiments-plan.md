# NotOnlyTranslator 增长实验计划

**文档版本**: v1.0
**创建日期**: 2026-03-16
**维护者**: Growth Hacker
**状态**: 活跃

---

## 执行摘要

本文档定义 NotOnlyTranslator 的增长实验框架，包括 A/B 测试计划、病毒式传播机制、数据埋点规范，以及实验执行流程。目标是系统化地优化用户获取、激活、留存和推荐转化率。

---

## 一、实验框架概览

### 1.1 增长实验飞轮

```
假设 → 实验设计 → 实施 → 数据分析 → 决策 → 规模化/放弃
  ↑                                              ↓
  └────────────── 学习沉淀 ──────────────────────┘
```

### 1.2 实验优先级矩阵

| 实验 | 影响 | 置信度 | 易实施 | ICE得分 | 优先级 |
|------|------|--------|--------|---------|--------|
| 欢迎弹窗简化 | 高 | 中 | 高 | 8 | P0 |
| 成就分享功能 | 高 | 中 | 中 | 7 | P0 |
| API试用配额 | 高 | 高 | 中 | 8 | P1 |
| 截图顺序优化 | 中 | 中 | 高 | 6 | P1 |
| 暗黑主题 | 中 | 低 | 高 | 5 | P2 |
| 推送时间优化 | 低 | 中 | 中 | 4 | P2 |

> **ICE评分标准**: 影响(1-10) × 置信度(1-10) × 易实施(1-10) / 10

---

## 二、A/B 测试实验详情

### 实验 1: 欢迎弹窗流程优化

**状态**: 🟡 计划中
**负责人**: Founding Engineer
**预期时间**: Sprint 2

#### 实验背景
当前用户引导流程有5步，完成率约40%。假设简化流程可提升完成率。

#### 实验假设
> 将用户引导从5步简化为3步，可提升7日激活率至少20%。

#### 变量设计

**对照组 (A)**:
```
安装 → 欢迎弹窗 → 水平选择 → API配置 → 示例网站 → 完成 (5步)
```

**实验组 (B)**:
```
安装 → 欢迎+水平选择合并 → API配置 → 示例网站 (3步)
        ↓
    提供"智能测试"按钮自动检测水平
```

**实验组 (C)**:
```
安装 → 欢迎+水平选择+API配置合并 → 示例网站 (2步)
        ↓
    提供"快速开始"模式（使用默认配置）
```

#### 成功指标

| 指标 | 目标提升 | 测量方法 |
|------|----------|----------|
| 7日激活率 | +20% | 完成首次翻译用户数/安装数 |
| 引导完成率 | +30% | 完成引导用户数/开始引导数 |
| 平均设置时间 | -40% | 从安装到完成设置的时间 |

#### 实验配置

```javascript
// 实验分组配置
const onboardingExperiment = {
  id: 'EXP-001-onboarding-simplification',
  startDate: '2026-04-02',
  endDate: '2026-04-16', // 14天
  trafficAllocation: 100, // 100%用户参与
  groups: [
    { id: 'control', weight: 34, variant: 'A' },
    { id: 'treatment-1', weight: 33, variant: 'B' },
    { id: 'treatment-2', weight: 33, variant: 'C' }
  ],
  primaryMetric: 'onboarding_completion_rate',
  secondaryMetrics: [
    '7d_activation_rate',
    'avg_setup_time_seconds',
    'first_translation_within_24h'
  ],
  minimumSampleSize: 300 // 每组至少300用户
}
```

---

### 实验 2: 成就系统与社交分享

**状态**: 🟡 计划中
**负责人**: Founding Engineer + Content Creator
**预期时间**: Sprint 2-3

#### 实验假设
> 添加成就系统和社交分享功能，可提升推荐转化率15%以上。

#### 功能设计

**成就类型**:

| 成就名称 | 解锁条件 | 分享触发 | 奖励 |
|----------|----------|----------|------|
| 词汇小白 | 标记第一个生词 | 手动分享按钮 | 徽章 |
| 每日学习 | 连续3天使用 | 第3天自动提示 | 徽章+50积分 |
| 词汇达人 | 掌握100词 | 达成时自动提示 | 徽章+100积分 |
| 坚持不懈 | 连续30天 | 自动分享+通知 | 实体周边抽奖 |
| 阅读先锋 | 阅读10万字 | 达成时提示 | 徽章+专属头像框 |

**分享卡片设计**:

```
┌─────────────────────────────────────┐
│  📚 NotOnlyTranslator               │
│                                     │
│  🎉 成就解锁：词汇达人              │
│                                     │
│  我已坚持学习 15 天                 │
│  掌握了 87 个新单词                 │
│  英语水平: CET-4 (4500词)           │
│                                     │
│  [生成卡片分享]                     │
│                                     │
│  🔗 notOnlyTranslator.com           │
└─────────────────────────────────────┘
```

#### 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 分享率 | 10%+ | 分享次数/活跃用户数 |
| 邀请转化率 | 15%+ | 通过分享链接安装数/分享次数 |
| 成就解锁率 | 60%+ | 至少解锁1个成就用户数/总用户数 |

#### 实验配置

```javascript
const achievementExperiment = {
  id: 'EXP-002-achievement-sharing',
  startDate: '2026-04-09',
  endDate: '2026-04-30',
  trafficAllocation: 50, // 50%用户可见成就功能
  groups: [
    { id: 'control', weight: 50, variant: 'no-achievement' },
    { id: 'treatment', weight: 50, variant: 'with-achievement' }
  ],
  primaryMetric: 'referral_conversion_rate',
  secondaryMetrics: [
    'share_rate',
    'achievement_unlock_rate',
    '7d_retention',
    'viral_coefficient'
  ],
  minimumSampleSize: 500
}
```

---

### 实验 3: API 试用配额机制

**状态**: 🟡 计划中
**负责人**: Founding Engineer
**预期时间**: Sprint 2

#### 实验假设
> 提供有限的免费 API 试用额度，可降低首次使用门槛，提升7日付费转化率。

#### 实验设计

**对照组**: 当前模式（需自行配置 API Key）

**实验组**:
- 新用户自动获得 100 次免费翻译额度
- 额度用完后引导配置自有 API Key
- 提供 "升级套餐" 选项（未来付费功能预埋）

#### 成功指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 首次翻译完成率 | +50% | 24h内完成首次翻译用户数/安装数 |
| 7日留存率 | +15% | 第7天仍活跃用户/安装数 |
| 配置自有API比例 | 30%+ | 配置API用户数/用完试用额度用户数 |

---

### 实验 4: Chrome Web Store 截图顺序 A/B 测试

**状态**: 🟡 计划中
**负责人**: ASO Specialist + Designer
**预期时间**: Sprint 2

#### 实验假设
> 优先展示价值主张（翻译效果对比）而非功能介绍（设置界面），可提升商店转化率。

#### 变量设计

**对照组 (A)**: 功能流程顺序
1. 扩展图标
2. 设置界面
3. 翻译效果
4. 生词本
5. 统计仪表盘

**实验组 (B)**: 价值展示顺序
1. 翻译前后对比（震撼效果）
2. 不同水平用户的差异化翻译
3. 一键标记生词
4. 词汇统计
5. 设置界面

**实验组 (C)**: 场景化顺序
1. 考研场景（真题阅读）
2. 职场场景（技术文档）
3. 学习场景（新闻阅读）
4. 功能总览
5. 设置界面

#### 成功指标

| 指标 | 目标提升 | 测量方法 |
|------|----------|----------|
| 商店转化率 | +10% | 安装数/访问数 |
| 点击率 | +15% | 点击数/展示数 |

---

## 三、病毒式传播机制设计

### 3.1 传播飞轮设计

```
         ┌──────────────────────────────────────┐
         │                                      │
    ┌────▼────┐    ┌──────────┐    ┌──────────▼──┐
    │ 价值体验 │───→│ 成就解锁 │───→│ 社交分享   │
    └────┬────┘    └────┬─────┘    └──────┬──────┘
         │              │                 │
         │              ▼                 │
         │         ┌──────────┐          │
         │         │ 学习报告 │          │
         │         └────┬─────┘          │
         │              │                 │
         └──────────────┴─────────────────┘
                          │
                          ▼
                    ┌──────────┐
                    │ 新用户   │
                    │ 安装     │
                    └──────────┘
```

### 3.2 推荐计划详细设计

**双向奖励体系**:

| 行为 | 邀请人奖励 | 被邀请人奖励 | 发放条件 |
|------|-----------|-------------|----------|
| 首次安装 | 50积分 | 50次免费翻译 | 双方均需完成首次翻译 |
| 连续7天使用 | 100积分 + 专属徽章 | 100次免费翻译 | 被邀请人连续7天活跃 |
| 邀请3人 | 周边抽奖资格 | - | 成功邀请3人且均激活 |
| 邀请10人 | 终身会员 | - | 成功邀请10人 |

**邀请流程**:

```
用户A (已有用户)
  ↓
点击"邀请好友"按钮
  ↓
生成唯一邀请链接: chrome.google.com/webstore/...?ref=USER_ID_A
  ↓
分享到社交媒体/私信
  ↓
用户B (新用户) 点击链接
  ↓
安装扩展 → 自动记录 ref 参数
  ↓
完成首次翻译
  ↓
双方获得奖励
```

**防刷机制**:

| 机制 | 说明 |
|------|------|
| 设备限制 | 每设备最多5次邀请奖励 |
| IP限制 | 同一IP每日最多3次安装计入邀请 |
| 行为验证 | 被邀请人需完成首次翻译才算有效 |
| 冷却期 | 同一用户24小时内最多邀请10人 |
| 人工审核 | 邀请量异常用户触发审核 |

### 3.3 分享内容模板

**成就分享模板**:

```
🎉 解锁成就：词汇达人

📚 NotOnlyTranslator

✅ 已坚持学习 15 天
✅ 掌握 87 个新单词
✅ 英语水平：CET-4 (4500词)

在阅读中自然提升词汇量
🔗 一起开始学习：{邀请链接}
```

**周报分享模板**:

```
📊 本周学习报告

🎯 新词学习：23 个
⏰ 阅读时长：4.5 小时
📈 水平提升：+200 词

用 NotOnlyTranslator 在阅读中提升词汇量
🔗 安装：{邀请链接}
```

---

## 四、数据埋点规范

### 4.1 事件追踪清单

#### 获客阶段 (Acquisition)

| 事件名 | 触发时机 | 参数 | 用途 |
|--------|----------|------|------|
| `store_view` | Chrome Web Store 页面展示 | source, ref | ASO分析 |
| `store_click` | 点击安装按钮 | position, screenshot_id | CTR分析 |
| `install_complete` | 完成安装 | utm_source, utm_campaign | 渠道归因 |
| `install_source` | 安装来源追踪 | ref_code, channel | 邀请追踪 |

#### 激活阶段 (Activation)

| 事件名 | 触发时机 | 参数 | 用途 |
|--------|----------|------|------|
| `onboarding_start` | 开始引导 | variant_id | 转化分析 |
| `onboarding_step_complete` | 完成每步引导 | step_number, step_name | 漏斗分析 |
| `onboarding_complete` | 完成引导 | duration_seconds, variant_id | 激活分析 |
| `onboarding_skip` | 跳过引导 | step_number | 流失分析 |
| `first_translation` | 首次翻译 | time_since_install, content_type | 价值验证 |
| `first_word_marked` | 首次标记词汇 | mark_type (known/unknown) | 功能使用 |
| `api_configured` | 配置API Key | provider (openai/claude/custom) | 配置分析 |
| `trial_quota_used` | 使用试用额度 | usage_count | 试用分析 |

#### 留存阶段 (Retention)

| 事件名 | 触发时机 | 参数 | 用途 |
|--------|----------|------|------|
| `translation_request` | 发起翻译 | domain, word_count, mode | 使用频率 |
| `word_marked` | 标记词汇 | mark_type, source_page | 功能粘性 |
| `vocabulary_review` | 打开生词本 | entry_point | 功能使用 |
| `flashcard_practice` | 闪卡复习 | cards_count, accuracy | 学习深度 |
| `settings_changed` | 修改设置 | setting_name, new_value | 个性化 |
| `theme_switched` | 切换主题 | from_theme, to_theme | 偏好 |
| `data_exported` | 导出数据 | format, size | 高级功能 |

#### 推荐阶段 (Referral)

| 事件名 | 触发时机 | 参数 | 用途 |
|--------|----------|------|------|
| `achievement_unlocked` | 解锁成就 | achievement_id, level | 动机分析 |
| `share_clicked` | 点击分享 | share_type, platform | 传播意愿 |
| `share_completed` | 完成分享 | platform, content_type | 传播行为 |
| `invite_link_generated` | 生成邀请链接 | source_page | 推荐意愿 |
| `referral_install` | 被邀请人安装 | referrer_id, channel | 推荐归因 |
| `referral_activated` | 被邀请人激活 | referrer_id, time_to_activate | 推荐质量 |

#### 收入阶段 (Revenue) - 未来

| 事件名 | 触发时机 | 参数 | 用途 |
|--------|----------|------|------|
| `purchase_view` | 查看购买页面 | source_page | 付费意愿 |
| `purchase_initiated` | 发起购买 | plan_type | 购买意图 |
| `purchase_completed` | 完成购买 | plan_type, amount | 收入归因 |
| `purchase_cancelled` | 取消购买 | reason | 流失分析 |

### 4.2 用户属性追踪

| 属性 | 类型 | 说明 |
|------|------|------|
| `user_id` | String | 唯一用户标识 |
| `install_date` | Date | 安装日期 |
| `install_source` | String | 安装来源 (organic/referral/{channel}) |
| `initial_level` | String | 初始设置水平 (cet4/cet6/ielts/toefl/gre) |
| `api_provider` | String | API提供商 |
| `experiment_group` | Object | 实验分组 {experiment_id: group_id} |
| `referrer_id` | String | 推荐人ID (如有) |
| `last_active_date` | Date | 最后活跃日期 |
| `total_words_marked` | Number | 累计标记词汇数 |
| `total_words_known` | Number | 累计掌握词汇数 |
| `current_vocabulary_estimate` | Number | 当前词汇量估计 |
| `days_active_last_7` | Number | 近7天活跃天数 |
| `days_active_last_30` | Number | 近30天活跃天数 |

### 4.3 数据发送规范

```typescript
// 事件追踪接口
interface TrackEvent {
  event: string
  properties?: Record<string, any>
  timestamp?: number
  user_id?: string
  session_id?: string
}

// 示例调用
track({
  event: 'onboarding_complete',
  properties: {
    variant_id: 'B',
    duration_seconds: 145,
    steps_completed: 3,
    skipped_steps: 0
  },
  timestamp: Date.now(),
  user_id: 'user_xxx',
  session_id: 'session_xxx'
})
```

---

## 五、数据分析仪表板

### 5.1 核心指标看板

#### 北极星指标

```
日活跃用户 (DAU)
├── 新增用户
│   ├── Chrome Web Store 自然流量
│   ├── 社交媒体引流
│   └── 推荐邀请
├── 回流用户
│   ├── 7日内回流
│   └── 7日+回流
└── 活跃用户
    ├── 轻度 (1-5次翻译/天)
    ├── 中度 (6-20次翻译/天)
    └── 重度 (20+次翻译/天)
```

#### 关键指标表

| 指标类别 | 指标名称 | 当前值 | 目标值 | 趋势 |
|----------|----------|--------|--------|------|
| 获客 | 周新增安装 | - | 1,000 | - |
| 获客 | CAC (获客成本) | - | <$0.5 | - |
| 激活 | 7日激活率 | - | 40% | - |
| 激活 | 平均设置时间 | - | <3分钟 | - |
| 留存 | 次日留存 | - | 45% | - |
| 留存 | 7日留存 | - | 35% | - |
| 留存 | 30日留存 | - | 20% | - |
| 推荐 | 分享率 | - | 10% | - |
| 推荐 | 邀请转化率 | - | 15% | - |
| 推荐 | 病毒系数 (K) | - | >0.3 | - |

### 5.2 转化漏斗分析

```
曝光 (100%)
  ↓ 15% CTR
访问 (15%)
  ↓ 8% CVR
安装 (1.2%)
  ↓ 50% 激活率
激活 (0.6%)
  ↓ 35% 7日留存
7日留存 (0.21%)
  ↓ 10% 分享率
分享用户 (0.021%)
```

### 5.3 实验结果仪表板

| 实验ID | 名称 | 状态 | 样本量 | 主要指标变化 | 结论 |
|--------|------|------|--------|--------------|------|
| EXP-001 | 引导流程优化 | 进行中 | - | - | - |
| EXP-002 | 成就系统 | 计划中 | - | - | - |
| EXP-003 | API试用配额 | 计划中 | - | - | - |
| EXP-004 | 截图顺序 | 计划中 | - | - | - |

---

## 六、实验执行流程

### 6.1 实验生命周期

```
[想法收集] → [优先级排序] → [实验设计] → [开发实施]
                                              ↓
[规模化推广] ← [结果分析] ← [数据收集] ← [上线运行]
      ↓
[学习沉淀] → [想法收集] (循环)
```

### 6.2 每周增长会议议程

**时间**: 每周一 10:00-11:00
**参与者**: CEO, Growth Hacker, Founding Engineer, Content Creator

**议程**:
1. **上周实验回顾** (15分钟)
   - 实验数据更新
   - 显著性检验结果
   - 决策：继续/停止/扩展

2. **本周实验状态** (15分钟)
   - 进行中实验进度
   - 样本量达成情况
   - 预期完成时间

3. **新实验提案** (20分钟)
   - ICE评分
   - 优先级讨论
   - 资源分配

4. **数据异常分析** (10分钟)
   - 指标异常波动
   - 用户反馈汇总
   - 问题跟进

### 6.3 实验文档模板

每个实验需创建独立文档，包含：

```markdown
# EXP-XXX: 实验名称

## 基本信息
- 实验ID: EXP-XXX
- 提出人:
- 负责人:
- 状态: 计划中/进行中/已完成/已取消
- 时间线: YYYY-MM-DD 至 YYYY-MM-DD

## 实验假设
[清晰的假设陈述]

## 实验设计
[对照组和实验组详细描述]

## 成功指标
- 主要指标:
- 次要指标:
- 目标提升:

## 实验结果
- 样本量:
- 统计显著性:
- 指标变化:

## 决策
[规模化/放弃/继续观察]

## 学习沉淀
[关键洞察和可复用经验]
```

---

## 七、工具与资源

### 7.1 推荐工具

| 用途 | 工具 | 说明 |
|------|------|------|
| 数据分析 | Google Analytics 4 | 网站流量分析 |
| 事件追踪 | Mixpanel / Amplitude | 用户行为分析 |
| A/B测试 | Google Optimize / 自建 | 实验平台 |
| 数据可视化 | Metabase / Grafana | 内部仪表板 |
| 热力图 | Hotjar / Clarity | 用户行为可视化 |
| 反馈收集 | Canny / GitHub Issues | 用户反馈管理 |

### 7.2 数据存储规范

```
/raw-events/         # 原始事件数据
  /YYYY-MM-DD/
    events-{hour}.json

/processed/          # 清洗后数据
  /daily/
  /weekly/

/experiments/        # 实验数据
  /EXP-XXX/
    config.json
    results.json
    analysis.md

/reports/            # 定期报告
  /weekly/
  /monthly/
```

---

## 八、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 样本量不足 | 统计不显著 | 延长实验时间，降低流量分配 |
| 实验相互干扰 | 结果不可靠 | 实验互斥设计，错开运行时间 |
| 数据延迟 | 决策滞后 | 实时监控，设置最小样本阈值 |
| 隐私合规 | 法律风险 | 匿名化处理，遵守 GDPR/CCPA |
| 技术故障 | 数据丢失 | 多重备份，实时告警 |

---

## 九、附录

### 9.1 统计显著性计算

使用卡方检验判断实验结果显著性:

```python
from scipy.stats import chi2_contingency

def check_significance(control_conversions, control_total,
                       treatment_conversions, treatment_total,
                       confidence=0.95):
    """
    返回: (是否显著, p值, 置信区间)
    """
    contingency_table = [
        [control_conversions, control_total - control_conversions],
        [treatment_conversions, treatment_total - treatment_conversions]
    ]

    chi2, p_value, dof, expected = chi2_contingency(contingency_table)

    is_significant = p_value < (1 - confidence)

    return is_significant, p_value
```

### 9.2 最小样本量计算

```python
def calculate_sample_size(baseline_rate, mde, alpha=0.05, power=0.8):
    """
    计算每组最小样本量
    baseline_rate: 基准转化率
    mde: 最小可检测效应 (如 0.2 表示20%相对提升)
    """
    from scipy.stats import norm

    p1 = baseline_rate
    p2 = baseline_rate * (1 + mde)

    z_alpha = norm.ppf(1 - alpha/2)
    z_beta = norm.ppf(power)

    pooled_p = (p1 + p2) / 2

    n = (
        (z_alpha * (2 * pooled_p * (1 - pooled_p))**0.5 +
         z_beta * (p1 * (1 - p1) + p2 * (1 - p2))**0.5)**2
    ) / (p1 - p2)**2

    return int(n) + 1
```

### 9.3 相关文档

- [增长策略总览](./growth-plan.md)
- [用户增长策略](./user-growth-strategy.md)
- [Chrome Web Store ASO](./chrome-web-store-aso.md)
- [内容营销策略](./content-marketing-strategy.md)

---

*文档版本: v1.0 | 最后更新: 2026-03-16 | 维护者: Growth Hacker*
