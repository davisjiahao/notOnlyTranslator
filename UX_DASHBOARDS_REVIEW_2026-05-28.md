# UX 补充审查 — 仪表板组件 (CacheStats / CostDashboard / ErrorDashboard / PromptSettings)

**日期:** 2026-05-28
**审查范围:** Options 页面中未纳入初始 Nielsen 启发式评估的 4 个组件
**审查方法:** 代码审查 + WCAG 2.1 AA 对比 + 与已有 UX 修复模式一致性检查

---

## 总览

| 组件 | 整体评分 | 严重问题 | 备注 |
|------|---------|---------|------|
| CacheStats | ✅ 良好 | 0 | 完整的 ARIA、焦点环、内联确认 |
| CostDashboard | ✅ 良好 | 0 | progressbar 语义、警告分级、空状态 |
| ErrorDashboard | ⚠️ 一般 | 1 P2 | 单项删除缺少确认 |
| PromptSettings | ⚠️ 一般 | 1 P2 | radiogroup 缺少箭头键导航 |

---

## 发现项

### S1: ErrorDashboard 单项删除缺少确认或 Undo

**文件:** `src/options/components/ErrorDashboard.tsx:562-570`
**严重度:** P2 (中 — 数据丢失风险)
**Nielsen 启发式:** H3 用户控制与自由 + H5 错误预防

**问题:**
列表项的"删除"按钮直接调用 `handleDeleteError(error.id)`，无任何确认或撤销机制。但同组件的"清除所有错误"按钮（line 433）却有完整的内联确认对话框（`role="alert"`）。

**不一致来源:**
- ✅ VocabularyList 单项删除：2 秒撤销窗口 (`handleRequestDelete`)
- ✅ ErrorDashboard 批量删除：内联确认对话框
- ❌ ErrorDashboard 单项删除：**无确认、无撤销**

**用户场景风险:**
- 用户误点击"删除"按钮 → 错误记录立即永久丢失
- 错误数据对故障排查至关重要，比生词数据更敏感
- 表单元素紧凑（按钮间距小），误触概率高

**建议方案 (按优先级):**

**方案 A (推荐):** 采用与 VocabularyList 一致的 2 秒撤销窗口
```tsx
const [pendingDeletes, setPendingDeletes] = useState<Map<string, number>>(new Map());

const handleRequestDelete = (id: string) => {
  const timerId = window.setTimeout(() => {
    handleDeleteError(id);
    setPendingDeletes(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, 2000);
  setPendingDeletes(prev => new Map(prev).set(id, timerId));
};

const handleUndo = (id: string) => {
  const timerId = pendingDeletes.get(id);
  if (timerId) clearTimeout(timerId);
  setPendingDeletes(prev => {
    const next = new Map(prev);
    next.delete(id);
    return next;
  });
};
```

**方案 B:** 修改详情弹窗中的"删除此错误"为唯一删除入口，移除列表中的"删除"按钮
- 减少误触面（用户必须先打开详情才能删除）
- 详情弹窗中的删除已隐含"我知道我在删除什么"

**方案 C:** 列表"删除"按钮改为图标按钮 + 二次确认（点击后变为"确定删除"）

**WCAG 影响:** WCAG 2.5.7 拖拽备用方案不适用，但 WCAG 3.3.4 错误预防（法律、金融、数据）建议对数据删除提供撤销机制。

---

### S2: PromptSettings radiogroup 缺少箭头键导航

**文件:** `src/options/components/PromptSettings.tsx:57-69`
**严重度:** P2 (中 — WCAG 2.1.1 一致性)
**Nielsen 启发式:** H4 一致性与标准

**问题:**
组件使用 `role="radiogroup"` 包裹一组 `role="radio"` 按钮，但缺少：
- ❌ ArrowDown/ArrowUp 在选项间循环
- ❌ Home/End 跳转首/末选项
- ❌ Roving tabindex（仅当前选中项 tabindex=0）

当前所有按钮都是独立的 Tab stop，破坏了 WAI-ARIA radiogroup pattern 的预期行为。

**对比已修复的同类问题:**
- ✅ `FeedbackModal.tsx` — ArrowLeft/ArrowRight + roving tabindex
- ✅ `GeneralSettings.tsx` 主题选择器 — ArrowLeft/ArrowRight
- ✅ `AchievementGallery.tsx` 筛选器 — ArrowLeft/ArrowRight

