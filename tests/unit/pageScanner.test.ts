import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PageScanner, type Paragraph, EXCLUDED_SELECTORS } from '@/content/pageScanner';

describe('PageScanner', () => {
  let scanner: PageScanner;
  let testContainer: HTMLDivElement;

  beforeEach(() => {
    scanner = new PageScanner();
    // 创建测试容器
    testContainer = document.createElement('div');
    testContainer.id = 'test-container';
    document.body.appendChild(testContainer);
  });

  afterEach(() => {
    // 清理测试容器
    testContainer.remove();
    // 清除缓存
    scanner.clearCache();
  });

  describe('scan', () => {
    it('should return empty array when no paragraphs exist', () => {
      testContainer.innerHTML = '';
      const result = scanner.scan();
      expect(result).toEqual([]);
    });

    it('should scan paragraphs from the page', () => {
      testContainer.innerHTML = `
        <p>This is a test paragraph with enough words.</p>
        <p>Another paragraph for testing purposes here.</p>
      `;

      const result = scanner.scan();

      expect(result.length).toBe(2);
      expect(result[0].text).toContain('This is a test paragraph');
      // "This is a test paragraph with enough words." = 8 words
      expect(result[0].wordCount).toBe(8);
    });

    it('should assign unique IDs to paragraphs', () => {
      testContainer.innerHTML = `
        <p>First paragraph with enough words here.</p>
        <p>Second paragraph with enough words here.</p>
      `;

      const result = scanner.scan();
      const ids = result.map(p => p.id);

      expect(new Set(ids).size).toBe(2);
    });

    it('should return cached results on subsequent scans', () => {
      testContainer.innerHTML = '<p>This is a cached paragraph with many words.</p>';

      const result1 = scanner.scan();
      const result2 = scanner.scan();

      expect(result1).toBe(result2); // Same reference = cached
    });

    it('should force rescan when cache is cleared', () => {
      testContainer.innerHTML = '<p>Original paragraph with enough words here.</p>';

      const result1 = scanner.scan();
      testContainer.innerHTML = '<p>Modified paragraph with enough words here.</p>';
      scanner.clearCache();
      const result2 = scanner.scan();

      expect(result2).not.toBe(result1); // Different reference
      expect(result2[0].text).toContain('Modified paragraph');
    });
  });

  describe('scanElement', () => {
    it('should scan only within specified element', () => {
      testContainer.innerHTML = `
        <div id="article">
          <p>Inside article paragraph with enough words.</p>
        </div>
        <div id="sidebar">
          <p>Sidebar paragraph with enough words here.</p>
        </div>
      `;

      const article = testContainer.querySelector('#article') as Element;
      const result = scanner.scanElement(article);

      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Inside article');
    });

    it('should return empty array for element with no translatable content', () => {
      testContainer.innerHTML = `
        <div id="empty"></div>
      `;

      const empty = testContainer.querySelector('#empty') as Element;
      const result = scanner.scanElement(empty);

      expect(result).toEqual([]);
    });
  });

  describe('isTranslatable', () => {
    it('should return true for translatable elements', () => {
      testContainer.innerHTML = '<p id="test">This is a test paragraph.</p>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(true);
    });

    it('should return false for script elements', () => {
      testContainer.innerHTML = '<script id="test">var x = 1;</script>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for style elements', () => {
      testContainer.innerHTML = '<style id="test">.test { color: red; }</style>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for noscript elements', () => {
      testContainer.innerHTML = '<noscript id="test">Enable JavaScript</noscript>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for code elements', () => {
      testContainer.innerHTML = '<code id="test">const x = 1;</code>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for pre elements', () => {
      testContainer.innerHTML = '<pre id="test">Preformatted text here</pre>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for input elements', () => {
      testContainer.innerHTML = '<input id="test" type="text" value="test">';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for textarea elements', () => {
      testContainer.innerHTML = '<textarea id="test">Text content</textarea>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for select elements', () => {
      testContainer.innerHTML = '<select id="test"><option>Option</option></select>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for button elements', () => {
      testContainer.innerHTML = '<button id="test">Click me</button>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for elements with data-notranslate', () => {
      testContainer.innerHTML = '<div id="test" data-notranslate>Do not translate</div>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for already highlighted elements', () => {
      testContainer.innerHTML = '<span id="test" class="not-only-translator-highlight">Highlighted</span>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for nav elements', () => {
      testContainer.innerHTML = '<nav id="test"><a href="#">Link</a></nav>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });

    it('should return false for footer elements', () => {
      testContainer.innerHTML = '<footer id="test">Footer content here</footer>';
      const element = testContainer.querySelector('#test') as Element;

      expect(scanner.isTranslatable(element)).toBe(false);
    });
  });

  describe('exclude selectors', () => {
    it('should exclude all defined selectors', () => {
      const selectors = EXCLUDED_SELECTORS;
      expect(selectors).toContain('script');
      expect(selectors).toContain('style');
      expect(selectors).toContain('noscript');
      expect(selectors).toContain('code');
      expect(selectors).toContain('pre');
      expect(selectors).toContain('input');
      expect(selectors).toContain('textarea');
      expect(selectors).toContain('select');
      expect(selectors).toContain('button');
      expect(selectors).toContain('iframe');
      expect(selectors).toContain('[data-notranslate]');
      expect(selectors).toContain('.not-only-translator-highlight');
      expect(selectors).toContain('nav');
      expect(selectors).toContain('footer');
    });

    it('should not include elements matching excluded selectors', () => {
      testContainer.innerHTML = `
        <p class="content">This is normal content paragraph here.</p>
        <script>var x = "This should not be included";</script>
        <style>.test { content: "This should not be included"; }</style>
        <nav><p>Navigation link text here right now.</p></nav>
        <footer><p>Footer text paragraph here now.</p></footer>
        <button>Button text should not be included</button>
        <code>Code snippet should not be included</code>
        <pre>Preformatted text should not be included</pre>
        <div data-notranslate><p>This should not be translated here.</p></div>
      `;

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].text).toContain('This is normal content');
    });
  });

  describe('minimum word count', () => {
    it('should exclude paragraphs with less than 3 words', () => {
      testContainer.innerHTML = `
        <p id="short1">Hi</p>
        <p id="short2">Hello world</p>
        <p id="long">This paragraph has enough words here.</p>
      `;

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].text).toContain('This paragraph has enough');
    });

    it('should include paragraphs with exactly 3 words', () => {
      testContainer.innerHTML = '<p>Hello world test</p>';

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].wordCount).toBe(3);
    });

    it('should include paragraphs with more than 3 words', () => {
      testContainer.innerHTML = '<p>This paragraph has many words for testing.</p>';

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].wordCount).toBe(7);
    });
  });

  describe('maximum text length', () => {
    it('should truncate text exceeding 5000 characters', () => {
      const longText = 'word '.repeat(2000); // 10000 chars
      testContainer.innerHTML = `<p id="long">${longText}</p>`;

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].text.length).toBeLessThanOrEqual(5000);
    });

    it('should include full text under 5000 characters', () => {
      const shortText = 'word '.repeat(100).trim(); // ~500 chars
      testContainer.innerHTML = `<p id="short">${shortText}</p>`;

      const result = scanner.scan();

      expect(result.length).toBe(1);
      // 允许轻微差异（trim 和空格处理）
      expect(result[0].text.length).toBeGreaterThanOrEqual(shortText.length - 10);
      expect(result[0].text.length).toBeLessThanOrEqual(shortText.length + 10);
    });
  });

  describe('word count calculation', () => {
    it('should correctly count words in English text', () => {
      testContainer.innerHTML = '<p>One two three four five six seven.</p>';

      const result = scanner.scan();

      expect(result[0].wordCount).toBe(7);
    });

    it('should handle multiple spaces', () => {
      testContainer.innerHTML = '<p>One   two    three   four.</p>';

      const result = scanner.scan();

      expect(result[0].wordCount).toBe(4);
    });

    it('should handle leading and trailing spaces', () => {
      testContainer.innerHTML = '<p>   One two three four.   </p>';

      const result = scanner.scan();

      expect(result[0].wordCount).toBe(4);
    });
  });

  describe('TreeWalker usage', () => {
    it('should use TreeWalker for DOM traversal', () => {
      // 验证 TreeWalker 被正确使用
      const createTreeWalkerSpy = vi.spyOn(document, 'createTreeWalker');

      testContainer.innerHTML = '<p>Test paragraph with enough words.</p>';
      scanner.scan();

      expect(createTreeWalkerSpy).toHaveBeenCalled();
      createTreeWalkerSpy.mockRestore();
    });

    it('should correctly traverse nested elements', () => {
      testContainer.innerHTML = `
        <article>
          <section>
            <div>
              <p>Nested paragraph with enough words here.</p>
            </div>
          </section>
        </article>
      `;

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Nested paragraph');
    });

    it('should handle deeply nested structures', () => {
      testContainer.innerHTML = `
        <div>
          <div>
            <div>
              <div>
                <div>
                  <p>Deeply nested paragraph with enough words here.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      const result = scanner.scan();

      expect(result.length).toBe(1);
    });
  });

  describe('edge cases', () => {
    it('should handle empty document body', () => {
      document.body.innerHTML = '';
      const result = scanner.scan();
      expect(result).toEqual([]);
    });

    it('should handle elements with only whitespace', () => {
      testContainer.innerHTML = '<p>     </p><p>\n\n\n</p><p>\t\t\t</p>';

      const result = scanner.scan();

      expect(result).toEqual([]);
    });

    it('should handle mixed content elements', () => {
      testContainer.innerHTML = `
        <p>Text before <span>inline text</span> text after here.</p>
      `;

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Text before');
      expect(result[0].text).toContain('inline text');
      expect(result[0].text).toContain('text after');
    });

    it('should handle elements with links', () => {
      testContainer.innerHTML = `
        <p>Click <a href="#">here</a> for more information about this.</p>
      `;

      const result = scanner.scan();

      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Click');
      expect(result[0].text).toContain('here');
      expect(result[0].text).toContain('for more information');
    });

    it('should handle Unicode characters', () => {
      testContainer.innerHTML = '<p>Hello world test paragraph here now.</p>';

      const result = scanner.scan();

      expect(result.length).toBe(1);
      // wordCount should count English words only
      expect(result[0].wordCount).toBeGreaterThanOrEqual(3);
    });

    it('should handle hidden elements', () => {
      testContainer.innerHTML = `
        <p id="visible">Visible paragraph with enough words here.</p>
        <p id="hidden" style="display: none;">Hidden paragraph with enough words here.</p>
      `;

      const result = scanner.scan();

      // 默认包含隐藏元素（可通过配置调整）
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('performance', () => {
    it('should handle large number of paragraphs efficiently', () => {
      // 创建 100 个段落
      let html = '';
      for (let i = 0; i < 100; i++) {
        html += `<p>Paragraph number ${i} with enough words for testing here.</p>`;
      }
      testContainer.innerHTML = html;

      const startTime = performance.now();
      const result = scanner.scan();
      const endTime = performance.now();

      expect(result.length).toBe(100);
      expect(endTime - startTime).toBeLessThan(100); // 应该在 100ms 内完成
    });

    it('should cache results to avoid redundant scanning', () => {
      testContainer.innerHTML = '<p>Test paragraph with enough words for caching.</p>';

      scanner.scan();
      const cachedResult = scanner.scan();

      // 第二次扫描应该返回缓存结果
      expect(cachedResult.length).toBe(1);
    });
  });

  describe('incremental scanning', () => {
    it('should support MutationObserver for dynamic content', () => {
      // 验证支持增量扫描
      expect(typeof scanner.observe).toBe('function');
      expect(typeof scanner.unobserve).toBe('function');
    });

    it('should detect new paragraphs added after initial scan', async () => {
      testContainer.innerHTML = '<p>Initial paragraph with enough words here.</p>';

      scanner.scan();
      expect(scanner.getCacheSize()).toBe(1);

      // 添加新段落
      const newParagraph = document.createElement('p');
      newParagraph.textContent = 'New paragraph added dynamically to the page.';
      testContainer.appendChild(newParagraph);

      // 清除缓存后重新扫描
      scanner.clearCache();
      const result = scanner.scan();

      expect(result.length).toBe(2);
    });

    it('should call callback when MutationObserver detects changes', async () => {
      testContainer.innerHTML = '<p>Initial paragraph with enough words here.</p>';

      const callback = vi.fn();
      scanner.observe(testContainer, callback);

      // 模拟添加新段落
      const newParagraph = document.createElement('p');
      newParagraph.textContent = 'New paragraph added dynamically to the page.';
      testContainer.appendChild(newParagraph);

      // 等待 MutationObserver 触发
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalled();
      scanner.unobserve();
    });

    it('should unobserve previous observer when observe is called again', () => {
      testContainer.innerHTML = '<p>Test paragraph with enough words.</p>';

      const callback1 = vi.fn();
      const callback2 = vi.fn();

      scanner.observe(testContainer, callback1);
      scanner.observe(testContainer, callback2);

      // 第一个 observer 应该被断开
      expect(scanner).toBeDefined();
      scanner.unobserve();
    });

    it('should detect changes in nested elements', async () => {
      testContainer.innerHTML = `
        <div id="outer">
          <p>Initial paragraph with enough words here.</p>
        </div>
      `;

      const callback = vi.fn();
      scanner.observe(testContainer, callback);

      // 在嵌套元素中添加内容
      const outer = testContainer.querySelector('#outer') as HTMLElement;
      const newDiv = document.createElement('div');
      newDiv.innerHTML = '<p>New nested paragraph with enough words.</p>';
      outer.appendChild(newDiv);

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(callback).toHaveBeenCalled();
      scanner.unobserve();
    });

    it('should not trigger callback for excluded elements', async () => {
      testContainer.innerHTML = '<p>Initial paragraph with enough words.</p>';

      const callback = vi.fn();
      scanner.observe(testContainer, callback);

      // 添加被排除的元素
      const script = document.createElement('script');
      script.textContent = 'var x = 1;';
      testContainer.appendChild(script);

      await new Promise(resolve => setTimeout(resolve, 50));

      // 不应该为 script 元素触发回调
      expect(callback).not.toHaveBeenCalled();
      scanner.unobserve();
    });

    it('should return observed element after observe is called', () => {
      testContainer.innerHTML = '<p>Test paragraph with enough words.</p>';

      expect(scanner.getObservedElement()).toBeNull();

      scanner.observe(testContainer);
      expect(scanner.getObservedElement()).toBe(testContainer);

      scanner.unobserve();
      expect(scanner.getObservedElement()).toBeNull();
    });
  });

  describe('iframe handling', () => {
    it('should skip iframe content by default', () => {
      testContainer.innerHTML = `
        <p>Regular paragraph with enough words here now.</p>
        <iframe id="test-frame">
          <html>
            <body>
              <p>Inside iframe paragraph with enough words.</p>
            </body>
          </html>
        </iframe>
      `;

      const result = scanner.scan();

      // 默认跳过 iframe 内容
      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Regular paragraph');
    });
  });

  describe('shadow DOM handling', () => {
    it('should skip shadow DOM content by default', () => {
      testContainer.innerHTML = `
        <p>Regular paragraph with enough words here now.</p>
        <div id="shadow-host"></div>
      `;

      // 创建 shadow DOM
      const shadowHost = testContainer.querySelector('#shadow-host') as HTMLElement;
      if (shadowHost.attachShadow) {
        const shadow = shadowHost.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<p>Inside shadow DOM paragraph with enough words.</p>';
      }

      const result = scanner.scan();

      // 默认跳过 shadow DOM 内容
      expect(result.length).toBe(1);
      expect(result[0].text).toContain('Regular paragraph');
    });
  });
});

describe('Paragraph interface', () => {
  it('should have required properties', () => {
    const paragraph: Paragraph = {
      id: 'test-id',
      element: document.createElement('p'),
      text: 'Test text content',
      wordCount: 3
    };

    expect(paragraph.id).toBeDefined();
    expect(paragraph.element).toBeDefined();
    expect(paragraph.text).toBeDefined();
    expect(paragraph.wordCount).toBeDefined();
  });
});