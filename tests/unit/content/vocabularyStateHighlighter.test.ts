/**
 * VocabularyHighlighter 词汇状态同步行为测试
 *
 * 覆盖：认识/不认识/撤销的 DOM 重扫、无残留标记、词表整体注入、
 * 等级变化自动重扫、公开 rescan/destroy、VocabularyService 词表不可变
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import { VocabularyHighlighter } from '@/content/vocabularyHighlighter';
import { VocabularyService } from '@/shared/utils/vocabularyService';

const EPHEMERAL_TEXT = 'The ephemeral nature of existence.';
// time/place 属于 COMMON_WORDS（A1），对 A1 用户天然不高亮，适合验证“标记后高亮”
const COMMON_TEXT = 'The time has come for us here now.';

/** 统计元素内指定单词的 mark 标记（含残留标记） */
function marksFor(root: ParentNode, word: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`mark[data-word="${word.toLowerCase()}"]`));
}

describe('VocabularyHighlighter 词汇状态同步', () => {
  let highlighter: VocabularyHighlighter;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
  });

  describe('addKnownWord', () => {
    it('标记认识后该词的 mark 移除且原文保留', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(marksFor(el, 'ephemeral').length).toBeGreaterThan(0);

      highlighter.addKnownWord('Ephemeral');

      // 认识 → 目标词 mark 完全移除，不留 DOM 标记残留，文本保持不变
      expect(marksFor(el, 'ephemeral')).toHaveLength(0);
      expect(el.textContent).toBe(EPHEMERAL_TEXT);
      expect(highlighter.isHighlighted('ephemeral')).toBe(false);
    });

    it('标记认识后从高亮词表中移除', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      highlighter.addKnownWord('ephemeral');

      expect(highlighter.isHighlighted('ephemeral')).toBe(false);
      expect(
        highlighter.getHighlightedWords().some((w) => w.word.toLowerCase() === 'ephemeral')
      ).toBe(false);
    });

    it('对未高亮词不报错', () => {
      expect(() => highlighter.addKnownWord('neverheard')).not.toThrow();
    });
  });

  describe('addUnknownWord', () => {
    it('标记不认识后立即重扫并在 DOM 中生成高亮', () => {
      const el = document.createElement('div');
      el.textContent = COMMON_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(marksFor(el, 'time').length).toBe(0);

      highlighter.addUnknownWord('time');

      expect(marksFor(el, 'time').length).toBeGreaterThan(0);
    });

    it('不报错', () => {
      expect(() => highlighter.addUnknownWord('someunknownword')).not.toThrow();
    });
  });

  describe('removeKnownWord（撤销认识）', () => {
    it('撤销后按等级恢复高亮', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      highlighter.addKnownWord('ephemeral');
      expect(marksFor(el, 'ephemeral')).toHaveLength(0);

      highlighter.removeKnownWord('ephemeral');
      const restored = marksFor(el, 'ephemeral')[0];
      expect(restored).toBeDefined();
      expect(restored!.classList.contains('not-translator-vocab-highlight')).toBe(true);
      expect(restored!.classList.contains('vocab-known')).toBe(false);
    });
  });

  describe('removeUnknownWord（撤销不认识）', () => {
    it('撤销后按等级重新评估，等级内词不再高亮', () => {
      const el = document.createElement('div');
      el.textContent = COMMON_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      highlighter.addUnknownWord('time');
      expect(marksFor(el, 'time').length).toBeGreaterThan(0);

      highlighter.removeUnknownWord('time');
      expect(marksFor(el, 'time').length).toBe(0);
    });
  });

  describe('updateConfig 等级变化', () => {
    it('等级降低后自动重扫，新超纲词获得高亮', () => {
      const h = new VocabularyHighlighter({ userLevel: 'C2', enabled: true });
      const el = document.createElement('div');
      el.textContent = 'Careful analysis of the data reveals a clear pattern here.';
      document.body.appendChild(el);

      h.highlightElement(el);
      expect(marksFor(el, 'analysis').length).toBe(0);

      h.updateConfig({ userLevel: 'A1' });

      expect(marksFor(el, 'analysis').length).toBeGreaterThan(0);
    });

    it('等级升高后自动重扫，原超纲词不再高亮', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(marksFor(el, 'ephemeral').length).toBeGreaterThan(0);

      highlighter.updateConfig({ userLevel: 'C2' });
      expect(marksFor(el, 'ephemeral').length).toBe(0);
      expect(el.textContent).toBe(EPHEMERAL_TEXT);
    });
  });

  describe('setCustomWords', () => {
    it('整体注入词表后重扫：未知词获得高亮', () => {
      const el = document.createElement('div');
      el.textContent = COMMON_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(marksFor(el, 'time').length).toBe(0);

      highlighter.setCustomWords(new Set(['ephemeral']), new Set(['time']));

      expect(marksFor(el, 'time').length).toBeGreaterThan(0);
    });

    it('整体注入词表后重扫：已知词不再高亮', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(marksFor(el, 'ephemeral').length).toBeGreaterThan(0);

      highlighter.setCustomWords(['ephemeral'], []);

      expect(marksFor(el, 'ephemeral').length).toBe(0);
      expect(el.textContent).toBe(EPHEMERAL_TEXT);
    });
  });

  describe('rescan / destroy', () => {
    it('rescan 按当前词表重建高亮', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      highlighter.clearAllHighlights();
      expect(el.querySelectorAll('mark').length).toBe(0);

      highlighter.rescan();
      expect(marksFor(el, 'ephemeral').length).toBeGreaterThan(0);
    });

    it('destroy 清除高亮与状态，之后不再处理新元素', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      highlighter.destroy();

      expect(el.querySelectorAll('mark').length).toBe(0);
      expect(el.classList.contains('not-translator-vocab-processed')).toBe(false);
      expect(highlighter.getHighlightedWords()).toEqual([]);

      const el2 = document.createElement('div');
      el2.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el2);
      expect(highlighter.highlightElement(el2)).toEqual([]);
      expect(el2.querySelectorAll('mark').length).toBe(0);
    });

    it('rescan 跳过已从文档移除的根元素且不报错', () => {
      const el = document.createElement('div');
      el.textContent = EPHEMERAL_TEXT;
      document.body.appendChild(el);
      highlighter.highlightElement(el);
      el.remove();

      expect(() => highlighter.rescan()).not.toThrow();
    });
  });
});

