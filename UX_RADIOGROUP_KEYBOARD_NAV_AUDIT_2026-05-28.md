# UX 审计 — radiogroup 键盘导航全代码库一致性

**日期:** 2026-05-28
**审计范围:** 所有使用 `role="radiogroup"` 的组件 (11 个文件)
**审计动机:** PromptSettings (S2, UX_DASHBOARDS_REVIEW) 暴露出该模式可能不止 1 个实例，需要全代码库验证
**WCAG 标准:** 2.1.1 键盘可访问 (Level A) + 2.4.3 焦点顺序 + WAI-ARIA Radio Group Pattern

---

## 执行摘要

代码库中存在 **11 个 `role="radiogroup"` 实例**，其中:
- ✅ **3 个已修复**（FeedbackModal、GeneralSettings、AchievementGallery）— 之前已有 a11y fix
- ❌ **8 个未修复**（含 1 个 ARIA 角色错配）— 全部缺少 ArrowKey/Home/End 导航
- 8 个未修复实例均使用相同的 `<button role="radio" aria-checked>` 模式，可批量复用 FeedbackModal 已建立的 `handleRadioKeyDown` 工具函数

**用户影响:** 屏幕阅读器用户期望 radiogroup 内 Tab 进入后用方向键切换选项（WAI-ARIA Authoring Practices 1.2 标准）。当前每个 button 都是独立 Tab stop，破坏了语义承诺，使纯键盘用户切换 N 个选项需要 N 次 Tab，而正常 radiogroup 只需 1 次 Tab + N-1 次方向键。

---

## 全实例清单

| # | 文件:行 | radiogroup 用途 | 选项数 | 状态 |
|---|---------|----------------|--------|------|
| 1 | `popup/components/Feedback/FeedbackModal.tsx:65` | 反馈类型 | 4 | ✅ 已修复 |
| 2 | `options/components/GeneralSettings.tsx` | 主题（浅/深/系统） | 3 | ✅ 已修复 |
| 3 | `shared/components/AchievementGallery.tsx` | 成就筛选器 | 3 | ✅ 已修复 |
| 4 | **`options/components/PromptSettings.tsx:57`** | **Prompt 版本** | **动态** | **❌ 未修复 (S2)** |
| 5 | **`popup/components/WelcomeModal.tsx:213`** | **翻译服务商（首次配置）** | **4** | **❌ 未修复 (R1)** |
| 6 | **`popup/App.tsx:398`** | **翻译模式（生词/双语/全文）** | **3** | **❌ 未修复 (R2)** |
| 7 | **`shared/components/WelcomeModalExperiment.tsx:376`** | **英语水平选择** | **6** | **❌ 未修复 (R3)** |
| 8 | **`shared/components/WelcomeModalExperiment.tsx:523`** | **翻译服务商（A/B 实验版）** | **4** | **❌ 未修复 (R4)** |
| 9 | **`options/components/TranslationStyleSettings.tsx:99`** | **高亮样式** | **多** | **❌ 未修复 (R5)** |
| 10 | **`options/components/LevelSelector.tsx:65`** | **考试类型** | **多** | **❌ 未修复 (R6)** |
| 11 | **`options/components/ApiKeyWizard.tsx:279, 588`** | **服务商 + 模型选择** | **多** | **❌ 未修复 (R7, R8)** |
| 12 | `options/components/ContextualLearningMode.tsx:208` | 学习模式（语境/闪卡） | 2 | ⚠️ ARIA 错配 (R9) |

---

## 发现项详情

### R1: WelcomeModal — 翻译服务商选择（首次启动 modal）

**文件:** `src/popup/components/WelcomeModal.tsx:213-248`
**严重度:** P1 — 这是新用户首次接触扩展的界面，键盘可访问性影响首印象
**用户场景:**
- 全键盘用户首次安装扩展 → 弹出 WelcomeModal → 焦点应进入 modal（已通过 `useFocusTrap` 实现）→ Tab 到服务商区域 → **应该用 ↓↑ 在 OpenAI/Anthropic/Gemini/DeepSeek 间切换**
- 当前行为: 必须 Tab 4 次才能跨过所有服务商按钮（每个都是独立 Tab stop）

