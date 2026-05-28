/**
 * NavigationManager 测试
 *
 * 覆盖键盘导航、高亮元素遍历、导航指示器等
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NavigationManager } from '@/content/core/navigationManager';

// Mock constants
vi.mock('@/shared/constants', () => ({
  CSS_CLASSES: {
    HIGHLIGHT: 'not-only-translator-highlight',
  },
  TIMING: {
    NAVIGATION_HIGHLIGHT_DURATION: 2000,
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

describe('NavigationManager', () => {
  let manager: NavigationManager;

  beforeEach(() => {
    document.body.innerHTML = '';
    manager = new NavigationManager();
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('基本状态', () => {
    it('初始索引为 -1', () => {
      expect(manager.getCurrentIndex()).toBe(-1);
    });

    it('初始高亮列表为空', () => {
      expect(manager.getHighlights()).toEqual([]);
    });

    it('设置高亮列表', () => {
      const mockElements = [
        document.createElement('span'),
        document.createElement('span'),
      ];
      manager.setHighlights(mockElements);
      expect(manager.getHighlights()).toHaveLength(2);
    });

    it('设置当前索引', () => {
      manager.setCurrentIndex(3);
      expect(manager.getCurrentIndex()).toBe(3);
    });
  });

  describe('getNavigableHighlights', () => {
    it('空页面返回空数组', () => {
      const elements = manager.getNavigableHighlights();
      expect(elements).toEqual([]);
    });

    it('获取高亮元素', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
      `;

      const elements = manager.getNavigableHighlights();
      expect(elements).toHaveLength(2);
    });

    it('获取语法高亮元素', () => {
      document.body.innerHTML = `
        <p><span class="not-translator-grammar-highlight">grammar1</span></p>
        <p><span class="not-translator-highlighted-word">word1</span></p>
      `;

      const elements = manager.getNavigableHighlights();
      expect(elements).toHaveLength(2);
    });

    it('按页面位置排序', () => {
      document.body.innerHTML = `
        <div><span class="not-only-translator-highlight">second</span></div>
        <div><span class="not-only-translator-highlight">first</span></div>
      `;

      const spans = document.querySelectorAll('.not-only-translator-highlight');
      // mock getBoundingClientRect 因为 jsdom 不计算布局位置
      spans[0].getBoundingClientRect = () => ({ top: 100, left: 0 } as DOMRect);
      spans[1].getBoundingClientRect = () => ({ top: 50, left: 0 } as DOMRect);

      const elements = manager.getNavigableHighlights();
      expect(elements[0].textContent).toBe('first');
      expect(elements[1].textContent).toBe('second');
    });
  });

  describe('navigateToNext', () => {
    it('无元素返回 null', () => {
      const result = manager.navigateToNext();
      expect(result.element).toBeNull();
      expect(result.index).toBe(-1);
    });

    it('导航到第一个元素', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
      `;

      const result = manager.navigateToNext();
      expect(result.element).not.toBeNull();
      expect(result.index).toBe(0);
    });

    it('连续导航到下一个', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
        <p><span class="not-only-translator-highlight">word3</span></p>
      `;

      manager.navigateToNext();
      const result = manager.navigateToNext();
      expect(result.index).toBe(1);
    });

    it('循环到第一个', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
      `;

      manager.navigateToNext();
      manager.navigateToNext();
      const result = manager.navigateToNext(); // 应该循环回第一个
      expect(result.index).toBe(0);
    });
  });

  describe('navigateToPrevious', () => {
    it('无元素返回 null', () => {
      const result = manager.navigateToPrevious();
      expect(result.element).toBeNull();
      expect(result.index).toBe(-1);
    });

    it('从末尾开始循环', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
      `;

      const result = manager.navigateToPrevious();
      expect(result.index).toBe(1);
    });

    it('导航到上一个', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
        <p><span class="not-only-translator-highlight">word3</span></p>
      `;

      manager.setCurrentIndex(2);
      const result = manager.navigateToPrevious();
      expect(result.index).toBe(1);
    });

    it('循环到最后一个', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
      `;

      manager.setCurrentIndex(0);
      const result = manager.navigateToPrevious();
      expect(result.index).toBe(1);
    });
  });

  describe('getCurrentElement', () => {
    it('返回当前索引的元素', () => {
      const el1 = document.createElement('span');
      const el2 = document.createElement('span');
      manager.setHighlights([el1, el2]);
      manager.setCurrentIndex(1);

      expect(manager.getCurrentElement()).toBe(el2);
    });

    it('无效索引返回 null', () => {
      expect(manager.getCurrentElement()).toBeNull();
    });
  });

  describe('highlightNavigationElement', () => {
    it('添加导航高亮类', () => {
      const el = document.createElement('span');
      document.body.appendChild(el);

      manager.highlightNavigationElement(el);
      expect(el.classList.contains('not-translator-nav-highlight')).toBe(true);
    });

    it('移除之前的导航高亮', () => {
      const el1 = document.createElement('span');
      const el2 = document.createElement('span');
      document.body.appendChild(el1);
      document.body.appendChild(el2);

      manager.highlightNavigationElement(el1);
      manager.highlightNavigationElement(el2);

      expect(el1.classList.contains('not-translator-nav-highlight')).toBe(false);
      expect(el2.classList.contains('not-translator-nav-highlight')).toBe(true);
    });
  });

  describe('showNavigationIndicator', () => {
    it('无 tooltip 时不报错', () => {
      expect(() => manager.showNavigationIndicator(0, 5)).not.toThrow();
    });

    it('在 tooltip 中创建指示器', () => {
      document.body.innerHTML = `
        <div id="not-translator-tooltip">
          <div class="not-translator-tooltip-content"></div>
        </div>
      `;

      manager.showNavigationIndicator(2, 10);

      const indicator = document.querySelector('.not-translator-nav-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator!.textContent).toBe('3 / 10');
    });

    it('更新已有指示器', () => {
      document.body.innerHTML = `
        <div id="not-translator-tooltip">
          <div class="not-translator-tooltip-content">
            <div class="not-translator-nav-indicator">1 / 5</div>
          </div>
        </div>
      `;

      manager.showNavigationIndicator(3, 10);

      const indicator = document.querySelector('.not-translator-nav-indicator');
      expect(indicator!.textContent).toBe('4 / 10');
    });

    it('指示器具有正确的 ARIA 属性', () => {
      document.body.innerHTML = `
        <div id="not-translator-tooltip">
          <div class="not-translator-tooltip-content"></div>
        </div>
      `;

      manager.showNavigationIndicator(0, 5);

      const indicator = document.querySelector('.not-translator-nav-indicator');
      expect(indicator!.getAttribute('role')).toBe('status');
      expect(indicator!.getAttribute('aria-live')).toBe('polite');
    });
  });

  describe('isNavigationKey', () => {
    it('识别导航键', () => {
      expect(manager.isNavigationKey('j')).toBe(true);
      expect(manager.isNavigationKey('J')).toBe(true);
      expect(manager.isNavigationKey('h')).toBe(true);
      expect(manager.isNavigationKey('H')).toBe(true);
      expect(manager.isNavigationKey('l')).toBe(true);
      expect(manager.isNavigationKey('L')).toBe(true);
      expect(manager.isNavigationKey('ArrowDown')).toBe(true);
      expect(manager.isNavigationKey('ArrowUp')).toBe(true);
    });

    it('非导航键返回 false', () => {
      expect(manager.isNavigationKey('a')).toBe(false);
      expect(manager.isNavigationKey('Enter')).toBe(false);
      expect(manager.isNavigationKey('Escape')).toBe(false);
    });
  });

  describe('handleNavigation', () => {
    it('j 键导航到下一个', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
      `;

      const result = manager.handleNavigation('j');
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('next');
      expect(result!.index).toBe(0);
    });

    it('h 键导航到上一个', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
        <p><span class="not-only-translator-highlight">word2</span></p>
      `;

      const result = manager.handleNavigation('h');
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('prev');
      expect(result!.index).toBe(1);
    });

    it('ArrowDown 导航到下一个', () => {
      document.body.innerHTML = `
        <p><span class="not-only-translator-highlight">word1</span></p>
      `;

      const result = manager.handleNavigation('ArrowDown');
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('next');
    });

    it('非导航键返回 null', () => {
      const result = manager.handleNavigation('a');
      expect(result).toBeNull();
    });

    it('无高亮元素返回 null', () => {
      const result = manager.handleNavigation('j');
      expect(result).toBeNull();
    });
  });

  describe('destroy', () => {
    it('清理导航高亮', () => {
      const el = document.createElement('span');
      el.classList.add('not-translator-nav-highlight');
      document.body.appendChild(el);

      manager.destroy();

      expect(el.classList.contains('not-translator-nav-highlight')).toBe(false);
    });

    it('移除导航指示器', () => {
      document.body.innerHTML = `
        <div id="not-translator-tooltip">
          <div class="not-translator-tooltip-content">
            <div class="not-translator-nav-indicator">1 / 5</div>
          </div>
        </div>
      `;

      manager.destroy();

      const indicator = document.querySelector('.not-translator-nav-indicator');
      expect(indicator).toBeNull();
    });

    it('重置状态', () => {
      manager.setHighlights([document.createElement('span')]);
      manager.setCurrentIndex(0);

      manager.destroy();

      expect(manager.getHighlights()).toEqual([]);
      expect(manager.getCurrentIndex()).toBe(-1);
    });
  });
});
