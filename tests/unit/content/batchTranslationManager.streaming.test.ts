import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchTranslationManager } from '@/content/batchTranslationManager';
import { TranslationDisplay } from '@/content/translationDisplay';
import { cancelTranslationMessages } from '@/content/translationMessaging';
import type { BatchParagraphResult, Message } from '@/shared/types';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender) => void;
let listeners: readonly Listener[] = [];
const sendMessage = vi.fn();

function paragraph(id: string) {
  const element = document.createElement('p');
  const text = `This is the original English paragraph ${id}.`;
  element.textContent = text;
  document.body.appendChild(element);
  return { id, element, text, elementPath: '', rect: { top: 0, left: 0, width: 100, height: 20 } };
}
function result(id: string): BatchParagraphResult {
  return { id, cached: false, result: { words: [], sentences: [], fullText: `${id} 的中文译文` } };
}
function emit(id: string, requestId = sendMessage.mock.calls[0][0].requestId) {
  const event = { type: 'BATCH_TRANSLATION_PROGRESS', requestId, payload: result(id) };
  listeners.forEach(listener => listener(event, { id: 'extension-id' }));
}
function reply(results = [result('p1'), result('p2')]) {
  sendMessage.mock.calls[0][1]({ success: true, data: { results, apiCallCount: 1, cacheHitCount: 0 } });
}

beforeEach(() => {
  vi.clearAllMocks();
  listeners = [];
  document.body.innerHTML = '';
  vi.stubGlobal('chrome', { runtime: {
    id: 'extension-id', lastError: undefined, sendMessage,
    onMessage: {
      addListener(listener: Listener) { listeners = [...listeners, listener]; },
      removeListener(listener: Listener) { listeners = listeners.filter(item => item !== listener); },
    },
  } });
});
afterEach(() => {
  cancelTranslationMessages(false);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('批次内逐段显示', () => {
  it('首段到达就显示，而后段仍等待；重复进度与最终整批响应不重复渲染', async () => {
    const manager = new BatchTranslationManager();
    manager.setMode('bilingual');
    const done = vi.fn();
    manager.setOnComplete(done);
    const [first, second] = [paragraph('p1'), paragraph('p2')];
    await manager.handleVisibleParagraphs([first, second]);
    emit('p1');
    expect(first.element.nextElementSibling?.textContent).toBe('p1 的中文译文');
    expect(document.body.textContent).not.toContain('p2 的中文译文');
    expect(second.element.classList.contains('not-translator-processed')).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    emit('p1');
    expect(done).toHaveBeenCalledTimes(1);
    reply();
    await vi.waitFor(() => expect(second.element.nextElementSibling?.textContent).toBe('p2 的中文译文'));
    expect(done).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.not-translator-translation-line')).toHaveLength(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('后半批失败时保留已完成段落，只让未完成段落重新排队', async () => {
    const manager = new BatchTranslationManager();
    manager.setMode('bilingual');
    const [first, second] = [paragraph('p1'), paragraph('p2')];
    await manager.handleVisibleParagraphs([first, second]);
    emit('p1');
    sendMessage.mock.calls[0][1]({ success: false, error: '翻译服务暂不可用，请检查服务是否启动或稍后重试' });
    await vi.waitFor(() => expect(manager.isProcessing('p2')).toBe(false));
    expect(first.element.nextElementSibling?.textContent).toBe('p1 的中文译文');
    expect(first.element.classList.contains('not-translator-processed')).toBe(true);
    await manager.handleVisibleParagraphs([first, second]);
    const batches = sendMessage.mock.calls.filter(([message]: [Message]) => message.type === 'BATCH_TRANSLATE_TEXT');
    expect(batches).toHaveLength(2);
    expect(batches[1][0].payload.paragraphs.map((p: { id: string }) => p.id)).toEqual(['p2']);
  });

  it('取消后迟到进度与最终响应都不能改写页面', async () => {
    const manager = new BatchTranslationManager();
    manager.setMode('bilingual');
    const first = paragraph('p1');
    await manager.handleVisibleParagraphs([first]);
    const oldListener = listeners[0];
    expect(oldListener).toBeTypeOf('function');
    const requestId = sendMessage.mock.calls[0][0].requestId;
    manager.cancelAll();
    oldListener({ type: 'BATCH_TRANSLATION_PROGRESS', requestId, payload: result('p1') }, { id: 'extension-id' });
    reply([result('p1')]);
    await Promise.resolve();
    expect(first.element.textContent).toBe(first.text);
  });

  it('忽略其它段落 ID、已断开节点及请求发出后被网页修改的正文', async () => {
    const manager = new BatchTranslationManager();
    manager.setMode('bilingual');
    const first = paragraph('p1');
    const second = paragraph('p2');
    const applied = vi.spyOn(TranslationDisplay, 'applyTranslation');
    const progress = vi.fn();
    manager.setOnProgress(progress);
    await manager.handleVisibleParagraphs([first, second]);
    first.element.textContent = 'The page replaced this content.';
    second.element.remove();
    emit('unknown');
    emit('p1');
    emit('p2');
    reply();
    await vi.waitFor(() => expect(progress).toHaveBeenLastCalledWith(0, 0));
    expect(applied).not.toHaveBeenCalled();
    expect(first.element.textContent).toBe('The page replaced this content.');
  });

  it('等待期间切换展示模式时，迟到段落按最新模式显示且不重发', async () => {
    const manager = new BatchTranslationManager();
    manager.setMode('bilingual');
    const first = paragraph('p1');
    await manager.handleVisibleParagraphs([first]);
    manager.setMode('full-translate');
    emit('p1');
    expect(first.element.textContent).toContain('p1 的中文译文');
    expect(first.element.textContent).not.toContain(first.text);
    reply([result('p1')]);
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