**修复优先级理由:** 首次配置流程是新用户唯一被强制完成的流程，无障碍质量必须最高。

---

### R2: popup/App.tsx — 翻译模式选择

**文件:** `src/popup/App.tsx:398-446`（推断 — 仅检查了头部 35 行）
**严重度:** P2
**用户场景:** popup 是日常高频入口，切换翻译模式是核心操作。3 个选项（生词高亮/双语/全文）通过 Tab 切换不符合 radiogroup 标准。

**注释证据:** 代码中已有注释 `// WCAG 4.1.2: 翻译模式按钮组 — 使用 radiogroup 角色，让屏幕阅读器识别当前选中项` — 说明团队认识到这是 a11y 关注点，但只完成了一半（语义角色），缺失键盘交互。

---

### R3: WelcomeModalExperiment — 英语水平

**文件:** `src/shared/components/WelcomeModalExperiment.tsx:376`
**严重度:** P1（实验版 modal — 若被启用为默认版本则首因效应放大）
**选项数:** 6（A1→C2 + 自定义）— **选项越多，缺少方向键导航的痛感越强**

---

### R4: WelcomeModalExperiment — 服务商选择（实验版）

**文件:** `src/shared/components/WelcomeModalExperiment.tsx:523`
**严重度:** P1（与 R1 同因 — 实验版本应保持等同 a11y 质量）

---

### R5: TranslationStyleSettings — 高亮样式

**文件:** `src/options/components/TranslationStyleSettings.tsx:99-125`
**严重度:** P2
**特殊点:** 包含 `disabled` 状态处理（line 106）— 修复时需保证 disabled 按钮在 Arrow 导航中被跳过。

---

### R6: LevelSelector — 考试类型

**文件:** `src/options/components/LevelSelector.tsx:65-83`
**严重度:** P2
**注意:** 该 radiogroup 与下方分数 slider 形成两阶段配置流程，键盘流畅性影响整个 Level 配置体验。

---

### R7 + R8: ApiKeyWizard — 服务商选择 + 模型选择

**文件:** `src/options/components/ApiKeyWizard.tsx:279, 588`
**严重度:** P2
**双重实例特殊点:** 同一 Wizard 内两个 radiogroup（步骤 1 选服务商、步骤 N 选模型），用户在 Wizard 流程中两次遭遇同一可用性缺陷。

---

### R9: ContextualLearningMode — ARIA 角色错配

**文件:** `src/options/components/ContextualLearningMode.tsx:208-231`
**严重度:** P3 — 但属于**结构性 ARIA 错误**而非交互缺陷
**问题:**
```tsx
<div role="radiogroup" aria-label="学习模式">
  <button aria-pressed={mode === 'contextual'}>📖 语境模式</button>  {/* ❌ 应该是 role="radio" + aria-checked */}
  <button aria-pressed={mode === 'flashcard'}>🎴 闪卡模式</button>
</div>
```

**两种正确方案（任选一）:**

**方案 A:** 改为正确的 radiogroup
```tsx
<div role="radiogroup" aria-label="学习模式">
  <button role="radio" aria-checked={mode === 'contextual'} onClick={() => setMode('contextual')}>...</button>
  <button role="radio" aria-checked={mode === 'flashcard'} onClick={() => setMode('flashcard')}>...</button>
</div>
```
+ 添加方向键导航

**方案 B:** 改为 toolbar（更适合 toggle 按钮组）
```tsx
<div role="toolbar" aria-label="学习模式">
  <button aria-pressed={mode === 'contextual'}>...</button>
  <button aria-pressed={mode === 'flashcard'}>...</button>
</div>
```
保留 `aria-pressed`，无需方向键导航（toolbar 只用 Tab）。

**推荐 B**：语义上更准确（这不是单选一组，而是两个互斥状态切换），且免去键盘导航实现成本。

---

## 已建立的修复模式（来自 FeedbackModal.tsx:121-143）

