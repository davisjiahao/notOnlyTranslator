# UX Research Report — NotOnlyTranslator Extension

**Date:** 2026-05-16
**Reviewer:** UX Researcher Agent
**Scope:** Popup UI, Options UI, Tooltip/Content Script interactions

---

## Summary

Reviewed 27+ UI components across popup, options, and content script layers. The extension has strong accessibility foundations (WCAG roles, aria-labels, focus management) and a clean visual hierarchy. Below are the UX findings ranked by impact.

---

## 🔴 High Impact — User Friction Points

### 1. Translation Mode Toggle Lacks Preview/Confirmation
**Location:** `popup/App.tsx` lines 328-376 (radiogroup)
**Issue:** Switching between "生词高亮" / "双语对照" / "全文翻译" applies immediately with only a brief toast notification. Users on pages with lots of text may experience jarring layout shifts without understanding what changed.
**Recommendation:** Add a brief inline preview or subtle animation showing the effect of the mode change on the current page. Consider a non-blocking preview before applying.

### 2. Site Toggle Refresh Is Destructive Without Warning
**Location:** `popup/App.tsx` lines 138-158 (`toggleSiteTranslation`)
**Issue:** Toggling a site on/off triggers an immediate `chrome.tabs.reload()` after 800ms. Any unsaved form data or page state on that tab is lost silently.
**Recommendation:** Show a confirmation dialog when the page will reload: "刷新页面以应用更改？" with cancel/confirm options.

### 3. Welcome Modal API Test Has Poor Error Feedback
**Location:** `WelcomeModal.tsx` lines 289-294
**Issue:** When API test fails, only "连接测试失败，请检查 API Key" is shown. No specific error reason (network? wrong key? rate limit?) is communicated, leaving users guessing.
**Recommendation:** Surface the actual error message from the API response. Differentiate between network errors, auth errors, and rate limit errors with actionable guidance.

---

## 🟡 Medium Impact — Usability Improvements

### 4. Tooltip Action Buttons Destroy After One Click
**Location:** `tooltip.ts` lines 650-674
**Issue:** Clicking "认识" / "不认识" / "加入生词本" immediately hides the tooltip. If a user misclicks, they must re-click the word to try again. No undo mechanism exists.
**Recommendation:** Add a brief "已标记 ✓ 撤销" inline feedback with a 3-second undo window before hiding.

### 5. Confidence Score Has No Contextual Meaning
**Location:** `popup/App.tsx` lines 300-315
**Issue:** The "置信度" (confidence) progress bar shows a percentage but gives no explanation of what it means or what level is "good enough." Users don't know if 30% is bad or 80% is excellent.
**Recommendation:** Add a tooltip or helper text: "置信度反映系统对你词汇量估算的可靠程度，标记越多越准确。" with a target range indicator.

### 6. Flashcard Review Has No Keyboard Shortcuts
**Location:** `FlashcardReview.tsx`
**Issue:** The flashcard review component relies entirely on mouse clicks for the 1-5 rating system. The content script tooltip has keyboard shortcuts (K/U/A/P), but the flashcard review has none, creating an inconsistent interaction model.
**Recommendation:** Add keyboard shortcuts (1-5 for rating, Space for flip, Esc for exit) to match the tooltip's keyboard-friendly design.

### 7. Heatmap Minimum Width Is Excessive
**Location:** `LearningHeatmap.tsx` line 61
**Issue:** `min-w-[800px]` on the heatmap container forces horizontal scrolling even in the full-width options page. On smaller screens, this creates significant scroll friction.
**Recommendation:** Reduce to `min-w-[500px]` or make the column width responsive to available space.

### 8. Recruitment Banner Could Be More Targeted
**Location:** `popup/components/RecruitmentBanner.tsx`
**Issue:** A single persistent banner that only dismisses on explicit close. No frequency capping or re-engagement logic.
**Recommendation:** Implement a snooze mechanism (e.g., "7天后提醒") instead of permanent dismiss, and show the banner only after the user has used the extension for a minimum threshold (e.g., 50+ words marked).

---

## 🟢 Low Impact — Polish & Consistency

### 9. Inconsistent Empty State Treatment
**Issue:** Different components handle empty states differently — some show text only, some show emoji + text (FlashcardReview's 🎉), some show nothing.
**Recommendation:** Establish a consistent empty state pattern: icon/emoji + descriptive text + suggested next action.

### 10. Toast Notification Duration Is Fixed
**Location:** `popup/App.tsx` line 44
**Issue:** All toasts auto-dismiss after 2 seconds regardless of content length or importance.
**Recommendation:** Duration based on message length (2s for short, 4s for longer), with a manual dismiss option.

### 11. Level Labels Use Chinese-Only Display
**Location:** `popup/App.tsx` lines 100-104
**Issue:** Vocabulary levels (初级/中级/中高级/高级/专家级) are Chinese-only with no visual indicator. New users unfamiliar with the scale have no reference point.
**Recommendation:** Add approximate CEFR/IELTS equivalents as subtext: "中级 (~B1, 3000词)" for context.

---

## ✅ Strengths Worth Preserving

1. **WCAG Compliance:** Strong ARIA roles, aria-live regions, focus management, and keyboard navigation throughout
2. **Dark Mode:** Consistent dark theme support across all components
3. **XSS Prevention:** `textContent` used consistently instead of `innerHTML` for user data in tooltip
4. **Multi-step Welcome Flow:** Well-structured onboarding with clear progress indication
5. **Pin Feature:** Tooltip pinning for studying words while scrolling is a thoughtful UX pattern

---

## Recommended Next Steps

1. **Quick wins (1-2 hours each):** Fix #2 (reload confirmation), #3 (error messaging), #5 (confidence tooltip)
2. **Medium effort (half-day each):** Fix #4 (undo on mark), #6 (flashcard keyboard), #7 (heatmap responsive)
3. **User research:** Conduct usability testing with 3-5 users to validate the friction points and discover additional pain points not visible from code review alone
4. **Analytics:** Instrument interaction tracking for mode switches, mark actions, and tooltip interactions to quantify usage patterns
