# UX 设计规格 — `prefers-reduced-motion` 无障碍支持

**日期:** 2026-05-28
**来源:** 原始 UX 报告 (2026-03-15) Section 6 — Accessibility
**严重度:** P1 (中高)
**范围:** 所有动画组件 + Content Script 样式

---

## 问题描述

NotOnlyTranslator 扩展大量使用动画效果（旋转加载、弹跳提示、渐入渐出、Confetti 庆祝等），但没有为使用 `prefers-reduced-motion` 的用户提供替代方案。这在 WCAG 2.1 的 2.3.3 动画触发下可能引起眩晕或不适。

**现状**: ❌ 无任何 `prefers-reduced-motion` 支持

---

## 影响分析

### 使用动画的组件 (45 个文件)

| 动画类型 | 出现次数 | 影响组件 |
|---------|---------|---------|
| `animate-spin` | 15+ | 加载状态 (所有页面) |
| `animate-bounce` | 5 | 成就提示、模式切换 |
| `animate-pulse` | 2 | 成就徽章角标 |
| `animate-ping` | 1 | 模式切换 overlay |
| `animate-in/fade-in/zoom-in` | 8+ | 模态框、提示 |
| `animate-confetti` (自定义) | 1 | 成就解锁 |
| `animate-shimmer` (自定义) | 1 | 成就通知 |
| CSS `@keyframes` (content script) | 8 | 导航高亮、tooltip |

### 高风险动画 (可能引起不适)
- ✨ **Confetti 动画** — 成就解锁时的多元素动画
- 🏀 **Bounce 动画** — 模式切换提示
- 🔄 **Spin 动画** — 多个加载 spinner
- 📡 **Ping 动画** — 扩散效果

### 低风险动画 (可保留)
- 颜色/透明度渐变 (fade-in/out)
- 过渡动画 (transition-all) — 如果不伴随运动

---

## 设计方案

### 核心原则

1. **降级而非消除**: 为 `prefers-reduced-motion` 用户提供静态或简化的替代方案，而不是完全移除视觉反馈
2. **分层处理**:
   - 运动动画 → 静态替代
   - 加载指示器 → 保留（功能性必需）但降低速度/频率
   - 过渡效果 → 简化为直接切换

### 实现策略

#### 策略 A: Tailwind CSS `motion-reduce` 变体 (推荐)

Tailwind CSS 内置 `motion-reduce:` 前缀，对应 `@media (prefers-reduced-motion: reduce)`。

```css
/* 在全局样式中添加 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

#### 策略 B: 逐组件条件渲染 (复杂但精确)

在每个动画组件中根据 `prefers-reduced-motion` 条件渲染不同内容。

**不推荐** — 45 个文件改动量过大，且违背了 Tailwind 的设计哲学。

---

## 实施方案

### Phase 1: 全局 CSS 降级 (覆盖 90% 场景)

**文件**: `src/index.css` (或主入口 CSS)

```css
/* 在文件末尾添加 */
@media (prefers-reduced-motion: reduce) {
  /* 减少所有动画为几乎瞬间完成 */
  .animate-spin,
  .animate-bounce,
  .animate-pulse,
  .animate-ping,
  .animate-confetti,
  .animate-shimmer {
    animation-duration: 0.01ms;
    animation-iteration-count: 1;
  }

  /* 保留加载 spinner 但降低频率 */
  .animate-spin {
    animation-duration: 2s;
    animation-iteration-count: infinite;
  }

  /* 禁用进入/退出动画 */
  .animate-in,
  .animate-out,
  .fade-in,
  .fade-out,
  .zoom-in,
  .zoom-out,
  .slide-in-from-right,
  .slide-out-right {
    animation: none;
  }

  /* 简化过渡效果 */
  .transition-all,
  .transition-transform,
  .transition-opacity {
    transition-duration: 0.01ms;
  }
}
```

### Phase 2: Content Script 样式处理

**文件**: `src/content/styles.css`

为每个 `@keyframes` 规则添加 `prefers-reduced-motion` 媒体查询：

```css
@media (prefers-reduced-motion: reduce) {
  .not-translator-nav-highlight {
    animation: none;
    background-color: #fef08a; /* 保持高亮但无脉冲 */
  }

  /* Loading spinners — 保留功能性但降低速度 */
  .not-translator-loading-spinner {
    animation-duration: 3s; /* 从 1s 降至 3s */
  }
}
```

### Phase 3: 高风险组件特殊处理

| 组件 | 问题 | 替代方案 |
|------|------|---------|
| `AchievementUnlockModal` | Confetti 多元素动画 | 显示静态成就图标 + 文字 |
| `AchievementNotification` | Shimmer + bounce | 静态显示，去掉 shimmer |
| `App.tsx` (popup) | Ping + bounce overlay | 仅显示静态模式图标 |
| `FlashcardReview` | 3D 翻转动画 | 直接显示正面/背面，无翻转 |

---

## 技术要点

### 需要修改的文件清单

| 文件 | 变更类型 | 工作量 |
|------|---------|--------|
| `src/index.css` | 新增 `prefers-reduced-motion` 全局规则 | 15 行 |
| `src/content/styles.css` | 新增 3-4 个降级规则 | 20 行 |
| `tailwind.config.js` | 确认 `motion-reduce` 变体已启用 | 检查 |
| `src/shared/components/AchievementUnlockModal.tsx` | 添加 `prefers-reduced-motion` 检查 | 条件渲染 |
| `src/popup/App.tsx` | 模式切换动画降级 | 条件 className |
| `src/options/components/FlashcardReview.tsx` | 翻转动画替代 | 状态切换 |

### 测试要求

1. **手动测试**: 在系统设置中开启 `Reduce Motion` (macOS/iOS: Accessibility → Motion → Reduce motion)
2. **验证点**:
   - 打开 Popup → 无弹跳/脉冲动画
   - 点击翻译模式切换 → 直接切换，无 ping/bounce
   - 打开闪卡复习 → 无 3D 翻转
   - 触发成就 → 无 confetti 动画
   - 加载状态 → spinner 变慢但仍然存在
   - 所有模态框 → 直接出现，无 fade/zoom

---

## 验收标准

- [ ] `prefers-reduced-motion: reduce` 用户在所有页面看到简化版动画
- [ ] 加载 spinner 仍然存在（功能性必需）但频率降低
- [ ] Confetti/bounce/ping 等高运动动画完全禁用
- [ ] Fade/transition 类简化为直接切换
- [ ] Content Script 中的导航高亮保留但无脉冲
- [ ] 不影响正常 `prefers-reduced-motion: no-preference` 用户的体验
- [ ] 通过 `prefers-reduced-motion` 媒体查询测试

---

## 与 WCAG 合规性

| 标准 | 要求 | 当前状态 | 目标状态 |
|------|------|---------|---------|
| WCAG 2.3.3 | 动画可以禁用 | ❌ 不合规 | ✅ 合规 |
| WCAG 2.2.2 | 暂停/停止/隐藏移动内容 | ❌ 不合规 | ✅ 合规 |

---

## 建议实现顺序

1. **Phase 1**: 全局 CSS 规则 (`src/index.css` + `src/content/styles.css`) — 覆盖 90%
2. **Phase 2**: 高风险组件条件渲染 — 覆盖剩余 10%
3. **Phase 3**: 无障碍测试验证

Phase 1 预计 1 小时工作量，Phase 2 预计 2-3 小时，Phase 3 预计 1 小时。
