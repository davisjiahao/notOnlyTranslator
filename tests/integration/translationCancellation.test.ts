import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleTranslationMessage } from '@/background/translationMessages';
import { sendTranslationMessage } from '@/content/translationMessaging';
import { StorageManager } from '@/background/storage';
import { TranslationService } from '@/background/translation';
import { BatchTranslationService } from '@/background/batchTranslation';
import { pendingRequestQueue } from '@/background/pendingRequestQueue';
import type { Message, MessageResponse } from '@/shared/types';
import { TransportError } from '@/shared/utils/translationErrors';
import { logger } from '@/shared/utils/logger';

vi.mock('@/background/storage', () => ({ StorageManager: { getUserProfile: vi.fn() } }));
vi.mock('@/background/translation', () => ({ TranslationService: { translate: vi.fn() } }));
vi.mock('@/background/batchTranslation', () => ({ BatchTranslationService: { translateBatch: vi.fn() } }));
// trackCleanup 复刻真实实现：前置写入完成后才调用 complete，且不阻塞取消响应。
vi.mock('@/background/pendingRequestQueue', () => {
  const complete = vi.fn(async () => undefined);
  return { pendingRequestQueue: {
    add: vi.fn(),
    complete,
    trackCleanup: vi.fn((prerequisite: Promise<void> | undefined, id: string) => {
      void (prerequisite ?? Promise.resolve()).catch(() => undefined).then(() => { void complete(id); });
    }),
  } };
});

const sender = { tab: { id: 7 }, documentId: 'document-1' } as chrome.runtime.MessageSender;
const request: Message = { type: 'TRANSLATE_TEXT', payload: { text: 'apple', mode: 'inline-only', context: '' } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue({ estimatedVocabulary: 3000 } as Awaited<ReturnType<typeof StorageManager.getUserProfile>>);
  vi.mocked(pendingRequestQueue.add).mockResolvedValue(undefined);
  vi.mocked(pendingRequestQueue.complete).mockResolvedValue(undefined);
});

