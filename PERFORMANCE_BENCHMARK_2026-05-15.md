# Performance Benchmark Report — 2026-05-15

**Agent:** Performance Benchmarker
**Branch:** main
**Commit:** 27d9c18

---

## Build Performance

| Metric | Value | Assessment |
|--------|-------|------------|
| Build Time | ~57s | Slow for a Chrome extension |
| Total Bundle | 2.1 MB | Moderate |
| Gzipped Bundle | ~0.5 MB | Acceptible |

### Bundle Size Breakdown (Top 5)

| File | Raw | Gzip |
|------|-----|------|
| options-S-plhSqb.js | 449.8 KB | 126.4 KB |
| vendor-UWoow9nH.js | 285.9 KB | 87.4 KB |
| index.ts-nwonywXd.js | 122.6 KB | 36.2 KB |
| popup-CB4oe6fY.js | 101.3 KB | 17.7 KB |
| index.ts-B86ieI94.js | 97.0 KB | 26.1 KB |

---

## Test Performance — Before Optimization

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Total Tests | 1,227 | 1,227 | — |
| Duration (warmed) | ~65.95s | ~53.34s | **-19%** |
| Test Time | 38.40s | 24.98s | -35% |

### FlashcardReview.test.tsx — Before/After

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Duration | 17,917ms | ~2,500ms | **-86%** |
| Tests | 37 | 37 | — |

### Top 10 Slowest Test Files (After Optimization)

| File | Before | After | Change |
|------|--------|-------|--------|
| tooltip.test.ts | 7,761ms | ~7,000ms | -10% |
| pageScanner.test.ts | 2,903ms | ~2,900ms | stable |
| translationErrors.test.ts | 3,049ms | 298ms | **-90%** |
| marker.test.ts | 1,122ms | ~1,100ms | stable |
| enhancedCache.test.ts | 1,078ms | ~1,000ms | stable |
| utils.test.ts | 533ms | ~500ms | stable |
| theme.test.ts | 474ms | ~400ms | stable |
| performance/dashboard.test.ts | 454ms | ~400ms | stable |
| translationDisplay.test.ts | 423ms | ~400ms | stable |
| textComplexityAnalyzer.test.ts | 408ms | ~400ms | stable |

---

## Changes Made

### 1. Extracted `COMPLETION_TRANSITION_DELAY` to constants

**File:** `src/shared/constants/index.ts`
```typescript
// Added to TIMING constant
COMPLETION_TRANSITION_DELAY: 800, // 完成状态切换动画延迟
```

**File:** `src/options/components/FlashcardReview.tsx`
```typescript
// Changed from hardcoded 800 to configurable constant
import { TIMING } from '@/shared/constants';
// ...
setTimeout(() => { ... }, TIMING.COMPLETION_TRANSITION_DELAY);
```

### 2. Mocked constant in tests

**File:** `tests/unit/options/FlashcardReview.test.tsx`
```typescript
vi.mock('@/shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/constants')>();
  return {
    ...actual,
    TIMING: { ...actual.TIMING, COMPLETION_TRANSITION_DELAY: 0 },
  };
});
```

### 3. Fixed single-word mock in mastery update result display tests

Changed `data: mockReviewWords` → `data: [mockReviewWords[0]]` to prevent card cycling race conditions with zero-delay transitions.

### 4. Scoped fake timers in translationErrors retry test

**File:** `tests/unit/shared/utils/translationErrors.test.ts`

Added `vi.useFakeTimers()` scoped to `withErrorHandling` describe block, using `vi.advanceTimersByTimeAsync(3000)` in the retry test.

Result: retry test from 3,007ms → ~50ms (-98%). The file went from 3,049ms → 298ms.

---

## Code Performance Analysis

### Identified Bottlenecks

1. **highlighter.ts (legacy, tests only)** — O(n×m) regex matching
   - Not used in production (OptimizedHighlighter is active)
   - Low priority

2. **translation.ts** — Sequential API calls
   - HybridTranslationService adds routing overhead per request
   - Batching handled at content script level

3. **content/index.ts (2,012 lines)** — Large but well-structured
   - MutationObserver with `subtree: true` on `document.body` — expensive on large pages

4. **Build time (57s)** — Primary remaining optimization target
   - Vite with CRXJS plugin
   - TypeScript type-checking is the main bottleneck

---

## Remaining Recommendations

### Quick Wins

1. **Enable Vite build caching**: Add `cacheDir` configuration
   - Expected: 20-30% faster rebuilds

### Medium Effort

3. **Optimize MutationObserver**: Use IntersectionObserver for lazy processing
4. **Code-split options page**: 450KB is large — lazy-load individual tabs

### Long-term

5. **Parallel test execution**: `--pool threads` could reduce wall-clock by 40-50%
6. **Migrate from CRXJS to manual Vite + manifest.json**

---

## Health Check Summary

| Check | Status | Details |
|-------|--------|---------|
| Build | PASS | ~57s, clean output |
| TypeScript | PASS | 0 errors |
| ESLint | PASS | 0 warnings |
| Tests | PASS | 1,227/1,227 |
| Bundle Size | WARN | options.js at 450KB (126KB gzip) |
| Build Time | WARN | 57s slow for project size |
| Test Performance | IMPROVED | FlashcardReview from 17.9s → 2.5s (-86%) |
