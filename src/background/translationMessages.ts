import type { BatchTranslationRequest, Message, MessageResponse, TranslationMode, TranslationRequest } from '@/shared/types';
import { DEFAULT_BATCH_CONFIG, MAX_TRANSLATION_TEXT_LENGTH } from '@/shared/constants';
import { TransportError } from '@/shared/utils/translationErrors';
import { StorageManager } from './storage';
import { TranslationService } from './translation';
import { translateBatchWithJoin } from './inflightBatchDedup';
import { pendingRequestQueue } from './pendingRequestQueue';
import { TranslationRequestRegistry } from './requestRegistry';

const registry = new TranslationRequestRegistry();
const MODES: readonly string[] = ['inline-only', 'bilingual', 'full-translate'];

function validMode(value: unknown): value is TranslationMode {
  return typeof value === 'string' && MODES.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TRANSLATION_TEXT_LENGTH;
}

function validRequest(message: Message): boolean {
  const payload = message.payload;
  if (!isRecord(payload) || !validMode(payload.mode)) return false;
  if (message.requestId !== undefined && (typeof message.requestId !== 'string' || !/^[\w-]{1,128}$/.test(message.requestId))) return false;
  if (message.type === 'TRANSLATE_TEXT') {
    return validText(payload.text) && (payload.context === undefined || (typeof payload.context === 'string' && payload.context.length <= MAX_TRANSLATION_TEXT_LENGTH));
  }
  const paragraphs = payload.paragraphs;
  return Array.isArray(paragraphs) && paragraphs.length > 0 && paragraphs.length <= DEFAULT_BATCH_CONFIG.maxParagraphsPerBatch
    && paragraphs.every(paragraph => isRecord(paragraph) && typeof paragraph.id === 'string' && paragraph.id.trim().length > 0 && paragraph.id.length <= 200 && validText(paragraph.text))
    && new Set(paragraphs.map(paragraph => paragraph.id)).size === paragraphs.length
    && paragraphs.reduce((sum, paragraph) => sum + paragraph.text.length, 0) <= DEFAULT_BATCH_CONFIG.maxCharsPerBatch
    && typeof payload.pageUrl === 'string' && payload.pageUrl.length <= 8192;
}

function publicError(error: unknown): string {
  // 只放行这一条固定的模式限制提示；其他上游异常仍不得原样返回给页面。
  if (error instanceof Error && error.message === '免费 Google 翻译不支持仅行内模式，请选择双语或全文翻译') {
    return '免费 Google 翻译不支持仅行内模式，请选择双语或全文翻译';
  }
  if (error instanceof TransportError) {
    if (error.kind === 'timeout') return '翻译请求超时，请缩短文本或使用更小的本地模型';
    if (error.kind === 'cancelled') return '翻译请求已取消';
    if (error.kind === 'output_limit') return '模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型';
    if (error.statusCode === 401 || error.statusCode === 403) return '翻译服务凭据无效，请检查密钥配置';
    return '翻译服务暂不可用，请检查服务是否启动或稍后重试';
  }
  if (error instanceof Error || error instanceof DOMException) {
    if (error.name === 'AbortError') return '翻译请求已取消';
    if (error.name === 'TimeoutError') return '翻译请求超时，请缩短文本或使用更小的本地模型';
    if (error.name === 'TypeError') return '无法连接翻译服务，请检查服务是否启动';
    if (error.name === 'SyntaxError') return '模型返回格式不正确，请重试或更换模型';
  }
  return '翻译失败，请检查翻译服务与模型配置后重试';
}

export async function handleTranslationMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<MessageResponse> {
  const owner = JSON.stringify([sender.tab?.id ?? 'extension', sender.documentId ?? sender.frameId ?? 0]);
  if (message.type === 'CANCEL_TRANSLATION') {
    const payload = message.payload;
    if (!isRecord(payload) || typeof payload.requestId !== 'string') return { success: false, error: '取消请求 ID 无效' };
    return { success: true, data: registry.cancel(owner, payload.requestId) };
  }
  if (!validRequest(message)) return { success: false, error: '翻译输入无效或超出长度限制' };
  let queueId: string | undefined;
  let queueWrite: Promise<void> | undefined;
  try {
    const result = await registry.run(owner, message.requestId, async signal => {
      const userLevel = await StorageManager.getUserProfile();
      signal.throwIfAborted();
      if (message.type === 'TRANSLATE_TEXT') {
        return TranslationService.translate({ ...(message.payload as TranslationRequest), userLevel }, { signal });
      }
      const request = { ...(message.payload as BatchTranslationRequest), userLevel };
      queueId = crypto.randomUUID();
      // 队列仅跟踪生命周期，不持久化页面正文或语境。
      queueWrite = pendingRequestQueue.add({ id: queueId, text: '', mode: request.mode, createdAt: Date.now(), retries: 0, tabId: sender.tab?.id, source: 'batch' });
      await queueWrite;
      signal.throwIfAborted();
      // 在途批次去重：同键（段落缓存 scope+原文）请求 join 现有 Promise，
      // 页面刷新后不重发；取消语义沿用 registry signal，路径不变
      return translateBatchWithJoin(request, {
        signal,
        onParagraph: payload => {
          if (signal.aborted || sender.tab?.id === undefined || !message.requestId) return;
          const target = sender.documentId
            ? { documentId: sender.documentId }
            : { frameId: sender.frameId ?? 0 };
          try {
            void chrome.tabs.sendMessage(sender.tab.id, {
              type: 'BATCH_TRANSLATION_PROGRESS', requestId: message.requestId, payload,
            }, target).catch(() => {});
          } catch {
            // 原文档卸载或不可达时，后台仍继续完成翻译与缓存写入。
          }
        },
      });
    });
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: publicError(error) };
  } finally {
    if (queueId) {
      // 清理必须晚于写入，但不能延长已取消请求的响应时间；
      // 整条链交给队列登记为在途写入，清空数据时由 settleWrites 等待落盘。
      pendingRequestQueue.trackCleanup(queueWrite, queueId);
    }
  }
}
