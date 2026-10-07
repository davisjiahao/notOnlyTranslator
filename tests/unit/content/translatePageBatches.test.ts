import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@/shared/types';
import { logger } from '@/shared/utils';

const sendTranslationMessage = vi.fn();
const applyTranslation = vi.fn();
vi.mock('@/content/translationMessaging', () => ({
  sendTranslationMessage,
  cancelTranslationMessages: vi.fn(),
}));
vi.mock('@/content/translationDisplay', () => ({
  TranslationDisplay: { applyTranslation },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // 清除未被消费的一次性响应，避免前一用例提前失败后留下挂起请求。
  sendTranslationMessage.mockReset();
  applyTranslation.mockReset().mockImplementation((paragraph: HTMLElement) => {
    paragraph.classList.add('not-translator-processed');
  });
  vi.stubGlobal('chrome', undefined);
  document.body.innerHTML = Array.from({ length: 15 }, (_, index) =>
    `<p>${String(index).padStart(2, '0')}${'a'.repeat(699)}</p>`
  ).join('');
  sendTranslationMessage.mockImplementation(async (message: Message) => {
    const paragraphs = (message.payload as { paragraphs: { text: string }[] }).paragraphs;
    if (paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0) > 10000) {
      return { success: false, error: '翻译输入无效或超出长度限制' };
    }
    return { success: true, data: { results: paragraphs.map(() => ({
      result: { words: [], sentences: [], fullText: '译文' },
    })) } };
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('右键整页翻译', () => {
  it('整页翻译不读取富文本编辑器中的未发送草稿', async () => {
    document.body.innerHTML = `<div contenteditable="true"><p>${'DRAFT_SECRET '.repeat(8)}</p></div><p>${'Public article text '.repeat(5)}</p>`;
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number }> };

    expect(await instance.handleTranslatePage()).toEqual({ translated: 1, failed: 0 });
    expect(JSON.stringify(sendTranslationMessage.mock.calls)).not.toContain('DRAFT_SECRET');
  });

  it('段落包含嵌套编辑区时整段跳过，不发送草稿', async () => {
    document.body.innerHTML = `<p>${'Public article text '.repeat(4)}<span contenteditable="true">DRAFT_SECRET</span></p><p>${'Another public paragraph '.repeat(4)}</p>`;
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number }> };

    expect(await instance.handleTranslatePage()).toEqual({ translated: 1, failed: 0 });
    expect(JSON.stringify(sendTranslationMessage.mock.calls)).not.toContain('DRAFT_SECRET');
  });

  it('每批同时遵守段落数和字符预算，长页面不会整批丢失', async () => {
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<void> };

    await instance.handleTranslatePage();

    expect(sendTranslationMessage.mock.calls.length).toBeGreaterThan(1);
    for (const [message] of sendTranslationMessage.mock.calls as [Message][]) {
      const paragraphs = (message.payload as { paragraphs: { text: string }[] }).paragraphs;
      expect(paragraphs.length).toBeLessThanOrEqual(15);
      expect(paragraphs.reduce((total, paragraph) => total + paragraph.text.length, 0)).toBeLessThanOrEqual(10000);
    }
    expect(applyTranslation).toHaveBeenCalledTimes(15);
  });

  it('单段超过批次上限但低于单段上限时仍调用单段翻译', async () => {
    document.body.innerHTML = `<p>${'a'.repeat(10001)}</p><p>${'b'.repeat(80)}</p>`;
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<void> };
    sendTranslationMessage.mockImplementation(async (message: Message) => ({
      success: true,
      data: message.type === 'TRANSLATE_TEXT'
        ? { words: [], sentences: [], fullText: '单段译文' }
        : { results: [{ result: { words: [], sentences: [], fullText: '批次译文' } }] },
    }));

    await instance.handleTranslatePage();

    expect(sendTranslationMessage.mock.calls.some(([message]: [Message]) => message.type === 'TRANSLATE_TEXT')).toBe(true);
    expect(applyTranslation).toHaveBeenCalledTimes(2);
  });

  it('超过单段上限时计入失败并继续翻译后续段落', async () => {
    document.body.innerHTML = `<p>${'a'.repeat(50001)}</p><p>${'b'.repeat(80)}</p>`;
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number }> };

    expect(await instance.handleTranslatePage()).toEqual({ translated: 1, failed: 1 });
    expect(sendTranslationMessage).toHaveBeenCalledTimes(1);
  });

  it('前一批失败后一批成功时返回准确的部分失败数量', async () => {
    sendTranslationMessage.mockResolvedValueOnce({ success: false, error: '服务暂不可用' });
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number }> };

    expect(await instance.handleTranslatePage()).toEqual({ translated: 1, failed: 14 });
    expect(applyTranslation).toHaveBeenCalledTimes(1);
  });

  it('超批次长度单段合法空结果经统一展示入口交付并计入成功', async () => {
    document.body.innerHTML = `<p>${'a'.repeat(10001)}</p>`;
    sendTranslationMessage.mockResolvedValue({ success: true, data: { words: [], sentences: [] } });
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number }> };

    expect(await instance.handleTranslatePage()).toEqual({ translated: 1, failed: 0 });
    expect(applyTranslation).toHaveBeenCalledExactlyOnceWith(
      document.querySelector('p'), { words: [], sentences: [] }, 'inline-only',
      expect.objectContaining({ enabled: true, translationMode: 'inline-only' })
    );
    expect(document.querySelector('p')?.classList.contains('not-translator-processed')).toBe(true);
  });

  it('渲染第二段异常时只把第二段计入失败', async () => {
    document.body.innerHTML = `<p>${'a'.repeat(80)}</p><p>${'b'.repeat(80)}</p>`;
    applyTranslation.mockImplementationOnce(() => undefined).mockImplementationOnce(() => { throw new Error('渲染失败'); });
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number }> };

    expect(await instance.handleTranslatePage()).toEqual({ translated: 1, failed: 1 });
  });

  it('整页翻译前取消自动批量管理器的待处理队列', async () => {
    const cancelAll = vi.fn();
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      batchManager: { cancelAll },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<unknown> };

    await instance.handleTranslatePage();

    expect(cancelAll).toHaveBeenCalledOnce();
  });

  it('第二次触发整页翻译时，前一次迟到结果不能覆盖', async () => {
    let resolveFirst!: (response: unknown) => void;
    sendTranslationMessage.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve; }));
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number; cancelled?: boolean }> };
    const first = instance.handleTranslatePage();
    const second = instance.handleTranslatePage();
    resolveFirst({ success: true, data: { results: [] } });

    expect(await first).toMatchObject({ cancelled: true });
    expect(await second).toEqual({ translated: 15, failed: 0 });
    expect(applyTranslation).toHaveBeenCalledTimes(15);
  });

  it('消息监听器等待翻译结束并报告部分失败', async () => {
    sendTranslationMessage.mockResolvedValueOnce({ success: false, error: '服务暂不可用' });
    const addListener = vi.fn();
    const { NotOnlyTranslator } = await import('@/content/index');
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener, removeListener: vi.fn() } },
      storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    });
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { setupMessageListener(): void };
    instance.setupMessageListener();
    const listener = addListener.mock.calls[0][0];
    const sendResponse = vi.fn();

    expect(listener({ type: 'TRANSLATE_PAGE' }, {}, sendResponse)).toBe(true);
    expect(sendResponse).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({
      success: false, data: { translated: 1, failed: 14 },
    }));
  });

  it('页面取消后迟到的批次响应不能报告成功或渲染', async () => {
    let resolveBatch!: (response: unknown) => void;
    sendTranslationMessage.mockImplementationOnce(() => new Promise(resolve => { resolveBatch = resolve; }));
    const addListener = vi.fn();
    const { NotOnlyTranslator } = await import('@/content/index');
    vi.stubGlobal('chrome', {
      runtime: { onMessage: { addListener, removeListener: vi.fn() } },
      storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    });
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { setupMessageListener(): void; translationGeneration: number };
    instance.setupMessageListener();
    const sendResponse = vi.fn();
    addListener.mock.calls[0][0]({ type: 'TRANSLATE_PAGE' }, {}, sendResponse);
    instance.translationGeneration++;
    resolveBatch({ success: true, data: { results: [] } });

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false })));
    expect(applyTranslation).not.toHaveBeenCalled();
  });

  it('批次合法空结果仍交付全部段落，发送地址不含路径令牌、查询参数或片段', async () => {
    window.history.replaceState(null, '', '/reset/SECRET_PATH_TOKEN?token=SECRET_SENTINEL#fragment');
    sendTranslationMessage.mockResolvedValue({ success: true, data: { results: Array.from({ length: 15 }, () => ({
      result: { words: [], sentences: [] },
    })) } });
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<{ translated: number; failed: number }> };

    expect(await instance.handleTranslatePage()).toEqual({ translated: 15, failed: 0 });
    expect(applyTranslation).toHaveBeenCalledTimes(15);
    expect(document.querySelectorAll('.not-translator-processed')).toHaveLength(15);
    expect(sendTranslationMessage).toHaveBeenCalledTimes(2);
    for (const [message] of sendTranslationMessage.mock.calls as [Message][]) {
      const pageUrl = (message.payload as { pageUrl: string }).pageUrl;
      expect(pageUrl).toBe(window.location.origin);
    }
    expect(JSON.stringify(sendTranslationMessage.mock.calls)).not.toMatch(/SECRET_PATH_TOKEN|SECRET_SENTINEL|fragment/);
  });

  it('后台返回失败时记录受控告警，不泄露错误正文', async () => {
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    sendTranslationMessage.mockResolvedValue({ success: false, error: 'SECRET_SENTINEL' });
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<void> };

    await instance.handleTranslatePage();

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('批量翻译失败'));
    expect(JSON.stringify(warning.mock.calls)).not.toContain('SECRET_SENTINEL');
    expect(applyTranslation).not.toHaveBeenCalled();
  });
});
