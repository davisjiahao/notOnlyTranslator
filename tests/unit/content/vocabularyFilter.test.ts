import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  VocabularyFilter,
  STOP_WORDS,
  type VocabularyFilterConfig,
  type FilterResult,
} from '@/content/vocabularyFilter';
import { frequencyManager } from '@/background/frequencyManager';
import type { UserProfile } from '@/shared/types';

// Mock FrequencyManager
vi.mock('@/background/frequencyManager', () => ({
  frequencyManager: {
    getDifficulty: vi.fn(),
    initialize: vi.fn(),
  },
}));

describe('VocabularyFilter', () => {
  let filter: VocabularyFilter;
  let mockUserProfile: UserProfile;
  let mockFrequencyManager: typeof frequencyManager;

  // 辅助函数：创建段落
  function createParagraph(text: string): {
    id: string;
    element: HTMLElement;
    text: string;
    wordCount: number;
  } {
    const element = document.createElement('p');
    element.textContent = text;
    return {
      id: `para-${Math.random().toString(36).slice(2, 9)}`,
      element,
      text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
    };
  }

  beforeEach(() => {
    // 重置 mock
    vi.resetAllMocks();

    // 创建模拟用户档案（中级水平，词汇量约 5000）
    mockUserProfile = {
      examType: 'cet6',
      estimatedVocabulary: 5000,
      knownWords: ['apple', 'banana', 'computer'],
      unknownWords: [],
      levelConfidence: 0.8,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 设置默认难度返回值
    mockFrequencyManager = frequencyManager;
    (mockFrequencyManager.getDifficulty as ReturnType<typeof vi.fn>).mockImplementation(
      (word: string) => {
        // 模拟难度：简单词 1-3，中等 4-6，困难 7-10
        const easyWords = ['the', 'is', 'are', 'have', 'been', 'word', 'hello'];
        const hardWords = ['serendipity', 'ephemeral', 'obfuscate', 'paradigm', 'algorithm'];
        const mediumWords = ['computer', 'science', 'knowledge', 'vocabulary'];

        const lowerWord = word.toLowerCase();
        if (easyWords.includes(lowerWord)) return 2;
        if (hardWords.includes(lowerWord)) return 9;
        if (mediumWords.includes(lowerWord)) return 5;
        return 5; // 默认中等难度
      }
    );

    filter = new VocabularyFilter(mockUserProfile, mockFrequencyManager);
  });

  describe('filter', () => {
    it('should filter words above user level', () => {
      // 词汇量 5000 的用户阈值是 3（CET-6 及以上）
      // 难度 9 > 3，应该被包含
      const paragraphs = [
        createParagraph('This serendipity is amazing'),
      ];

      const results = filter.filter(paragraphs);

      // serendipity 难度 9 > 阈值 3，应该被返回
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r: FilterResult) => r.word.toLowerCase() === 'serendipity')).toBe(true);
      expect(results.every((r: FilterResult) => r.difficulty > 3)).toBe(true);
    });

    it('should exclude stop words', () => {
      const paragraphs = [
        createParagraph('The is are have been'),
      ];

      const results = filter.filter(paragraphs);

      // 停用词应该被排除
      const resultWords = results.map((r: FilterResult) => r.word.toLowerCase());
      expect(resultWords).not.toContain('the');
      expect(resultWords).not.toContain('is');
      expect(resultWords).not.toContain('are');
      expect(resultWords).not.toContain('have');
      expect(resultWords).not.toContain('been');
    });

    it('should deduplicate words across paragraphs', () => {
      const paragraphs = [
        createParagraph('Serendipity happened yesterday'),
        createParagraph('Another serendipity today'),
        createParagraph('Serendipity is everywhere'),
      ];

      const results = filter.filter(paragraphs);

      // serendipity 应该只出现一次
      const serendipityCount = results.filter(
        (r: FilterResult) => r.word.toLowerCase() === 'serendipity'
      ).length;
      expect(serendipityCount).toBe(1);
    });

    it('should skip known words', () => {
      // apple 和 banana 在 knownWords 中
      const paragraphs = [
        createParagraph('I ate apple and banana today'),
      ];

      const results = filter.filter(paragraphs);

      // knownWords 中的词应该被跳过
      const resultWords = results.map((r: FilterResult) => r.word.toLowerCase());
      expect(resultWords).not.toContain('apple');
      expect(resultWords).not.toContain('banana');
    });

    it('should respect minimum word length', () => {
      const paragraphs = [
        createParagraph('I go to the zoo and see cats'), // 短词
        createParagraph('serendipity is wonderful'), // 长词
      ];

      const results = filter.filter(paragraphs);

      // 所有返回的单词长度都应该 >= 3
      expect(results.every((r: FilterResult) => r.word.length >= 3)).toBe(true);
      // 单字母词应该被排除
      const resultWords = results.map((r: FilterResult) => r.word.toLowerCase());
      expect(resultWords).not.toContain('i');
      expect(resultWords).not.toContain('a');
    });

    it('should skip pure numbers', () => {
      const paragraphs = [
        createParagraph('In 2024 and 123 there are many things'),
      ];

      const results = filter.filter(paragraphs);

      // 纯数字应该被排除
      const resultWords = results.map((r: FilterResult) => r.word);
      expect(resultWords).not.toContain('2024');
      expect(resultWords).not.toContain('123');
    });

    it('should handle hyphenated words', () => {
      const paragraphs = [
        createParagraph('Well-known facts are easy'),
      ];

      // mock 设置 well-known 的难度为 6
      (mockFrequencyManager.getDifficulty as ReturnType<typeof vi.fn>).mockImplementation(
        (word: string) => {
          if (word.toLowerCase() === 'well-known') return 6;
          return 2;
        }
      );

      const results = filter.filter(paragraphs);

      // well-known 应该被识别为一个单词（如果难度超过阈值）
      const resultWords = results.map((r: FilterResult) => r.word.toLowerCase());
      expect(resultWords).toContain('well-known');
    });

    it('should handle empty paragraphs', () => {
      const paragraphs: ReturnType<typeof createParagraph>[] = [];
      const results = filter.filter(paragraphs);
      expect(results).toEqual([]);
    });

    it('should handle paragraphs with only stop words', () => {
      const paragraphs = [
        createParagraph('The is are have been was were'),
      ];

      const results = filter.filter(paragraphs);
      expect(results).toEqual([]);
    });
  });

  describe('isWordEligible', () => {
    it('should return false for short words', () => {
      expect(filter.isWordEligible('a')).toBe(false);
      expect(filter.isWordEligible('ab')).toBe(false);
    });

    it('should return true for words meeting minimum length', () => {
      expect(filter.isWordEligible('abc')).toBe(true);
      expect(filter.isWordEligible('hello')).toBe(true);
    });

    it('should return false for pure numbers', () => {
      expect(filter.isWordEligible('123')).toBe(false);
      expect(filter.isWordEligible('2024')).toBe(false);
    });

    it('should return true for words with numbers', () => {
      expect(filter.isWordEligible('abc123')).toBe(true);
    });

    it('should return false for stop words', () => {
      expect(filter.isWordEligible('the')).toBe(false);
      expect(filter.isWordEligible('is')).toBe(false);
      expect(filter.isWordEligible('and')).toBe(false);
    });

    it('should handle case insensitive stop words', () => {
      expect(filter.isWordEligible('THE')).toBe(false);
      expect(filter.isWordEligible('Is')).toBe(false);
    });
  });

  describe('getWordDifficulty', () => {
    it('should return difficulty from frequency manager', () => {
      (mockFrequencyManager.getDifficulty as ReturnType<typeof vi.fn>).mockReturnValue(7);
      const difficulty = filter.getWordDifficulty('test');
      expect(difficulty).toBe(7);
      expect(mockFrequencyManager.getDifficulty).toHaveBeenCalledWith('test');
    });
  });

  describe('updateUserLevel', () => {
    it('should update known words set', () => {
      const newProfile: UserProfile = {
        ...mockUserProfile,
        knownWords: ['apple', 'banana', 'cherry', 'date'],
      };

      filter.updateUserLevel(newProfile);

      // cherry 和 date 现在应该被识别为已知
      const paragraphs = [
        createParagraph('Cherry and date are fruits'),
      ];

      const results = filter.filter(paragraphs);
      const resultWords = results.map((r: FilterResult) => r.word.toLowerCase());
      expect(resultWords).not.toContain('cherry');
      expect(resultWords).not.toContain('date');
    });
  });

  describe('config', () => {
    it('should get current config', () => {
      const config = filter.getConfig();
      expect(config.minWordLength).toBe(3);
      expect(config.excludeCommonWords).toBe(true);
    });

    it('should update config', () => {
      filter.updateConfig({ minWordLength: 5 });
      const config = filter.getConfig();
      expect(config.minWordLength).toBe(5);
    });

    it('should use custom config in constructor', () => {
      const customFilter = new VocabularyFilter(
        mockUserProfile,
        mockFrequencyManager,
        { minWordLength: 5, excludeCommonWords: false }
      );

      const config = customFilter.getConfig();
      expect(config.minWordLength).toBe(5);
      expect(config.excludeCommonWords).toBe(false);
    });

    it('should respect custom minWordLength', () => {
      filter.updateConfig({ minWordLength: 5 });

      const paragraphs = [
        createParagraph('Word test longwords here'),
      ];

      const results = filter.filter(paragraphs);

      // 所有返回的单词长度都应该 >= 5
      expect(results.every((r: FilterResult) => r.word.length >= 5)).toBe(true);
    });

    it('should not exclude stop words when configured', () => {
      // 创建一个不排除停用词的过滤器，同时将最小长度设为 2
      const customFilter = new VocabularyFilter(
        mockUserProfile,
        mockFrequencyManager,
        { excludeCommonWords: false, minWordLength: 2 }
      );

      // mock the 难度为高
      (mockFrequencyManager.getDifficulty as ReturnType<typeof vi.fn>).mockReturnValue(10);

      const paragraphs = [
        createParagraph('The is serendipity amazing'),
      ];

      const results = customFilter.filter(paragraphs);
      const resultWords = results.map((r: FilterResult) => r.word.toLowerCase());

      // 当 excludeCommonWords 为 false 时，停用词应该被包含（如果难度足够高且长度符合）
      expect(resultWords).toContain('the');
      expect(resultWords).toContain('is');
    });
  });

  describe('STOP_WORDS', () => {
    it('should contain common stop words', () => {
      expect(STOP_WORDS.has('the')).toBe(true);
      expect(STOP_WORDS.has('is')).toBe(true);
      expect(STOP_WORDS.has('and')).toBe(true);
      expect(STOP_WORDS.has('of')).toBe(true);
      expect(STOP_WORDS.has('to')).toBe(true);
    });

    it('should contain articles', () => {
      expect(STOP_WORDS.has('a')).toBe(true);
      expect(STOP_WORDS.has('an')).toBe(true);
    });

    it('should contain pronouns', () => {
      expect(STOP_WORDS.has('i')).toBe(true);
      expect(STOP_WORDS.has('you')).toBe(true);
      expect(STOP_WORDS.has('he')).toBe(true);
      expect(STOP_WORDS.has('she')).toBe(true);
    });

    it('should contain be verbs', () => {
      expect(STOP_WORDS.has('am')).toBe(true);
      expect(STOP_WORDS.has('is')).toBe(true);
      expect(STOP_WORDS.has('are')).toBe(true);
      expect(STOP_WORDS.has('was')).toBe(true);
      expect(STOP_WORDS.has('were')).toBe(true);
    });
  });

  describe('user level thresholds', () => {
    it('should use threshold 2 for beginners (< 3000 words)', () => {
      const beginnerProfile: UserProfile = {
        ...mockUserProfile,
        estimatedVocabulary: 2000,
      };
      const beginnerFilter = new VocabularyFilter(beginnerProfile, mockFrequencyManager);

      // mock: difficulty 3 的词应该被包含（因为 3 > 2）
      (mockFrequencyManager.getDifficulty as ReturnType<typeof vi.fn>).mockReturnValue(3);

      const paragraphs = [
        createParagraph('Test word here'),
      ];

      const results = beginnerFilter.filter(paragraphs);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should use threshold 8 for experts (> 12000 words)', () => {
      const expertProfile: UserProfile = {
        ...mockUserProfile,
        estimatedVocabulary: 15000,
      };
      const expertFilter = new VocabularyFilter(expertProfile, mockFrequencyManager);

      // mock: difficulty 9 的词应该被包含（因为 9 > 8）
      (mockFrequencyManager.getDifficulty as ReturnType<typeof vi.fn>).mockReturnValue(9);

      const paragraphs = [
        createParagraph('Serendipity is amazing'),
      ];

      const results = expertFilter.filter(paragraphs);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should not include words at threshold level', () => {
      // 词汇量 5000，阈值是 3
      // 难度 3 的词不应该被包含
      (mockFrequencyManager.getDifficulty as ReturnType<typeof vi.fn>).mockReturnValue(3);

      const paragraphs = [
        createParagraph('Test word here'),
      ];

      const results = filter.filter(paragraphs);
      // 难度 3 <= 阈值 3，不应该被包含
      expect(results.length).toBe(0);
    });
  });
});
