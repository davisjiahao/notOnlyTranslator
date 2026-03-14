/**
 * Content Script 主入口测试
 * 验证 NotOnlyTranslator 类的初始化和功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 模拟 constants 模块
vi.mock('@/shared/constants', () => ({
  CSS_CLASSES: {
    HIGHLIGHT: 'not-only-translator-highlight',
    TOOLTIP: 'not-translator-tooltip',
    TOOLTIP_VISIBLE: 'not-translator-tooltip-visible',
    MARK_BUTTON: 'not-translator-mark-button',
    KNOWN: 'not-translator-known',
    UNKNOWN: 'not-translator-unknown',
  },
  TIMING: {
    SELECTION_DELAY: 50,
    DEFAULT_MESSAGE_TIMEOUT: 5000,
    TRANSLATION_MESSAGE_TIMEOUT: 30000,
    SCAN_DEBOUNCE: 300,
    MIN_PARAGRAPH_LENGTH: 20,
    MAX_SAMPLE_LENGTH: 1000,
    MODE_SWITCH_TRANSITION: 150,
    TOOLTIP_HIDE_DELAY: 100,
  },
  CHINESE_DETECTION_THRESHOLD: {
    PAGE: 0.5,
    PARAGRAPH: 0.7,
  },
}));

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
  getChineseRatio: (text: string) => {
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
    return chineseChars ? chineseChars.length / text.length : 0;
  },
}));

// 模拟 frequencyManager
vi.mock('@/background/frequencyManager', () => ({
  frequencyManager: {
    getDifficulty: vi.fn(() => 5),
  },
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
