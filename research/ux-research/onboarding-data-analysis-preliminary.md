# Onboarding 流程数据分析报告（初步）

## 数据收集能力评估

### ✅ 已具备的数据收集能力

基于对 analytics 模块的分析，系统已具备以下 onboarding 相关数据收集能力：

#### 1. 激活阶段事件追踪

| 事件名称 | 事件常量 | 追踪目的 |
|----------|----------|----------|
| 开始引导 | `ONBOARDING_START` | 用户开始 onboarding 流程 |
| 完成引导步骤 | `ONBOARDING_STEP_COMPLETE` | 追踪各步骤完成情况 |
| 完成引导 | `ONBOARDING_COMPLETE` | 用户完成整个引导流程 |
| 跳过引导 | `ONBOARDING_SKIP` | 用户跳过 onboarding |
| 首次翻译 | `FIRST_TRANSLATION` | 用户完成首次翻译 |
| 首次标记单词 | `FIRST_WORD_MARKED` | 用户完成首次单词标记 |
| API 配置完成 | `API_CONFIGURED` | 用户成功配置 API Key |
| 试用额度使用 | `TRIAL_QUOTA_USED` | 用户使用了试用额度 |

#### 2. 预定义漏斗分析

系统已配置 **用户激活漏斗**：

```
开始引导 → 完成引导 → 首次翻译 → 标记首个单词
```

#### 3. 用户属性追踪

- 安装日期
- 安装来源
- 初始英语水平
- API 提供商选择
- 实验分组
- 推荐人 ID

---

## 📊 可分析的指标

### 1. Onboarding 完成率

**计算公式**：
```
Onboarding 完成率 = 完成引导用户数 / 开始引导用户数 × 100%
```

### 2. 各步骤转化率

| 步骤 | 转化指标 |
|------|----------|
| 开始引导 → 完成引导 | 引导完成率 |
| 完成引导 → 首次翻译 | 首次功能使用率 |
| 首次翻译 → 标记单词 | 核心功能采用率 |

### 3. 流失点识别

通过分析 `ONBOARDING_SKIP` 事件：
- 用户在哪个步骤最容易跳过
- 跳过 onboarding 的用户后续激活率

### 4. API 配置成功率

**需要补充追踪**：
- API Key 配置尝试次数
- 配置失败错误类型
- 从安装到配置成功的时间

---

## ⚠️ 数据缺口识别

### 当前缺失的关键数据

| 缺失数据 | 影响 | 建议补充 |
|----------|------|----------|
| API Key 配置错误详情 | 无法诊断配置失败原因 | 追踪 `API_CONFIG_ERROR` 事件 |
| Popup 首次打开数据 | 无法分析首次接触体验 | 追踪 `POPUP_FIRST_OPEN` 事件 |
| 用户首次设置时长 | 无法评估设置复杂度 | 记录开始和完成时间戳 |
| 用户英语水平的自我评估 | 无法细分用户群体 | 在 onboarding 中添加问卷 |
| 用户期望与实际体验差距 | 无法评估满意度 | 在首次使用后收集反馈 |

---

## 🔍 建议的数据分析方向

### 1. 短期分析（本周可完成）

#### Onboarding 漏斗分析
```typescript
const activationFunnel = {
  steps: [
    { name: '开始引导', event: 'onboarding_start' },
    { name: '完成引导', event: 'onboarding_complete' },
    { name: '首次翻译', event: 'first_translation' },
    { name: '标记单词', event: 'first_word_marked' }
  ]
}
```

**预期产出**：
- 整体转化率
- 各步骤流失率
- 平均完成时间

#### 用户分群分析
- 按英语水平分群
- 按安装来源分群
- 按 API 提供商分群

### 2. 中期分析（需要补充数据）

#### API Key 配置深度分析
- 配置成功率
- 常见错误类型
- 配置尝试次数分布

#### 首次体验质量分析
- 首次翻译成功率
- 首次翻译响应时间
- 用户对首次翻译的满意度

### 3. 长期追踪（建立基线后）

#### A/B 测试分析
- 不同 onboarding 流程版本的转化率对比
- 不同引导方式的效果对比

#### 留存关联分析
- 完成 onboarding 与 7 日留存的关系
- 首次体验质量与长期留存的关系

---

## 📝 数据收集建议

### 立即实施（无需开发）

1. **导出现有数据**
   - 从 Chrome Storage 导出 analytics_conversions 数据
   - 分析近 30 天的 onboarding 事件

2. **创建数据看板**
   - 使用现有 funnel.ts 分析函数
   - 生成周报/月报的 onboarding 指标

### 需要开发支持

1. **增强事件追踪**
   ```typescript
   // 建议新增事件
   AnalyticsEvents.API_CONFIG_ERROR = 'api_config_error'
   AnalyticsEvents.API_CONFIG_RETRY = 'api_config_retry'
   AnalyticsEvents.POPUP_FIRST_OPEN = 'popup_first_open'
   AnalyticsEvents.ONBOARDING_STEP_VIEW = 'onboarding_step_view'
   AnalyticsEvents.ONBOARDING_BACK = 'onboarding_back'
   ```

2. **添加用户反馈收集**
   - 首次使用后弹出满意度调查
   - API 配置失败时收集反馈

3. **创建数据分析脚本**
   - 定期导出分析数据
   - 生成可视化报告

---

## 🎯 下一步行动

### 本周行动项

- [ ] 导出现有 analytics 数据进行初步分析
- [ ] 计算当前 onboarding 漏斗转化率基线
- [ ] 识别主要流失点

### 下周行动项

- [ ] 开始用户访谈（基于现有数据设计问题）
- [ ] 与开发团队协作增强事件追踪
- [ ] 创建实时数据看板

### 中期目标

- [ ] 建立完整的 onboarding 数据分析体系
- [ ] 完成竞品分析
- [ ] 提出并验证优化方案

---

## 附录：数据导出脚本

```typescript
// 导出 analytics 数据供分析
async function exportAnalyticsData() {
  const result = await chrome.storage.local.get([
    'analytics_conversions',
    'analytics_profiles',
    'user_traits'
  ]);

  const data = {
    conversions: result.analytics_conversions || [],
    profiles: result.analytics_profiles || [],
    traits: result.user_traits || {},
    exportTime: Date.now()
  };

  // 导出为 JSON 文件
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analytics-export-${Date.now()}.json`;
  a.click();

  return data;
}
```

---

*报告创建时间：2026-03-18*
*数据来源：src/shared/analytics/*
*版本：v1.0*
