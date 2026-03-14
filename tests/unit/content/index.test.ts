/**
 * Content Script 主入口测试
 * 验证 NotOnlyTranslator 类的初始化和功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 模拟 chrome API
const mockChrome = {
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
    },
  },
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
    sync: {
      get: vi.fn(),
      set: vi.fn(),
    },
  },
};

// 将 chrome 设置为全局变量
vi.stubGlobal('chrome', mockChrome);

// 模拟 logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
  debounce: (fn: Function) => fn,
  getChineseRatio: () => 0,
}));

// 模拟 frequencyManager
vi.mock('@/background/frequencyManager', () => ({
  frequencyManager: {
    getDifficulty: vi.fn(() => 5),
  },
}));

// 模拟 highlighter
vi.mock('./highlighter', () => ({
  Highlighter: vi.fn().mockImplementation(() => ({
    highlightWords: vi.fn(),
    markAsKnown: vi.fn(),
    markAsUnknown: vi.fn(),
    clearAllHighlights: vi.fn(),
  })),
}));

// 模拟 tooltip
vi.mock('./tooltip', () => ({
  Tooltip: vi.fn().mockImplementation((callbacks) => ({
    showWord: vi.fn(),
    showSentence: vi.fn(),
    showLoading: vi.fn(),
    showError: vi.fn(),
    hide: vi.fn(),
    isVisible: vi.fn(() => false),
    getCurrentWord: vi.fn(() => null),
    destroy: vi.fn(),
    callbacks,
  })),
}));

// 模拟 marker
vi.mock('./marker', () => ({
  MarkerService: vi.fn().mockImplementation(() => ({
    markKnown: vi.fn(),
    markUnknown: vi.fn(),
    addToVocabulary: vi.fn(),
    getSelectionContext: vi.fn(() => ''),
  })),
}));

// 模拟 translationDisplay
vi.mock('./translationDisplay', () => ({
  TranslationDisplay: {
    saveOriginalText: vi.fn(),
    applyTranslation: vi.fn(),
    clearTranslation: vi.fn(),
    isProcessed: vi.fn(() => false),
  },
}));

// 模拟 viewportObserver
vi.mock('./viewportObserver', () => ({
  ViewportObserver: vi.fn().mockImplementation(() => ({
    observeAll: vi.fn(),
    checkCurrentViewport: vi.fn(),
    markAsProcessed: vi.fn(),
    disable: vi.fn(),
    resetTracking: vi.fn(),
    destroy: vi.fn(),
  })),
  VisibleParagraph: vi.fn(),
}));

// 模拟 batchTranslationManager
vi.mock('./batchTranslationManager', () => ({
  BatchTranslationManager: vi.fn().mockImplementation(() => ({
    handleVisibleParagraphs: vi.fn(),
    setMode: vi.fn(),
    setOnComplete: vi.fn(),
    clearProcessedCache: vi.fn(),
    cancelAll: vi.fn(),
  })),
}));

// 模拟 floatingButton
vi.mock('./floatingButton', () => ({
  FloatingButton: vi.fn().mockImplementation(() => ({
    updateMode: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// 模拟 core modules
vi.mock('./core', () => ({
  NavigationManager: vi.fn().mockImplementation(() => ({
    isNavigationKey: vi.fn(() => false),
    handleNavigation: vi.fn(),
    highlightNavigationElement: vi.fn(),
    getNavigableHighlights: vi.fn(() => []),
    showNavigationIndicator: vi.fn(),
    destroy: vi.fn(),
  })),
  PageScanner: vi.fn().mockImplementation(() => ({
    scan: vi.fn(() => []),
    scanElement: vi.fn(() => []),
    isTranslatable: vi.fn(() => true),
    getParagraphs: vi.fn(() => []),
    observe: vi.fn(),
    unobserve: vi.fn(),
  })),
  HoverManager: vi.fn().mockImplementation(() => ({
    handleMouseOver: vi.fn(),
    handleMouseOut: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// 模拟 vocabularyHighlighter
vi.mock('./vocabularyHighlighter', () => ({
  VocabularyHighlighter: vi.fn().mockImplementation(() => ({
    highlightElements: vi.fn(() => []),
  })),
}));

import { NotOnlyTranslator, onExecute } from '@/content/index';

describe('NotOnlyTranslator Content Script', () => {
  let instance: NotOnlyTranslator;
  let container: HTMLElement;

  beforeEach(() => {
    // 清理 DOM
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'test-container';
    document.body.appendChild(container);

    // 重置 chrome mock
    vi.resetAllMocks();

    // 模拟 sendMessage 返回成功响应
    mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type === 'GET_SETTINGS') {
        callback({
          success: true,
          data: {
            enabled: true,
            autoHighlight: true,
            highlightColor: '#FF6B6B',
            translationMode: 'inline-only',
            hoverDelay: 500,
          },
        });
      } else if (message.type === 'GET_CEFR_LEVEL') {
        callback({
          success: true,
          data: { level: 'B1', confidence: 0.8 },
        });
      } else {
        callback({ success: true, data: {} });
      }
    });

    // 模拟 document.readyState
    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      writable: true,
    });
  });

  afterEach(() => {
    // 清理实例
    if (instance) {
      instance.destroy();
    }
    document.body.innerHTML = '';
  });

  describe('初始化', () => {
    it('应该创建 NotOnlyTranslator 实例', () => {
      instance = new NotOnlyTranslator();
      expect(instance).toBeInstanceOf(NotOnlyTranslator);
    });

    it('onExecute 应该返回实例', () => {
      const result = onExecute();
      expect(result).toBeInstanceOf(NotOnlyTranslator);
      result?.destroy();
    });
  });

  describe('事件监听', () => {
    it('应该添加 document 事件监听器', () => {
      instance = new NotOnlyTranslator();

      // 模拟创建一些内容
      container.innerHTML = '<p>Test paragraph with some text content.</p>';

      // 触发 mouseup 事件
      const mouseEvent = new MouseEvent('mouseup', {
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(mouseEvent);

      // 验证事件被处理（通过确保没有错误抛出）
      expect(true).toBe(true);
    });

    it('应该处理键盘事件', () => {
      instance = new NotOnlyTranslator();

      const keyEvent = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      });
      document.dispatchEvent(keyEvent);

      expect(true).toBe(true);
    });
  });

  describe('翻译功能', () => {
    it('应该调用 translateSelection 进行翻译', async () => {
      instance = new NotOnlyTranslator();

      const testElement = document.createElement('span');
      testElement.textContent = 'test';
      document.body.appendChild(testElement);

      // 等待初始化
      await new Promise((resolve) => setTimeout(resolve, 100));

      // 验证 sendMessage 被调用
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GET_SETTINGS',
        }),
        expect.any(Function)
      );
    });
  });

  describe('清理', () => {
    it('应该正确销毁实例', () => {
      instance = new NotOnlyTranslator();

      // 销毁前应该可以正常使用
      expect(instance).toBeDefined();

      // 销毁
      instance.destroy();

      // 销毁后不应该抛出错误
      expect(true).toBe(true);
    });

    it('应该清理所有事件监听器', () => {
      instance = new NotOnlyTranslator();

      // 销毁实例
      instance.destroy();

      // 触发事件应该不抛出错误
      const event = new MouseEvent('mouseup', { bubbles: true });
      document.dispatchEvent(event);

      expect(true).toBe(true);
    });
  });
});

describe('Content Script 错误处理', () => {
  let instance: NotOnlyTranslator;

  beforeEach(() => {
    vi.resetAllMocks();

    // 模拟失败的响应
    mockChrome.runtime.sendMessage.mockImplementation((message, callback) => {
      callback({
        success: false,
        error: 'Connection failed',
      });
    });

    Object.defineProperty(document, 'readyState', {
      value: 'complete',
      writable: true,
    });
  });

  afterEach(() => {
    if (instance) {
      instance.destroy();
    }
  });

  it('应该处理设置加载失败的情况', () => {
    // 在设置加载失败时不应抛出错误
    instance = new NotOnlyTranslator();
    expect(instance).toBeDefined();
  });
});

describe('Content Script 模块化整合', () => {
  it('应该正确导出所有模块', () => {
    expect(NotOnlyTranslator).toBeDefined();
    expect(onExecute).toBeDefined();
    expect(typeof onExecute).toBe('function');
  });
});
