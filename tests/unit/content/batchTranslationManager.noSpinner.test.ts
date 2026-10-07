/**
 * 批次加载指示契约测试
 *
 * 新契约：翻译进行中不给段落注入任何加载指示。
 * 历史缺陷：一次 showLoading 同时注入 `.not-translator-paragraph-loading`
 * （::after 伪元素圈）与 `.not-translator-loading-spinner` DOM 节点（边框圈），
 * 同一段落出现两个圈。修复后进度仅由悬浮按钮/面板显示（onProgress 回调）。
 *
 * 本文件使用真实 TranslationDisplay（不 mock），锁定段落零注入契约。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchTranslationManager } from '@/content/batchTranslationManager';

let respond: ((response: unknown) => void) | undefined;
const sendMessage = vi.fn((_message: unknown, callback: (r: unknown) => void) => {
  respond = callback;
});

beforeEach(() => {
  vi.clearAllMocks();
  respond = undefined;
  vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } });
  document.body.innerHTML = '';
});

afterEach(() => vi.unstubAllGlobals());

/** 创建真实挂在 body 下的可见段落 */
function createParagraph(id: string, text: string) {
  const element = document.createElement('p');
  element.textContent = text;
  document.body.appendChild(element);
  return { id, element, text, elementPath: '', rect: { top: 0, left: 0, width: 100, height: 20 } };
}

describe('批次加载指示（新契约：段落零注入，进度走回调）', () => {
  it('翻译在途时段落无 spinner 节点与 loading 类，且单批只外发一次', async () => {
    const manager = new BatchTranslationManager();
    const p1 = createParagraph('p1', 'First visible paragraph for the batch.');
    const p2 = createParagraph('p2', 'Second visible paragraph for the batch.');
    await manager.handleVisibleParagraphs([p1, p2]);

    // 响应尚未返回：批次在途。旧契约此处段落同时有 loading 类与 spinner 节点（双圈）。
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
    expect(p1.element.classList.contains('not-translator-paragraph-loading')).toBe(false);
    expect(p2.element.classList.contains('not-translator-paragraph-loading')).toBe(false);

    respond!({
      success: true,
      data: {
        results: [
          { id: 'p1', result: { words: [], sentences: [], fullText: '第一段译文' } },
          { id: 'p2', result: { words: [], sentences: [], fullText: '第二段译文' } },
        ],
      },
    });
    await vi.waitFor(() => expect(p2.element.classList.contains('not-translator-processed')).toBe(true));

    // 完成后依然零注入，且正常渲染、未重复外发（排除入队竞态双请求）
    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
    expect(p1.element.classList.contains('not-translator-processed')).toBe(true);
    expect(p2.element.classList.contains('not-translator-processed')).toBe(true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('批次取消后段落也不出现任何加载指示', async () => {
    const manager = new BatchTranslationManager();
    // 取消/失败路径同样要把进度归零（悬浮按钮需随之退出忙碌态）
    const onProgress = vi.fn();
    manager.setOnProgress(onProgress);
    const p = createParagraph('p1', 'Paragraph that will be cancelled soon.');
    await manager.handleVisibleParagraphs([p]);

    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
    expect(onProgress).toHaveBeenCalledWith(1, 0);

    manager.cancelAll();
    respond!({ success: false, error: '翻译请求已取消' });
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(0, 0));

    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
    expect(p.element.classList.contains('not-translator-paragraph-loading')).toBe(false);
    expect(p.element.classList.contains('not-translator-processed')).toBe(false);
  });

  it('进度回调在批次起止时通知，作为悬浮按钮/面板的进度数据源', async () => {
    const manager = new BatchTranslationManager();
    const onProgress = vi.fn();
    manager.setOnProgress(onProgress);
    const p = createParagraph('p1', 'Progress callback paragraph content.');
    await manager.handleVisibleParagraphs([p]);

    // 批次发出：active=1，队列已清空
    expect(onProgress).toHaveBeenCalledWith(1, 0);

    respond!({
      success: true,
      data: { results: [{ id: 'p1', result: { words: [], sentences: [], fullText: '进度译文' } }] },
    });
    // 批次结束：active=0
    await vi.waitFor(() => expect(onProgress).toHaveBeenCalledWith(0, 0));
  });
});
