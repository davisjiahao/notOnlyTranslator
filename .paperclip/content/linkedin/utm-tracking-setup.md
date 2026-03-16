# LinkedIn UTM 追踪链接设置指南

## 基础链接结构

### Chrome Web Store 产品页
```
https://chromewebstore.google.com/detail/notonlytranslator/[id]
```

---

## UTM 参数模板

### 1. D-Day 发布帖 (01-launch-announcement)
```
https://chromewebstore.google.com/detail/notonlytranslator/[id]?utm_source=linkedin&utm_medium=social&utm_campaign=launch&utm_content=announcement_dd
```

### 2. 功能亮点 Carousel (02-feature-highlight)
```
https://chromewebstore.google.com/detail/notonlytranslator/[id]?utm_source=linkedin&utm_medium=social&utm_campaign=launch&utm_content=feature_carousel
```

### 3. 学习洞察帖 (03-learning-insight)
```
https://chromewebstore.google.com/detail/notonlytranslator/[id]?utm_source=linkedin&utm_medium=social&utm_campaign=launch&utm_content=learning_insight
```

### 4. 生产力工具合集 (04-productivity-tools)
```
https://chromewebstore.google.com/detail/notonlytranslator/[id]?utm_source=linkedin&utm_medium=social&utm_campaign=launch&utm_content=tools_listicle
```

### 5. 互动话题帖 (05-interactive-engagement)
```
https://chromewebstore.google.com/detail/notonlytranslator/[id]?utm_source=linkedin&utm_medium=social&utm_campaign=launch&utm_content=engagement_friday
```

---

## 置顶评论专用短链接

为提高点击率，建议使用短链接服务：

| 内容 | 长链接 | 短链接平台 |
|------|--------|-----------|
| D-Day 发布 | `utm_content=announcement_dd` | bit.ly/NOT-launch |
| 功能亮点 | `utm_content=feature_carousel` | bit.ly/NOT-feature |
| 学习洞察 | `utm_content=learning_insight` | bit.ly/NOT-learn |
| 工具合集 | `utm_content=tools_listicle` | bit.ly/NOT-tools |
| 互动话题 | `utm_content=engagement_friday` | bit.ly/NOT-join |

---

## UTM 参数命名规范

### 必需参数
- `utm_source=linkedin` - 流量来源
- `utm_medium=social` - 媒介类型
- `utm_campaign=launch` - 活动名称
- `utm_content={content_type}` - 具体内容

### 可选参数
- `utm_term={keyword}` - 用于付费推广时标记关键词

---

## 链接使用场景对照表

| 使用位置 | UTM 内容值 | 示例 |
|---------|-----------|------|
| 帖子正文 | announcement_dd | "Chrome 商店搜索 NotOnlyTranslator" |
| 置顶评论 | 对应内容值 | 直接放短链接 |
| 个人简介 | bio_linkedin | 个人 profile 简介 |
| 公司主页 | company_about | 公司页面 about |
| 私信回复 | dm_response | 回复用户咨询 |

---

## 转化追踪设置

### Chrome Web Store 后台
1. 进入 [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
2. 选择 NotOnlyTranslator
3. 点击 "Analytics" → "Traffic Sources"
4. 验证 UTM 参数被正确捕获

### 自建追踪（可选）
如需更详细的用户行为追踪，可添加：
```javascript
// 在插件安装页面或欢迎页面
const utmParams = new URLSearchParams(window.location.search);
const source = utmParams.get('utm_source');
const campaign = utmParams.get('utm_campaign');

// 发送到自有分析系统
analytics.track('Install', {
  source,
  campaign,
  content: utmParams.get('utm_content')
});
```

---

## 每周数据检查清单

### 周一：检查上周数据
- [ ] Chrome Web Store 安装量（按来源筛选 LinkedIn）
- [ ] LinkedIn 帖子点击率（Analytics → Website Clicks）
- [ ] 计算 CTR = 点击量 / 曝光量

### 周五：优化下周内容
- [ ] 对比不同 `utm_content` 的转化效果
- [ ] 识别高转化内容类型
- [ ] 调整下周内容策略

---

## 预期数据基准

### LinkedIn 自然流量（无付费）
- 平均 CTR：1.5% - 3%
- 目标 CTR：>2%
- 安装转化率：20% - 30%（从点击到安装）

### 计算公式
```
曝光量 × CTR = 点击量
点击量 × 安装转化率 = 安装量

示例：
5000 曝光 × 2% CTR = 100 点击
100 点击 × 25% 转化率 = 25 安装
```

---

## 注意事项

1. **链接长度**：LinkedIn 评论区对长链接显示不友好，务必使用短链接
2. **链接预览**：发布前检查链接是否能正常生成预览卡片
3. **定期更新**：Chrome Web Store 链接中的 `[id]` 需在发布后替换为实际 ID
4. **A/B 测试**：同一内容可测试不同文案配相同 UTM，追踪文案效果

---

**状态**: ✅ Week 1 任务完成
**创建日期**: 2026-03-15
**最后更新**: 2026-03-15