**建议方案:**
复用已建立的 radiogroup 键盘导航模式（参考 `FeedbackModal.tsx`）：

```tsx
const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    e.preventDefault();
    const nextIndex = (index + 1) % availableVersions.length;
    handleVersionChange(availableVersions[nextIndex].version);
    radioRefs.current[nextIndex]?.focus();
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const prevIndex = (index - 1 + availableVersions.length) % availableVersions.length;
    handleVersionChange(availableVersions[prevIndex].version);
    radioRefs.current[prevIndex]?.focus();
  } else if (e.key === 'Home') {
    e.preventDefault();
    handleVersionChange(availableVersions[0].version);
    radioRefs.current[0]?.focus();
  } else if (e.key === 'End') {
    e.preventDefault();
    const lastIndex = availableVersions.length - 1;
    handleVersionChange(availableVersions[lastIndex].version);
    radioRefs.current[lastIndex]?.focus();
  }
};

// 在 button 上添加:
// onKeyDown={(e) => handleKeyDown(e, index)}
// tabIndex={selectedVersion === version ? 0 : -1}
// ref={(el) => { radioRefs.current[index] = el; }}
```

**WCAG 标准:** 2.1.1 键盘可访问 (Level A) + 2.4.3 焦点顺序

---

## 已验证良好的实现 ✅

### CacheStats 组件
- ✅ Loading 状态：`role="status"` + `aria-label="加载缓存统计中"`
- ✅ 状态消息：`role="status" aria-live="polite"`
- ✅ 内联确认对话框：`role="alert"` + 双按钮（确定/取消）
- ✅ 所有交互元素：`focus-visible:ring-2` 焦点环
- ✅ 颜色不作为唯一指示（数值 + 颜色组合）
- ✅ 自动 30 秒刷新（合理频率，不打扰）

### CostDashboard 组件
- ✅ 预算进度条：`role="progressbar"` + 完整 ARIA 数值属性
- ✅ 警告分级：致命/警告/信息的三层视觉系统
- ✅ 时间选择器：`htmlFor` + `sr-only` label
- ✅ 月度预算输入：明确的 `aria-label="月度预算金额"`
- ✅ 空状态组件：使用统一的 `EmptyState` 设计
- ✅ 内联确认：与其他组件一致的红色危险操作模式

### ErrorDashboard 其他部分
- ✅ 模态弹窗：`role="dialog" aria-modal="true"` + `aria-labelledby`
- ✅ 列表项：完整键盘支持（Enter/Space + `role="button"` + `tabIndex={0}`）
- ✅ 关闭按钮：`aria-label="关闭错误详情"`
- ✅ 过滤器：所有 select 元素均有 `sr-only` label
- ✅ 严重程度分级：致命/错误/警告的语义颜色

### PromptSettings 其他部分
- ✅ `role="radiogroup"` 和 `role="radio"` 语义正确
- ✅ `aria-checked` 状态同步
- ✅ `disabled` 时的 `opacity-50` 视觉反馈
- ✅ Focus-visible 焦点环

---

## 建议实施顺序

| 优先级 | 任务 | 工作量 | 影响 |
|--------|------|--------|------|
| P2 | S1: ErrorDashboard 单项删除撤销/确认 | 1h | 防止意外数据丢失 |
| P2 | S2: PromptSettings 箭头键导航 | 30min | WCAG 2.1.1 一致性 |

两项均可由 frontend-developer 在 1.5 小时内完成，复用已建立的代码模式。

---

## 与现有 UX 工作的关系

| 现有产出 | 关联 |
|---------|------|
| `UX_HEURISTIC_EVALUATION_2026-05-16.md` | 本审查覆盖了原评估未涉及的 4 个仪表板组件 |
| 已修复的 radiogroup (FeedbackModal/GeneralSettings/AchievementGallery) | S2 是同一模式的第 4 个实例 |
| VocabularyList 撤销窗口 (F3.3) | S1 应复用此模式 |
| 内联确认对话框 (各组件) | 仪表板组件已采用此模式（除 ErrorDashboard 单项删除外）|

---

## 结论

仪表板组件整体 UX 质量较高，反映出团队已经吸收了之前 Nielsen 评估的反馈并形成了一致的设计语言（内联确认、焦点环、空状态、aria-live 消息）。剩余两项 P2 问题均为可复用现有模式的小修复。
