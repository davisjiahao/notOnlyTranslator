import { afterEach, describe, expect, it, vi } from 'vitest';

interface ActionHost {
  lastMarkAction: { type: 'known' | 'unknown' | 'add'; word: string; translation: string } | null;
  marker: { getSelectionContext: () => string; addToVocabulary: () => Promise<boolean>; markKnown: () => Promise<void> };
  highlighter: { markAsUnknown: () => void; markAsKnown: () => void };
  handleAddToVocabulary: (word: string, translation: string) => Promise<boolean>;
  handleMarkKnown: (word: string) => Promise<void>;
}
afterEach(() => vi.unstubAllGlobals());
async function makeHost(save: () => Promise<boolean>) {
  // 不启动自动注入；直接执行真实原型上的消息动作，避免复制实现。
  vi.stubGlobal('chrome', undefined);
  const { NotOnlyTranslator } = await import('@/content/index');
  const host = Object.create(NotOnlyTranslator.prototype) as ActionHost;
  host.lastMarkAction = null;
  host.marker = { getSelectionContext: () => '语境', addToVocabulary: save, markKnown: async () => undefined };
  host.highlighter = { markAsUnknown: vi.fn(), markAsKnown: vi.fn() };
  return host;
}

describe('收藏确认不能覆盖后来的标词动作', () => {
  it('迟到收藏成功不把另一词的撤销指针改回旧词', async () => {
    let finish!: (saved: boolean) => void;
    const host = await makeHost(() => new Promise(resolve => { finish = resolve; }));
    const first = host.handleAddToVocabulary('apple', '苹果');
    await host.handleMarkKnown('book');
    finish(true);
    expect(await first).toBe(true);
    expect(host.lastMarkAction?.word).toBe('book');
  });
  it('收藏失败恢复此前动作，不显示成功高亮', async () => {
    const host = await makeHost(async () => false);
    host.lastMarkAction = { type: 'known', word: 'book', translation: '' };
    expect(await host.handleAddToVocabulary('apple', '苹果')).toBe(false);
    expect(host.lastMarkAction?.word).toBe('book');
    expect(host.highlighter.markAsUnknown).not.toHaveBeenCalled();
  });
});
