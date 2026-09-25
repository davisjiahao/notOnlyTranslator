import type { Message, MessageResponse } from '@/shared/types';

const DEFAULT_TIMEOUT_MS = 120_000;
let pendingRequests: Readonly<Record<string, () => void>> = {};

function notifyCancellation(requestId: string): void {
  try {
    chrome.runtime.sendMessage({ type: 'CANCEL_TRANSLATION', payload: { requestId } }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // 页面卸载或扩展更新时消息通道可能已经关闭。
  }
}

export function cancelTranslationMessages(): void {
  Object.values(pendingRequests).forEach(cancel => cancel());
}

export function sendTranslationMessage<T = unknown>(
  message: Message,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal
): Promise<MessageResponse<T>> {
  if (signal?.aborted) return Promise.resolve({ success: false, error: '翻译请求已取消' });
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    let settled = false;
    const finish = (response: MessageResponse<T>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      pendingRequests = Object.fromEntries(Object.entries(pendingRequests).filter(([id]) => id !== requestId));
      resolve(response);
    };
    const cancel = (error: string): void => {
      if (settled) return;
      finish({ success: false, error });
      notifyCancellation(requestId);
    };
    const onAbort = (): void => cancel('翻译请求已取消');
    const timeout = setTimeout(() => cancel('翻译请求超时，请稍后重试'), timeoutMs);
    pendingRequests = { ...pendingRequests, [requestId]: onAbort };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      chrome.runtime.sendMessage({ ...message, requestId }, (response: MessageResponse<T>) => {
        const channelError = chrome.runtime.lastError;
        finish(channelError
          ? { success: false, error: '扩展连接已断开，请刷新页面后重试' }
          : response ?? { success: false, error: '翻译服务未返回响应' });
      });
    } catch {
      finish({ success: false, error: '扩展连接已断开，请刷新页面后重试' });
    }
  });
}
