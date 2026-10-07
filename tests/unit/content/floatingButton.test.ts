/**
 * FloatingButton 测试
 *
 * 覆盖浮动按钮创建、面板交互、模式/引擎切换、拖拽、最小化、销毁
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// jsdom 环境下 localStorage mock
const mockStorage: Record<string, string> = {};

import { FloatingButton } from '@/content/floatingButton';

describe('FloatingButton', () => {
  let onModeChange: ReturnType<typeof vi.fn>;
  let onEngineChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 清理 DOM
    document.body.innerHTML = '';
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
    });

    onModeChange = vi.fn();
    onEngineChange = vi.fn();

    // Mock window 尺寸
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, writable: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  describe('构造函数与 DOM 创建', () => {
    it('创建浮动按钮容器', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn');
      expect(btn).not.toBeNull();
      expect(btn!.className).toBe('not-translator-floating-btn');
    });

    it('按钮具有 ARIA 属性', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      expect(btn.getAttribute('role')).toBe('button');
      expect(btn.getAttribute('tabindex')).toBe('0');
      expect(btn.getAttribute('aria-label')).toBe('翻译模式切换');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('重复创建不会生成第二个按钮', () => {
      new FloatingButton(onModeChange);
      new FloatingButton(onModeChange);
      const btns = document.querySelectorAll('#not-translator-floating-btn');
      expect(btns.length).toBe(1);
    });

    it('按钮包含图标和文字', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      expect(btn.querySelector('.not-translator-floating-btn-icon')?.textContent).toBe('🌐');
      expect(btn.querySelector('.not-translator-floating-btn-text')?.textContent).toBe('翻译');
    });

    it('设置默认位置', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      expect(btn.style.left).toBe(`${1024 - 120}px`);
      expect(btn.style.top).toBe(`${768 - 80}px`);
    });

    it('从 localStorage 恢复位置', () => {
      mockStorage['not-translator-floating-btn-pos'] = JSON.stringify({ left: 100, top: 200 });
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      expect(btn.style.left).toBe('100px');
      expect(btn.style.top).toBe('200px');
    });

    it('恢复位置时限制边界', () => {
      mockStorage['not-translator-floating-btn-pos'] = JSON.stringify({ left: 9999, top: -50 });
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      // left 应被限制在 innerWidth - 80
      expect(parseInt(btn.style.left)).toBeLessThanOrEqual(1024 - 80);
      // top 应至少为 10
      expect(parseInt(btn.style.top)).toBeGreaterThanOrEqual(10);
    });
  });

  describe('面板创建', () => {
    it('创建面板但初始隐藏', () => {
      new FloatingButton(onModeChange);
      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.style.display).toBe('none');
    });

    it('面板包含三种翻译模式', () => {
      new FloatingButton(onModeChange);
      const items = document.querySelectorAll('.not-translator-floating-mode-item');
      expect(items.length).toBe(3);
    });

    it('面板包含三种翻译引擎', () => {
      new FloatingButton(onModeChange);
      const items = document.querySelectorAll('.not-translator-floating-engine-item');
      expect(items.length).toBe(3);
    });

    it('默认模式为 inline-only', () => {
      new FloatingButton(onModeChange);
      const activeItem = document.querySelector('.not-translator-floating-mode-item.active') as HTMLElement;
      expect(activeItem.dataset.mode).toBe('inline-only');
    });

    it('默认引擎为 hybrid', () => {
      new FloatingButton(onModeChange);
      const activeItem = document.querySelector('.not-translator-floating-engine-item.active') as HTMLElement;
      expect(activeItem.dataset.engine).toBe('hybrid');
    });

    it('面板具有 aria-pressed 属性', () => {
      new FloatingButton(onModeChange);
      const activeMode = document.querySelector('.not-translator-floating-mode-item.active')!;
      expect(activeMode.getAttribute('aria-pressed')).toBe('true');

      const inactiveMode = document.querySelector('.not-translator-floating-mode-item:not(.active)')!;
      expect(inactiveMode.getAttribute('aria-pressed')).toBe('false');
    });

    it('面板包含关闭和最小化按钮', () => {
      new FloatingButton(onModeChange);
      expect(document.querySelector('.not-translator-floating-panel-close')).not.toBeNull();
      expect(document.querySelector('.not-translator-floating-minimize')).not.toBeNull();
    });
  });

  describe('面板展开/收起', () => {
    it('点击按钮展开面板', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click();

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('block');
    });

    it('再次点击收起面板', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开
      btnInner.click(); // 收起

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('none');
    });

    it('展开时更新 aria-expanded', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click();

      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });

    it('收起时更新 aria-expanded', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开
      btnInner.click(); // 收起

      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    it('点击关闭按钮收起面板', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const closeBtn = document.querySelector('.not-translator-floating-panel-close') as HTMLElement;
      closeBtn.click();

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('none');
    });
  });

  describe('面板视口定位', () => {
    it.each([
      { name: '滚动后仍显示在按钮上方', viewport: [1024, 768], button: [500, 600], expected: [500, 290] },
      { name: '上方空间不足时显示在下方', viewport: [1024, 768], button: [500, 30], expected: [500, 80] },
      { name: '靠右时保留视口边距', viewport: [1024, 768], button: [950, 600], expected: [794, 290] },
      { name: '按钮超出左边界时面板不出现负坐标', viewport: [1024, 768], button: [-20, 600], expected: [10, 290] },
      { name: '上下空间均不足时限制在视口内', viewport: [320, 400], button: [250, 160], expected: [90, 90] },
      { name: '视口小于面板时保持左上方可见', viewport: [180, 200], button: [80, 100], expected: [10, 10] },
    ])('$name', ({ viewport, button, expected }) => {
      vi.stubGlobal('innerWidth', viewport[0]);
      vi.stubGlobal('innerHeight', viewport[1]);
      vi.stubGlobal('scrollX', 120);
      vi.stubGlobal('scrollY', 1600);
      const fb = new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      const buttonRect = vi.spyOn(btn, 'getBoundingClientRect')
        .mockReturnValue(new DOMRect(button[0], button[1], 80, 40));
      const panelRect = vi.spyOn(panel, 'getBoundingClientRect')
        .mockReturnValue(new DOMRect(0, 0, 220, 300));

      try {
        (btn.querySelector('.not-translator-floating-btn-inner') as HTMLElement).click();

        expect(panel.style.display).toBe('block');
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        expect(panel.style.top).toBe(`${expected[1]}px`);
        expect(panel.style.left).toBe(`${expected[0]}px`);
      } finally {
        buttonRect.mockRestore();
        panelRect.mockRestore();
        fb.destroy();
      }
    });
  });

  describe('键盘操作', () => {
    it('Enter 键展开面板', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('block');
    });

    it('Space 键展开面板', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('block');
    });

    it('Escape 键收起面板', () => {
      new FloatingButton(onModeChange);
      const btn = document.getElementById('not-translator-floating-btn')!;
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('none');
    });
  });

  describe('模式切换', () => {
    it('点击模式按钮触发 onModeChange', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const bilingualBtn = document.querySelector('[data-mode="bilingual"]') as HTMLElement;
      bilingualBtn.click();

      expect(onModeChange).toHaveBeenCalledWith('bilingual');
    });

    it('切换模式更新 active 状态', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const fullBtn = document.querySelector('[data-mode="full-translate"]') as HTMLElement;
      fullBtn.click();

      expect(fullBtn.classList.contains('active')).toBe(true);
      expect(fullBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('切换模式后面板自动收起', async () => {
      vi.useFakeTimers();
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const bilingualBtn = document.querySelector('[data-mode="bilingual"]') as HTMLElement;
      bilingualBtn.click();

      vi.advanceTimersByTime(300);

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('none');
      vi.useRealTimers();
    });
  });

  describe('引擎切换', () => {
    it('点击引擎按钮触发 onEngineChange', () => {
      new FloatingButton(onModeChange, onEngineChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const llmBtn = document.querySelector('[data-engine="llm"]') as HTMLElement;
      llmBtn.click();

      expect(onEngineChange).toHaveBeenCalledWith('llm');
    });

    it('切换引擎更新 active 状态', () => {
      new FloatingButton(onModeChange, onEngineChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const traditionalBtn = document.querySelector('[data-engine="traditional"]') as HTMLElement;
      traditionalBtn.click();

      expect(traditionalBtn.classList.contains('active')).toBe(true);
      expect(traditionalBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('无 onEngineChange 回调时不报错', () => {
      new FloatingButton(onModeChange); // 不传 engine 回调
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const llmBtn = document.querySelector('[data-engine="llm"]') as HTMLElement;
      expect(() => llmBtn.click()).not.toThrow();
    });

    it('setEngine 更新引擎状态', () => {
      const fb = new FloatingButton(onModeChange, onEngineChange);
      fb.setEngine('llm');

      const llmBtn = document.querySelector('[data-engine="llm"]') as HTMLElement;
      expect(llmBtn.classList.contains('active')).toBe(true);
      expect(llmBtn.getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('updateMode', () => {
    it('更新按钮文字', () => {
      const fb = new FloatingButton(onModeChange);
      fb.updateMode('bilingual');

      const btnText = document.querySelector('.not-translator-floating-btn-text')!;
      expect(btnText.textContent).toBe('对照');
    });

    it('更新面板选中状态', () => {
      const fb = new FloatingButton(onModeChange);
      fb.updateMode('full-translate');

      const activeItem = document.querySelector('.not-translator-floating-mode-item.active') as HTMLElement;
      expect(activeItem.dataset.mode).toBe('full-translate');
    });
  });

  describe('setBusy（翻译进行中状态，替代段落加载圈）', () => {
    const btnText = () => document.querySelector('.not-translator-floating-btn-text')!;
    const btn = () => document.getElementById('not-translator-floating-btn') as HTMLElement;

    it('初始状态不忙碌', () => {
      new FloatingButton(onModeChange);
      expect(btn().getAttribute('aria-busy')).toBe('false');
      expect(btnText().textContent).toBe('翻译'); // 构造时通用标签，updateMode 后才显示模式名
    });

    it('忙碌时显示翻译中并标记 aria-busy', () => {
      const fb = new FloatingButton(onModeChange);
      fb.updateMode('bilingual'); // 从默认模式切到对照，再进入忙碌
      fb.setBusy(true);
      expect(btnText().textContent).toBe('翻译中…');
      expect(btn().getAttribute('aria-busy')).toBe('true');
    });

    it('全部结束后恢复模式标签并清除 aria-busy', () => {
      const fb = new FloatingButton(onModeChange);
      fb.updateMode('bilingual');
      fb.setBusy(true);
      fb.setBusy(false);
      expect(btnText().textContent).toBe('对照');
      expect(btn().getAttribute('aria-busy')).toBe('false');
    });

    it('忙碌期间 updateMode 不覆盖进度文案，结束后恢复为最新模式', () => {
      const fb = new FloatingButton(onModeChange);
      fb.setBusy(true);
      fb.updateMode('full-translate'); // 忙碌中切换模式：面板状态更新，按钮文案保持进度
      expect(btnText().textContent).toBe('翻译中…');
      const activeItem = document.querySelector('.not-translator-floating-mode-item.active') as HTMLElement;
      expect(activeItem.dataset.mode).toBe('full-translate');

      fb.setBusy(false); // 取消/失败/完成统一收尾：恢复为最新模式标签
      expect(btnText().textContent).toBe('全文');
      expect(btn().getAttribute('aria-busy')).toBe('false');
    });
  });

  describe('显示/隐藏', () => {
    it('hide 隐藏按钮', () => {
      const fb = new FloatingButton(onModeChange);
      fb.hide();

      const btn = document.getElementById('not-translator-floating-btn') as HTMLElement;
      expect(btn.style.display).toBe('none');
    });

    it('show 显示按钮', () => {
      const fb = new FloatingButton(onModeChange);
      fb.hide();
      fb.show();

      const btn = document.getElementById('not-translator-floating-btn') as HTMLElement;
      expect(btn.style.display).toBe('block');
    });
  });

  describe('最小化', () => {
    it('点击最小化按钮进入最小化状态', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const minimizeBtn = document.querySelector('.not-translator-floating-minimize') as HTMLElement;
      minimizeBtn.click();

      const btn = document.getElementById('not-translator-floating-btn')!;
      expect(btn.classList.contains('minimized')).toBe(true);
    });

    it('最小化后面板收起', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const minimizeBtn = document.querySelector('.not-translator-floating-minimize') as HTMLElement;
      minimizeBtn.click();

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('none');
    });

    it('最小化后移动到右下角', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      const minimizeBtn = document.querySelector('.not-translator-floating-minimize') as HTMLElement;
      minimizeBtn.click();

      const btn = document.getElementById('not-translator-floating-btn') as HTMLElement;
      expect(btn.style.right).toBe('10px');
      expect(btn.style.bottom).toBe('10px');
    });
  });

  describe('销毁', () => {
    it('destroy 移除 DOM 元素', () => {
      const fb = new FloatingButton(onModeChange);
      fb.destroy();

      expect(document.getElementById('not-translator-floating-btn')).toBeNull();
    });

    it('destroy 后 show/hide 不报错', () => {
      const fb = new FloatingButton(onModeChange);
      fb.destroy();
      expect(() => {
        fb.show();
        fb.hide();
      }).not.toThrow();
    });

    it('destroy 清理事件监听器', () => {
      const fb = new FloatingButton(onModeChange);
      fb.destroy();

      // 点击 document 不应报错（外部点击监听器已清理）
      expect(() => document.body.click()).not.toThrow();
    });
  });

  describe('点击外部关闭面板', () => {
    it('点击面板外部收起面板', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      // 点击外部
      document.body.click();

      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      expect(panel.style.display).toBe('none');
    });

    it('点击面板内部不收起', () => {
      new FloatingButton(onModeChange);
      const btnInner = document.querySelector('.not-translator-floating-btn-inner') as HTMLElement;
      btnInner.click(); // 展开

      // 点击面板内部元素
      const panel = document.querySelector('.not-translator-floating-panel') as HTMLElement;
      panel.click();

      expect(panel.style.display).toBe('block');
    });
  });
});
