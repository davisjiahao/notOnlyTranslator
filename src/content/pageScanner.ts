/**
 * PageScanner - 页面扫描器模块
 * 使用 TreeWalker 遍历 DOM，识别并提取可翻译的文本段落
 */

/**
 * 段落接口定义
 */
export interface Paragraph {
  id: string;           // 唯一标识符
  element: HTMLElement; // 原始 DOM 元素引用
  text: string;         // 纯文本内容
  wordCount: number;    // 单词数量
}

/**
 * 排除元素选择器列表
 * 这些元素的文本内容不应被翻译
 *
 * 分类说明：
 * 1. 基础非内容元素：script, style, noscript 等
 * 2. 表单和交互元素：input, button, select 等
 * 3. 导航和布局元素：nav, footer, aside
 * 4. ARIA 角色元素：通过 role 属性识别的 UI 组件
 * 5. 语义 UI 类名：导航、菜单、模态框等
 *
 * 注意：不包含 header 标签，因为 <article> 内的 <header> 是文章元数据，
 * 属于应翻译的内容。页面级 header 通过 nav/footer 规则已足够覆盖。
 * 注意：不包含过于宽泛的类名（如 .header, .footer, .sidebar, .tab），
 * 这些类名在内容区域中常被复用，会导致误排除。
 */
export const EXCLUDED_SELECTORS = [
  // 基础非内容元素
  'script',
  'style',
  'noscript',
  'code',
  'pre',
  'template',

  // 表单和交互元素
  'input',
  'textarea',
  'select',
  'button',
  'option',
  'optgroup',
  'label',

  // 嵌入内容
  'iframe',
  'svg',
  'canvas',

  // 翻译标记
  '[data-notranslate]',
  '.not-only-translator-highlight',

  // 导航和布局元素
  'nav',
  'footer',
  'aside',

  // ARIA 角色元素 - UI 组件
  '[role="navigation"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="dialog"]',
  '[role="tooltip"]',
  '[role="alert"]',
  '[role="status"]',
  '[role="button"]',
  '[role="listbox"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="search"]',
  '[role="searchbox"]',

  // 语义 UI 类名（仅限明确属于 UI 组件的类名）
  '.navbar',
  '.dropdown-menu',
  '.modal',
  '.popover',
  '.pagination',
  '.language-selector',
  '.locale-selector',
];

/**
 * 站点特定选择器列表
 * 用于排除特定网站的 UI 元素，可按需合并到运行时选择器
 */
export const SITE_SPECIFIC_SELECTORS: Record<string, string[]> = {
  github: [
    '.Header',
    '.Header-item',
    '.Header-link',
    '.header-nav',
    '.js-header-wrapper',
    '.js-navigation-item',
    '.js-menu-target',
    '.select-menu',
    '.ActionList',
    '.ActionList-item',
    '.UnderlineNav',
    '.UnderlineNav-item',
  ],
};

/**
 * 扫描配置
 */
interface ScannerConfig {
  /** 最小单词数量限制 */
  minWordCount: number;
  /** 最大文本长度限制 */
  maxTextLength: number;
}

