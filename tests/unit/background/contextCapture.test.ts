/**
 * 语境捕获管理器单元测试
 * CMP-97 语境学习模式
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ContextCaptureManager,
  DEFAULT_CONTEXT_CAPTURE_CONFIG,
} from '@/background/contextCapture';

// Mock Chrome Storage API
const mockStorage: Record<string, unknown> = {};
const mockChromeStorage = {
  local: {
    get: vi.fn((key: string) => {
      const result: Record<string, unknown> = {};
      if (mockStorage[key]) {
        result[key] = mockStorage[key];
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((data: Record<string, unknown>) => {
      Object.assign(mockStorage, data);
      return Promise.resolve();
    }),
    remove: vi.fn((key: string) => {
      delete mockStorage[key];
      return Promise.resolve();
    }),
  },
};

vi.stubGlobal('chrome', { storage: mockChromeStorage });

describe('ContextCaptureManager', () => {
  let manager: ContextCaptureManager;

  beforeEach(() => {
    Object.keys(mockStorage).forEach((key) => delete mockStorage[key]);
    manager = new ContextCaptureManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('load()', () => {
    it('应该正确加载存储的词汇数据', async () => {
      const testEntry = {
        word: 'example',
        mastery: {
          word: 'example',
          level: 1,
          firstSeenAt: Date.now(),
          lastReviewedAt: Date.now(),
          reviewCount: 1,
          correctCount: 1,
          consecutiveCorrect: 1,
          difficulty: 0.5,
          contextCount: 1,
        },
        addedAt: Date.now(),
        contexts: [
          {
            sentence: 'This is an example sentence.',
            source: 'test',
            url: 'https://example.com',
            capturedAt: Date.now(),
          },
        ],
      };

      mockStorage['vocabularyWithContexts'] = [testEntry];

      await manager.load();

      const contexts = manager.getContexts('example');
      expect(contexts).toHaveLength(1);
      expect(contexts[0].sentence).toBe('This is an example sentence.');
    });

    it('应该正确处理空数据', async () => {
      await manager.load();
      expect(manager.getVocabularyWithContexts()).toHaveLength(0);
    });
  });

  describe('captureContext()', () => {
    it('应该成功捕获有效的上下文', async () => {
      const result = await manager.captureContext(
        'test',
        'This is a test sentence for capturing context.'
      );
      expect(result).toBe(true);
    });

    it('应该拒绝过短的句子', async () => {
      const result = await manager.captureContext('test', 'Short.');
      expect(result).toBe(false);
    });

    it('应该拒绝过长的句子', async () => {
      const longSentence = 'a'.repeat(301);
      const result = await manager.captureContext('test', longSentence);
      expect(result).toBe(false);
    });

    it('应该拒绝不包含目标单词的句子', async () => {
      const result = await manager.captureContext(
        'python',
        'This sentence does not contain the target word.'
      );
      expect(result).toBe(false);
    });

    it('应该拒绝重复的句子', async () => {
      const sentence = 'This is a test sentence with the word test.';
      await manager.captureContext('test', sentence);
      const result = await manager.captureContext('test', sentence);
      expect(result).toBe(false);
    });

    it('应该在禁用时拒绝捕获', async () => {
      const disabledManager = new ContextCaptureManager({
        ...DEFAULT_CONTEXT_CAPTURE_CONFIG,
        enabled: false,
      });
      const result = await disabledManager.captureContext(
        'test',
        'This is a test sentence.'
      );
      expect(result).toBe(false);
    });
  });

  describe('captureContexts()', () => {
    it('应该批量捕获多个上下文', async () => {
      const items = [
        { word: 'apple', sentence: 'I like apples very much.' },
        { word: 'banana', sentence: 'Bananas are healthy fruits.' },
      ];
      const count = await manager.captureContexts(items);
      expect(count).toBe(2);
    });
  });

  describe('getStats()', () => {
    it('应该返回正确的统计信息', async () => {
      await manager.captureContext('word1', 'Sentence with word1 here.');
      await manager.captureContext('word2', 'Sentence with word2 here.');
      await manager.captureContext('word1', 'Another sentence with word1.');

      const stats = manager.getStats();

      expect(stats.totalWords).toBe(2);
      expect(stats.totalContexts).toBe(3);
    });
  });

  describe('removeContext()', () => {
    it('应该成功删除指定的上下文', async () => {
      await manager.captureContext('test', 'Test sentence for removal.');
      const contexts = manager.getContexts('test');
      expect(contexts).toHaveLength(1);

      const result = await manager.removeContext('test', contexts[0].capturedAt);
      expect(result).toBe(true);

      const remaining = manager.getContexts('test');
      expect(remaining).toHaveLength(0);
    });
  });

  describe('clearAll()', () => {
    it('应该清除所有数据', async () => {
      await manager.captureContext('word1', 'Sentence one here.');
      await manager.captureContext('word2', 'Sentence two here.');

      await manager.clearAll();

      expect(manager.getVocabularyWithContexts()).toHaveLength(0);
    });
  });

  describe('DEFAULT_CONTEXT_CAPTURE_CONFIG', () => {
    it('应该有正确的默认配置值', () => {
      expect(DEFAULT_CONTEXT_CAPTURE_CONFIG.enabled).toBe(true);
      expect(DEFAULT_CONTEXT_CAPTURE_CONFIG.maxContextsPerWord).toBe(5);
      expect(DEFAULT_CONTEXT_CAPTURE_CONFIG.minSentenceLength).toBe(10);
      expect(DEFAULT_CONTEXT_CAPTURE_CONFIG.maxSentenceLength).toBe(300);
    });
  });
});
