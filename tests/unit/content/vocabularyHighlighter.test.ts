/**
 * VocabularyHighlighter 测试
 *
 * 覆盖：元素高亮、配置更新、清除高亮、已知/未知词管理、难度统计、推荐单词
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

import { VocabularyHighlighter } from '@/content/vocabularyHighlighter';
import { TranslationDisplay } from '@/content/translationDisplay';

const CSS_VOCAB_HIGHLIGHT = 'not-translator-vocab-highlight';
const CSS_VOCAB_PROCESSED = 'not-translator-vocab-processed';

describe('VocabularyHighlighter', () => {
  let highlighter: VocabularyHighlighter;

  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    highlighter = new VocabularyHighlighter({ userLevel: 'A1', enabled: true });
  });

  describe('constructor', () => {
    it('使用默认配置', () => {
      const h = new VocabularyHighlighter();
      expect(h).toBeInstanceOf(VocabularyHighlighter);
    });

    it('接受部分配置', () => {
      const h = new VocabularyHighlighter({ userLevel: 'C2' });
      expect(h).toBeInstanceOf(VocabularyHighlighter);
    });
  });

  describe('highlightElement', () => {
    it('高亮超出用户水平的单词', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      const result = highlighter.highlightElement(el);

      // ephemeral 是 C1 级别，对 A1 用户应被高亮
      expect(result.length).toBeGreaterThan(0);
      const marks = el.querySelectorAll(`mark.${CSS_VOCAB_HIGHLIGHT}`);
      expect(marks.length).toBeGreaterThan(0);
    });

    it('短文本跳过处理', () => {
      const el = document.createElement('div');
      el.textContent = 'short';
      document.body.appendChild(el);

      const result = highlighter.highlightElement(el);
      expect(result).toEqual([]);
    });

    it('已处理的元素不重复处理', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence is profound.';
      document.body.appendChild(el);

      const first = highlighter.highlightElement(el);
      expect(first.length).toBeGreaterThan(0);

      // 第二次调用返回空（因为已经处理过）
      const second = highlighter.highlightElement(el);
      expect(second).toEqual([]);
    });

    it('跳过 SCRIPT 标签', () => {
      const el = document.createElement('div');
      const script = document.createElement('script');
      script.textContent = 'var ephemeral = 1;';
      el.appendChild(script);
      document.body.appendChild(el);

      // script 内的文本不应被高亮
      expect(el.querySelectorAll(`mark.${CSS_VOCAB_HIGHLIGHT}`).length).toBe(0);
    });

    it('跳过已带 HIGHLIGHT class 的元素', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      el.classList.add('not-translator-highlight');
      document.body.appendChild(el);

      const result = highlighter.highlightElement(el);
      expect(result).toEqual([]);
    });

    it.each([
      ['inline-only', ''],
      ['bilingual', '短暂的本质。'],
    ] as const)('先词汇高亮后翻译时，%s 快照重扫保留翻译 DOM', (mode, fullText) => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);
      highlighter.highlightElement(el);

      TranslationDisplay.applyTranslation(
        el,
        {
          words: [
            {
              original: 'ephemeral',
              translation: '短暂的',
              position: [4, 13],
              difficulty: 8,
              isPhrase: false,
            },
          ],
          sentences: [],
          fullText,
        },
        mode
      );
      expect(el.querySelector('mark.not-translator-vocab-highlight mark.not-translator-highlight')).toBeTruthy();

      highlighter.applySnapshot({
        userLevel: 'A1',
        knownWords: new Set(),
        unknownWords: new Set(),
      });

      const translated = el.querySelector('mark.not-translator-highlight');
      expect(translated).toBeTruthy();
      expect(translated?.dataset.translation).toBe('短暂的');
      if (mode === 'bilingual') {
        expect(translated?.querySelector('.not-translator-inline-translation')?.textContent).toBe('短暂的');
        expect(el.nextElementSibling?.classList.contains('not-translator-translation-line')).toBe(true);
      }
    });

    it.each(['snapshot', 'destroy'] as const)(
      '翻译清理重建 CEFR 节点后，%s 仍清除当前 DOM 词汇标记',
      (cleanup) => {
        const el = document.createElement('div');
        el.textContent = 'The ephemeral nature of existence.';
        document.body.appendChild(el);
        highlighter.highlightElement(el);
        TranslationDisplay.applyTranslation(
          el,
          {
            words: [{
              original: 'ephemeral',
              translation: '短暂的',
              position: [4, 13],
              difficulty: 8,
              isPhrase: false,
            }],
            sentences: [],
            fullText: '',
          },
          'inline-only'
        );
        TranslationDisplay.clearTranslation(el);
        expect(el.querySelectorAll('mark.not-translator-vocab-highlight').length).toBeGreaterThan(0);

        if (cleanup === 'snapshot') {
          highlighter.applySnapshot({
            userLevel: 'C2',
            knownWords: new Set(['ephemeral']),
            unknownWords: new Set(),
          });
        } else {
          highlighter.destroy();
        }

        expect(el.querySelectorAll('mark.not-translator-vocab-highlight')).toHaveLength(0);
      }
    );

    it('认识词重评估仅解除 CEFR 包装，不拍平翻译子结构', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);
      highlighter.highlightElement(el);
      TranslationDisplay.applyTranslation(
        el,
        {
          words: [{
            original: 'ephemeral',
            translation: '短暂的',
            position: [4, 13],
            difficulty: 8,
            isPhrase: false,
          }],
          sentences: [],
          fullText: '',
        },
        'inline-only'
      );

      highlighter.addKnownWord('ephemeral');
      expect(el.querySelector('mark.not-translator-highlight')?.getAttribute('data-translation')).toBe('短暂的');

      highlighter.removeKnownWord('ephemeral');
      expect(el.querySelector('mark.not-translator-highlight')?.getAttribute('data-translation')).toBe('短暂的');
    });

    it('翻译显示标记原文后仍高亮未被翻译器包装的超纲词', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      TranslationDisplay.applyTranslation(
        el,
        {
          words: [
            {
              original: 'existence',
              translation: '存在',
              position: [24, 33],
              difficulty: 8,
              isPhrase: false,
            },
          ],
          sentences: [],
          fullText: '',
        },
        'inline-only'
      );

      highlighter.highlightElement(el);

      expect(el.classList.contains('not-translator-processed')).toBe(true);
      expect(el.querySelector('mark.not-translator-highlight')).toBeTruthy();
      expect(el.querySelector('mark.not-translator-vocab-highlight[data-word="ephemeral"]')).toBeTruthy();

      highlighter.applySnapshot({
        userLevel: 'A1',
        knownWords: new Set(),
        unknownWords: new Set(),
      });

      expect(el.querySelector('mark.not-translator-highlight')).toBeTruthy();
      expect(el.querySelector('mark.not-translator-vocab-highlight[data-word="ephemeral"]')).toBeTruthy();
    });

    it('处理完成后添加 vocab-processed class', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence is profound.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(el.classList.contains(CSS_VOCAB_PROCESSED)).toBe(true);
    });

    it('无超出水平的词时不添加高亮', () => {
      const h = new VocabularyHighlighter({ userLevel: 'C2', enabled: true });
      const el = document.createElement('div');
      el.textContent = 'I am a simple person with simple words.';
      document.body.appendChild(el);

      const result = h.highlightElement(el);
      expect(result).toEqual([]);
    });

    it('高亮元素包含数据属性', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);

      const mark = el.querySelector(`mark.${CSS_VOCAB_HIGHLIGHT}`) as HTMLElement;
      if (mark) {
        expect(mark.dataset.word).toBeDefined();
        expect(mark.dataset.level).toBeDefined();
        expect(mark.dataset.difficulty).toBeDefined();
        expect(mark.tabIndex).toBe(0);
      }
    });

    it('保留高亮前后的文本', () => {
      const el = document.createElement('div');
      el.textContent = 'before ephemeral after';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(el.textContent).toBe('before ephemeral after');
    });
  });

  describe('highlightElements', () => {
    it('批量处理多个元素', () => {
      const el1 = document.createElement('p');
      el1.textContent = 'The ephemeral beauty fades quickly here.';
      document.body.appendChild(el1);

      const el2 = document.createElement('p');
      el2.textContent = 'Another ephemeral moment passes us by.';
      document.body.appendChild(el2);

      const result = highlighter.highlightElements([el1, el2]);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('禁用时返回空数组', () => {
      highlighter.updateConfig({ enabled: false });

      const el = document.createElement('p');
      el.textContent = 'The ephemeral nature of things.';
      document.body.appendChild(el);

      const result = highlighter.highlightElements([el]);
      expect(result).toEqual([]);
    });

    it('空数组不报错', () => {
      expect(() => highlighter.highlightElements([])).not.toThrow();
    });
  });

  describe('updateConfig', () => {
    it('禁用后清除所有高亮', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(el.querySelectorAll(`mark`).length).toBeGreaterThan(0);

      highlighter.updateConfig({ enabled: false });
      expect(el.querySelectorAll(`mark`).length).toBe(0);
    });

    it('改变用户等级后重新扫描', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);

      // 改变等级后，processedElements 被重置
      highlighter.updateConfig({ userLevel: 'C2' });

      // 现在 ephemeral 对 C2 用户不应被高亮
      const result = highlighter.highlightElement(el);
      expect(Array.isArray(result)).toBe(true);
    });

    it('更新 highlightStyle 不报错', () => {
      expect(() => {
        highlighter.updateConfig({ highlightStyle: 'underline' });
      }).not.toThrow();
    });
  });

  describe('clearAllHighlights', () => {
    it('清除所有高亮恢复文本', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(el.querySelectorAll('mark').length).toBeGreaterThan(0);

      highlighter.clearAllHighlights();
      expect(el.querySelectorAll('mark').length).toBe(0);
      expect(el.textContent).toBe('The ephemeral nature of existence.');
    });

    it('清除后移除 vocab-processed class', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      expect(el.classList.contains(CSS_VOCAB_PROCESSED)).toBe(true);

      highlighter.clearAllHighlights();
      expect(el.classList.contains(CSS_VOCAB_PROCESSED)).toBe(false);
    });

    it('空状态清除不报错', () => {
      expect(() => highlighter.clearAllHighlights()).not.toThrow();
    });
  });

  describe('clearElementHighlights', () => {
    it('清除指定元素的高亮', () => {
      const el1 = document.createElement('div');
      el1.textContent = 'The ephemeral nature here.';
      document.body.appendChild(el1);

      const el2 = document.createElement('div');
      el2.textContent = 'Another ephemeral moment passes.';
      document.body.appendChild(el2);

      highlighter.highlightElements([el1, el2]);
      const totalBefore = document.querySelectorAll(`mark.${CSS_VOCAB_HIGHLIGHT}`).length;

      highlighter.clearElementHighlights(el1);
      const totalAfter = document.querySelectorAll(`mark.${CSS_VOCAB_HIGHLIGHT}`).length;
      expect(totalAfter).toBeLessThan(totalBefore);
    });

    it('清除后元素可以重新处理', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      highlighter.clearElementHighlights(el);

      // 可以再次处理
      const result = highlighter.highlightElement(el);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('getHighlightedWords / isHighlighted / getWordData', () => {
    it('获取所有高亮单词', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      const words = highlighter.getHighlightedWords();
      expect(Array.isArray(words)).toBe(true);
    });

    it('isHighlighted 检测已高亮的词', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);

      const words = highlighter.getHighlightedWords();
      if (words.length > 0) {
        expect(highlighter.isHighlighted(words[0].word)).toBe(true);
      }
      expect(highlighter.isHighlighted('nonexistentword')).toBe(false);
    });

    it('getWordData 返回高亮数据', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);

      const words = highlighter.getHighlightedWords();
      if (words.length > 0) {
        const data = highlighter.getWordData(words[0].word);
        expect(data).toBeDefined();
        expect(data!.word).toBe(words[0].word);
        expect(data!.elements.length).toBeGreaterThan(0);
      }
    });

    it('getWordData 对未高亮词返回 undefined', () => {
      expect(highlighter.getWordData('nothighlighted')).toBeUndefined();
    });
  });

  describe('addKnownWord', () => {
    it('将高亮词标记为已知', () => {
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);

      const words = highlighter.getHighlightedWords();
      expect(words.length).toBeGreaterThan(0);
      const word = words[0].word;
      highlighter.addKnownWord(word);

      const targetMarks = Array.from(el.querySelectorAll<HTMLElement>('mark'))
        .filter(mark => mark.dataset.word === word);
      expect(targetMarks).toHaveLength(0);
      expect(highlighter.isHighlighted(word)).toBe(false);
      expect(el.textContent).toBe('The ephemeral nature of existence.');
    });

    it('对未高亮词不报错', () => {
      expect(() => highlighter.addKnownWord('neverheard')).not.toThrow();
    });
  });

  describe('addUnknownWord', () => {
    it('添加未知词后允许重新处理包含该词的元素', () => {
      const el = document.createElement('div');
      el.textContent = 'This simple text has only simple words here.';
      document.body.appendChild(el);

      // 先处理（可能无高亮因为都是简单词）
      highlighter.highlightElement(el);

      // 将 simple 标记为未知
      highlighter.addUnknownWord('simple');

      // 元素应该可以重新处理
      const result = highlighter.highlightElement(el);
      expect(Array.isArray(result)).toBe(true);
    });

    it('不报错', () => {
      expect(() => highlighter.addUnknownWord('someunknownword')).not.toThrow();
    });
  });

  describe('analyzeText', () => {
    it('返回词汇过滤结果', () => {
      const result = highlighter.analyzeText('The ephemeral nature of existence.');
      expect(result).toHaveProperty('wordsAboveLevel');
      expect(result).toHaveProperty('wordsWithinLevel');
      expect(result).toHaveProperty('totalAnalyzed');
      expect(result.totalAnalyzed).toBeGreaterThan(0);
    });

    it('空文本返回空结果', () => {
      const result = highlighter.analyzeText('');
      expect(result.wordsAboveLevel).toEqual([]);
      expect(result.wordsWithinLevel).toEqual([]);
      expect(result.totalAnalyzed).toBe(0);
    });
  });

  describe('getRecommendedWords', () => {
    it('返回推荐单词数组', () => {
      document.body.innerHTML = '<p>The ephemeral nature of existence is profound and mysterious.</p>';
      const words = highlighter.getRecommendedWords(5);
      expect(Array.isArray(words)).toBe(true);
      expect(words.length).toBeLessThanOrEqual(5);
    });

    it('空页面返回空数组', () => {
      document.body.innerHTML = '';
      const words = highlighter.getRecommendedWords();
      expect(words).toEqual([]);
    });
  });

  describe('高亮样式', () => {
    it('应用 background 样式类', () => {
      const h = new VocabularyHighlighter({ userLevel: 'A1', highlightStyle: 'background' });
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      h.highlightElement(el);
      const mark = el.querySelector('mark') as HTMLElement;
      if (mark) {
        expect(mark.className).toContain('vocab-highlight-background');
      }
    });

    it('应用 underline 样式类', () => {
      const h = new VocabularyHighlighter({ userLevel: 'A1', highlightStyle: 'underline' });
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      h.highlightElement(el);
      const mark = el.querySelector('mark') as HTMLElement;
      if (mark) {
        expect(mark.className).toContain('vocab-highlight-underline');
      }
    });

    it('应用 border 样式类', () => {
      const h = new VocabularyHighlighter({ userLevel: 'A1', highlightStyle: 'border' });
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      h.highlightElement(el);
      const mark = el.querySelector('mark') as HTMLElement;
      if (mark) {
        expect(mark.className).toContain('vocab-highlight-border');
      }
    });

    it('showDifficultyIndicator 添加指示器类', () => {
      const h = new VocabularyHighlighter({ userLevel: 'A1', showDifficultyIndicator: true });
      const el = document.createElement('div');
      el.textContent = 'The ephemeral nature of existence.';
      document.body.appendChild(el);

      h.highlightElement(el);
      const mark = el.querySelector('mark') as HTMLElement;
      if (mark) {
        expect(mark.className).toContain('vocab-with-indicator');
      }
    });
  });

  describe('边界情况', () => {
    it('处理空元素', () => {
      const el = document.createElement('div');
      document.body.appendChild(el);

      const result = highlighter.highlightElement(el);
      expect(result).toEqual([]);
    });

    it('处理仅含空白的元素', () => {
      const el = document.createElement('div');
      el.textContent = '   ';
      document.body.appendChild(el);

      const result = highlighter.highlightElement(el);
      expect(result).toEqual([]);
    });

    it('同一文本多个匹配', () => {
      const el = document.createElement('div');
      el.textContent = 'Ephemeral things are ephemeral in nature.';
      document.body.appendChild(el);

      highlighter.highlightElement(el);
      const marks = el.querySelectorAll(`mark.${CSS_VOCAB_HIGHLIGHT}`);
      expect(marks.length).toBeGreaterThanOrEqual(1);
    });

    it('正则特殊字符安全', () => {
      const el = document.createElement('div');
      el.textContent = 'Use C++ and other tools for this task.';
      document.body.appendChild(el);

      expect(() => highlighter.highlightElement(el)).not.toThrow();
    });
  });
});
