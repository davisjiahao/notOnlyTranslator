---
name: FlashcardReview 测试警告分析
description: act() 警告的根本原因和解决方案
type: feedback
---

## 问题

FlashcardReview 测试在运行时产生 `act()` 警告：
- 37 个测试全部通过
- 警告出现在评分按钮测试中

## 根本原因

组件 `handleRating` 函数中使用 `setTimeout` (800ms) 来延迟显示下一张卡片：

```typescript
setTimeout(() => {
  if (currentIndex + 1 >= reviewWords.length) {
    setIsComplete(true);
  } else {
    setCurrentIndex((prev) => prev + 1);
    setIsFlipped(false);
    setLastUpdateResult(null);
  }
  setIsSubmitting(false);
}, 800);
```

这个 `setTimeout` 中的状态更新没有被测试框架正确等待，导致 `act()` 警告。

## 解决方案选项

1. **使用假定时器**（推荐）：
   ```typescript
   vi.useFakeTimers();
   // 点击评分按钮后
   await vi.runAllTimersAsync();
   ```

2. **增加测试等待时间**：
   ```typescript
   await waitFor(() => ..., { timeout: 2000 });
   ```

3. **组件重构**：让 `delay` prop 可配置，测试时设为 0

## 当前状态

- 测试全部通过
- 警告不影响功能验证
- 可作为技术债务稍后处理

## 何时处理

优先级：低
触发条件：当测试运行时间成为瓶颈，或需要更严格的测试验证时