# Founding Engineer 任务分配

## 当前任务: US-001-T1

**任务**: 实现页面段落扫描器 (PageScanner)
**优先级**: Critical
**估计工时**: 4 小时
**依赖**: 无 (可以立即开始)

---

## 任务描述

实现一个页面扫描器模块，能够遍历网页 DOM，识别并提取可翻译的文本段落。

## 详细要求

### 1. 功能需求

- [ ] 扫描整个页面的文本内容
- [ ] 识别段落元素 (`<p>`, `<article>`, `<div>` 等包含文本的元素)
- [ ] 过滤掉不应翻译的元素 (导航、按钮、脚本、样式等)
- [ ] 返回结构化的段落数据 (元素引用 + 文本内容)

### 2. 技术规范

**文件位置**: `src/content/pageScanner.ts`

**接口定义**:
```typescript
interface Paragraph {
  id: string;           // 唯一标识符
  element: HTMLElement; // 原始 DOM 元素引用
  text: string;         // 纯文本内容
  wordCount: number;    // 单词数量
}

interface PageScanner {
  scan(): Paragraph[];                    // 扫描整个页面
  scanElement(element: Element): Paragraph[];  // 扫描特定元素
  isTranslatable(element: Element): boolean;   // 判断是否可翻译
}
```

### 3. 实现细节

**使用 TreeWalker 遍历 DOM**:
```typescript
const walker = document.createTreeWalker(
  document.body,
  NodeFilter.SHOW_TEXT,
  {
    acceptNode: (node) => {
      // 过滤逻辑：检查父元素是否可翻译
      const parent = node.parentElement;
      if (!parent || isExcluded(parent)) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  }
);
```

**排除元素选择器**:
```typescript
const EXCLUDED_SELECTORS = [
  'script', 'style', 'noscript', 'code', 'pre',
  'input', 'textarea', 'select', 'button',
  '[data-notranslate]',
  '.not-only-translator-highlight', // 已高亮的元素
  'nav', 'header nav', 'footer'
];
```

### 4. 边界情况处理

- [ ] 处理动态加载的内容 (SPA 应用)
- [ ] 处理 iframe 中的内容
- [ ] 处理 shadow DOM
- [ ] 最小文本长度限制 (至少 3 个单词)
- [ ] 最大文本长度限制 (最多 5000 字符)

### 5. 性能考虑

- [ ] 使用 requestIdleCallback 或 setTimeout 分块处理
- [ ] 缓存扫描结果，避免重复扫描
- [ ] 支持增量扫描 (MutationObserver)

---

## 测试要求

### 单元测试

```typescript
// tests/unit/pageScanner.test.ts
describe('PageScanner', () => {
  it('should scan paragraphs from the page', () => {
    // 测试页面扫描
  });

  it('should exclude script and style elements', () => {
    // 测试排除逻辑
  });

  it('should respect minimum word count', () => {
    // 测试最小单词限制
  });
});
```

### 手动测试

- [ ] 在简单静态页面测试
- [ ] 在 Medium/博客文章测试
- [ ] 在新闻网站测试
- [ ] 在技术文档 (MDN, GitHub) 测试

---

## 验收标准

- [ ] `PageScanner` 类实现完成
- [ ] 所有单元测试通过
- [ ] 代码通过 ESLint 检查
- [ ] TypeScript 类型检查通过
- [ ] 在至少 3 个不同类型的网站上手动测试通过

---

## 相关文档

- `docs/ARCHITECTURE.md` - 系统架构
- `docs/SPRINT_1.md` - Sprint 1 计划
- `src/content/index.ts` - Content Script 入口 (参考现有代码结构)

---

## 提交规范

提交时使用以下格式:
```
feat(content): implement PageScanner for text extraction

- Add PageScanner class to scan and extract translatable paragraphs
- Implement TreeWalker-based DOM traversal
- Add exclude selectors for non-translatable elements
- Include unit tests

Refs: US-001-T1
Co-Authored-By: Paperclip <noreply@paperclip.ing>
```

---

## 下一步

完成此任务后，继续:
- **US-001-T2**: 实现词汇过滤服务 (基于用户水平)

