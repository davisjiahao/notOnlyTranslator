/**
 * BatchTranslationManager 测试
 *
 * 覆盖段落队列、批量提取、并发请求、结果分发、取消操作
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchTranslationManager } from '@/content/batchTranslationManager';
import type { VisibleParagraph } from '@/content/viewportObserver';

const mockShowLoading = vi.fn();
const mockRemoveLoading = vi.fn();
const mockSaveOriginalText = vi.fn();
const mockApplyTranslation = vi.fn();

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/shared/constants', () => ({
  DEFAULT_BATCH_CONFIG: {
    maxParagraphsPerBatch: 3,
    maxCharsPerBatch: 100,
    debounceDelay: 0,
  },
}));

vi.mock('@/content/translationDisplay', () => ({
  TranslationDisplay: {
    showLoading: (...args: any[]) => mockShowLoading(...args),
    removeLoading: (...args: any[]) => mockRemoveLoading(...args),
    saveOriginalText: (...args: any[]) => mockSaveOriginalText(...args),
    applyTranslation: (...args: any[]) => mockApplyTranslation(...args),
  },
}));

function createVisibleParagraph(overrides: Partial<VisibleParagraph> = {}): VisibleParagraph {
  const el = document.createElement('p');
  el.id = overrides.id || `para-${Math.random().toString(36).slice(2)}`;
  document.body.appendChild(el);
  return {
    id: el.id,
    element: el,
    text: 'This is a test paragraph with enough words',
    elementPath: '',
    rect: { top: 0, left: 0, width: 100, height: 20 },
    ...overrides,
  };
}

function mockSendMessage(response: any) {
  (global as any).chrome = {
    runtime: {
      sendMessage: vi.fn((_msg: any, callback: (r: any) => void) => {
        setTimeout(() => callback(response), 0);
      }),
      lastError: undefined,
    },
  };
}

describe('BatchTranslationManager', () => {
  let manager: BatchTranslationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    manager = new BatchTranslationManager();
    mockSendMessage({
      success: true,
      data: {
        results: [],
      },
    });
  });

  describe('handleVisibleParagraphs', () => {
    it('发送批次时不持久化路径及查询令牌', async () => {
      window.history.replaceState(null, '', '/private/SECRET_PATH?key=SECRET_QUERY#draft');
      try {
        manager = new BatchTranslationManager();
        await manager.handleVisibleParagraphs([createVisibleParagraph()]);

        await vi.waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'BATCH_TRANSLATE_TEXT',
            payload: expect.objectContaining({ pageUrl: window.location.origin }),
          }),
          expect.any(Function)
        ));
      } finally {
        window.history.replaceState(null, '', '/');
      }
    });

    it('空段落列表不处理', async () => {
      await manager.handleVisibleParagraphs([]);
      expect(manager.getProcessingCount()).toBe(0);
    });

    it('添加段落到处理队列', async () => {
      const paragraphs = [createVisibleParagraph()];
      await manager.handleVisibleParagraphs(paragraphs);

      expect(manager.isProcessing(paragraphs[0].id)).toBe(true);
      expect(manager.getProcessingCount()).toBe(1);
    });

    it('过滤已在处理中的段落', async () => {
      const p = createVisibleParagraph();
      await manager.handleVisibleParagraphs([p]);
      const count1 = manager.getProcessingCount();

      await manager.handleVisibleParagraphs([p]);
      const count2 = manager.getProcessingCount();

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it('过滤已翻译过的段落', async () => {
      const p = createVisibleParagraph();
      p.element.classList.add('not-translator-processed');

      await manager.handleVisibleParagraphs([p]);
      expect(manager.getProcessingCount()).toBe(0);
    });
  });

  describe('isProcessing / getProcessingCount', () => {
    it('检查段落是否正在处理', async () => {
      const p = createVisibleParagraph();
      expect(manager.isProcessing(p.id)).toBe(false);

      await manager.handleVisibleParagraphs([p]);
      expect(manager.isProcessing(p.id)).toBe(true);
    });

    it('获取处理中的段落数量', async () => {
      const paragraphs = [createVisibleParagraph(), createVisibleParagraph()];
      await manager.handleVisibleParagraphs(paragraphs);

      expect(manager.getProcessingCount()).toBe(2);
    });
  });

  describe('setMode / setSettings / setOnComplete', () => {
    it('设置翻译模式', () => {
      manager.setMode('bilingual');
      // 通过内部行为间接验证：无异常即通过
      expect(() => manager.setMode('inline-only')).not.toThrow();
    });

    it('设置用户设置', () => {
      const settings = { phraseTranslationEnabled: false } as any;
      expect(() => manager.setSettings(settings)).not.toThrow();
    });

    it('设置完成回调', async () => {
      const callback = vi.fn();
      manager.setOnComplete(callback);

      const p = createVisibleParagraph();
      mockSendMessage({
        success: true,
        data: {
          results: [{
            id: p.id,
            result: {
              words: [{ word: 'test', translation: '测试', level: 'A1' }],
              fullText: '测试全文',
            },
          }],
        },
      });

      await manager.handleVisibleParagraphs([p]);
      // 等待异步处理完成
      await new Promise(r => setTimeout(r, 50));

      // 回调应在结果被分发后调用
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('cancelAll', () => {
    it('清除所有待处理请求', async () => {
      const paragraphs = [createVisibleParagraph(), createVisibleParagraph()];
      await manager.handleVisibleParagraphs(paragraphs);
      expect(manager.getProcessingCount()).toBe(2);

      manager.cancelAll();
      expect(manager.getProcessingCount()).toBe(0);
    });
  });

  describe('cancelOffscreenParagraphs', () => {
    it('取消不在视口内的段落', async () => {
      const p1 = createVisibleParagraph({ id: 'visible-1' });
      const p2 = createVisibleParagraph({ id: 'offscreen-1' });

      await manager.handleVisibleParagraphs([p1, p2]);
      expect(manager.getProcessingCount()).toBe(2);

      manager.cancelOffscreenParagraphs(new Set(['visible-1']));
      // offscreen-1 被取消，但 visible-1 仍在处理中
      expect(manager.isProcessing('visible-1')).toBe(true);
      expect(manager.isProcessing('offscreen-1')).toBe(false);
    });

    it('空集合取消所有段落', async () => {
      const p = createVisibleParagraph();
      await manager.handleVisibleParagraphs([p]);
      expect(manager.getProcessingCount()).toBe(1);

      manager.cancelOffscreenParagraphs(new Set());
      expect(manager.getProcessingCount()).toBe(0);
    });
  });

  describe('cleanupStale', () => {
    it('调用不报错', () => {
      expect(() => manager.cleanupStale()).not.toThrow();
    });
  });

  describe('clearProcessedCache', () => {
    it('清除处理缓存', async () => {
      const p = createVisibleParagraph();
      await manager.handleVisibleParagraphs([p]);
      expect(manager.getProcessingCount()).toBe(1);

      manager.clearProcessedCache();
      expect(manager.getProcessingCount()).toBe(0);
    });
  });

  describe('processBatch - 错误处理', () => {
    it('仅已知免费 Google 行内模式错误显示可关闭提示，且批次保持失败状态', async () => {
      const p = createVisibleParagraph();
      mockSendMessage({ success: false, error: '免费 Google 翻译不支持仅行内模式，请选择双语或全文翻译' });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());

      const alert = document.querySelector('[role="alert"]') as HTMLElement;
      expect(alert.textContent).toContain('请选择双语或全文翻译');
      expect(alert.querySelector('[data-action="dismiss"]')).not.toBeNull();
      expect(manager.isProcessing(p.id)).toBe(false);
      expect(p.element.classList.contains('not-translator-processed')).toBe(false);
      expect(mockApplyTranslation).not.toHaveBeenCalled();
    });

    it('其他错误即使含私密内容也不显示上游文本', async () => {
      const p = createVisibleParagraph();
      mockSendMessage({ success: false, error: 'SYNTH-PRIVATE-UPSTREAM' });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(manager.isProcessing(p.id)).toBe(false));

      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(document.body.textContent).not.toContain('SYNTH-PRIVATE-UPSTREAM');
    });

    it('发送消息失败时清除状态', async () => {
      const p = createVisibleParagraph();
      (global as any).chrome = {
        runtime: {
          sendMessage: vi.fn((_msg: any, callback: (r: any) => void) => {
            setTimeout(() => callback({ success: false, error: 'Network error' }), 0);
          }),
          lastError: undefined,
        },
      };

      await manager.handleVisibleParagraphs([p]);
      await new Promise(r => setTimeout(r, 50));

      // 失败后状态应被清除，允许重试
      expect(manager.isProcessing(p.id)).toBe(false);
    });

    it('chrome.runtime.lastError 时返回错误', async () => {
      const p = createVisibleParagraph();
      (global as any).chrome = {
        runtime: {
          sendMessage: vi.fn((_msg: any, callback: (r: any) => void) => {
            (global as any).chrome.runtime.lastError = { message: 'Connection failed' };
            setTimeout(() => callback({ success: false, error: 'Connection failed' }), 0);
          }),
          lastError: undefined,
        },
      };

      await manager.handleVisibleParagraphs([p]);
      await new Promise(r => setTimeout(r, 50));

      expect(manager.isProcessing(p.id)).toBe(false);
    });
  });

  describe('filterResultBySettings', () => {
    it('禁用词组翻译时过滤短语', async () => {
      const callback = vi.fn();
      manager.setOnComplete(callback);
      manager.setSettings({ phraseTranslationEnabled: false } as any);

      const p = createVisibleParagraph();
      mockSendMessage({
        success: true,
        data: {
          results: [{
            id: p.id,
            result: {
              words: [
                { word: 'hello', translation: '你好', level: 'A1', isPhrase: false },
                { word: 'good morning', translation: '早上好', level: 'A1', isPhrase: true },
              ],
              fullText: '你好 早上好',
            },
          }],
        },
      });

      await manager.handleVisibleParagraphs([p]);
      await new Promise(r => setTimeout(r, 50));

      expect(mockApplyTranslation).toHaveBeenCalled();
      // 验证 filterResultBySettings 被调用：结果中 isPhrase=true 的词被过滤
      const callArgs = mockApplyTranslation.mock.calls[0];
      const filteredResult = callArgs[1];
      expect(filteredResult.words.length).toBe(1);
      expect(filteredResult.words[0].word).toBe('hello');
    });

    it('禁用语法翻译时清空语法点', async () => {
      const callback = vi.fn();
      manager.setOnComplete(callback);
      manager.setSettings({ grammarTranslationEnabled: false } as any);

      const p = createVisibleParagraph();
      mockSendMessage({
        success: true,
        data: {
          results: [{
            id: p.id,
            result: {
              words: [],
              fullText: 'test',
              grammarPoints: [{ pattern: 'test', explanation: 'test' }],
            },
          }],
        },
      });

      await manager.handleVisibleParagraphs([p]);
      await new Promise(r => setTimeout(r, 50));

      const callArgs = mockApplyTranslation.mock.calls[0];
      const filteredResult = callArgs[1];
      expect(filteredResult.grammarPoints).toEqual([]);
    });
  });

  describe('批量提取限制', () => {
    it('超过单批最大段落数时分批处理', async () => {
      const paragraphs = Array.from({ length: 5 }, (_, i) =>
        createVisibleParagraph({ id: `batch-para-${i}`, text: 'Short' })
      );

      let callCount = 0;
      (global as any).chrome = {
        runtime: {
          sendMessage: vi.fn((_msg: any, callback: (r: any) => void) => {
            callCount++;
            setTimeout(() => callback({
              success: true,
              data: { results: [] },
            }), 0);
          }),
          lastError: undefined,
        },
      };

      await manager.handleVisibleParagraphs(paragraphs);
      await new Promise(r => setTimeout(r, 100));

      // maxParagraphsPerBatch 被 mock 为 3，所以 5 个段落应分 2 批
      expect(callCount).toBeGreaterThanOrEqual(2);
    });

    it('超过单批最大字符数时分批处理', async () => {
      const paragraphs = [
        createVisibleParagraph({ id: 'char-1', text: 'A'.repeat(60) }),
        createVisibleParagraph({ id: 'char-2', text: 'B'.repeat(60) }),
      ];

      let callCount = 0;
      (global as any).chrome = {
        runtime: {
          sendMessage: vi.fn((_msg: any, callback: (r: any) => void) => {
            callCount++;
            setTimeout(() => callback({
              success: true,
              data: { results: [] },
            }), 0);
          }),
          lastError: undefined,
        },
      };

      await manager.handleVisibleParagraphs(paragraphs);
      await new Promise(r => setTimeout(r, 100));

      // maxCharsPerBatch 被 mock 为 100，所以 120 字符应分 2 批
      expect(callCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('并发限制', () => {
    it('不超过最大并发批次数', async () => {
      const paragraphs = Array.from({ length: 20 }, (_, i) =>
        createVisibleParagraph({ id: `concurrent-${i}`, text: 'A' })
      );

      let activeCount = 0;
      let maxActive = 0;

      (global as any).chrome = {
        runtime: {
          sendMessage: vi.fn((_msg: any, callback: (r: any) => void) => {
            activeCount++;
            maxActive = Math.max(maxActive, activeCount);
            setTimeout(() => {
              activeCount--;
              callback({ success: true, data: { results: [] } });
            }, 10);
          }),
          lastError: undefined,
        },
      };

      await manager.handleVisibleParagraphs(paragraphs);
      await new Promise(r => setTimeout(r, 200));

      // MAX_CONCURRENT_BATCHES = 5
      expect(maxActive).toBeLessThanOrEqual(5);
    });
  });
});
