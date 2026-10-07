import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelTranslationMessages, sendTranslationMessage } from '@/content/translationMessaging';
import type { BatchParagraphResult, Message } from '@/shared/types';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender) => void;
let listeners: readonly Listener[] = [];
const sendMessage = vi.fn();
const addListener = vi.fn((listener: Listener) => { listeners = [...listeners, listener]; });
const removeListener = vi.fn((listener: Listener) => {
  listeners = listeners.filter(candidate => candidate !== listener);
});
const message: Message = {
  type: 'BATCH_TRANSLATE_TEXT',
  payload: { paragraphs: [{ id: 'p1', text: 'Original first paragraph.', elementPath: '' }] },
};
const paragraph: BatchParagraphResult = {
  id: 'p1', cached: false, result: { words: [], sentences: [], fullText: '第一段译文' },
};

function emit(requestId: string, payload: unknown = paragraph, senderId = 'extension-id') {
  const event = { type: 'BATCH_TRANSLATION_PROGRESS', requestId, payload };
  listeners.forEach(listener => listener(event, { id: senderId }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listeners = [];
  vi.stubGlobal('chrome', { runtime: {
    id: 'extension-id', sendMessage, lastError: undefined,
    onMessage: { addListener, removeListener },
  } });
});
afterEach(() => {
  cancelTranslationMessages(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('批次逐段消息消费者', () => {
  it('先注册监听，再外发请求；整批未返回时立即交付完整段落', async () => {
    const onParagraph = vi.fn();
    sendMessage.mockImplementationOnce((sent: Message) => {
      expect(listeners).toHaveLength(1);
      emit(sent.requestId!);
    });
    const done = vi.fn();
    const pending = sendTranslationMessage(message, 1000, undefined, onParagraph);
    void pending.then(done);
    expect(onParagraph).toHaveBeenCalledWith(paragraph);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    cancelTranslationMessages(false);
    await pending;
  });

  it('按 requestId 与扩展身份隔离，不接收其它请求或无效段落', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const a = sendTranslationMessage(message, 1000, undefined, first);
    const b = sendTranslationMessage(message, 1000, undefined, second);
    const requestId = sendMessage.mock.calls[0][0].requestId;
    emit(requestId, paragraph, 'other-extension');
    emit('stale-request');
    emit(requestId, { id: 'p1', result: null });
    emit(requestId, { ...paragraph, id: 'other-paragraph' });
    emit(requestId, { ...paragraph, result: { ...paragraph.result, fullText: 12 } });
    emit(requestId);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    cancelTranslationMessages(false);
    await Promise.all([a, b]);
  });

  it('进度消费者抛错不影响整批结算和清理', async () => {
    const onParagraph = vi.fn(() => { throw new Error('consumer failed'); });
    const pending = sendTranslationMessage(message, 1000, undefined, onParagraph);
    const [sent, reply] = sendMessage.mock.calls[0];
    expect(() => emit(sent.requestId)).not.toThrow();
    reply({ success: true, data: { results: [paragraph] } });
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(listeners).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'failure', 'abort', 'timeout', 'unload'] as const)(
    '%s 结算后解绑监听且忽略迟到进度', async outcome => {
      const onParagraph = vi.fn();
      const controller = new AbortController();
      const pending = sendTranslationMessage(message, 1000, controller.signal, onParagraph);
      const [sent, reply] = sendMessage.mock.calls[0];
      const lateListener = listeners[0];
      if (outcome === 'success') reply({ success: true, data: { results: [paragraph] } });
      if (outcome === 'failure') reply({ success: false, error: '失败' });
      if (outcome === 'abort') controller.abort();
      if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(1000);
      if (outcome === 'unload') cancelTranslationMessages(false);
      await pending;
      expect(listeners).toHaveLength(0);
      expect(removeListener).toHaveBeenCalledWith(lateListener);
      lateListener({ type: 'BATCH_TRANSLATION_PROGRESS', requestId: sent.requestId, payload: paragraph }, { id: 'extension-id' });
      expect(onParagraph).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      if (outcome === 'unload') expect(sendMessage).toHaveBeenCalledTimes(1);
    }
  );
});
