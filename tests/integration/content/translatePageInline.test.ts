import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSS_CLASSES } from '@/shared/constants';
import { getTranslatableText } from '@/content/pageScanner';

const sendTranslationMessage = vi.fn();
vi.mock('@/content/translationMessaging', () => ({
  sendTranslationMessage,
  cancelTranslationMessages: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', undefined);
  document.body.innerHTML = '<p>The ubiquitous word appears here in context, and this sentence is long enough to be translated.</p>';
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('整页翻译的行内词汇结果', () => {
  it('没有 fullText 也保留原文并渲染本地词义标记', async () => {
    sendTranslationMessage.mockResolvedValue({ success: true, data: { results: [{ result: {
      words: [{ original: 'ubiquitous', translation: '无处不在的', position: [4, 14], difficulty: 8, isPhrase: false }],
      sentences: [],
    } }] } });
    const { NotOnlyTranslator } = await import('@/content/index');
    const instance = Object.assign(Object.create(NotOnlyTranslator.prototype), {
      translationGeneration: 0,
      destroyed: false,
      tooltip: { hide: vi.fn() },
      isEnabled: true,
      settings: { enabled: true, translationMode: 'inline-only' },
    }) as { handleTranslatePage(): Promise<void> };

    await instance.handleTranslatePage();

    const paragraph = document.querySelector('p')!;
    expect(getTranslatableText(paragraph)).toBe('The ubiquitous word appears here in context, and this sentence is long enough to be translated.');
    const mark = paragraph.querySelector(`mark.${CSS_CLASSES.HIGHLIGHT}`);
    expect(mark?.firstChild?.textContent).toBe('ubiquitous');
    expect(mark?.querySelector('.not-translator-inline-translation')?.textContent).toBe('无处不在的');
    expect(mark?.textContent).toBe('ubiquitous无处不在的');
    expect(mark?.getAttribute('data-translation')).toBe('无处不在的');
  });
});
