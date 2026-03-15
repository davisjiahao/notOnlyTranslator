import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Tooltip } from '@/content/tooltip';
import { CSS_CLASSES } from '@/shared/constants';
import type { TranslatedWord, TranslatedSentence } from '@/shared/types';

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Tooltip', () => {
  let tooltip: Tooltip;
  let mockCallbacks: {
    onMarkKnown: ReturnType<typeof vi.fn>;
    onMarkUnknown: ReturnType<typeof vi.fn>;
    onAddToVocabulary: ReturnType<typeof vi.fn>;
  };
  let mockTarget: HTMLElement;

  beforeEach(() => {
    // Setup fake timers for timer-related tests
    vi.useFakeTimers();

    // Setup DOM
    document.body.innerHTML = '';

    // Create mock callbacks
    mockCallbacks = {
      onMarkKnown: vi.fn(),
      onMarkUnknown: vi.fn(),
      onAddToVocabulary: vi.fn(),
    };

    // Create tooltip instance
    tooltip = new Tooltip(mockCallbacks);

    // Create mock target element
    mockTarget = document.createElement('span');
    mockTarget.className = CSS_CLASSES.HIGHLIGHT;
    mockTarget.textContent = 'serendipity';
    document.body.appendChild(mockTarget);
  });

  afterEach(() => {
    tooltip.destroy();
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should create tooltip element on initialization', () => {
      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl).not.toBeNull();
      expect(tooltipEl?.classList.contains(CSS_CLASSES.TOOLTIP)).toBe(true);
    });

    it('should reuse existing tooltip element if already exists', () => {
      // Create second tooltip instance
      const tooltip2 = new Tooltip(mockCallbacks);

      const tooltipEls = document.querySelectorAll(`#not-translator-tooltip`);
      expect(tooltipEls.length).toBe(1);

      tooltip2.destroy();
    });

    it('should create help panel on initialization', () => {
      const helpPanel = document.querySelector('.not-translator-help-panel');
      expect(helpPanel).not.toBeNull();
      expect((helpPanel as HTMLElement)?.style.display).toBe('none');
    });
  });

  describe('showWord', () => {
    const mockWordData: TranslatedWord = {
      original: 'serendipity',
      translation: '意外发现美好事物的能力',
      position: [10, 20],
      difficulty: 8,
      isPhrase: false,
    };

    it('should display word tooltip with translation and difficulty', () => {
      tooltip.showWord(mockTarget, mockWordData);

      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl?.classList.contains(CSS_CLASSES.TOOLTIP_VISIBLE)).toBe(true);

      // Check content
      const content = tooltipEl?.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).toContain('serendipity');
      expect(content?.textContent).toContain('意外发现美好事物的能力');
      expect(content?.textContent).toContain('困难');
    });

    it('should display correct difficulty labels', () => {
      // Easy difficulty (<=3)
      tooltip.showWord(mockTarget, { ...mockWordData, difficulty: 2 });
      const content1 = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content1?.textContent).toContain('简单');

      tooltip.hide();

      // Medium difficulty (4-6)
      tooltip.showWord(mockTarget, { ...mockWordData, difficulty: 5 });
      const content2 = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content2?.textContent).toContain('中等');

      tooltip.hide();

      // Hard difficulty (>6)
      tooltip.showWord(mockTarget, { ...mockWordData, difficulty: 8 });
      const content3 = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content3?.textContent).toContain('困难');
    });

    it('should show phrase label for phrases', () => {
      tooltip.showWord(mockTarget, { ...mockWordData, isPhrase: true });

      const content = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).toContain('短语');
    });

    it('should have action buttons (mark known, mark unknown, add to vocabulary)', () => {
      tooltip.showWord(mockTarget, mockWordData);

      const knownBtn = document.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.known`);
      const unknownBtn = document.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.unknown`);
      const addBtn = document.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.add`);

      expect(knownBtn).not.toBeNull();
      expect(unknownBtn).not.toBeNull();
      expect(addBtn).not.toBeNull();

      expect(knownBtn?.textContent).toContain('认识');
      expect(unknownBtn?.textContent).toContain('不认识');
      expect(addBtn?.textContent).toContain('加入生词本');
    });

    it('should trigger onMarkKnown callback when known button clicked', () => {
      tooltip.showWord(mockTarget, mockWordData);

      const knownBtn = document.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.known`) as HTMLElement;
      knownBtn?.click();

      expect(mockCallbacks.onMarkKnown).toHaveBeenCalledWith('serendipity');
    });

    it('should trigger onMarkUnknown callback when unknown button clicked', () => {
      tooltip.showWord(mockTarget, mockWordData);

      const unknownBtn = document.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.unknown`) as HTMLElement;
      unknownBtn?.click();

      expect(mockCallbacks.onMarkUnknown).toHaveBeenCalledWith('serendipity', '意外发现美好事物的能力');
    });

    it('should trigger onAddToVocabulary callback when add button clicked', () => {
      tooltip.showWord(mockTarget, mockWordData);

      const addBtn = document.querySelector(`.${CSS_CLASSES.MARK_BUTTON}.add`) as HTMLElement;
      addBtn?.click();

      expect(mockCallbacks.onAddToVocabulary).toHaveBeenCalledWith('serendipity', '意外发现美好事物的能力');
    });
  });

  describe('showSentence', () => {
    const mockSentenceData: TranslatedSentence = {
      original: 'The quick brown fox jumps over the lazy dog.',
      translation: '那只敏捷的棕色狐狸跳过了那只懒狗。',
      grammarNote: '这是一个包含所有26个字母的英语句子。',
    };

    it('should display sentence translation', () => {
      tooltip.showSentence(mockTarget, mockSentenceData);

      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl?.classList.contains(CSS_CLASSES.TOOLTIP_VISIBLE)).toBe(true);

      const content = tooltipEl?.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).toContain('句子翻译');
      expect(content?.textContent).toContain('那只敏捷的棕色狐狸跳过了那只懒狗。');
    });

    it('should display grammar note when present', () => {
      tooltip.showSentence(mockTarget, mockSentenceData);

      const content = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).toContain('语法说明');
      expect(content?.textContent).toContain('这是一个包含所有26个字母的英语句子。');
    });

    it('should not display grammar section when grammarNote is absent', () => {
      tooltip.showSentence(mockTarget, {
        ...mockSentenceData,
        grammarNote: undefined,
      });

      const content = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).not.toContain('语法说明');
    });
  });

  describe('showGrammar', () => {
    const mockGrammarData = {
      original: 'Had I known',
      explanation: '这是虚拟语气的倒装结构，表示与过去事实相反的假设',
      type: '虚拟语气',
      position: [0, 11] as [number, number],
    };

    it('should display grammar explanation', () => {
      tooltip.showGrammar(mockTarget, mockGrammarData);

      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl?.classList.contains(CSS_CLASSES.TOOLTIP_VISIBLE)).toBe(true);

      const content = tooltipEl?.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).toContain('虚拟语气');
      expect(content?.textContent).toContain('Had I known');
      expect(content?.textContent).toContain('这是虚拟语气的倒装结构');
    });
  });

  describe('showLoading', () => {
    it('should display loading state', () => {
      tooltip.showLoading(mockTarget);

      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl?.classList.contains(CSS_CLASSES.TOOLTIP_VISIBLE)).toBe(true);

      const content = tooltipEl?.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).toContain('正在翻译');
    });
  });

  describe('showError', () => {
    it('should display error message', () => {
      tooltip.showError(mockTarget, '翻译服务暂时不可用');

      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl?.classList.contains(CSS_CLASSES.TOOLTIP_VISIBLE)).toBe(true);

      const content = tooltipEl?.querySelector(`.${CSS_CLASSES.TOOLTIP}-content`);
      expect(content?.textContent).toContain('翻译服务暂时不可用');
    });
  });

  describe('hide', () => {
    it('should hide the tooltip', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      expect(tooltip.isVisible()).toBe(true);

      tooltip.hide();

      expect(tooltip.isVisible()).toBe(false);
      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl?.classList.contains(CSS_CLASSES.TOOLTIP_VISIBLE)).toBe(false);
    });

    it('should reset pinned state on hide', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      tooltip.togglePin();
      expect(tooltip.getPinned()).toBe(true);

      tooltip.hide();
      expect(tooltip.getPinned()).toBe(false);
    });

    it('should hide help panel when tooltip is hidden', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      // Show help panel
      const helpBtn = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-help`) as HTMLElement;
      helpBtn?.click();

      const helpPanel = document.querySelector('.not-translator-help-panel') as HTMLElement;
      expect(helpPanel?.style.display).toBe('block');

      tooltip.hide();
      expect(helpPanel?.style.display).toBe('none');
    });
  });

  describe('pin functionality', () => {
    beforeEach(() => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });
    });

    it('should toggle pin state', () => {
      expect(tooltip.getPinned()).toBe(false);

      tooltip.togglePin();
      expect(tooltip.getPinned()).toBe(true);

      tooltip.togglePin();
      expect(tooltip.getPinned()).toBe(false);
    });

    it('should update pin button visual state', () => {
      tooltip.togglePin();

      const pinBtn = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-pin`) as HTMLElement;
      expect(pinBtn?.classList.contains('pinned')).toBe(true);
      expect(pinBtn?.textContent).toContain('📍');
    });

    it('should reset pin state when showing new word', () => {
      tooltip.togglePin();
      expect(tooltip.getPinned()).toBe(true);

      tooltip.showWord(mockTarget, {
        original: 'another',
        translation: '另一个',
        position: [0, 7],
        difficulty: 3,
        isPhrase: false,
      });

      expect(tooltip.getPinned()).toBe(false);
    });
  });

  describe('help panel', () => {
    it('should show help panel when help button clicked', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      const helpBtn = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-help`) as HTMLElement;
      helpBtn?.click();

      const helpPanel = document.querySelector('.not-translator-help-panel') as HTMLElement;
      expect(helpPanel?.style.display).toBe('block');
    });

    it('should hide help panel when close button clicked', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      // Show help panel
      const helpBtn = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-help`) as HTMLElement;
      helpBtn?.click();

      // Hide help panel
      const closeBtn = document.querySelector('.not-translator-help-close') as HTMLElement;
      closeBtn?.click();

      const helpPanel = document.querySelector('.not-translator-help-panel') as HTMLElement;
      expect(helpPanel?.style.display).toBe('none');
    });

    it('should toggle help panel visibility', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      const helpBtn = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-help`) as HTMLElement;
      const helpPanel = document.querySelector('.not-translator-help-panel') as HTMLElement;

      // First click - show
      helpBtn?.click();
      expect(helpPanel?.style.display).toBe('block');

      // Second click - hide
      helpBtn?.click();
      expect(helpPanel?.style.display).toBe('none');
    });
  });

  describe('positioning', () => {
    it('should position tooltip near target element', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl?.style.top).not.toBe('');
      expect(tooltipEl?.style.left).not.toBe('');
    });
  });

  describe('close button', () => {
    it('should hide tooltip when close button clicked', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      const closeBtn = document.querySelector(`.${CSS_CLASSES.TOOLTIP}-close`) as HTMLElement;
      closeBtn?.click();

      expect(tooltip.isVisible()).toBe(false);
    });
  });

  describe('isVisible', () => {
    it('should return false when tooltip is hidden', () => {
      expect(tooltip.isVisible()).toBe(false);
    });

    it('should return true when tooltip is shown', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      expect(tooltip.isVisible()).toBe(true);
    });
  });

  describe('getCurrentWord', () => {
    it('should return null when no word is displayed', () => {
      expect(tooltip.getCurrentWord()).toBeNull();
    });

    it('should return current word when tooltip is shown', () => {
      tooltip.showWord(mockTarget, {
        original: 'serendipity',
        translation: '意外发现',
        position: [0, 11],
        difficulty: 8,
        isPhrase: false,
      });

      expect(tooltip.getCurrentWord()).toBe('serendipity');
    });

    it('should return null for sentence translations', () => {
      tooltip.showSentence(mockTarget, {
        original: 'Hello world',
        translation: '你好世界',
      });

      expect(tooltip.getCurrentWord()).toBeNull();
    });
  });

  describe('destroy', () => {
    it('should remove tooltip element from DOM', () => {
      tooltip.destroy();

      const tooltipEl = document.getElementById('not-translator-tooltip');
      expect(tooltipEl).toBeNull();
    });

    it('should remove help panel from DOM', () => {
      tooltip.destroy();

      const helpPanel = document.querySelector('.not-translator-help-panel');
      expect(helpPanel).toBeNull();
    });

    it('should clean up event listeners', () => {
      tooltip.destroy();

      // Should not throw when triggering events after destroy
      expect(() => {
        document.dispatchEvent(new Event('click'));
        document.dispatchEvent(new Event('scroll'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      }).not.toThrow();
    });

    it('should clear any pending timeouts', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      tooltip.destroy();

      // Fast-forward time - should not cause any issues
      vi.advanceTimersByTime(1000);
    });
  });

  describe('keyboard shortcuts', () => {
    it('should hide on Escape key', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(tooltip.isVisible()).toBe(false);
    });

    it('should trigger mark known on K key', () => {
      tooltip.showWord(mockTarget, {
        original: 'testword',
        translation: '测试词',
        position: [0, 8],
        difficulty: 5,
        isPhrase: false,
      });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));

      expect(mockCallbacks.onMarkKnown).toHaveBeenCalledWith('testword');
    });

    it('should trigger mark unknown on U key', () => {
      tooltip.showWord(mockTarget, {
        original: 'testword',
        translation: '测试词',
        position: [0, 8],
        difficulty: 5,
        isPhrase: false,
      });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'u' }));

      expect(mockCallbacks.onMarkUnknown).toHaveBeenCalledWith('testword', '测试词');
    });

    it('should trigger add to vocabulary on A key', () => {
      tooltip.showWord(mockTarget, {
        original: 'testword',
        translation: '测试词',
        position: [0, 8],
        difficulty: 5,
        isPhrase: false,
      });

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

      expect(mockCallbacks.onAddToVocabulary).toHaveBeenCalledWith('testword', '测试词');
    });

    it('should toggle pin on P key', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      expect(tooltip.getPinned()).toBe(false);

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));

      expect(tooltip.getPinned()).toBe(true);
    });

    it('should not process shortcuts when tooltip is not visible', () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));

      expect(mockCallbacks.onMarkKnown).not.toHaveBeenCalled();
    });

    it('should not process shortcuts when typing in input', () => {
      tooltip.showWord(mockTarget, {
        original: 'testword',
        translation: '测试词',
        position: [0, 8],
        difficulty: 5,
        isPhrase: false,
      });

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));

      expect(mockCallbacks.onMarkKnown).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });

  describe('click outside to close', () => {
    it('should hide tooltip when clicking outside highlighted word', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      // Click on document body (outside tooltip and highlight)
      document.body.click();

      expect(tooltip.isVisible()).toBe(false);
    });

    it('should not hide when tooltip is pinned', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      tooltip.togglePin();

      // Click outside
      document.body.click();

      expect(tooltip.isVisible()).toBe(true);
    });
  });

  describe('scroll handling', () => {
    it('should hide tooltip on scroll when not pinned', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      // Trigger scroll event
      document.dispatchEvent(new Event('scroll'));

      // Should hide after debounce (300ms)
      vi.advanceTimersByTime(350);

      expect(tooltip.isVisible()).toBe(false);
    });

    it('should not hide tooltip on scroll when pinned', () => {
      tooltip.showWord(mockTarget, {
        original: 'test',
        translation: '测试',
        position: [0, 4],
        difficulty: 5,
        isPhrase: false,
      });

      tooltip.togglePin();

      // Trigger scroll event
      document.dispatchEvent(new Event('scroll'));

      // Fast-forward time
      vi.advanceTimersByTime(350);

      expect(tooltip.isVisible()).toBe(true);
    });
  });
});
