# 用户数据导出与邮件发送操作指南

**日期**: 2026-03-18
**用途**: Onboarding 用户访谈招募

---

## 1. 导出用户数据

### 方法 1: 使用 StorageManager

在 Chrome 扩展开发者控制台执行：

```javascript
// 获取最近 7 天的新用户
const newUsers = await StorageManager.getNewUsers(7);
console.log(newUsers);

// 导出研究数据
const data = await StorageManager.exportUserDataForResearch();
console.log(data.json); // JSON 格式
console.log(data.csv);  // CSV 格式
```

### 方法 2: 手动导出

1. 打开 Chrome 扩展管理页面
2. 找到 NotOnlyTranslator
3. 打开 "background page" 开发者工具
4. 在 Console 执行上述代码
5. 复制输出的 JSON/CSV 数据

### 导出字段

| 字段 | 说明 |
|------|------|
| userId | 用户ID |
| email | 邮箱地址 |
| installDate | 安装日期 |
| vocabularySize | 词汇量 |
| examType | 考试类型 |
| markedWords | 标记单词数 |
| lastActive | 最后活跃时间 |

---

## 2. 筛选目标用户

### 筛选条件

**必须满足**:
- 安装时间: 近 7 天内
- 有邮箱地址

**优先选择**:
- 不同职业（开发者/学生/职场）
- 不同英语水平
- 不同使用程度（轻度/中度/重度）

### 筛选步骤

1. 打开导出的数据文件
2. 按 installDate 排序
3. 筛选出近 7 天安装的用户
4. 确保有 email 字段
5. 标记用户类型（职业/英语水平）
6. 选择 50-100 位用户

---

## 3. 发送邮件邀请

### 邮件模板

**主题**: 诚邀参与 NotOnlyTranslator 用户访谈（含30元奖励）

**正文**:

```
尊敬的 {用户名}，

感谢您安装 NotOnlyTranslator！

我们正在改进产品体验，诚邀您参与一次简短的用户访谈，分享您首次使用的感受。

🎁 【参与奖励】
完成访谈后，您将获得：
- 30元京东卡  或
- 1个月高级会员

📝 【访谈内容】
- 分享您首次使用产品的体验
- 告诉我们哪些地方让您困惑
- 提出您的改进建议

⏱️ 【时间安排】
- 时长：30-45 分钟
- 形式：视频会议（腾讯会议/Zoom）
- 时间：双方协商，灵活安排

✅ 【参与条件】
✓ 近7天内安装了 NotOnlyTranslator
✓ 有英文阅读需求

🔒 【隐私保护】
- 访谈将录音用于分析
- 个人信息严格保密
- 数据仅用于产品改进
- 参与完全自愿，可随时退出

【立即报名】
点击链接填写报名表：https://forms.gle/notonlytranslator-onboarding-recruitment

名额有限，先到先得！

如有任何问题，请联系：research@notonlytranslator.com

期待与您的交流！

NotOnlyTranslator 团队
2026-03-18
```

### 发送工具

#### 选项 1: Gmail 邮件合并
1. 使用 Google Sheets 整理用户列表
2. 安装 "Yet Another Mail Merge" 插件
3. 创建邮件模板
4. 批量发送

#### 选项 2: 邮件营销工具
- Mailchimp
- SendGrid
- 或其他邮件工具

#### 选项 3: 手动发送
- 适用于少量用户（<20人）
- 逐个发送个性化邮件

### 发送注意事项

1. **发送时间**: 工作日上午 9:00-11:00 效果最佳
2. **分批发送**: 每批 20-30 封，避免被标记为垃圾邮件
3. **个性化**: 尽可能使用用户姓名
4. **跟踪**: 使用邮件跟踪工具查看打开率

---

## 4. 社交媒体发布

### 小红书

**文案**:
```
🎁 招募 | NotOnlyTranslator 用户访谈

刚刚安装了 NotOnlyTranslator 的朋友看过来！

我们正在招募新用户参与产品体验访谈：
✅ 近7天内安装
✅ 有英文阅读需求
✅ 愿意分享使用体验

🎁 参与福利：30元京东卡
⏱️ 访谈时长：30-45 分钟
💻 形式：视频会议

报名方式：https://forms.gle/notonlytranslator-onboarding-recruitment

⏰ 截止时间：名额有限，招满即止！

#用户研究 #产品体验 #英语学习 #翻译工具
```

### 知乎

**文案**:
```
【招募】NotOnlyTranslator 用户访谈 | 30元奖励

我们正在招募新用户参与产品体验访谈。

🎯 招募条件
- 近7天内安装了 NotOnlyTranslator
- 有英文阅读需求
- 愿意分享真实使用感受

🎁 参与奖励：30元京东卡

📝 访谈详情
- 时长：30-45 分钟
- 形式：视频会议
- 内容：分享首次使用体验

报名方式：https://forms.gle/notonlytranslator-onboarding-recruitment

#用户研究 #产品体验 #英语学习
```

### V2EX

**文案**:
```
【招募】NotOnlyTranslator 用户访谈 - 30元京东卡

各位 V 友好！

我们正在开发一款 Chrome 翻译扩展，现招募新用户参与访谈。

🎯 招募条件
- 近7天内安装过 NotOnlyTranslator
- 有英文阅读需求
- 愿意花 30-45 分钟聊聊使用体验

🎁 奖励：30元京东卡

📮 报名：https://forms.gle/notonlytranslator-onboarding-recruitment

谢谢！
```

---

## 5. 监控与跟踪

### 报名表单监控

**Google Forms 回复**:
1. 打开表单
2. 点击 "回复" 标签
3. 查看实时回复
4. 导出到 Google Sheets

### 跟踪指标

| 指标 | 目标 | 跟踪方式 |
|------|------|----------|
| 收到报名 | 15+ | Google Forms |
| 邮件打开率 | >30% | 邮件跟踪 |
| 点击率 | >10% | 链接跟踪 |
| 社交媒体曝光 | 1000+ | 平台数据 |

### 每日检查

**上午**:
- [ ] 检查新报名
- [ ] 记录到跟踪表
- [ ] 初步筛选

**下午**:
- [ ] 回复咨询
- [ ] 更新社交媒体
- [ ] 跟进潜在参与者

---

## 6. 用户筛选流程

### Step 1: 收到报名
- 检查资格条件
- 记录到跟踪表

### Step 2: 初步筛选（24小时内）
- 确保多样性
- 选择 10-12 人

### Step 3: 发送确认
- 发送知情同意书
- 收集时间段

### Step 4: 安排访谈
- 确认时间
- 发送会议链接

---

## 7. 时间表

| 时间 | 任务 | 目标 |
|------|------|------|
| Day 1 | 导出数据、发送邮件 | 50+ 邮件 |
| Day 2 | 发布社交媒体 | 多平台 |
| Day 3-7 | 持续推广、筛选用户 | 15+ 报名 |
| Week 2 | 安排访谈 | 8-10 场 |

---

**文档时间**: 2026-03-18
**负责人**: UX Researcher