describe('VocabularyService 词表不可变', () => {
  it('addKnownWord/addUnknownWord 互斥迁移且生成新集合', () => {
    const svc = new VocabularyService({ userLevel: 'B1' });
    svc.addKnownWord('Sun');

    expect(svc.getKnownWords().has('sun')).toBe(true);

    const knownBefore = svc.getKnownWords();
    svc.addUnknownWord('sun');

    expect(knownBefore.has('sun')).toBe(true); // 旧集合不被原地修改
    expect(svc.getKnownWords().has('sun')).toBe(false);
    expect(svc.getUnknownWords().has('sun')).toBe(true);

    svc.removeUnknownWord('sun');
    expect(svc.getUnknownWords().has('sun')).toBe(false);
  });

  it('getConfig 返回副本，外部修改不影响内部状态', () => {
    const svc = new VocabularyService({ userLevel: 'B1' });
    svc.addKnownWord('alpha');

    const config = svc.getConfig();
    config.customKnownWords.add('hack');

    expect(svc.getKnownWords().has('hack')).toBe(false);
  });

  it('setCustomWords 整体替换词表并规范化', () => {
    const svc = new VocabularyService({ userLevel: 'B1' });
    svc.setCustomWords([' Alpha '], ['BETA']);

    expect(svc.getKnownWords().has('alpha')).toBe(true);
    expect(svc.getUnknownWords().has('beta')).toBe(true);

    svc.setCustomWords([], ['gamma']);
    expect(svc.getKnownWords().size).toBe(0);
    expect(svc.getUnknownWords().has('gamma')).toBe(true);
  });
});