```tsx
// 1. 准备选项数组和 ref 数组
const options = [...]; // 你的选项列表
const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

// 2. 键盘处理函数（可复用）
const handleRadioKeyDown = useCallback(
  (e: React.KeyboardEvent, currentIndex: number) => {
    let targetIndex = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      targetIndex = (currentIndex + 1) % options.length;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      targetIndex = (currentIndex - 1 + options.length) % options.length;
    } else if (e.key === 'Home') {
      e.preventDefault();
      targetIndex = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      targetIndex = options.length - 1;
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleSelect(options[currentIndex]);
      return;
    } else {
      return;
    }
    // 同时选中并聚焦（WAI-ARIA radio 模式 — 焦点跟随选中）
    handleSelect(options[targetIndex]);
    radioRefs.current[targetIndex]?.focus();
  },
  [options, handleSelect]
);

// 3. 在每个 button 上应用
<button
  ref={(el) => { radioRefs.current[index] = el; }}
  role="radio"
  aria-checked={selected === option.value}
  tabIndex={selected === option.value ? 0 : -1}  // ★ 关键：roving tabindex
  onKeyDown={(e) => handleRadioKeyDown(e, index)}
  onClick={() => handleSelect(option.value)}
>
  {option.label}
</button>
```

**Roving tabindex 解释:**
- 仅当前选中项 `tabIndex={0}`（接收 Tab 焦点）
- 其他选项 `tabIndex={-1}`（仅可通过 Arrow 键访问）
- 这样 Tab 键能跳过整个 radiogroup（只进入选中项），符合 WAI-ARIA 标准

---

## 建议实施顺序

| 优先级 | 任务 | 文件 | 工作量 | 影响 |
|--------|------|------|--------|------|
| **P1** | R1 + R3 + R4: Welcome modal 服务商 + 水平选择 | 3 处 | 1h | 首次配置流程 a11y |
| **P2** | R2: 翻译模式 | popup/App.tsx | 20min | 日常高频操作 |
| **P2** | S2 + R5 + R6 + R7 + R8: Options 内 5 处 | 5 处 | 1.5h | Options 整体一致性 |
| **P3** | R9: ContextualLearningMode ARIA 修正 | 1 处 | 15min | 修正 ARIA 错配 |

**总计:** ~3 小时（含全部 9 处修复 + 测试），可由 frontend-developer 在 1 个工作日内完成。

---

## 建议提取通用 Hook

由于该模式被 9 处复用，建议提取为通用 hook：

```tsx
// src/shared/hooks/useRadioGroupKeyboard.ts
export function useRadioGroupKeyboard<T>({
  options,
  selected,
  onSelect,
}: {
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, currentIndex: number) => {
      // ...同上 handleRadioKeyDown 逻辑
    },
    [options, onSelect]
  );

  return {
    getRadioProps: (index: number, value: T) => ({
      ref: (el: HTMLButtonElement | null) => { refs.current[index] = el; },
      role: 'radio' as const,
      'aria-checked': selected === value,
      tabIndex: selected === value ? 0 : -1,
      onKeyDown: (e: React.KeyboardEvent) => handleKeyDown(e, index),
    }),
  };
}
```

**收益:**
- 9 处修复总代码量 < 复制粘贴 9 次
- 未来新增 radiogroup 自动获得正确 a11y 行为
- 测试可集中在一处

---

## 与现有 UX 工作的关系

| 现有产出 | 关联 |
|---------|------|
| `UX_HEURISTIC_EVALUATION_2026-05-16.md` H4（一致性） | 本审计是该启发式在键盘交互层面的全代码库映射 |
| `UX_DASHBOARDS_REVIEW_2026-05-28.md` S2 | S2 仅记录 1 实例 — 本审计揭示实际有 9 处同类问题 |
| FeedbackModal/GeneralSettings/AchievementGallery 已修复 | 提供成熟代码模式可直接复用 |

---

## 结论

PromptSettings 的 S2 finding 不是孤立缺陷，而是 **9 处同类模式漏洞中的一处**。当前代码库 radiogroup 修复率仅 25%（3/12），存在系统性 a11y 一致性缺口。

提取通用 hook（~50 行代码）+ 批量替换 9 处使用点，可一次性消除该类问题并防止未来回归。该项工作的 ROI 显著优于单点修复，建议优先级提升至 **P1（一次性技术债清理）**。
