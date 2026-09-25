/**
 * ViewportObserver 测试
 *
 * 覆盖 IntersectionObserver 交互、段落过滤、防抖通知、启用/禁用
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ViewportObserver } from '@/content/viewportObserver';
import { isInExcludedArea } from '@/content/pageScanner';

vi.mock('@/content/pageScanner', () => ({
  isInExcludedArea: vi.fn(() => false),
  EXCLUDED_SELECTORS: [],
  SITE_SPECIFIC_SELECTORS: {},
}));

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  debounce: (fn: () => void, _delay: number) => {
    // 同步 debounce 用于测试
    return function () {
      fn();
    };
  },
}));

vi.mock('@/shared/constants', () => ({
  DEFAULT_BATCH_CONFIG: {
    maxParagraphsPerBatch: 3,
    maxCharsPerBatch: 100,
    debounceDelay: 0,
  },
}));

// 全局 IntersectionObserver mock
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  elements: Set<Element> = new Set();

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(element: Element) {
    this.elements.add(element);
  }

  unobserve(element: Element) {
    this.elements.delete(element);
  }

  disconnect() {
    this.elements.clear();
  }

  // 测试辅助：手动触发交叉事件
  trigger(entries: Partial<IntersectionObserverEntry>[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

let currentObserver: MockIntersectionObserver | null = null;

(globalThis as any).IntersectionObserver = function (callback: IntersectionObserverCallback) {
  currentObserver = new MockIntersectionObserver(callback);
  return currentObserver;
};

function createParagraphElement(text: string, id?: string): HTMLElement {
  const el = document.createElement('p');
  el.textContent = text;
  if (id) el.id = id;
  document.body.appendChild(el);
  return el;
}

describe('ViewportObserver', () => {
  let observer: ViewportObserver;
  let callback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isInExcludedArea).mockReturnValue(false);
    document.body.innerHTML = '';
    currentObserver = null;
    callback = vi.fn();
    observer = new ViewportObserver(callback);
  });

  afterEach(() => {
    observer?.destroy();
    document.body.innerHTML = '';
  });

  describe('constructor', () => {
    it('创建 IntersectionObserver', () => {
      expect(currentObserver).not.toBeNull();
      expect(currentObserver).toBeInstanceOf(MockIntersectionObserver);
    });
  });

  describe('observe / unobserve', () => {
    it('观察单个元素', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      expect(currentObserver!.elements.has(el)).toBe(true);
    });

    it('重复观察同一元素不报错', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      observer.observe(el);
      expect(currentObserver!.elements.size).toBe(1);
    });

    it('批量观察元素', () => {
      const els = [
        createParagraphElement('A'.repeat(100)),
        createParagraphElement('B'.repeat(100)),
      ];
      observer.observeAll(els);
      expect(currentObserver!.elements.size).toBe(2);
    });

    it('取消观察元素', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      observer.unobserve(el);
      expect(currentObserver!.elements.has(el)).toBe(false);
    });
  });

  describe('handleIntersection', () => {
    it('元素进入可视区域触发回调', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(callback).toHaveBeenCalled();
      const paragraphs = callback.mock.calls[0][0];
      expect(paragraphs.length).toBe(1);
      expect(paragraphs[0].element).toBe(el);
      expect(paragraphs[0].text).toBe('A'.repeat(100));
    });

    it('元素离开可视区域从集合移除', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);

      // 先进入
      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      expect(observer.getVisibleCount()).toBe(1);

      callback.mockClear();

      // 再离开
      currentObserver!.trigger([{ target: el, isIntersecting: false }]);
      expect(observer.getVisibleCount()).toBe(0);
    });

    it('禁用时不处理交叉事件', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      observer.disable();

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(callback).not.toHaveBeenCalled();
    });

    it('已处理元素不加入可视集合', () => {
      const el = createParagraphElement('A'.repeat(100));
      el.classList.add('not-translator-processed');
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(observer.getVisibleCount()).toBe(0);
    });

    it('短文本元素被过滤', () => {
      const el = createParagraphElement('Hi');
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(observer.getVisibleCount()).toBe(0);
    });

    it('排除区域元素被过滤', () => {
      vi.mocked(isInExcludedArea).mockReturnValue(true);
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(observer.getVisibleCount()).toBe(0);
      vi.mocked(isInExcludedArea).mockReturnValue(false);
    });

    it('多次进入同一元素不重复添加', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(observer.getVisibleCount()).toBe(1);
    });
  });

  describe('notifyVisibleParagraphs', () => {
    it('通知包含元素ID集合', () => {
      const idCallback = vi.fn();
      observer.setVisibleIdsChangedCallback(idCallback);

      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(idCallback).toHaveBeenCalled();
      const ids = idCallback.mock.calls[0][0];
      expect(ids instanceof Set).toBe(true);
      expect(ids.size).toBe(1);
    });

    it('已处理元素不通知翻译', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      expect(callback).toHaveBeenCalledTimes(1);
      callback.mockClear();

      // 标记为已处理
      el.classList.add('not-translator-processed');
      observer.markAsProcessed(el);

      // 重新触发不应通知
      observer.checkCurrentViewport();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('enable / disable', () => {
    it('启用观察器', () => {
      observer.disable();
      observer.enable();
      expect(() => {
        const el = createParagraphElement('A'.repeat(100));
        observer.observe(el);
        currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      }).not.toThrow();
    });

    it('禁用后清除可视段落', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      expect(observer.getVisibleCount()).toBe(1);

      observer.disable();
      expect(observer.getVisibleCount()).toBe(0);
    });
  });

  describe('checkCurrentViewport', () => {
    it('手动检查可视区域', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);

      // Mock getBoundingClientRect
      el.getBoundingClientRect = vi.fn(() => ({
        top: 10,
        bottom: 100,
        left: 10,
        right: 500,
        width: 490,
        height: 90,
        x: 10,
        y: 10,
        toJSON: () => {},
      }));

      // Mock window dimensions
      Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
      Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true });

      observer.checkCurrentViewport();

      expect(callback).toHaveBeenCalled();
    });

    it('禁用时手动检查不执行', () => {
      observer.disable();
      observer.checkCurrentViewport();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getVisibleCount', () => {
    it('返回可视段落数量', () => {
      expect(observer.getVisibleCount()).toBe(0);

      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      currentObserver!.trigger([{ target: el, isIntersecting: true }]);

      expect(observer.getVisibleCount()).toBe(1);
    });
  });

  describe('resetTracking', () => {
    it('重置追踪状态', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);
      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      expect(observer.getVisibleCount()).toBe(1);

      observer.resetTracking();
      expect(observer.getVisibleCount()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('断开观察器并清理', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);

      observer.destroy();
      expect(currentObserver!.elements.size).toBe(0);
    });
  });

  describe('generateId', () => {
    it('使用元素自身的ID', () => {
      const el = createParagraphElement('A'.repeat(100), 'my-paragraph');
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      const paragraphs = callback.mock.calls[0][0];

      expect(paragraphs[0].id).toBe('para_my-paragraph');
    });

    it('无ID时使用计数器', () => {
      const el1 = createParagraphElement('A'.repeat(100));
      const el2 = createParagraphElement('B'.repeat(100));
      observer.observe(el1);
      observer.observe(el2);

      currentObserver!.trigger([
        { target: el1, isIntersecting: true },
        { target: el2, isIntersecting: true },
      ]);
      const paragraphs = callback.mock.calls[0][0];

      expect(paragraphs[0].id).toMatch(/^para_\d+$/);
      expect(paragraphs[1].id).toMatch(/^para_\d+$/);
      expect(paragraphs[0].id).not.toBe(paragraphs[1].id);
    });
  });

  describe('getElementPath', () => {
    it('生成有效的元素路径', () => {
      const el = createParagraphElement('A'.repeat(100));
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      const paragraphs = callback.mock.calls[0][0];

      expect(paragraphs[0].elementPath).toBeTruthy();
      expect(paragraphs[0].elementPath).toContain('p');
    });

    it('包含ID的元素路径', () => {
      const el = createParagraphElement('A'.repeat(100), 'test-id');
      observer.observe(el);

      currentObserver!.trigger([{ target: el, isIntersecting: true }]);
      const paragraphs = callback.mock.calls[0][0];

      expect(paragraphs[0].elementPath).toContain('#test-id');
    });
  });
});
