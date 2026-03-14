# Founding Engineer 任务分配

## 当前任务: US-002-T1 🔄 进行中

**任务**: 实现 Tooltip 组件
**状态**: 🔄 进行中
**优先级**: High
**估计工时**: 4 小时
**依赖**: US-001 已完成

---

## 已完成的任务

### ✅ US-001-T2: VocabularyFilter 词汇过滤服务
**状态**: 已完成 ✓
**实际工时**: 3 小时
**完成时间**: 2026-03-14

实现一个词汇过滤服务，根据用户的英语水平，从扫描的段落中筛选出需要翻译的生僻词。

**完成的功能**:
- ✅ 接收 `Paragraph[]` 和 `UserProfile`，返回应高亮的单词列表
- ✅ 使用 `FrequencyManager` 判断单词难度
- ✅ 只返回难度高于用户水平的单词
- ✅ 支持词汇去重（同一单词在页面中只高亮一次）
- ✅ 支持已知词汇过滤（用户已标记为已知的单词跳过）

**文件位置**:
- 实现: `src/content/vocabularyFilter.ts` (292 行)
- 测试: `tests/unit/content/vocabularyFilter.test.ts` (29 个测试通过)

---

### ✅ US-001-T3: Highlighter 高亮渲染器
**状态**: 已完成 ✓
**实际工时**: 2 小时
**完成时间**: 2026-03-14

实现高亮渲染器，在 DOM 中高亮显示筛选出的单词。

**完成的功能**:
- ✅ 高亮单词（使用 span 包裹并添加 CSS 类）
- ✅ 支持大小写不敏感匹配
- ✅ 标记单词为已知/未知（添加不同 CSS 类）
- ✅ 移除单个单词高亮
- ✅ 清除所有高亮
- ✅ 获取已高亮单词列表

**文件位置**:
- 实现: `src/content/highlighter.ts` (232 行)
- 测试: `tests/unit/content/highlighter.test.ts` (9 个测试通过)

---

## US-002-T1 任务描述: Tooltip 组件

实现一个 Tooltip 组件，当用户悬停或点击高亮单词时显示翻译详情。

### 功能需求

- [ ] 悬停高亮单词时显示 Tooltip
- [ ] 显示单词翻译、难度等级
- [ ] 提供"标记已知"和"标记未知"按钮
- [ ] 支持点击外部关闭 Tooltip
- [ ] 自动定位（避免超出视口）

### 技术规范

**文件位置**: `src/content/tooltip.ts`

**接口定义**:
```typescript
interface TooltipOptions {
  position: 'top' | 'bottom' | 'auto';
  showDifficulty: boolean;
  autoClose: boolean;
  closeDelay: number;
}

class Tooltip {
  constructor(container: HTMLElement, options?: Partial<TooltipOptions>);

  show(word: string, translation: string, difficulty: number, target: HTMLElement): void;
  hide(): void;
  destroy(): void;

  // 事件回调
  onMarkKnown(callback: (word: string) => void): void;
  onMarkUnknown(callback: (word: string) => void): void;
}
```

### 2. 技术规范

**文件位置**: `src/content/vocabularyFilter.ts`

**接口定义**:
```typescript
interface VocabularyFilterConfig {
  minWordLength: number;      // 最小单词长度（默认 3）
  excludeCommonWords: boolean; // 是否排除常见词（默认 true）
}

interface FilterResult {
  word: string;          // 单词
  element: HTMLElement;  // 所在元素
  paragraphId: string;   // 段落 ID
  difficulty: number;    // 难度等级 (1-10)
  isKnown: boolean;      // 是否已知
}

class VocabularyFilter {
  constructor(
    userLevel: UserLevel,
    frequencyManager: FrequencyManager,
    config?: Partial<VocabularyFilterConfig>
  );

  filter(paragraphs: Paragraph[]): FilterResult[];
  isWordEligible(word: string): boolean;
  getWordDifficulty(word: string): number;
}
```

### 3. 实现细节

**依赖服务**:
- `FrequencyManager` (`src/background/frequencyManager.ts`) - 单词难度查询
- `UserLevel` (`src/background/userLevel.ts`) - 用户水平管理

**过滤逻辑**:
```typescript
// 单词资格判断
function isWordEligible(word: string): boolean {
  // 1. 最小长度检查（默认 3 个字符）
  if (word.length < config.minWordLength) return false;

  // 2. 纯数字跳过
  if (/^\d+$/.test(word)) return false;

  // 3. 常见停用词检查（a, an, the, is, are 等）
  if (config.excludeCommonWords && isStopWord(word)) return false;

  return true;
}

// 单词难度比较
function shouldHighlight(word: string, userLevel: UserLevel): boolean {
  const difficulty = frequencyManager.getDifficulty(word);
  return difficulty > userLevel.threshold;
}
```

**常见停用词列表**:
```typescript
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'yet', 'so', 'if', 'because', 'although',
  'though', 'while', 'where', 'when', 'that', 'which', 'who',
  'whom', 'whose', 'what', 'this', 'these', 'those', 'i',
  'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their'
]);
```

### 4. 单元测试要求

**测试文件**: `tests/unit/content/vocabularyFilter.test.ts`

```typescript
describe('VocabularyFilter', () => {
  it('should filter words above user level', () => {
    // 测试难度过滤
  });

  it('should exclude stop words', () => {
    // 测试停用词过滤
  });

  it('should deduplicate words across paragraphs', () => {
    // 测试去重逻辑
  });

  it('should skip known words', () => {
    // 测试已知词汇过滤
  });

  it('should respect minimum word length', () => {
    // 测试最小长度限制
  });
});
```

---

## 提交规范

提交时使用以下格式:
```
feat(content): implement VocabularyFilter service

- Add VocabularyFilter class to filter words based on user level
- Implement stop word exclusion and word deduplication
- Integrate with FrequencyManager for difficulty calculation
- Include unit tests

Refs: US-001-T2
Co-Authored-By: Paperclip <noreply@paperclip.ing>
```

---

## 下一步

完成此任务后，继续:
- **US-001-T3**: 实现高亮渲染器 (Highlighter)