const DEFAULT_CONFIG: ScannerConfig = {
  minWordCount: 3,
  maxTextLength: 5000,
};

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `para-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 计算单词数量
 * 基于空格分割的英文单词计数
 */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  // 匹配英文单词（连续字母序列）
  const words = trimmed.match(/[a-zA-Z]+/g);
  return words ? words.length : 0;
}

/**
 * 组合排除选择器（用于性能优化）
 * 将所有选择器合并为一个 CSS 选择器字符串，避免循环调用 matches()
 */
const COMBINED_EXCLUDED_SELECTOR = EXCLUDED_SELECTORS.join(',');

/**
 * 检查元素是否匹配排除选择器
 * 使用组合选择器进行单次匹配，性能优于循环匹配
 */
function matchesExcludedSelector(element: Element): boolean {
  try {
    return element.matches(COMBINED_EXCLUDED_SELECTOR);
  } catch {
    // 某些选择器可能在某些浏览器中不支持，保守返回 false
    // 这种情况下，元素会被当作可翻译内容处理
    return false;
  }
}

/**
 * 检查元素是否在排除的祖先元素内
 */
function hasExcludedAncestor(element: Element): boolean {
  let current: Element | null = element;

  while (current) {
    if (matchesExcludedSelector(current)) {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

/**
 * PageScanner 类
 * 负责扫描页面 DOM 并提取可翻译的文本段落
 */
export class PageScanner {
  private config: ScannerConfig;
  private cache: Paragraph[] | null = null;
  private observer: MutationObserver | null = null;
  private _observedElement: Element | null = null;

  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 扫描整个页面
   * @returns 段落数组
   */
  scan(): Paragraph[] {
    // 返回缓存结果
    if (this.cache !== null) {
      return this.cache;
    }

    if (!document.body) {
      return [];
    }

    this.cache = this.scanElement(document.body);
    return this.cache;
  }

  /**
   * 扫描特定元素
   * @param element - 要扫描的元素
   * @returns 段落数组
   */
  scanElement(element: Element): Paragraph[] {
    const paragraphs: Paragraph[] = [];
    const processedElements = new Set<Element>();

    // 使用 TreeWalker 遍历文本节点
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node: Text) => {
          const parent = node.parentElement;
          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }

          // 检查是否在排除的元素内
          if (hasExcludedAncestor(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          // 检查元素本身是否可翻译
          if (!this.isTranslatable(parent)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );

    // 收集文本节点并按父元素分组
    const elementTexts = new Map<Element, string[]>();
    let currentNode: Text | null;

    while ((currentNode = walker.nextNode() as Text | null)) {
      const parent = currentNode.parentElement;
      if (!parent) continue;

      // 找到最近的段落级祖先元素
      const paragraphAncestor = this.findParagraphAncestor(parent);
      if (!paragraphAncestor || processedElements.has(paragraphAncestor)) {
        continue;
      }

      const text = currentNode.textContent || '';
      if (!text.trim()) continue;

      if (!elementTexts.has(paragraphAncestor)) {
        elementTexts.set(paragraphAncestor, []);
      }
      elementTexts.get(paragraphAncestor)!.push(text);
    }

    // 将分组后的文本转换为 Paragraph 对象
    elementTexts.forEach((texts, el) => {
      const fullText = texts.join(' ').trim();

      // 检查最小单词数量
      const wordCount = countWords(fullText);
      if (wordCount < this.config.minWordCount) {
        return;
      }

      // 截断过长的文本
      const truncatedText = fullText.length > this.config.maxTextLength
        ? fullText.slice(0, this.config.maxTextLength)
        : fullText;

      paragraphs.push({
        id: generateId(),
        element: el as HTMLElement,
        text: truncatedText,
        wordCount,
      });

      processedElements.add(el);
    });

    return paragraphs;
  }

  /**
   * 判断元素是否可翻译
   * @param element - 要检查的元素
   * @returns 是否可翻译
   */
  isTranslatable(element: Element): boolean {
    // 检查是否匹配排除选择器
    if (matchesExcludedSelector(element)) {
      return false;
    }

    // 检查是否在排除的祖先元素内
    if (hasExcludedAncestor(element)) {
      return false;
    }

    return true;
  }

  /**
   * 找到最近的段落级祖先元素
   * 段落级元素包括: p, div, article, section, li, td, th, blockquote, h1-h6
   */
  private findParagraphAncestor(element: Element): Element | null {
    const paragraphTags = ['P', 'DIV', 'ARTICLE', 'SECTION', 'LI', 'TD', 'TH', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'];
    let current: Element | null = element;

    while (current) {
      if (paragraphTags.includes(current.tagName)) {
        return current;
      }
      current = current.parentElement;
    }

    return element;
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.cache ? this.cache.length : 0;
  }

  /**
   * 使用 MutationObserver 监听 DOM 变化
   * @param element - 要监听的元素，默认为 document.body
   * @param callback - 变化时的回调函数
   */
  observe(element: Element = document.body, callback?: (paragraphs: Paragraph[]) => void): void {
    if (this.observer) {
      this.unobserve();
    }

    this._observedElement = element;
    this.observer = new MutationObserver((mutations) => {
      // 检查是否有相关的变化
      const hasRelevantChanges = mutations.some((mutation) => {
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as Element;
            return this.isTranslatable(el) || el.querySelector?.('p, div, article, section');
          }
          return false;
        });
      });

      if (hasRelevantChanges) {
        // 清除缓存以便重新扫描
        this.clearCache();
        const newParagraphs = this.scan();
        callback?.(newParagraphs);
      }
    });

    this.observer.observe(element, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * 停止监听 DOM 变化
   */
  unobserve(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this._observedElement = null;
  }

  /**
   * 获取当前监听的元素
   */
  getObservedElement(): Element | null {
    return this._observedElement;
  }

  /**
   * 获取页面中的段落元素数组（向后兼容）
   * 返回 HTMLElement[] 供 ViewportObserver 使用
   */
  getParagraphs(): HTMLElement[] {
    const paragraphs = this.scan();
    return paragraphs.map(p => p.element);
  }
}

// 默认导出
export default PageScanner;