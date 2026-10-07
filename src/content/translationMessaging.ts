import type { BatchParagraphResult, BatchTranslationRequest, Message, MessageResponse } from '@/shared/types';

const DEFAULT_TIMEOUT_MS = 120_000;
let pendingRequests: Readonly<Record<string, (error: string, notifyBackground?: boolean) => void>> = {};

function isParagraphResult(value: unknown): value is BatchParagraphResult {
  if (!value || typeof value !== 'object') return false;
  const paragraph = value as Partial<BatchParagraphResult>;
  const result = paragraph.result;
  return typeof paragraph.id === 'string' && typeof paragraph.cached === 'boolean'
    && !!result && typeof result === 'object'
    && Array.isArray(result.words) && Array.isArray(result.sentences)
    && (result.fullText === undefined || typeof result.fullText === 'string')
    && (result.grammarPoints === undefined || Array.isArray(result.grammarPoints));
}

function notifyCancellation(requestId: string): void {
  try {
    chrome.runtime.sendMessage({ type: 'CANCEL_TRANSLATION', payload: { requestId } }, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    // 页面卸载或扩展更新时消息通道可能已经关闭。
  }
}

/**
 * 结算所有在途翻译消息的等待 Promise。
 * @param notifyBackground true 时向后台发 CANCEL_TRANSLATION（用户主动取消语义）；
 *   false 时仅前端静默结算——页面卸载（pagehide/关闭）用，让后台在途批次
 *   继续完成并写缓存，刷新后的新页面经在途去重或缓存拿到结果，不重发。
 */
export function cancelTranslationMessages(notifyBackground = true): void {
  Object.values(pendingRequests).forEach(cancel => cancel('翻译请求已取消', notifyBackground));
}

export function sendTranslationMessage<T = unknown>(
  message: Message,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
  onParagraph?: (result: BatchParagraphResult) => void
): Promise<MessageResponse<T>> {
  if (signal?.aborted) return Promise.resolve({ success: false, error: '翻译请求已取消' });
  const requestId = crypto.randomUUID();
  const paragraphs = message.type === 'BATCH_TRANSLATE_TEXT'
    ? (message.payload as BatchTranslationRequest | undefined)?.paragraphs : undefined;
  const expectedIds = new Set(Array.isArray(paragraphs) ? paragraphs.map(paragraph => paragraph.id) : []);
  return new Promise(resolve => {
    let settled = false;
    const events = chrome.runtime.onMessage;
    const onProgress = (event: Message, sender: chrome.runtime.MessageSender): void => {
      if (settled || signal?.aborted || sender.id !== chrome.runtime.id || sender.tab
        || event?.type !== 'BATCH_TRANSLATION_PROGRESS' || event.requestId !== requestId
        || !isParagraphResult(event.payload) || !expectedIds.has(event.payload.id)) return;
      try {
        onParagraph?.(event.payload);
      } catch {
        // 页面消费者异常不能中断整批响应及其监听器清理。
      }
    };
    const finish = (response: MessageResponse<T>): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      if (onParagraph) events?.removeListener(onProgress);
      pendingRequests = Object.fromEntries(Object.entries(pendingRequests).filter(([id]) => id !== requestId));
      resolve(response);
    };
    const cancel = (error: string, notifyBackground = true): void => {
      if (settled) return;
      finish({ success: false, error });
      // notifyBackground=false 为页面卸载路径：只结算前端等待，不通知后台取消
      if (notifyBackground) notifyCancellation(requestId);
    };
    const onAbort = (): void => cancel('翻译请求已取消');
    const timeout = setTimeout(() => cancel('翻译请求超时，请稍后重试'), timeoutMs);
    pendingRequests = { ...pendingRequests, [requestId]: cancel };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (onParagraph) events?.addListener(onProgress);
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
