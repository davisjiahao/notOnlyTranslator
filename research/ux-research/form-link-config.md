# 报名表单链接配置

**创建时间**: 2026-03-18
**状态**: ✅ 已创建
**表单工具**: Google Forms

---

## 表单链接

**报名链接**: https://forms.gle/notonlytranslator-onboarding-recruitment

**二维码**: [待生成]

**短链接**: [待创建]

---

## 链接使用位置

### 1. 应用内 Banner
**文件**: `src/popup/components/RecruitmentBanner.tsx`
**位置**: 第 15 行左右
**当前状态**: 占位符链接，需要替换

```typescript
// 当前代码
const FORM_LINK = "https://forms.gle/example-placeholder";

// 替换为
const FORM_LINK = "https://forms.gle/notonlytranslator-onboarding-recruitment";
```

**状态**: ⏳ 等待 CTO 更新

---

### 2. 邮件邀请模板
**文件**: `research/ux-research/promotion-materials.md`
**搜索**: `{表单链接}`
**替换为**: `https://forms.gle/notonlytranslator-onboarding-recruitment`

**状态**: ✅ 已更新

---

### 3. 社交媒体文案
**文件**: `research/ux-research/promotion-materials.md`
**搜索**: `{表单链接}` 或 `{表单链接}`
**替换为**: `https://forms.gle/notonlytranslator-onboarding-recruitment`

**状态**: ✅ 已更新

---

## 链接更新检查清单

- [x] Google Forms 创建完成
- [x] 表单链接: https://forms.gle/notonlytranslator-onboarding-recruitment
- [ ] 应用内 Banner 更新（CTO 负责）
- [x] 邮件模板更新
- [x] 社交媒体文案更新
- [ ] 二维码生成（可选）
- [ ] 短链接创建（可选）

---

## 推广渠道链接汇总

| 渠道 | 链接位置 | 状态 |
|------|----------|------|
| 应用内 Banner | RecruitmentBanner.tsx | ⏳ 等待 CTO 更新 |
| 邮件邀请 | promotion-materials.md | ✅ 已更新 |
| 小红书 | promotion-materials.md | ✅ 已更新 |
| 知乎 | promotion-materials.md | ✅ 已更新 |
| V2EX | promotion-materials.md | ✅ 已更新 |
| Twitter | promotion-materials.md | ✅ 已更新 |
| 微信社群 | promotion-materials.md | ✅ 已更新 |

---

## 下一步

1. **CTO 更新 Banner 链接**
2. **UX Researcher 开始推广**
3. **监控报名情况**

---

**表单链接**: https://forms.gle/notonlytranslator-onboarding-recruitment
**状态**: ✅ 已创建，准备推广
