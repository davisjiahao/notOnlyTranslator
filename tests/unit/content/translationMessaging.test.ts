import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelTranslationMessages, sendTranslationMessage } from '@/content/translationMessaging';
import type { Message, MessageResponse } from '@/shared/types';

const sendMessage = vi.fn();
const message: Message = { type: 'TRANSLATE_TEXT', payload: { text: 'apple', mode: 'inline-only' } };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } });
  sendMessage.mockReset();
});
afterEach(() => {
  cancelTranslationMessages();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('跨进程翻译取消', () => {
  it('发送唯一请求 ID，并清理成功请求的超时器', async () => {
    sendMessage.mockImplementation((_message: Message, reply: (value: MessageResponse) => void) => reply({ success: true, data: '苹果' }));
    await expect(sendTranslationMessage(message)).resolves.toEqual({ success: true, data: '苹果' });
    expect(sendMessage.mock.calls[0][0]).toMatchObject({ type: 'TRANSLATE_TEXT', requestId: expect.any(String) });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('超时后通知后台取消，迟到结果不再生效', async () => {
    const pending = sendTranslationMessage(message, 50);
    const [sent, reply] = sendMessage.mock.calls[0];
    await vi.advanceTimersByTimeAsync(50);
    await expect(pending).resolves.toMatchObject({ success: false, error: expect.stringContaining('超时') });
    expect(sendMessage.mock.calls[1][0]).toEqual({ type: 'CANCEL_TRANSLATION', payload: { requestId: sent.requestId } });
    reply({ success: true, data: '迟到结果' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('导航取消所有活跃请求，但不影响后来发起的请求', async () => {
    const first = sendTranslationMessage(message);
    const second = sendTranslationMessage(message);
    cancelTranslationMessages();
    await expect(first).resolves.toMatchObject({ success: false });
    await expect(second).resolves.toMatchObject({ success: false });
    sendMessage.mockImplementation((_message: Message, reply: (value: MessageResponse) => void) => reply({ success: true }));
    await expect(sendTranslationMessage(message)).resolves.toEqual({ success: true });
  });

  it('可取消单批请求，不取消其它并行批次', async () => {
    const controller = new AbortController();
    const first = sendTranslationMessage(message, 100, controller.signal);
    const second = sendTranslationMessage(message);
    const replySecond = sendMessage.mock.calls[1][1];
    controller.abort();
    await expect(first).resolves.toMatchObject({ success: false, error: expect.stringContaining('取消') });
    replySecond({ success: true });
    await expect(second).resolves.toEqual({ success: true });
  });

  it('已经取消的请求不发送到后台', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sendTranslationMessage(message, 100, controller.signal)).resolves.toMatchObject({ success: false });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('回调无响应时返回明确错误并清理计时器', async () => {
    sendMessage.mockImplementation((_message: Message, reply: (value?: MessageResponse) => void) => reply());
    await expect(sendTranslationMessage(message)).resolves.toMatchObject({ success: false, error: '翻译服务未返回响应' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('runtime.lastError 不回显内部内容', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: { message: 'private endpoint' } } });
    sendMessage.mockImplementation((_message: Message, reply: (value?: MessageResponse) => void) => reply());
    const result = await sendTranslationMessage(message);
    expect(result).toMatchObject({ success: false, error: expect.stringContaining('扩展连接已断开') });
    expect(result.error).not.toContain('private');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('扩展已失效时取消仍及时完成', async () => {
    sendMessage.mockImplementation((sent: Message) => {
      if (sent.type === 'CANCEL_TRANSLATION') throw new Error('private endpoint');
    });
    const request = sendTranslationMessage(message);
    cancelTranslationMessages();
    await expect(request).resolves.toMatchObject({ success: false, error: '翻译请求已取消' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('扩展失效时返回可读错误且不泄漏内部异常', async () => {
    sendMessage.mockImplementation(() => { throw new Error('secret endpoint'); });
    const result = await sendTranslationMessage(message);
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('secret');
    expect(vi.getTimerCount()).toBe(0);
  });
});
