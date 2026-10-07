import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportObserver, type VisibleParagraph } from '@/content/viewportObserver';
import { PageScanner } from '@/content/pageScanner';
import { BatchTranslationManager } from '@/content/batchTranslationManager';
import { TranslationDisplay } from '@/content/translationDisplay';
import { VocabularyHighlighter } from '@/content/vocabularyHighlighter';
import { VocabularyStateSync } from '@/content/core/vocabularyState';
import type { BatchTranslationRequest, MessageResponse } from '@/shared/types';

const failedText = "From Claude Code's perspective, there are two independent limits: GitHub's API rate limits and Claude Code's own usage limits.";
let intersect: (entries: Array<{ target: Element; isIntersecting: boolean }>) => void;
let requests: Array<{ payload: BatchTranslationRequest; respond: (response: MessageResponse) => void }>;

beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  document.documentElement.lang = 'en';
  document.body.replaceChildren();
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) {
      intersect = entries => callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      sendMessage(message: { type: string; payload: BatchTranslationRequest }, respond: (response: MessageResponse) => void) {
        if (message.type === 'BATCH_TRANSLATE_TEXT') requests.push({ payload: message.payload, respond });
      },
    },
  });
});
afterEach(() => {
  TranslationDisplay.clearAll();
  TranslationDisplay.setKnownWords([]);
  document.body.replaceChildren();
  document.documentElement.removeAttribute('lang');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function paragraph(id: string, text: string): HTMLElement {
  const element = document.createElement('p');
  element.id = id;
  element.textContent = text;
  document.body.appendChild(element);
  return element;
}

function mockTextRects(rects: (node: Node) => DOMRect[]): void {
  const createRange = document.createRange.bind(document);
  vi.spyOn(document, 'createRange').mockImplementation(() => {
    const range = createRange();
    Object.defineProperty(range, 'getClientRects', { value: () => rects(range.startContainer) });
    return range;
  });
}

describe('失败段落只有自己真正离开再进入视口才重试', () => {
  it('display:contents按可译正文Range首次投递，父元素IO为false及连续检查不能重投', async () => {
    const element = paragraph('contents', failedText);
    element.style.display = 'contents';
    mockTextRects(() => [{ top: 100, bottom: 118, left: 0, right: 774 } as DOMRect]);
    const notify = vi.fn();
    const viewport = new ViewportObserver(notify);
    expect(new PageScanner().scan().map(entry => entry.element)).toContain(element);
    viewport.observe(element);
    try {
      viewport.checkCurrentViewport();
      expect(notify).toHaveBeenCalledTimes(1);
      const id = notify.mock.calls[0][0][0].id;
      intersect([{ target: element, isIntersecting: false }]);
      await vi.advanceTimersByTimeAsync(150);
      viewport.checkCurrentViewport();
      window.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(150);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0][0][0].id).toBe(id);
      expect(viewport.getVisibleCount()).toBe(1);
    } finally { viewport.destroy(); }
  });

  it('无框正文初始离屏后由滚动进入、resize离开、嵌套滚动重进驱动通知', async () => {
    const element = paragraph('contents-scroll', failedText);
    element.style.display = 'contents';
    let top = 3000;
    mockTextRects(() => [{ top, bottom: top + 18, left: 0, right: 774 } as DOMRect]);
    const notify = vi.fn();
    const viewport = new ViewportObserver(notify);
    viewport.observe(element);
    try {
      intersect([{ target: element, isIntersecting: false }]);
      await vi.advanceTimersByTimeAsync(150);
      expect(notify).not.toHaveBeenCalled();
      top = 100;
      window.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(150);
      expect(notify).toHaveBeenCalledTimes(1);
      top = 3000;
      window.dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(150);
      expect(viewport.getVisibleCount()).toBe(0);
      top = 100;
      element.dispatchEvent(new Event('scroll', { bubbles: false }));
      await vi.advanceTimersByTimeAsync(150);
      expect(notify).toHaveBeenCalledTimes(2);
      viewport.destroy();
      window.dispatchEvent(new Event('scroll'));
      await vi.advanceTimersByTimeAsync(150);
      expect(notify).toHaveBeenCalledTimes(2);
    } finally { viewport.destroy(); }
  });

  it.each(['display:none', 'hidden-descendant'])('%s的零框段落不能借隐藏文本Range误投递', scenario => {
    const element = paragraph('hidden-range', failedText);
    if (scenario === 'display:none') element.style.display = 'none';
    else {
      element.style.display = 'contents';
      const hidden = document.createElement('span');
      hidden.hidden = true;
      hidden.textContent = failedText;
      element.replaceChildren(hidden);
    }
    mockTextRects(() => [{ top: 100, bottom: 118, left: 0, right: 774 } as DOMRect]);
    const notify = vi.fn();
    const viewport = new ViewportObserver(notify);
    viewport.observe(element);
    try {
      viewport.checkCurrentViewport();
      expect(notify).not.toHaveBeenCalled();
    } finally { viewport.destroy(); }
  });

  it.each(['上方500px', '下方200px', '上方边界', '下方边界'] as const)('并发满时%s的匿名预加载段落，经手动检查再滚入视口不会丢失队列任务', async location => {
    const blockers = Array.from({ length: 5 }, (_, index) => paragraph(`active-${index}`, failedText));
    const queued = paragraph('', failedText);
    for (const element of blockers) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100, left: 0, right: 100 } as DOMRect);
    }
    const top = {
      上方500px: -600,
      下方200px: window.innerHeight + 200,
      上方边界: -1300,
      下方边界: window.innerHeight + 400,
    }[location];
    const queuedRect = vi.spyOn(queued, 'getBoundingClientRect').mockReturnValue({ top, bottom: top + 100, left: 0, right: 100 } as DOMRect);
    const manager = new BatchTranslationManager();
    const deliveries = vi.fn((paragraphs: VisibleParagraph[]) => { void manager.handleVisibleParagraphs(paragraphs); });
    const visibleIds = vi.fn((ids: Set<string>) => manager.cancelOffscreenParagraphs(ids));
    const viewport = new ViewportObserver(deliveries);
    viewport.setVisibleIdsChangedCallback(visibleIds);
    const scanned = new PageScanner().scan();
    expect(scanned.map(entry => entry.element)).toContain(queued);
    viewport.observeAll(scanned.map(entry => entry.element));
    try {
      // 五次独立进入占满真实批次并发，第六段只能等待已有请求结束。
      for (const element of blockers) {
        intersect([{ target: element, isIntersecting: true }]);
        await vi.advanceTimersByTimeAsync(150);
      }
      expect(requests).toHaveLength(5);
      intersect([{ target: queued, isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(150);
      const queuedId = deliveries.mock.calls.flatMap(([entries]) => entries).find(entry => entry.element === queued)!.id;
      expect(manager.isProcessing(queuedId)).toBe(true);
      expect(requests).toHaveLength(5);
      viewport.checkCurrentViewport();
      expect(visibleIds.mock.lastCall?.[0].has(queuedId)).toBe(true);
      expect(manager.isProcessing(queuedId)).toBe(true);

      // 始终在同一个预加载区域内，不伪造离开事件来解除通知去重。
      queuedRect.mockReturnValue({ top: 100, bottom: 200, left: 0, right: 100 } as DOMRect);
      intersect([{ target: queued, isIntersecting: true }]);
      viewport.checkCurrentViewport();
      await vi.advanceTimersByTimeAsync(150);
      expect(deliveries.mock.calls.flatMap(([entries]) => entries).filter(entry => entry.element === queued)).toHaveLength(1);
      requests[0].respond({ success: true, data: { results: [] } });
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(6);
      expect(requests[5].payload.paragraphs.map(entry => entry.id)).toEqual([queuedId]);
      // 新契约：段落零 spinner 注入（含并发满排队后补发的场景）
      expect(queued.querySelector('.not-translator-loading-spinner')).toBeNull();
    } finally {
      viewport.destroy();
      manager.cancelAll();
    }
  });

  it.each([false, true])('零面积段落仅在已有交叉可见记录=%s时保留通知生命周期', async previouslyIntersecting => {
    const element = paragraph('', failedText);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 0, left: 0, right: 0 } as DOMRect);
    const notify = vi.fn();
    const idsChanged = vi.fn();
    const viewport = new ViewportObserver(notify);
    viewport.setVisibleIdsChangedCallback(idsChanged);
    viewport.observe(element);
    try {
      if (previouslyIntersecting) {
        intersect([{ target: element, isIntersecting: true }]);
        await vi.advanceTimersByTimeAsync(150);
      }
      const originalId = notify.mock.calls[0]?.[0][0].id;
      viewport.checkCurrentViewport();
      viewport.checkCurrentViewport();
      expect(notify).toHaveBeenCalledTimes(previouslyIntersecting ? 1 : 0);
      if (previouslyIntersecting) expect(idsChanged.mock.lastCall?.[0].has(originalId)).toBe(true);
    } finally { viewport.destroy(); }
  });

  it('连续检查和其他段落的可见集抖动不重复投递，匿名段落ID保持稳定', async () => {
    const failed = paragraph('', failedText);
    const other = paragraph('other', failedText);
    vi.spyOn(failed, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100, left: 0, right: 100 } as DOMRect);
    vi.spyOn(other, 'getBoundingClientRect').mockReturnValue({ top: 3000, bottom: 3100, left: 0, right: 100 } as DOMRect);
    const notify = vi.fn();
    const idsChanged = vi.fn();
    const viewport = new ViewportObserver(notify);
    viewport.setVisibleIdsChangedCallback(idsChanged);
    viewport.observeAll([failed, other]);
    try {
      intersect([{ target: failed, isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(150);
      const originalId = notify.mock.calls[0][0][0].id;
      for (let round = 0; round < 3; round++) {
        viewport.checkCurrentViewport();
        intersect([{ target: other, isIntersecting: true }]);
        await vi.advanceTimersByTimeAsync(150);
        intersect([{ target: other, isIntersecting: false }]);
        await vi.advanceTimersByTimeAsync(150);
      }
      const deliveries = notify.mock.calls.flatMap(([entries]) => entries);
      expect(deliveries.filter(entry => entry.element === failed)).toHaveLength(1);
      expect(deliveries.filter(entry => entry.element === other)).toHaveLength(3);
      expect(idsChanged.mock.calls.every(([ids]) => ids.has(originalId))).toBe(true);
      intersect([{ target: failed, isIntersecting: false }]);
      await vi.advanceTimersByTimeAsync(150);
      intersect([{ target: failed, isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(150);
      expect(notify.mock.calls.flatMap(([entries]) => entries).filter(entry => entry.element === failed)).toHaveLength(2);
    } finally { viewport.destroy(); }
  });

  it.each(['resetTracking', 'disable', 'unobserve'] as const)('%s 显式结束通知生命周期后允许再次投递', async operation => {
    const element = paragraph('reset', failedText);
    const notify = vi.fn();
    const viewport = new ViewportObserver(notify);
    viewport.observe(element);
    try {
      intersect([{ target: element, isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(150);
      expect(notify).toHaveBeenCalledTimes(1);
      if (operation === 'resetTracking') viewport.resetTracking();
      if (operation === 'disable') { viewport.disable(); viewport.enable(); }
      if (operation === 'unobserve') { viewport.unobserve(element); viewport.observe(element); }
      intersect([{ target: element, isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(150);
      expect(notify).toHaveBeenCalledTimes(2);
    } finally { viewport.destroy(); }
  });

  it.each(['其他段落进入', '手动检查当前视口'])('切换模式并词汇重扫后，%s 不重投始终可见的失败段落', async trigger => {
    const failed = paragraph('failed', failedText);
    const other = paragraph('other', 'This independent paragraph becomes visible when bilingual translations change the page layout.');
    const highlighter = new VocabularyHighlighter({ enabled: true, userLevel: 'A1' });
    highlighter.highlightElements([failed, other]);
    expect(failed.querySelectorAll('.not-translator-vocab-highlight').length).toBeGreaterThan(0);
    const manager = new BatchTranslationManager();
    manager.setMode('full-translate');
    const viewport = new ViewportObserver(paragraphs => { void manager.handleVisibleParagraphs(paragraphs); });
    viewport.setVisibleIdsChangedCallback(ids => manager.cancelOffscreenParagraphs(ids));
    viewport.observeAll([failed, other]);
    const sync = new VocabularyStateSync({
      applyVocabularySnapshot(snapshot) {
        highlighter.applySnapshot(snapshot);
        TranslationDisplay.rerenderTranslations('bilingual');
      },
    }, async () => ({ userLevel: 'A1', knownWords: new Set(), unknownWords: new Set() }));
    try {
      intersect([{ target: failed, isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(150);
      expect(requests).toHaveLength(1);
      expect(failed.querySelector('.not-translator-loading-spinner')).toBeNull();
      requests[0].respond({ success: false, error: '翻译请求超时，请稍后重试' });
      await vi.advanceTimersByTimeAsync(0);
      expect(manager.getProcessingCount()).toBe(0);
      expect(failed.querySelector('.not-translator-loading-spinner')).toBeNull();
      expect(TranslationDisplay.isProcessed(failed)).toBe(false);
      manager.setMode('bilingual');
      TranslationDisplay.rerenderTranslations('bilingual');
      await sync.syncNow();
      await vi.advanceTimersByTimeAsync(500);
      expect(requests).toHaveLength(1);

      if (trigger === '其他段落进入') {
        // 只触发其他段落的交叉事件，失败段落始终没有离开视口。
        intersect([{ target: other, isIntersecting: true }]);
        await vi.advanceTimersByTimeAsync(150);
      } else {
        for (const element of [failed, other]) {
          vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100, left: 0, right: 100 } as DOMRect);
        }
        viewport.checkCurrentViewport();
      }
      expect(requests).toHaveLength(2);
      expect(requests[1].payload.paragraphs.map(entry => entry.id)).not.toContain('para_failed');
      expect(failed.querySelector('.not-translator-loading-spinner')).toBeNull();

      intersect([{ target: failed, isIntersecting: false }]);
      await vi.advanceTimersByTimeAsync(150);
      intersect([{ target: failed, isIntersecting: true }]);
      await vi.advanceTimersByTimeAsync(150);
      expect(requests).toHaveLength(3);
      expect(requests[2].payload.paragraphs.map(entry => entry.id)).toContain('para_failed');
      expect(failed.querySelector('.not-translator-loading-spinner')).toBeNull();
    } finally {
      sync.stop();
      viewport.destroy();
      manager.cancelAll();
      highlighter.destroy();
    }
  });
});
