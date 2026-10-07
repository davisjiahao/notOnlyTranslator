/**
 * PageScanner 测试
 *
 * 覆盖页面扫描、段落提取、排除选择器、缓存、MutationObserver
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PageScanner,
  EXCLUDED_SELECTORS,
  SITE_SPECIFIC_SELECTORS,
  isInExcludedArea,
  type Paragraph,
} from '@/content/pageScanner';

describe('PageScanner', () => {
  let scanner: PageScanner;

  beforeEach(() => {
    scanner = new PageScanner();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    scanner.unobserve();
    document.body.innerHTML = '';
  });

  describe('scan', () => {
    it('扫描空页面返回空数组', () => {
      const result = scanner.scan();
      expect(result).toEqual([]);
    });

    it('扫描包含文本段落的页面', () => {
      document.body.innerHTML = `
        <p>This is a test paragraph with enough words to be counted</p>
        <p>Another paragraph here with more text content</p>
      `;

      const result = scanner.scan();
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].text).toContain('test paragraph');
      expect(result[0].wordCount).toBeGreaterThanOrEqual(3);
    });

    it('返回缓存结果', () => {
      document.body.innerHTML = '<p>Cached paragraph content here</p>';

      const first = scanner.scan();
      const second = scanner.scan();

      expect(first).toBe(second);
    });

    it('忽略 script 标签内容', () => {
      document.body.innerHTML = `
        <p>Visible paragraph text here</p>
        <script>var hidden = "this should not appear";</script>
      `;

      const result = scanner.scan();
      expect(result.length).toBe(1);
      expect(result[0].text).not.toContain('hidden');
    });

    it('忽略 style 标签内容', () => {
      document.body.innerHTML = `
        <p>Visible paragraph text here</p>
        <style>.hidden { display: none; }</style>
      `;

      const result = scanner.scan();
      expect(result.length).toBe(1);
      expect(result[0].text).not.toContain('display');
    });

    it('忽略 code 标签内容', () => {
      document.body.innerHTML = `
        <p>Normal text here with some content</p>
        <code>const hidden = "code";</code>
      `;

      const result = scanner.scan();
      expect(result[0].text).not.toContain('const hidden');
    });

    it('忽略 nav 元素内的文本', () => {
      document.body.innerHTML = `
        <nav>Home About Contact</nav>
        <p>Real content paragraph here with words</p>
      `;

      const result = scanner.scan();
      const texts = result.map((r) => r.text);
      expect(texts.some((t) => t.includes('Home About'))).toBe(false);
      expect(texts.some((t) => t.includes('Real content'))).toBe(true);
    });

    it('忽略 footer 元素内的文本', () => {
      document.body.innerHTML = `
        <p>Main content paragraph here</p>
        <footer>Copyright footer text</footer>
      `;

      const result = scanner.scan();
      const texts = result.map((r) => r.text);
      expect(texts.some((t) => t.includes('Copyright'))).toBe(false);
    });

    it('忽略 ARIA role=navigation 元素', () => {
      document.body.innerHTML = `
        <div role="navigation">Nav item one two</div>
        <p>Real article content here with words</p>
      `;

      const result = scanner.scan();
      const texts = result.map((r) => r.text);
      expect(texts.some((t) => t.includes('Nav item'))).toBe(false);
    });

    it('忽略 data-notranslate 标记的元素', () => {
      document.body.innerHTML = `
        <p data-notranslate>Do not translate this</p>
        <p>Translate this paragraph instead with many words</p>
      `;

      const result = scanner.scan();
      const texts = result.map((r) => r.text);
      expect(texts.some((t) => t.includes('Do not translate'))).toBe(false);
    });

    it('忽略 not-only-translator-highlight 类元素', () => {
      document.body.innerHTML = `
        <p class="not-only-translator-highlight">Already highlighted</p>
        <p>New content to scan here with enough words</p>
      `;

      const result = scanner.scan();
      const texts = result.map((r) => r.text);
      expect(texts.some((t) => t.includes('Already highlighted'))).toBe(false);
    });

    it('合并同一父元素下的多个文本节点', () => {
      document.body.innerHTML = `
        <div id="container">
          <span>First part</span>
          <span>second part</span>
          <span>third part here</span>
        </div>
      `;

      const result = scanner.scan();
      const containerResult = result.find((r) => r.element.id === 'container');
      expect(containerResult).toBeTruthy();
      expect(containerResult!.text).toContain('First part');
      expect(containerResult!.text).toContain('second part');
    });

    it('过滤少于最小单词数的段落', () => {
      document.body.innerHTML = `
        <p>Hi</p>
        <p>This is a longer paragraph with many words to count properly</p>
      `;

      const result = scanner.scan();
      const texts = result.map((r) => r.text);
      expect(texts.some((t) => t.includes('Hi'))).toBe(false);
      expect(texts.some((t) => t.includes('longer paragraph'))).toBe(true);
    });

    it('自定义最小单词数配置', () => {
      document.body.innerHTML = '<p>This is a longer paragraph</p>';
      const customScanner = new PageScanner({ minWordCount: 10 });

      const result = customScanner.scan();
      expect(result.length).toBe(0);
    });

    it('截断超长文本', () => {
      const longText = 'a '.repeat(3000);
      document.body.innerHTML = `<p>${longText}</p>`;
      const customScanner = new PageScanner({ maxTextLength: 100 });

      const result = customScanner.scan();
      expect(result[0].text.length).toBeLessThanOrEqual(100);
    });

    it('段落元素包含正确属性', () => {
      document.body.innerHTML = '<p>Test paragraph with enough words here</p>';

      const result = scanner.scan();
      expect(result[0].id).toMatch(/^para-/);
      expect(result[0].element).toBeInstanceOf(HTMLElement);
      expect(result[0].text).toBeTruthy();
      expect(result[0].wordCount).toBeGreaterThan(0);
    });
  });

  describe('isTranslatable', () => {
    it('普通段落元素可翻译', () => {
      const p = document.createElement('p');
      expect(scanner.isTranslatable(p)).toBe(true);
    });

    it('script 元素不可翻译', () => {
      const script = document.createElement('script');
      expect(scanner.isTranslatable(script)).toBe(false);
    });

    it('input 元素不可翻译', () => {
      const input = document.createElement('input');
      expect(scanner.isTranslatable(input)).toBe(false);
    });

    it('排除祖先的后代元素不可翻译', () => {
      const nav = document.createElement('nav');
      const span = document.createElement('span');
      nav.appendChild(span);

      expect(scanner.isTranslatable(span)).toBe(false);
    });
  });

  describe('isInExcludedArea', () => {
    it('排除元素本身返回 true', () => {
      const nav = document.createElement('nav');
      expect(isInExcludedArea(nav)).toBe(true);
    });

    it('排除元素的后代返回 true', () => {
      const nav = document.createElement('nav');
      const span = document.createElement('span');
      nav.appendChild(span);

      expect(isInExcludedArea(span)).toBe(true);
    });

    it('富文本编辑区内的草稿段落被排除', () => {
      const editor = document.createElement('div');
      editor.setAttribute('contenteditable', 'true');
      const paragraph = document.createElement('p');
      editor.appendChild(paragraph);

      expect(isInExcludedArea(paragraph)).toBe(true);
      expect(scanner.isTranslatable(paragraph)).toBe(false);
    });

    it('包含嵌套编辑草稿的段落整体排除，避免重新读取 textContent 泄漏', () => {
      const paragraph = document.createElement('p');
      paragraph.innerHTML = '公开文章 <span contenteditable="true">未发送草稿</span>';

      expect(isInExcludedArea(paragraph)).toBe(true);
      expect(scanner.isTranslatable(paragraph)).toBe(false);
    });

    it('普通元素返回 false', () => {
      const p = document.createElement('p');
      expect(isInExcludedArea(p)).toBe(false);
    });
  });

  describe('缓存', () => {
    it('clearCache 清除缓存', () => {
      document.body.innerHTML = '<p>Test content here with words</p>';
      scanner.scan();
      expect(scanner.getCacheSize()).toBeGreaterThan(0);

      scanner.clearCache();
      expect(scanner.getCacheSize()).toBe(0);
    });

    it('getCacheSize 返回正确数量', () => {
      document.body.innerHTML = `
        <p>First paragraph here</p>
        <p>Second paragraph here</p>
      `;
      scanner.scan();
      expect(scanner.getCacheSize()).toBeGreaterThan(0);
    });
  });

  describe('observe / unobserve', () => {
    it('observe 启动 MutationObserver', () => {
      document.body.innerHTML = '<p>Initial content here</p>';
      const callback = vi.fn();

      scanner.observe(document.body, callback);

      // 添加新内容触发变化
      const newP = document.createElement('p');
      newP.textContent = 'New paragraph with enough words here';
      document.body.appendChild(newP);

      // MutationObserver 是异步的
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(callback).toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('unobserve 停止监听', () => {
      document.body.innerHTML = '<p>Initial content here</p>';
      const callback = vi.fn();

      scanner.observe(document.body, callback);
      scanner.unobserve();

      const newP = document.createElement('p');
      newP.textContent = 'New paragraph with enough words';
      document.body.appendChild(newP);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(callback).not.toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });

    it('重复 observe 先取消旧的', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      scanner.observe(document.body, callback1);
      scanner.observe(document.body, callback2);

      expect(scanner.getObservedElement()).toBe(document.body);
    });

    it('getObservedElement 返回监听元素', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      scanner.observe(div);
      expect(scanner.getObservedElement()).toBe(div);
    });

    it('不相关的 DOM 变化不触发回调', () => {
      document.body.innerHTML = '<p>Initial content here</p>';
      const callback = vi.fn();

      scanner.observe(document.body, callback);

      // 添加 script 标签（应被忽略）
      const script = document.createElement('script');
      script.textContent = 'var x = 1;';
      document.body.appendChild(script);

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(callback).not.toHaveBeenCalled();
          resolve();
        }, 50);
      });
    });
  });

  describe('getParagraphs', () => {
    it('返回 HTMLElement 数组', () => {
      document.body.innerHTML = '<p>Test paragraph with enough words</p>';

      const result = scanner.getParagraphs();
      expect(Array.isArray(result)).toBe(true);
      expect(result[0]).toBeInstanceOf(HTMLElement);
    });
  });

  describe('scanElement', () => {
    it('扫描指定元素而非整个页面', () => {
      document.body.innerHTML = `
        <div id="target"><p>Target paragraph here</p></div>
        <div id="other"><p>Other paragraph here</p></div>
      `;

      const target = document.getElementById('target')!;
      const result = scanner.scanElement(target);

      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Target paragraph');
    });

    it('忽略空白文本节点', () => {
      const div = document.createElement('div');
      div.innerHTML = '<p>   </p><p>Real text here with words</p>';

      const result = scanner.scanElement(div);
      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Real text');
    });
  });
});

describe('EXCLUDED_SELECTORS', () => {
  it('包含基础非内容元素选择器', () => {
    expect(EXCLUDED_SELECTORS).toContain('script');
    expect(EXCLUDED_SELECTORS).toContain('style');
    expect(EXCLUDED_SELECTORS).toContain('code');
  });

  it('包含表单元素选择器', () => {
    expect(EXCLUDED_SELECTORS).toContain('input');
    expect(EXCLUDED_SELECTORS).toContain('textarea');
    expect(EXCLUDED_SELECTORS).toContain('button');
  });

  it('包含导航元素选择器', () => {
    expect(EXCLUDED_SELECTORS).toContain('nav');
    expect(EXCLUDED_SELECTORS).toContain('footer');
    expect(EXCLUDED_SELECTORS).toContain('aside');
  });

  it('包含 ARIA 角色选择器', () => {
    expect(EXCLUDED_SELECTORS).toContain('[role="navigation"]');
    expect(EXCLUDED_SELECTORS).toContain('[role="dialog"]');
  });

  it('包含语义 UI 类名选择器', () => {
    expect(EXCLUDED_SELECTORS).toContain('.navbar');
    expect(EXCLUDED_SELECTORS).toContain('.modal');
  });

  it('包含翻译标记选择器', () => {
    expect(EXCLUDED_SELECTORS).toContain('[data-notranslate]');
    expect(EXCLUDED_SELECTORS).toContain('.not-only-translator-highlight');
  });
});

describe('SITE_SPECIFIC_SELECTORS', () => {
  it('包含 GitHub 特定选择器', () => {
    expect(SITE_SPECIFIC_SELECTORS.github).toContain('.Header');
    expect(SITE_SPECIFIC_SELECTORS.github).toContain('.ActionList');
  });
});