describe('内容脚本到翻译服务的取消链', () => {
  it('发出取消消息后，后台服务接收的 signal 确实中止', async () => {
    let serviceSignal: AbortSignal | undefined;
    vi.mocked(TranslationService.translate).mockImplementation(async (_request, options) => {
      serviceSignal = options?.signal;
      return new Promise(() => {});
    });
    vi.stubGlobal('chrome', { runtime: {
      lastError: undefined,
      sendMessage: (message: Message, reply: (response: MessageResponse) => void) => {
        void handleTranslationMessage(message, sender).then(reply);
      },
    } });
    const controller = new AbortController();
    const response = sendTranslationMessage(request, 1000, controller.signal);
    await vi.waitFor(() => expect(serviceSignal).toBeDefined());
    controller.abort();
    await expect(response).resolves.toMatchObject({ success: false, error: expect.stringContaining('取消') });
    expect(serviceSignal?.aborted).toBe(true);
    vi.unstubAllGlobals();
  });

  it('批量失败也清理真实队列 ID，不使用 batch_latest', async () => {
    vi.mocked(BatchTranslationService.translateBatch).mockRejectedValue(new Error('private text'));
    const result = await handleTranslationMessage({ type: 'BATCH_TRANSLATE_TEXT', payload: {
      paragraphs: [{ id: 'p1', text: 'A reading paragraph.', elementPath: 'p' }], mode: 'inline-only', pageUrl: 'https://example.test',
    } }, sender);
    const entry = vi.mocked(pendingRequestQueue.add).mock.calls[0][0];
    await vi.waitFor(() => expect(pendingRequestQueue.complete).toHaveBeenCalledWith(entry.id));
    expect(entry.text).toBe('');
    expect(result.success).toBe(false);
    expect(result.error).not.toContain('private text');
  });

  it('仅将已知免费 Google 行内模式错误映射为固定提示，其他上游异常继续净化', async () => {
    const message: Message = { type: 'BATCH_TRANSLATE_TEXT', payload: {
      paragraphs: [{ id: 'p1', text: 'A reading paragraph.', elementPath: 'p' }],
      mode: 'inline-only', pageUrl: 'https://example.test',
    } };
    const hint = '免费 Google 翻译不支持仅行内模式，请选择双语或全文翻译';
    vi.mocked(BatchTranslationService.translateBatch).mockRejectedValueOnce(new Error(hint))
      .mockRejectedValueOnce(new Error(`${hint} PRIVATE-UPSTREAM`));

    expect(await handleTranslationMessage(message, sender)).toEqual({ success: false, error: hint });
    const other = await handleTranslationMessage(message, sender);
    expect(other.success).toBe(false);
    expect(other.error).toBe('翻译失败，请检查翻译服务与模型配置后重试');
    expect(other.error).not.toContain('PRIVATE-UPSTREAM');
  });

  it('使用存储里的等级且不原地修改调用方请求', async () => {
    vi.mocked(TranslationService.translate).mockResolvedValue({ words: [], sentences: [] });
    const payload = Object.freeze({ text: 'apple', mode: 'inline-only', context: '' });
    const result = await handleTranslationMessage({ ...request, payload }, sender);
    expect(result.success).toBe(true);
    expect(payload).not.toHaveProperty('userLevel');
    expect(TranslationService.translate).toHaveBeenCalledWith(expect.objectContaining({ userLevel: { estimatedVocabulary: 3000 } }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('存储写入阻塞时仍及时取消，并在写入完成后清理队列', async () => {
    let finishWrite!: () => void;
    vi.mocked(pendingRequestQueue.add).mockImplementation(() => new Promise(resolve => { finishWrite = resolve; }));
    const pending = handleTranslationMessage({ type: 'BATCH_TRANSLATE_TEXT', requestId: 'slow-storage', payload: {
      paragraphs: [{ id: 'p1', text: 'A paragraph.', elementPath: 'p' }], mode: 'inline-only', pageUrl: 'https://example.test',
    } }, sender);
    await vi.waitFor(() => expect(finishWrite).toBeDefined());
    await handleTranslationMessage({ type: 'CANCEL_TRANSLATION', payload: { requestId: 'slow-storage' } }, sender);
    const outcome = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('still-pending'), 30))]);
    expect(outcome).toMatchObject({ success: false, error: expect.stringContaining('取消') });
    finishWrite();
    await vi.waitFor(() => expect(pendingRequestQueue.complete).toHaveBeenCalled());
    expect(BatchTranslationService.translateBatch).not.toHaveBeenCalled();
  });

  it.each([
    [TransportError.timeout(90_000), '超时'],
    [TransportError.cancelled(), '取消'],
    [TransportError.unavailable('private server detail'), '服务暂不可用'],
  ])('保留传输错误分类而不回显内部信息', async (error, expected) => {
    vi.mocked(TranslationService.translate).mockRejectedValue(error);
    const response = await handleTranslationMessage(request, sender);
    expect(response.error).toContain(expected);
    expect(response.error).not.toContain('private');
  });

  it.each(['TRANSLATE_TEXT', 'BATCH_TRANSLATE_TEXT'] as const)('%s 输出耗尽返回固定提示，响应与日志不回显上游正文', async type => {
    const privateText = 'SYNTHETIC-PRIVATE-PROVIDER-RESPONSE';
    const error = new TransportError('output_limit', privateText, { retryable: false, detail: privateText });
    const logs = (['debug', 'info', 'warn', 'error'] as const)
      .map(level => vi.spyOn(logger, level).mockImplementation(() => undefined));
    vi.mocked(TranslationService.translate).mockRejectedValue(error);
    vi.mocked(BatchTranslationService.translateBatch).mockRejectedValue(error);
    const message: Message = type === 'TRANSLATE_TEXT' ? request : {
      type, payload: {
        paragraphs: [{ id: 'p1', text: 'A reading paragraph.', elementPath: 'p' }],
        mode: 'bilingual', pageUrl: 'https://example.test',
      },
    };

    try {
      const result = await handleTranslationMessage(message, sender);
      expect(result).toEqual({
        success: false,
        error: '模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型',
      });
      const logged = JSON.stringify(logs.flatMap(log => log.mock.calls), (_key, value: unknown) =>
        value instanceof Error ? { ...value, message: value.message } : value);
      expect(logged).not.toContain(privateText);
    } finally {
      logs.forEach(log => log.mockRestore());
    }
  });

  it.each([
    { paragraphs: [] },
    { paragraphs: [null] },
    { paragraphs: [{ id: '', text: 'apple' }] },
    { paragraphs: [{ id: 'p1', text: 'apple' }, { id: 'p1', text: 'bank' }] },
    { paragraphs: [{ id: 'p1', text: ' ' }] },
    { paragraphs: [{ id: 'a'.repeat(201), text: 'apple' }] },
    { paragraphs: [{ id: 'p1', text: 'a'.repeat(50_001) }] },
    { paragraphs: Array.from({ length: 100 }, (_, i) => ({ id: String(i), text: 'apple' })) },
    { pageUrl: null },
    { pageUrl: 'a'.repeat(8193) },
  ])('拒绝无效批次、重复段落标识和过大输入', async patch => {
    const result = await handleTranslationMessage({ type: 'BATCH_TRANSLATE_TEXT', payload: {
      paragraphs: [{ id: 'p1', text: 'apple' }], mode: 'inline-only', pageUrl: 'https://example.test', ...patch,
    } }, sender);
    expect(result.success).toBe(false);
    expect(BatchTranslationService.translateBatch).not.toHaveBeenCalled();
  });

  it.each([401, 403])('凭据错误 %i 不回显上游正文', async status => {
    vi.mocked(TranslationService.translate).mockRejectedValue(TransportError.unavailable('SYNTHETIC-SECRET', status));
    expect(await handleTranslationMessage(request, sender)).toMatchObject({ success: false, error: expect.stringContaining('凭据无效') });
  });

  it.each([
    [new DOMException('private', 'TimeoutError'), '超时'],
    [new TypeError('private'), '无法连接'],
    [new SyntaxError('private'), '格式不正确'],
    ['private', '翻译失败'],
  ])('错误边界保留类型但不暴露详情', async (error, expected) => {
    vi.mocked(TranslationService.translate).mockRejectedValue(error);
    const result = await handleTranslationMessage(request, {});
    expect(result.error).toContain(expected);
    expect(result.error).not.toContain('private');
  });

  it.each([null, {}, { requestId: 123 }])('取消消息验证请求标识类型', async payload => {
    expect(await handleTranslationMessage({ type: 'CANCEL_TRANSLATION', payload }, sender)).toMatchObject({ success: false });
  });

  it('拒绝不合法的客户端请求标识', async () => {
    expect(await handleTranslationMessage({ ...request, requestId: '../invalid' }, sender)).toMatchObject({ success: false });
    expect(TranslationService.translate).not.toHaveBeenCalled();
  });

  it.each([null, { text: 123 }, { text: 'apple', mode: 'invalid' }, { text: 'apple', mode: 'inline-only', context: 123 }, { text: 'apple', mode: 'inline-only', context: 'a'.repeat(50_001) }, { text: 'a'.repeat(50_001), mode: 'inline-only' }])('拒绝无效单段输入', async payload => {
    const result = await handleTranslationMessage({ ...request, payload }, sender);
    expect(result.success).toBe(false);
    expect(TranslationService.translate).not.toHaveBeenCalled();
  });
});
