import { describe, it, expect, beforeEach, vi } from 'vitest';
import { frequencyManager } from '@/background/frequencyManager';

describe('FrequencyManager', () => {
  beforeEach(async () => {
    await frequencyManager.initialize();
  });

  describe('getDifficulty', () => {
    it('应该返回1-10之间的难度值', () => {
      const difficulty = frequencyManager.getDifficulty('the');
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
    });

    it('常见单词应该返回较低难度', () => {
      const easyWords = ['the', 'is', 'are', 'have', 'been'];
      for (const word of easyWords) {
        const difficulty = frequencyManager.getDifficulty(word);
        expect(difficulty).toBeLessThanOrEqual(3);
      }
    });

    it('复杂单词应该返回较高难度', () => {
      const hardWords = ['serendipity', 'ephemeral', 'obfuscate'];
      for (const word of hardWords) {
        const difficulty = frequencyManager.getDifficulty(word);
        expect(difficulty).toBeGreaterThanOrEqual(7);
      }
    });

    it('应该处理大小写不敏感的单词', () => {
      const difficulty1 = frequencyManager.getDifficulty('HELLO');
      const difficulty2 = frequencyManager.getDifficulty('hello');
      expect(difficulty1).toBe(difficulty2);
    });

    it('应该处理空字符串', () => {
      const difficulty = frequencyManager.getDifficulty('');
      // 空字符串应该返回中等难度
      expect(difficulty).toBeGreaterThanOrEqual(1);
      expect(difficulty).toBeLessThanOrEqual(10);
    });
  });

  describe('本地筛词与调用阈值', () => {
    const difficultWords = 'transmogrification unobtanium';

    it('低词汇量仅在至少两个难词且占比达到 5% 时请求远程翻译', () => {
      expect(frequencyManager.getDifficulty('transmogrification')).toBeGreaterThanOrEqual(7);
      expect(frequencyManager.getDifficulty('unobtanium')).toBeGreaterThanOrEqual(7);
      expect(frequencyManager.hasPotentialUnknownWords(`the ${difficultWords}`, 2000)).toBe(true);
      expect(frequencyManager.hasPotentialUnknownWords('the transmogrification', 2000)).toBe(false);
      expect(frequencyManager.hasPotentialUnknownWords(`${'the '.repeat(39)}${difficultWords}`, 2000)).toBe(false);
      expect(frequencyManager.hasPotentialUnknownWords(`${'the '.repeat(38)}${difficultWords}`, 2000)).toBe(true);
    });

    it.each([2999, 3000, 4999, 5000, 7999, 8000])('词汇量 %i 使用对应难度门槛', size => {
      const expected = size < 3000 ? 2 : size < 5000 ? 3 : size < 8000 ? 5 : 7;
      expect(frequencyManager.analyzeText(difficultWords, size)).toMatchObject({
        threshold: expected, validWords: 2, difficultWords: 2, shouldTranslate: true,
      });
      expect(frequencyManager.hasPotentialUnknownWords(difficultWords, size)).toBe(true);
    });

    it('空文本、标点和数字不触发 API，分析统计忽略短词和数字', () => {
      expect(frequencyManager.hasPotentialUnknownWords('', 2000)).toBe(true);
      expect(frequencyManager.hasPotentialUnknownWords('... !!!', 2000)).toBe(false);
      expect(frequencyManager.hasPotentialUnknownWords('1 22 123 a it', 2000)).toBe(false);
      expect(frequencyManager.analyzeText('123 a it transmogrification', 2000)).toMatchObject({
        totalWords: 4, validWords: 1, difficultWords: 1, shouldTranslate: true,
      });
      expect(frequencyManager.analyzeText('123 a it', 2000)).toMatchObject({
        validWords: 0, difficultRatio: 0, shouldTranslate: false,
      });
    });

    it('未初始化词表时不漏过难词，直到本地词表加载完成', async () => {
      vi.resetModules();
      const { frequencyManager: fresh } = await import('@/background/frequencyManager');
      expect(fresh.getDifficulty('the')).toBe(5);
      expect(fresh.getFrequencyRank('the')).toBe(50000);
      expect(fresh.isEasyWord('the')).toBe(false);
      expect(fresh.hasPotentialUnknownWords('the the', 2000)).toBe(true);
      expect(fresh.analyzeText('the', 2000)).toMatchObject({
        totalWords: 0, validWords: 0, shouldTranslate: true,
      });
    });

    it('已初始化的常用词不误认为难词，未知词返回安全的高难度', () => {
      expect(frequencyManager.isEasyWord(' THE ')).toBe(true);
      expect(frequencyManager.isEasyWord('transmogrification')).toBe(false);
      expect(frequencyManager.getFrequencyRank('the')).toBe(1000);
      expect(frequencyManager.getDifficulty('transmogrification')).toBe(8);
      expect(frequencyManager.analyzeText('', 2000).shouldTranslate).toBe(true);
    });
  });

  describe('initialize', () => {
    it('应该成功初始化', async () => {
      await expect(frequencyManager.initialize()).resolves.not.toThrow();
    });

    it('重复初始化应该不抛出错误', async () => {
      await frequencyManager.initialize();
      await expect(frequencyManager.initialize()).resolves.not.toThrow();
    });
  });
});
