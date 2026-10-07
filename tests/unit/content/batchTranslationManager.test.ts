/**
 * BatchTranslationManager 测试
 *
 * 覆盖段落队列、批量提取、并发请求、结果分发、取消操作
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BatchTranslationManager } from '@/content/batchTranslationManager';
import { logger } from '@/shared/utils';
import type { VisibleParagraph } from '@/content/viewportObserver';

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
    saveOriginalText: (...args: any[]) => mockSaveOriginalText(...args),
    applyTranslation: (...args: any[]) => mockApplyTranslation(...args),
  },
}));

function createVisibleParagraph(overrides: Partial<VisibleParagraph> = {}): VisibleParagraph {
  const el = document.createElement('p');
  el.id = overrides.id || `para-${Math.random().toString(36).slice(2)}`;
  el.textContent = overrides.text ?? 'This is a test paragraph with enough words';
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

    it('切换展示模式不取消在途请求，响应按最新模式渲染', async () => {
      const paragraph = createVisibleParagraph();
      const callbacks: Array<(response: unknown) => void> = [];
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(((_message: unknown, callback: (response: unknown) => void) => {
        callbacks.push(callback);
      }) as typeof chrome.runtime.sendMessage);
      await manager.handleVisibleParagraphs([paragraph]);

      manager.setMode('bilingual');
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
      expect(manager.isProcessing(paragraph.id)).toBe(true);
      callbacks[0]({ success: true, data: { results: [{ id: paragraph.id, result: {
        words: [], sentences: [], fullText: '保留的请求结果',
      } }] } });
      await vi.waitFor(() => expect(mockApplyTranslation).toHaveBeenCalledWith(
        paragraph.element, expect.objectContaining({ fullText: '保留的请求结果' }), 'bilingual', undefined
      ));
    });

    it('排队的本地行内任务切模式后不升级获取模式，也不与新模式任务混批', async () => {
      const callbacks: Array<(response: unknown) => void> = [];
      vi.mocked(chrome.runtime.sendMessage).mockImplementation(((_message: unknown, callback: (response: unknown) => void) => {
        callbacks.push(callback);
      }) as typeof chrome.runtime.sendMessage);
      const original = Array.from({ length: 16 }, (_, index) =>
        createVisibleParagraph({ id: `original-${index}`, text: 'Short' }));
      await manager.handleVisibleParagraphs(original);
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(5);
      manager.setMode('bilingual');
      await manager.handleVisibleParagraphs([createVisibleParagraph({ id: 'new-mode', text: 'Short' })]);

      callbacks[0]({ success: true, data: { results: [] } });
      await vi.waitFor(() => expect(callbacks).toHaveLength(6));
      callbacks[1]({ success: true, data: { results: [] } });
      await vi.waitFor(() => expect(callbacks).toHaveLength(7));
      const requests = vi.mocked(chrome.runtime.sendMessage).mock.calls.map(call => call[0]);
      expect(requests).not.toContainEqual(expect.objectContaining({ type: 'CANCEL_TRANSLATION' }));
      expect(requests[5]).toMatchObject({ payload: { mode: 'bilingual', paragraphs: [{ id: 'new-mode' }] } });
      expect(requests[6]).toMatchObject({ payload: { mode: 'inline-only', paragraphs: [{ id: 'original-0' }] } });
      manager.cancelAll();
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

    it('其他错误展示固定安全提示，不显示上游私密内容', async () => {
      const p = createVisibleParagraph();
      mockSendMessage({ success: false, error: 'SYNTH-PRIVATE-UPSTREAM' });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());

      const alert = document.querySelector('[role="alert"]') as HTMLElement;
      expect(alert.textContent).toContain('批量翻译失败');
      expect(document.body.textContent).not.toContain('SYNTH-PRIVATE-UPSTREAM');
      expect(manager.isProcessing(p.id)).toBe(false);
      expect(p.element.classList.contains('not-translator-processed')).toBe(false);
      expect(mockApplyTranslation).not.toHaveBeenCalled();
    });

    it.each([
      '翻译请求超时，请缩短文本或使用更小的本地模型',
      '翻译请求超时，请稍后重试',
      '扩展连接已断开，请刷新页面后重试',
      '翻译服务未返回响应',
      '翻译输入无效或超出长度限制',
      '模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型',
      '翻译服务凭据无效，请检查密钥配置',
      '翻译服务暂不可用，请检查服务是否启动或稍后重试',
      '无法连接翻译服务，请检查服务是否启动',
      '模型返回格式不正确，请重试或更换模型',
      '翻译失败，请检查翻译服务与模型配置后重试',
    ])('安全错误通知显示后台固定原因：%s，但不把失败或取消标记为成功', async error => {
      const p = createVisibleParagraph();
      const onComplete = vi.fn();
      manager.setOnComplete(onComplete);
      mockSendMessage({ success: false, error });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());

      expect(document.querySelector('[role="alert"]')?.textContent).toContain(error);
      expect(manager.isProcessing(p.id)).toBe(false);
      expect(p.element.classList.contains('not-translator-processed')).toBe(false);
      expect(mockApplyTranslation).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it.each([
      'SYNTH-PRIVATE https://private.test/v1?key=SYNTH-KEY',
      '翻译请求已取消 SYNTH-PRIVATE https://private.test/v1?key=SYNTH-KEY',
      'SYNTH-PRIVATE 模型返回格式不正确，请重试或更换模型',
      '翻译输入无效或超出长度限制 SYNTH-PRIVATE',
      'SYNTH-PRIVATE 翻译输入无效或超出长度限制',
      '<img src="https://private.test/SYNTH-KEY">',
      undefined,
      { message: '翻译请求已取消', key: 'SYNTH-KEY' },
    ])('安全错误通知只精确放行固定文案，未知值 %j 不回显到页面或日志', async error => {
      const p = createVisibleParagraph();
      mockSendMessage({ success: false, error });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());

      expect(document.querySelector('[role="alert"]')?.textContent)
        .toContain('本次翻译未能完成，段落再次进入视口时会自动重试。');
      expect(document.body.textContent).not.toMatch(/SYNTH-|private\.test/);
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toMatch(/SYNTH-|private\.test/);
      expect(mockApplyTranslation).not.toHaveBeenCalled();
    });

    it('安全错误通知对后台固定取消响应静默清理，不提示失败或假报成功', async () => {
      const p = createVisibleParagraph();
      const onComplete = vi.fn();
      manager.setOnComplete(onComplete);
      mockSendMessage({ success: false, error: '翻译请求已取消' });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(manager.isProcessing(p.id)).toBe(false));

      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(p.element.classList.contains('not-translator-processed')).toBe(false);
      expect(mockApplyTranslation).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('安全错误通知的异常catch不向页面或日志暴露Error中的正文、端点或密钥', async () => {
      const p = createVisibleParagraph();
      const privateDetail = 'SYNTH-PRIVATE https://private.test/v1?key=SYNTH-KEY';
      mockApplyTranslation.mockImplementationOnce(() => { throw new Error(privateDetail); });
      mockSendMessage({ success: true, data: { results: [{
        id: p.id, result: { words: [], sentences: [], fullText: '完整译文。' },
      }] } });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());

      expect(document.querySelector('[role="alert"]')?.textContent)
        .toContain('本次翻译未能完成，段落再次进入视口时会自动重试。');
      const logged = JSON.stringify(vi.mocked(logger.error).mock.calls, (_key, value: unknown) =>
        value instanceof Error ? { ...value, message: value.message } : value);
      expect(logged).not.toMatch(/SYNTH-|private\.test/);
      expect(document.body.textContent).not.toMatch(/SYNTH-|private\.test/);
      expect(manager.isProcessing(p.id)).toBe(false);
    });

    it('安全错误通知不改变再次进入视口重试的行为，成功后清除旧提示', async () => {
      const p = createVisibleParagraph();
      mockSendMessage({ success: false, error: '翻译请求超时，请缩短文本或使用更小的本地模型' });
      const firstSend = chrome.runtime.sendMessage;
      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(manager.isProcessing(p.id)).toBe(false));
      expect(firstSend).toHaveBeenCalledTimes(1);
      expect(mockApplyTranslation).not.toHaveBeenCalled();

      mockSendMessage({ success: true, data: { results: [{
        id: p.id, result: { words: [], sentences: [], fullText: '完整译文。' },
      }] } });
      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(mockApplyTranslation).toHaveBeenCalledTimes(1));

      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="alert"]')).toBeNull();
    });

    it('合法零词结果仍经统一展示入口交付并通知完成，不当成缺失或失败结果', async () => {
      const paragraph = createVisibleParagraph();
      const onComplete = vi.fn();
      manager.setOnComplete(onComplete);
      const result = { words: [], sentences: [] };
      mockSendMessage({ success: true, data: { results: [{ id: paragraph.id, result }] } });
      await manager.handleVisibleParagraphs([paragraph]);
      await vi.waitFor(() => expect(mockApplyTranslation).toHaveBeenCalledWith(
        paragraph.element, expect.objectContaining(result), 'inline-only', undefined
      ));
      expect(onComplete).toHaveBeenCalledWith(paragraph.element, expect.objectContaining(result));
      expect(document.querySelector('[role="alert"]')).toBeNull();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    });

    it('success 但缺少段落结果时安全提示、清圈并释放 processing 允许重试', async () => {
      const p = createVisibleParagraph();
      mockSendMessage({ success: true, data: { results: [] } });

      await manager.handleVisibleParagraphs([p]);
      await vi.waitFor(() => expect(manager.isProcessing(p.id)).toBe(false));

      expect(p.element.classList.contains('not-translator-processed')).toBe(false);
      expect(mockApplyTranslation).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alert"]')?.textContent).toContain('批量翻译失败');
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
