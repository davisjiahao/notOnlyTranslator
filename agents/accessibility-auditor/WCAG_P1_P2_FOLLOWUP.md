# WCAG 2.1 AA P1/P2 Follow-up Audit Report

**Generated**: 2026-04-25
**Agent**: Accessibility Auditor
**Status**: Report ready — awaiting issue creation by CTO/CEO

## Overview

CMP-134 (Commit: c2bc2ac) covered all P0 WCAG items. Three P1/P2 gaps identified via post-fix systematic review.

---

## Gap 1: Tablist Arrow-Key Navigation (P1) — ✅ FIXED

**WCAG**: 2.1.1 Keyboard — ARIA Authoring Practices (tablist pattern)
**Severity**: P1 — keyboard-only users cannot access non-active tabs
**Status**: Fixed in commit `e3d0939` (2026-05-07)

### What Was Fixed
- Created `useTablistKeyboard` hook with ArrowRight/ArrowLeft/Home/End navigation
- Added `getTabElement` parameter for focus management after tab selection
- Applied to all 3 tabbed components: LearningStatistics, DataManager, VocabularyRecommendation
- Added 11 unit tests for the hook

### Remaining Issue (newly discovered during fix)
The hook initially shipped without focus management — Arrow keys changed active tab but focus stayed on original tab. This was caught and fixed with the `getTabElement` callback + `.focus()` call.

### Affected Files (3)

| File | Component | Tab Count |
|------|-----------|-----------|
| `src/options/components/LearningStatistics.tsx:640-667` | `ChartTabButton` | 3 tabs |
| `src/options/components/DataManager.tsx:224-277` | Export/Import/Advanced tabs | 3 tabs |
| `src/options/components/VocabularyRecommendation.tsx:177-228` | Recommendations/Daily/Settings tabs | 3 tabs |

### Remaining Issue (newly discovered during fix)
The hook initially shipped without focus management — Arrow keys changed active tab but focus stayed on original tab. This was caught and fixed with the `getTabElement` callback + `.focus()` call.

### Original Root Cause (for reference)
All three components used `tabIndex={active ? 0 : -1}` — inactive tabs were removed from the Tab key order. No `onKeyDown` handler for ArrowRight/ArrowLeft/Home/End keys.

### Original Fix Approach (implemented as described)
Created `useTablistKeyboard` hook in `src/shared/hooks/` that:
1. Accepts tab count, active index, and `onSelect` callback
2. Handles ArrowRight, ArrowLeft, Home, End keys
3. Moves focus via `getTabElement` callback (parent manages active state)
4. Returns `onKeyDown` handler for each tab button

---

## Gap 2: Content Navigation Focus Loss (P1) — ✅ FIXED

**WCAG**: 2.4.3 Focus Order
**Severity**: P1 — users navigating via floating button lose focus context
**Status**: Fixed in commit `d583bfb` (2026-05-07)

### What Was Fixed
Added focus management to `handleNavigationToElement()` in `src/content/index.ts`:
- Set temporary `tabindex="-1"` on the target element (since highlighted words may not be natively focusable)
- Call `.focus()` after `scrollIntoView()` to move keyboard focus
- Added `blur` event listener to clean up `tabindex` and restore natural focus order

### Original Root Cause (for reference)
Method called `element.scrollIntoView()` and `highlightNavigationElement()` but never `.focus()` on the target element.

---

## Gap 3: Global aria-label Audit (P2) — ✅ COMPLETED

**WCAG**: 4.1.2 Name, Role, Value
**Severity**: P2 — some interactive elements may lack accessible names
**Status**: Audit completed, 1 gap found and fixed (commit `259a866`)

### Audit Results

| Check | Files Scanned | Gaps Found | Status |
|-------|--------------|------------|--------|
| Buttons without accessible names | 40 files (202 buttons) | 1 | ✅ Fixed |
| SVG buttons without aria-hidden | 40 files | 0 | ✅ Clean |
| Form inputs without labels | 30 inputs | 0 | ✅ Clean |

### Gap Found
- `WelcomeModalExperiment.tsx:542` — API key show/hide toggle button had SVG icon with `aria-hidden="true"` but no `aria-label` on the button itself. Screen readers announced only "button" with no name. Fixed with `aria-label` + `aria-pressed`.

### Coverage Assessment
- All icon-only buttons now have `aria-label` attributes
- All form inputs have either `<label htmlFor>` association or `aria-label`
- All SVG decorative elements have `aria-hidden="true"`
- Toggle buttons use `aria-pressed` for state communication

---

## Closure Status

| Gap | Severity | Status | Commit | Date |
|-----|----------|--------|--------|------|
| Tablist keyboard navigation | P1 | ✅ FIXED | e3d0939 | 2026-05-07 |
| Content navigation focus loss | P1 | ✅ FIXED | d583bfb | 2026-05-07 |
| Global aria-label audit | P2 | ✅ COMPLETED | 259a866 | 2026-05-07 |

All P1/P2 gaps from CMP-134 follow-up audit are now closed.

---

*Created by Accessibility Auditor heartbeat. Create issue and assign to fix.*
