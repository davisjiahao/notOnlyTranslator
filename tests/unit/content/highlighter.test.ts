import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Highlighter } from '@/content/highlighter';
import { CSS_CLASSES } from '@/shared/constants';
import type { TranslatedWord } from '@/shared/types';

describe('Highlighter', () => {
  let highlighter: Highlighter;
  let testContainer: HTMLElement;

  beforeEach(() => {
    highlighter = new Highlighter();
    // 创建测试容器
    testContainer = document.createElement('div');
    testContainer.innerHTML = '<p>Hello world this is a test</p>';
    document.body.appendChild(testContainer);
  });

  describe('highlightWords', () => {
    it('应该高亮指定的单词', () => {
      const words: TranslatedWord[] = [
        { original: 'Hello', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
        { original: 'test', translation: '测试', position: [19, 23], difficulty: 3, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);

      const highlighted = testContainer.querySelectorAll(`.${CSS_CLASSES.HIGHLIGHT}`);
      expect(highlighted.length).toBe(2);
    });

    it('应该忽略空单词列表', () => {
      highlighter.highlightWords(testContainer, []);
      const highlighted = testContainer.querySelectorAll(`.${CSS_CLASSES.HIGHLIGHT}`);
      expect(highlighted.length).toBe(0);
    });

    it('应该正确处理大小写', () => {
      const words: TranslatedWord[] = [
        { original: 'HELLO', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);

      const highlighted = testContainer.querySelector(`.${CSS_CLASSES.HIGHLIGHT}`);
      expect(highlighted).toBeTruthy();
    });
  });

  describe('markAsKnown', () => {
    it('应该将单词标记为已认识', () => {
      const words: TranslatedWord[] = [
        { original: 'Hello', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);
      highlighter.markAsKnown('hello');

      const highlighted = testContainer.querySelector(`.${CSS_CLASSES.HIGHLIGHT}`);
      expect(highlighted?.classList.contains(CSS_CLASSES.KNOWN)).toBe(true);
    });
  });

  describe('markAsUnknown', () => {
    it('应该将单词标记为不认识', () => {
      const words: TranslatedWord[] = [
        { original: 'Hello', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);
      highlighter.markAsUnknown('hello');

      const highlighted = testContainer.querySelector(`.${CSS_CLASSES.HIGHLIGHT}`);
      expect(highlighted?.classList.contains(CSS_CLASSES.UNKNOWN)).toBe(true);
    });
  });

  describe('removeHighlight', () => {
    it('应该移除指定单词的高亮', () => {
      const words: TranslatedWord[] = [
        { original: 'Hello', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);
      highlighter.removeHighlight('hello');

      const highlighted = testContainer.querySelectorAll(`.${CSS_CLASSES.HIGHLIGHT}`);
      expect(highlighted.length).toBe(0);
    });
  });

  describe('clearAllHighlights', () => {
    it('应该清除所有高亮', () => {
      const words: TranslatedWord[] = [
        { original: 'Hello', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
        { original: 'world', translation: '世界', position: [6, 11], difficulty: 3, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);
      highlighter.clearAllHighlights();

      const highlighted = testContainer.querySelectorAll(`.${CSS_CLASSES.HIGHLIGHT}`);
      expect(highlighted.length).toBe(0);
    });
  });

  describe('getHighlightedWords', () => {
    it('应该返回所有高亮单词', () => {
      const words: TranslatedWord[] = [
        { original: 'Hello', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
        { original: 'world', translation: '世界', position: [6, 11], difficulty: 3, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);

      const highlightedWords = highlighter.getHighlightedWords();
      expect(highlightedWords).toContain('hello');
      expect(highlightedWords).toContain('world');
    });
  });

  describe('isHighlighted', () => {
    it('应该正确判断单词是否被高亮', () => {
      const words: TranslatedWord[] = [
        { original: 'Hello', translation: '你好', position: [0, 5], difficulty: 5, isPhrase: false },
      ];

      highlighter.highlightWords(testContainer, words);

      expect(highlighter.isHighlighted('hello')).toBe(true);
      expect(highlighter.isHighlighted('world')).toBe(false);
    });
  });
});
