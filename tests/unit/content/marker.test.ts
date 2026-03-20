import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MarkerService, createMarkerService, type MarkerCallbacks, type MarkType } from '@/content/marker';
import { CSS_CLASSES } from '@/shared/constants';

// Mock chrome.runtime
const mockSendMessage = vi.fn();
(global as unknown as { chrome: typeof chrome }).chrome = {
  runtime: {
    sendMessage: mockSendMessage,
    lastError: null,
  },
} as typeof chrome;

describe('MarkerService', () => {
  let markerService: MarkerService;
  let mockCallbacks: MarkerCallbacks;

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = '';

    // Setup mock callbacks
    mockCallbacks = {
      onMarked: vi.fn(),
      onError: vi.fn(),
    };

    // Create marker service instance
    markerService = new MarkerService(mockCallbacks);

    // Reset mock
    mockSendMessage.mockReset();
    mockSendMessage.mockImplementation((message, callback) => {
      if (callback) callback({ success: true });
    });
  });

  afterEach(() => {
    markerService.clearAllMarks();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should create instance with callbacks', () => {
      expect(markerService).toBeInstanceOf(MarkerService);
    });

    it('should start with empty marked words', () => {
      expect(markerService.getMarkedCount()).toBe(0);
      expect(markerService.getAllMarkedWords()).toEqual([]);
    });
  });

  describe('markKnown', () => {
    it('should mark a word as known', async () => {
      await markerService.markKnown('hello');

      expect(markerService.isMarked('hello')).toBe(true);
      expect(markerService.getMarkStatus('hello')).toBe('known');
    });

    it('should call onMarked callback', async () => {
      await markerService.markKnown('hello');

      expect(mockCallbacks.onMarked).toHaveBeenCalledWith('hello', 'known');
    });

    it('should update UI when updateUI option is true', async () => {
      // Create a highlighted element
      const highlight = document.createElement('span');
      highlight.className = CSS_CLASSES.HIGHLIGHT;
      highlight.setAttribute('data-word', 'hello');
      document.body.appendChild(highlight);

      await markerService.markKnown('hello');

      expect(highlight.classList.contains(CSS_CLASSES.KNOWN)).toBe(true);
    });

    it('should not update UI when updateUI option is false', async () => {
      // Create a highlighted element
      const highlight = document.createElement('span');
      highlight.className = CSS_CLASSES.HIGHLIGHT;
      highlight.setAttribute('data-word', 'hello');
      document.body.appendChild(highlight);

      await markerService.markKnown('hello', { updateUI: false });

      expect(highlight.classList.contains(CSS_CLASSES.KNOWN)).toBe(false);
    });

    it('should send message to background when syncToBackground is true', async () => {
      await markerService.markKnown('hello');

      expect(mockSendMessage).toHaveBeenCalledWith(
        {
          type: 'MARK_WORD_KNOWN',
          payload: { word: 'hello' },
        },
        expect.any(Function)
      );
    });

    it('should not send message when syncToBackground is false', async () => {
      await markerService.markKnown('hello', { syncToBackground: false });

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('should call onError callback when sync fails', async () => {
      mockSendMessage.mockImplementation((message, callback) => {
        if (callback) {
          callback({ success: false, error: 'Sync failed' });
        }
      });

      await markerService.markKnown('hello');

      expect(mockCallbacks.onError).toHaveBeenCalled();
    });
  });

  describe('markUnknown', () => {
    it('should mark a word as unknown', async () => {
      await markerService.markUnknown('difficult');

      expect(markerService.isMarked('difficult')).toBe(true);
      expect(markerService.getMarkStatus('difficult')).toBe('unknown');
    });

    it('should call onMarked callback', async () => {
      await markerService.markUnknown('difficult');

      expect(mockCallbacks.onMarked).toHaveBeenCalledWith('difficult', 'unknown');
    });

    it('should include translation when provided', async () => {
      await markerService.markUnknown('difficult', '困难的');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            entry: expect.objectContaining({
              word: 'difficult',
              translation: '困难的',
            }),
          }),
        }),
        expect.any(Function)
      );
    });

    it('should include context when provided', async () => {
      await markerService.markUnknown('difficult', '困难的', {
        context: 'This is a difficult problem.',
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            entry: expect.objectContaining({
              context: 'This is a difficult problem.',
            }),
          }),
        }),
        expect.any(Function)
      );
    });

    it('should update UI when updateUI option is true', async () => {
      const highlight = document.createElement('span');
      highlight.className = CSS_CLASSES.HIGHLIGHT;
      highlight.setAttribute('data-word', 'difficult');
      document.body.appendChild(highlight);

      await markerService.markUnknown('difficult');

      expect(highlight.classList.contains(CSS_CLASSES.UNKNOWN)).toBe(true);
    });
  });

  describe('batchMark', () => {
    it('should mark multiple words at once', async () => {
      const words = ['word1', 'word2', 'word3'];

      await markerService.batchMark(words, 'known');

      expect(markerService.getMarkedCount()).toBe(3);
      words.forEach(word => {
        expect(markerService.getMarkStatus(word)).toBe('known');
      });
    });

    it('should call onMarked for each word', async () => {
      const words = ['word1', 'word2'];

      await markerService.batchMark(words, 'unknown');

      expect(mockCallbacks.onMarked).toHaveBeenCalledTimes(2);
      expect(mockCallbacks.onMarked).toHaveBeenCalledWith('word1', 'unknown');
      expect(mockCallbacks.onMarked).toHaveBeenCalledWith('word2', 'unknown');
    });

    it('should update UI for all words', async () => {
      const words = ['word1', 'word2'];

      words.forEach(word => {
        const highlight = document.createElement('span');
        highlight.className = CSS_CLASSES.HIGHLIGHT;
        highlight.setAttribute('data-word', word);
        document.body.appendChild(highlight);
      });

      await markerService.batchMark(words, 'known');

      words.forEach(word => {
        const highlight = document.querySelector(`[data-word="${word}"]`);
        expect(highlight?.classList.contains(CSS_CLASSES.KNOWN)).toBe(true);
      });
    });
  });

  describe('word status queries', () => {
    beforeEach(async () => {
      await markerService.markKnown('knownword');
      await markerService.markUnknown('unknownword');
    });

    it('should check if word is marked', () => {
      expect(markerService.isMarked('knownword')).toBe(true);
      expect(markerService.isMarked('unknownword')).toBe(true);
      expect(markerService.isMarked('notmarked')).toBe(false);
    });

    it('should get mark status', () => {
      expect(markerService.getMarkStatus('knownword')).toBe('known');
      expect(markerService.getMarkStatus('unknownword')).toBe('unknown');
      expect(markerService.getMarkStatus('notmarked')).toBeUndefined();
    });

    it('should get marked count', () => {
      expect(markerService.getMarkedCount()).toBe(2);
    });

    it('should get all marked words', () => {
      const allMarked = markerService.getAllMarkedWords();
      expect(allMarked).toHaveLength(2);
      expect(allMarked).toContainEqual({ word: 'knownword', type: 'known' });
      expect(allMarked).toContainEqual({ word: 'unknownword', type: 'unknown' });
    });

    it('should be case insensitive', () => {
      expect(markerService.isMarked('KNOWNWORD')).toBe(true);
      expect(markerService.isMarked('KnownWord')).toBe(true);
      expect(markerService.getMarkStatus('KNOWNWORD')).toBe('known');
    });
  });

  describe('unmark', () => {
    beforeEach(async () => {
      await markerService.markKnown('testword');
    });

    it('should remove mark from word', () => {
      expect(markerService.isMarked('testword')).toBe(true);

      markerService.unmark('testword');

      expect(markerService.isMarked('testword')).toBe(false);
      expect(markerService.getMarkStatus('testword')).toBeUndefined();
    });

    it('should remove UI styling', () => {
      const highlight = document.createElement('span');
      highlight.className = `${CSS_CLASSES.HIGHLIGHT} ${CSS_CLASSES.KNOWN}`;
      highlight.setAttribute('data-word', 'testword');
      document.body.appendChild(highlight);

      markerService.unmark('testword');

      expect(highlight.classList.contains(CSS_CLASSES.KNOWN)).toBe(false);
    });

    it('should be case insensitive', () => {
      markerService.unmark('TESTWORD');

      expect(markerService.isMarked('testword')).toBe(false);
    });
  });

  describe('clearAllMarks', () => {
    beforeEach(async () => {
      await markerService.markKnown('word1');
      await markerService.markUnknown('word2');
    });

    it('should clear all marked words', () => {
      expect(markerService.getMarkedCount()).toBe(2);

      markerService.clearAllMarks();

      expect(markerService.getMarkedCount()).toBe(0);
      expect(markerService.isMarked('word1')).toBe(false);
      expect(markerService.isMarked('word2')).toBe(false);
    });

    it('should clear pending sync', async () => {
      // Start a sync operation
      const syncPromise = markerService.markKnown('word3');

      // Clear before sync completes
      markerService.clearAllMarks();

      // Wait for sync to complete
      await syncPromise;

      // All should be cleared
      expect(markerService.getMarkedCount()).toBe(0);
    });
  });

  describe('getSelectionContext', () => {
    it('应该返回空字符串当没有选中文本时', () => {
      const context = markerService.getSelectionContext();
      expect(context).toBe('');
    });

    it('应该返回选中文本的上下文', () => {
      // 创建一个包含文本的元素
      const container = document.createElement('div');
      container.textContent = 'This is a test sentence for context extraction.';
      document.body.appendChild(container);

      // 模拟选中文本
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(container);
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const context = markerService.getSelectionContext();
      expect(context.length).toBeGreaterThan(0);
    });
  });

  describe('addToVocabulary', () => {
    it('应该添加单词到词汇表', async () => {
      await markerService.addToVocabulary('test', '测试', 'This is a test.');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'ADD_TO_VOCABULARY',
          payload: expect.objectContaining({
            entry: expect.objectContaining({
              word: 'test',
              translation: '测试',
              context: 'This is a test.',
            }),
          }),
        }),
        expect.any(Function)
      );
    });

    it('应该处理添加失败的情况', async () => {
      mockSendMessage.mockImplementationOnce((message, callback) => {
        if (callback) callback({ success: false, error: 'Failed to add' });
      });

      await markerService.addToVocabulary('test', '测试', 'context');

      expect(mockCallbacks.onError).toHaveBeenCalledWith('test', 'Failed to add');
    });

    it('应该处理发送消息异常', async () => {
      mockSendMessage.mockImplementationOnce(() => {
        throw new Error('Network error');
      });

      await markerService.addToVocabulary('test', '测试', 'context');

      expect(mockCallbacks.onError).toHaveBeenCalledWith('test', 'Error: Network error');
    });
  });

  describe('sendMessage error handling', () => {
    it('应该处理 chrome.runtime.lastError', async () => {
      // 设置 lastError
      (chrome as unknown as { runtime: { lastError: { message: string } | null } }).runtime.lastError = {
        message: 'Extension context invalidated',
      };

      mockSendMessage.mockImplementationOnce((message, callback) => {
        if (callback) callback(undefined);
      });

      // 尝试标记单词
      await markerService.markKnown('error-test');

      // 清理
      (chrome as unknown as { runtime: { lastError: { message: string } | null } }).runtime.lastError = null;
    });
  });
});

describe('createMarkerService', () => {
  it('应该创建 MarkerService 实例', () => {
    const service = createMarkerService();
    expect(service).toBeInstanceOf(MarkerService);
  });

  it('应该传递回调函数', () => {
    const callbacks: MarkerCallbacks = {
      onMarked: vi.fn(),
      onError: vi.fn(),
    };
    const service = createMarkerService(callbacks);
    expect(service).toBeInstanceOf(MarkerService);
  });
});
