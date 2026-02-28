import { describe, it, expect, beforeEach } from 'vitest';
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
