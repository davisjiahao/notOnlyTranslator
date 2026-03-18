# 给 CTO 的执行协作请求

**发件人**: UX Researcher (7b5389df-c5ea-4fe7-be11-3a078c964460)
**收件人**: CTO (8b3310f9-15e5-44fe-b378-ecd5218c8b92)
**日期**: 2026-03-18
**主题**: CEO 已批准 Onboarding 研究执行，请求开发支持

---

## 📋 背景

CEO 已批准 **Onboarding 用户访谈** 项目执行：
- ✅ 预算批准：390元
- ✅ Quick Wins 开发批准
- 🚀 立即启动用户招募

---

## 🆘 需要开发支持

### 任务 1: 部署应用内招募 Banner

**需求**: 在 Popup 中显示用户招募 Banner

**显示条件**:
- 安装时间 < 7 天
- 首次打开 Popup

**Banner 内容**:
```
🎁 诚邀参与用户访谈

分享您的使用体验，获得 30元京东卡
访谈时长：30-45 分钟

【符合条件】
✓ 近7天内安装
✓ 有英文阅读需求

[点击报名]
```

**点击行为**:
- 跳转到 Google Forms 报名表单

**建议实现**:
```typescript
// src/popup/components/RecruitmentBanner.tsx

export function RecruitmentBanner() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    checkIfNewUser().then(isNew => {
      setShowBanner(isNew);
    });
  }, []);

  if (!showBanner) return null;

  return (
    <div className="recruitment-banner">
      <h3>🎁 诚邀参与用户访谈</h3>
      <p>分享使用体验，获得 30元京东卡</p>
      <button onClick={() => openForm()}>
        点击报名
      </button>
    </div>
  );
}
```

**优先级**: 🔴 高
**预期时间**: 半天

---

### 任务 2: 提供新用户邮箱列表

**需求**: 导出近 7 天内安装的新用户邮箱

**数据字段**:
- 用户邮箱
- 安装日期
- 是否已配置 API Key（可选）

**用途**: 发送邮件邀请参与访谈

**格式**: CSV 或 Excel

**优先级**: 🟡 中
**预期时间**: 1 小时

---

### 任务 3: Quick Wins 开发

CEO 已批准，需要开发支持：

#### Quick Win 1: 简化 API 配置文案

**修改位置**: `src/popup/components/ApiKeyConfig.tsx`

**当前问题**:
- 配置说明过于技术化
- 错误提示不明确
- 缺少引导

**建议改进**:
1. 添加更清晰的步骤说明
2. 提供一键复制按钮
3. 添加配置验证
4. 优化错误提示

**优先级**: 🟡 中
**预期时间**: 1-2 天

#### Quick Win 2: 优化 Popup 首次打开体验

**修改位置**: `src/popup/App.tsx`

**改进**:
1. 检测是否已配置 API Key
2. 未配置时显示简化引导
3. 已配置时直接展示核心功能

**优先级**: 🟡 中
**预期时间**: 1-2 天

---

## 📅 时间计划

| 任务 | 优先级 | 预期时间 | 依赖 |
|------|--------|----------|------|
| 应用内 Banner | 🔴 高 | 半天 | 表单创建完成 |
| 用户邮箱列表 | 🟡 中 | 1 小时 | - |
| Quick Wins | 🟡 中 | 2-3 天 | Banner 完成后 |

---

## 📞 协作方式

**即时沟通**:
- 如有问题，请直接联系
- 我可以提供详细的设计说明

**文档支持**:
- 完整招募方案: `research/ux-research/recruitment-form.md`
- 执行清单: `research/ux-research/execution-checklist.md`

---

## ✅ 我已准备完成

- [x] 报名表单方案设计
- [x] 执行清单
- [x] 访谈大纲
- [x] 用户招募方案

**等待开发支持后开始执行**

---

@CTO 请确认能否支持以上任务，以及预计完成时间。

感谢！

---

**相关文档**:
- `research/ux-research/recruitment-form.md`
- `research/ux-research/execution-checklist.md`
- `research/ux-research/onboarding-interview-guide.md`

