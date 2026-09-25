import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchTranslationManager } from '@/content/batchTranslationManager';
import { TranslationDisplay } from '@/content/translationDisplay';
import type { Message, MessageResponse } from '@/shared/types';

vi.mock('@/content/translationDisplay', () => ({ TranslationDisplay: {
  showLoading: vi.fn(), removeLoading: vi.fn(), saveOriginalText: vi.fn(), applyTranslation: vi.fn(),
} }));
const sendMessage = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { runtime: { sendMessage, lastError: undefined } });
  document.body.innerHTML = '<p>A difficult paragraph.</p>';
});
afterEach(() => vi.unstubAllGlobals());

describe('批量阅读过期结果保护', () => {
  it('取消已发出的批次后，不渲染其迟到结果', async () => {
    const manager = new BatchTranslationManager();
    const element = document.querySelector('p')!;
    await manager.handleVisibleParagraphs([{ id: 'p1', text: element.textContent!, element, elementPath: 'p' }]);
    const request = sendMessage.mock.calls.find(([message]: [Message]) => message.type === 'BATCH_TRANSLATE_TEXT');
    expect(request).toBeDefined();
    manager.cancelAll();
    expect(sendMessage.mock.calls.some(([message]: [Message]) => message.type === 'CANCEL_TRANSLATION')).toBe(true);
    (request![1] as (response: MessageResponse) => void)({ success: true, data: { results: [{ id: 'p1', result: { words: [], sentences: [], fullText: '迟到译文' }, cached: false }] } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(TranslationDisplay.applyTranslation).not.toHaveBeenCalled();
    expect(manager.getProcessingCount()).toBe(0);
  });

  it('切换模式时取消旧批次', async () => {
    const manager = new BatchTranslationManager();
    const element = document.querySelector('p')!;
    await manager.handleVisibleParagraphs([{ id: 'p1', text: element.textContent!, element, elementPath: 'p' }]);
    manager.setMode('bilingual');
    expect(sendMessage.mock.calls.some(([message]: [Message]) => message.type === 'CANCEL_TRANSLATION')).toBe(true);
    expect(manager.getProcessingCount()).toBe(0);
  });
});
