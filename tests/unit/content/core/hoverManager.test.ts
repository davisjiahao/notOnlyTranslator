/**
 * HoverManager 测试
 *
 * 覆盖悬停定时器、Tooltip 触发、Ctrl 快捷显示等
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HoverManager } from '@/content/core/hoverManager';

// Mock constants
vi.mock('@/shared/constants', () => ({
  CSS_CLASSES: {
    HIGHLIGHT: 'not-only-translator-highlight',
  },
  TIMING: {
    DEFAULT_HOVER_DELAY: 300,
  },
}));

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Tooltip
function createMockTooltip() {
  return {
    getPinned: vi.fn().mockReturnValue(false),
    hide: vi.fn(),
  };
}

// jsdom 中 MouseEvent 构造函数不会设置 target，需要手动构造
function mockMouseEvent(
  type: string,
  target: HTMLElement,
  options: { ctrlKey?: boolean } = {}
): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true });
  Object.defineProperty(event, 'target', { value: target, enumerable: true });
  if (options.ctrlKey !== undefined) {
    Object.defineProperty(event, 'ctrlKey', { value: options.ctrlKey, enumerable: true });
  }
  return event;
}

describe('HoverManager', () => {
  let manager: HoverManager;
  let mockTooltip: ReturnType<typeof createMockTooltip>;
  let hoverShowHandler: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    mockTooltip = createMockTooltip();
    hoverShowHandler = vi.fn();
    manager = new HoverManager(mockTooltip as any, hoverShowHandler);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  describe('基本状态', () => {
    it('初始悬停元素为 null', () => {
      expect(manager.getHoverElement()).toBeNull();
    });

    it('设置悬停延迟', () => {
      manager.setHoverDelay(500);
      expect(() => manager.setHoverDelay(500)).not.toThrow();
    });
  });

  describe('handleMouseOver', () => {
    it('非高亮元素不触发', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const event = mockMouseEvent('mouseover', div);
      manager.handleMouseOver(event);

      vi.advanceTimersByTime(1000);
      expect(hoverShowHandler).not.toHaveBeenCalled();
    });

    it('高亮元素触发悬停定时器', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      expect(hoverShowHandler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledWith(span);
    });

    it('Ctrl+悬停立即显示', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span, { ctrlKey: true });
      manager.handleMouseOver(event);

      expect(hoverShowHandler).toHaveBeenCalledWith(span);
    });

    it('子元素事件冒泡找到父高亮元素', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      const child = document.createElement('b');
      span.appendChild(child);
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', child);
      manager.handleMouseOver(event);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledWith(span);
    });

    it('同一元素不重复触发', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const event1 = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event1);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledTimes(1);

      const event2 = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event2);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledTimes(1);
    });

    it('切换元素时清除旧定时器', () => {
      const span1 = document.createElement('span');
      span1.classList.add('not-only-translator-highlight');
      document.body.appendChild(span1);

      const span2 = document.createElement('span');
      span2.classList.add('not-only-translator-highlight');
      document.body.appendChild(span2);

      const event1 = mockMouseEvent('mouseover', span1);
      manager.handleMouseOver(event1);

      const event2 = mockMouseEvent('mouseover', span2);
      manager.handleMouseOver(event2);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledTimes(1);
      expect(hoverShowHandler).toHaveBeenCalledWith(span2);
    });

    it('语法高亮元素触发', () => {
      const span = document.createElement('span');
      span.classList.add('not-translator-grammar-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledWith(span);
    });

    it('高亮词汇元素触发', () => {
      const span = document.createElement('span');
      span.classList.add('not-translator-highlighted-word');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledWith(span);
    });

    it('翻译高亮元素触发', () => {
      const span = document.createElement('span');
      span.classList.add('not-translator-highlighted-translation');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledWith(span);
    });

    it('词汇高亮元素触发', () => {
      const span = document.createElement('span');
      span.classList.add('not-translator-vocab-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).toHaveBeenCalledWith(span);
    });
  });

  describe('handleMouseOut', () => {
    it('离开高亮元素时清除定时器并隐藏', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const overEvent = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(overEvent);

      const outEvent = mockMouseEvent('mouseout', span);
      manager.handleMouseOut(outEvent);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).not.toHaveBeenCalled();
      expect(mockTooltip.hide).toHaveBeenCalled();
    });

    it('钉住 Tooltip 时不隐藏', () => {
      mockTooltip.getPinned.mockReturnValue(true);

      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const overEvent = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(overEvent);

      const outEvent = mockMouseEvent('mouseout', span);
      manager.handleMouseOut(outEvent);

      expect(mockTooltip.hide).not.toHaveBeenCalled();
    });

    it('离开子元素时触发', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      const child = document.createElement('b');
      span.appendChild(child);
      document.body.appendChild(span);

      const overEvent = mockMouseEvent('mouseover', child);
      manager.handleMouseOver(overEvent);

      const outEvent = mockMouseEvent('mouseout', child);
      manager.handleMouseOut(outEvent);

      expect(mockTooltip.hide).toHaveBeenCalled();
    });

    it('非高亮元素离开不处理', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);

      const event = mockMouseEvent('mouseout', div);
      manager.handleMouseOut(event);

      expect(mockTooltip.hide).not.toHaveBeenCalled();
    });
  });

  describe('clearHoverTimer', () => {
    it('清除未触发的定时器', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      manager.clearHoverTimer();

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).not.toHaveBeenCalled();
    });
  });

  describe('clearHoverState', () => {
    it('清除定时器和悬停元素', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      manager.clearHoverState();

      expect(manager.getHoverElement()).toBeNull();

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).not.toHaveBeenCalled();
    });
  });

  describe('destroy', () => {
    it('清理所有状态', () => {
      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      manager.handleMouseOver(event);

      manager.destroy();

      expect(manager.getHoverElement()).toBeNull();

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).not.toHaveBeenCalled();
    });
  });

  describe('自定义延迟', () => {
    it('使用自定义悬停延迟', () => {
      const customManager = new HoverManager(mockTooltip as any, hoverShowHandler, 500);

      const span = document.createElement('span');
      span.classList.add('not-only-translator-highlight');
      document.body.appendChild(span);

      const event = mockMouseEvent('mouseover', span);
      customManager.handleMouseOver(event);

      vi.advanceTimersByTime(300);
      expect(hoverShowHandler).not.toHaveBeenCalled();

      vi.advanceTimersByTime(200);
      expect(hoverShowHandler).toHaveBeenCalled();

      customManager.destroy();
    });
  });
});
