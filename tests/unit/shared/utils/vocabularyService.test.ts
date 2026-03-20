/**
 * 词汇服务测试
 *
 * 测试词汇难度评估和过滤功能
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  assessWordDifficulty,
  extractWords,
  isWordAboveLevel,
  filterWordsByLevel,
  analyzeTextVocabulary,
  getRecommendedWords,
  createDefaultVocabularyConfig,
  calculateTextDifficultyStats,
  VocabularyService,
  type UserVocabularyConfig,
} from '@/shared/utils/vocabularyService';
import type { CEFRLevel } from '@/shared/types/mastery';

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('assessWordDifficulty', () => {
  it('应该评估常用词为低难度', () => {
    const result = assessWordDifficulty('the');

    expect(result.level).toBe('A1');
    expect(result.isCommon).toBe(true);
    expect(result.confidence).toBe(0.8);
  });

  it('应该评估学术词汇为中等难度', () => {
    const result = assessWordDifficulty('analyze');

    expect(result.level).toBe('B1');
    expect(result.isCommon).toBe(false);
    expect(result.confidence).toBe(0.75);
  });

  it('应该基于复杂度评估未知词', () => {
    const result = assessWordDifficulty('unprecedented');

    expect(result.difficulty).toBeGreaterThanOrEqual(1);
    expect(result.difficulty).toBeLessThanOrEqual(10);
    expect(result.confidence).toBe(0.6);
  });

  it('应该处理空字符串', () => {
    const result = assessWordDifficulty('');

    expect(result.level).toBe('A1');
    expect(result.difficulty).toBe(1);
    expect(result.confidence).toBe(0.1);
  });

  it('应该处理空白字符串', () => {
    const result = assessWordDifficulty('   ');

    expect(result.level).toBe('A1');
    expect(result.difficulty).toBe(1);
  });

  it('应该忽略大小写', () => {
    const result1 = assessWordDifficulty('THE');
    const result2 = assessWordDifficulty('the');

    expect(result1.level).toBe(result2.level);
    expect(result1.isCommon).toBe(true);
  });

  it('应该评估长单词为高难度', () => {
    const result = assessWordDifficulty('internationalization');

    expect(result.difficulty).toBeGreaterThan(5);
  });

  it('应该评估短单词为低难度', () => {
    const result = assessWordDifficulty('is');

    expect(result.difficulty).toBeLessThan(5);
  });

  it('应该识别复杂前缀', () => {
    const result = assessWordDifficulty('interdisciplinary');

    expect(result.difficulty).toBeGreaterThan(3);
  });

  it('应该识别学术后缀', () => {
    const result = assessWordDifficulty('methodology');

    expect(result.difficulty).toBeGreaterThan(3);
  });
});

describe('extractWords', () => {
  it('应该从文本中提取单词', () => {
    const words = extractWords('Hello world, this is a test.');

    expect(words).toContain('hello');
    expect(words).toContain('world');
    expect(words).toContain('test');
  });

  it('应该去重', () => {
    const words = extractWords('hello hello world world');

    expect(words).toEqual(['hello', 'world']);
  });

  it('应该转换为小写', () => {
    const words = extractWords('HELLO World');

    expect(words).toContain('hello');
    expect(words).toContain('world');
  });

  it('应该过滤单字母词', () => {
    const words = extractWords('a b c hello');

    expect(words).not.toContain('a');
    expect(words).not.toContain('b');
    expect(words).toContain('hello');
  });

  it('应该处理连字符单词', () => {
    const words = extractWords('well-known self-aware');

    expect(words).toContain('well-known');
    expect(words).toContain('self-aware');
  });

  it('应该返回空数组当没有匹配时', () => {
    const words = extractWords('123 456 !@#');

    expect(words).toEqual([]);
  });

  it('应该处理空字符串', () => {
    const words = extractWords('');

    expect(words).toEqual([]);
  });

  it('应该处理 null/undefined', () => {
    expect(extractWords(null as unknown as string)).toEqual([]);
    expect(extractWords(undefined as unknown as string)).toEqual([]);
  });
});

describe('isWordAboveLevel', () => {
  it('应该返回 true 当单词等级高于用户等级', () => {
    expect(isWordAboveLevel('B1', 'A2')).toBe(true);
    expect(isWordAboveLevel('C1', 'B2')).toBe(true);
    expect(isWordAboveLevel('C2', 'C1')).toBe(true);
  });

  it('应该返回 false 当单词等级等于用户等级', () => {
    expect(isWordAboveLevel('B1', 'B1')).toBe(false);
    expect(isWordAboveLevel('A1', 'A1')).toBe(false);
  });

  it('应该返回 false 当单词等级低于用户等级', () => {
    expect(isWordAboveLevel('A1', 'B1')).toBe(false);
    expect(isWordAboveLevel('B1', 'C1')).toBe(false);
  });
});

describe('filterWordsByLevel', () => {
  const createConfig = (overrides: Partial<UserVocabularyConfig> = {}): UserVocabularyConfig => ({
    userLevel: 'B1',
    includeKnownWords: true,
    customKnownWords: new Set(),
    customUnknownWords: new Set(),
    ...overrides,
  });

  it('应该过滤出超出用户水平的单词', () => {
    const words = ['the', 'analyze', 'methodology', 'internationalization'];
    const config = createConfig({ userLevel: 'A2' });

    const result = filterWordsByLevel(words, config);

    expect(result.wordsAboveLevel.length).toBeGreaterThan(0);
    expect(result.totalAnalyzed).toBe(4);
  });

  it('应该将用户自定义未知词汇标记为超出水平', () => {
    const words = ['hello'];
    const config = createConfig({
      customUnknownWords: new Set(['hello']),
    });

    const result = filterWordsByLevel(words, config);

    expect(result.wordsAboveLevel).toHaveLength(1);
    expect(result.wordsAboveLevel[0].confidence).toBe(0.95);
  });

  it('应该将用户自定义已知词汇标记为已知', () => {
    const words = ['methodology'];
    const config = createConfig({
      userLevel: 'A1',
      customKnownWords: new Set(['methodology']),
    });

    const result = filterWordsByLevel(words, config);

    expect(result.wordsWithinLevel).toHaveLength(1);
    expect(result.wordsWithinLevel[0].confidence).toBe(0.95);
  });

  it('应该优先处理用户自定义未知词汇', () => {
    const words = ['test'];
    const config = createConfig({
      customKnownWords: new Set(['test']),
      customUnknownWords: new Set(['test']),
    });

    const result = filterWordsByLevel(words, config);

    // 未知词汇优先级更高
    expect(result.wordsAboveLevel).toHaveLength(1);
    expect(result.wordsWithinLevel).toHaveLength(0);
  });

  it('应该跳过无效单词', () => {
    const words = ['', 'a', '  ', 'hello'];
    const config = createConfig();

    const result = filterWordsByLevel(words, config);

    expect(result.totalAnalyzed).toBe(4);
    // 只有 'hello' 被分析
    expect(result.wordsAboveLevel.length + result.wordsWithinLevel.length).toBe(1);
  });

  it('应该忽略大小写', () => {
    const words = ['HELLO', 'World'];
    const config = createConfig({
      customUnknownWords: new Set(['hello']),
    });

    const result = filterWordsByLevel(words, config);

    expect(result.wordsAboveLevel).toContainEqual(
      expect.objectContaining({ word: 'hello' })
    );
  });
});

describe('analyzeTextVocabulary', () => {
  const createConfig = (overrides: Partial<UserVocabularyConfig> = {}): UserVocabularyConfig => ({
    userLevel: 'B1',
    includeKnownWords: true,
    customKnownWords: new Set(),
    customUnknownWords: new Set(),
    ...overrides,
  });

  it('应该分析文本中的词汇', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const config = createConfig({ userLevel: 'A1' });

    const result = analyzeTextVocabulary(text, config);

    expect(result.totalAnalyzed).toBeGreaterThan(0);
  });

  it('应该处理空文本', () => {
    const config = createConfig();

    const result = analyzeTextVocabulary('', config);

    expect(result.wordsAboveLevel).toEqual([]);
    expect(result.wordsWithinLevel).toEqual([]);
    expect(result.totalAnalyzed).toBe(0);
  });
});

describe('getRecommendedWords', () => {
  const createFilterResult = (
    wordsAboveLevel: Array<{ word: string; level: CEFRLevel; difficulty: number; confidence: number }> = []
  ) => ({
    wordsAboveLevel: wordsAboveLevel.map(w => ({
      word: w.word,
      level: w.level,
      difficulty: w.difficulty,
      confidence: w.confidence,
      isCommon: false,
    })),
    wordsWithinLevel: [],
    totalAnalyzed: wordsAboveLevel.length,
  });

  it('应该返回推荐学习的单词', () => {
    const result = createFilterResult([
      { word: 'analyze', level: 'B2', difficulty: 6, confidence: 0.7 },
      { word: 'methodology', level: 'C1', difficulty: 8, confidence: 0.8 },
    ]);

    const recommended = getRecommendedWords(result, 10);

    expect(recommended.length).toBe(2);
  });

  it('应该过滤低置信度的单词', () => {
    const result = createFilterResult([
      { word: 'test1', level: 'B2', difficulty: 6, confidence: 0.3 },
      { word: 'test2', level: 'C1', difficulty: 8, confidence: 0.7 },
    ]);

    const recommended = getRecommendedWords(result, 10);

    expect(recommended).toHaveLength(1);
    expect(recommended[0].word).toBe('test2');
  });

  it('应该限制返回数量', () => {
    const result = createFilterResult([
      { word: 'word1', level: 'B2', difficulty: 6, confidence: 0.7 },
      { word: 'word2', level: 'B2', difficulty: 6, confidence: 0.7 },
      { word: 'word3', level: 'B2', difficulty: 6, confidence: 0.7 },
    ]);

    const recommended = getRecommendedWords(result, 2);

    expect(recommended).toHaveLength(2);
  });

  it('应该按等级排序（低等级优先）', () => {
    const result = createFilterResult([
      { word: 'c1-word', level: 'C1', difficulty: 8, confidence: 0.7 },
      { word: 'b2-word', level: 'B2', difficulty: 6, confidence: 0.7 },
    ]);

    const recommended = getRecommendedWords(result, 10);

    expect(recommended[0].word).toBe('b2-word');
    expect(recommended[1].word).toBe('c1-word');
  });

  it('应该使用默认限制数量', () => {
    const words = Array.from({ length: 20 }, (_, i) => ({
      word: `word${i}`,
      level: 'B2' as CEFRLevel,
      difficulty: 6,
      confidence: 0.7,
    }));
    const result = createFilterResult(words);

    const recommended = getRecommendedWords(result);

    expect(recommended).toHaveLength(10);
  });
});

describe('createDefaultVocabularyConfig', () => {
  it('应该创建默认配置', () => {
    const config = createDefaultVocabularyConfig();

    expect(config.userLevel).toBe('B1');
    expect(config.includeKnownWords).toBe(true);
    expect(config.customKnownWords).toBeInstanceOf(Set);
    expect(config.customUnknownWords).toBeInstanceOf(Set);
  });

  it('应该使用指定的用户等级', () => {
    const config = createDefaultVocabularyConfig('C1');

    expect(config.userLevel).toBe('C1');
  });
});

describe('calculateTextDifficultyStats', () => {
  it('应该计算文本难度统计', () => {
    const result = {
      wordsAboveLevel: [
        { word: 'analyze', level: 'B2' as CEFRLevel, difficulty: 6, confidence: 0.7, isCommon: false },
        { word: 'methodology', level: 'C1' as CEFRLevel, difficulty: 8, confidence: 0.8, isCommon: false },
      ],
      wordsWithinLevel: [
        { word: 'the', level: 'A1' as CEFRLevel, difficulty: 2, confidence: 0.8, isCommon: true },
        { word: 'hello', level: 'A1' as CEFRLevel, difficulty: 2, confidence: 0.8, isCommon: true },
      ],
      totalAnalyzed: 4,
    };

    const stats = calculateTextDifficultyStats(result);

    expect(stats.aboveLevelRatio).toBe(0.5);
    expect(stats.averageWordDifficulty).toBe(4.5); // (6+8+2+2)/4
    expect(stats.difficultyScore).toBeGreaterThan(0);
    expect(stats.recommendedFocus).toBeDefined();
  });

  it('应该返回零值当没有分析结果时', () => {
    const result = {
      wordsAboveLevel: [],
      wordsWithinLevel: [],
      totalAnalyzed: 0,
    };

    const stats = calculateTextDifficultyStats(result);

    expect(stats.difficultyScore).toBe(0);
    expect(stats.aboveLevelRatio).toBe(0);
    expect(stats.averageWordDifficulty).toBe(0);
    expect(stats.recommendedFocus).toBe('无内容可分析');
  });

  it('应该推荐学习重点当超水平词汇比例高时', () => {
    const result = {
      wordsAboveLevel: Array.from({ length: 40 }, (_, i) => ({
        word: `word${i}`,
        level: 'C1' as CEFRLevel,
        difficulty: 8,
        confidence: 0.7,
        isCommon: false,
      })),
      wordsWithinLevel: Array.from({ length: 60 }, (_, i) => ({
        word: `easy${i}`,
        level: 'A1' as CEFRLevel,
        difficulty: 2,
        confidence: 0.8,
        isCommon: true,
      })),
      totalAnalyzed: 100,
    };

    const stats = calculateTextDifficultyStats(result);

    expect(stats.aboveLevelRatio).toBe(0.4);
    expect(stats.recommendedFocus).toBe('难度较高，建议关注高亮词汇');
  });

  it('应该推荐适中学习当超水平词汇比例适中时', () => {
    const result = {
      wordsAboveLevel: Array.from({ length: 20 }, (_, i) => ({
        word: `word${i}`,
        level: 'B2' as CEFRLevel,
        difficulty: 6,
        confidence: 0.7,
        isCommon: false,
      })),
      wordsWithinLevel: Array.from({ length: 80 }, (_, i) => ({
        word: `easy${i}`,
        level: 'A1' as CEFRLevel,
        difficulty: 2,
        confidence: 0.8,
        isCommon: true,
      })),
      totalAnalyzed: 100,
    };

    const stats = calculateTextDifficultyStats(result);

    expect(stats.aboveLevelRatio).toBe(0.2);
    expect(stats.recommendedFocus).toBe('适中难度，适合学习新词汇');
  });
});

describe('VocabularyService', () => {
  let service: VocabularyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VocabularyService();
  });

  describe('constructor', () => {
    it('应该创建默认配置的服务实例', () => {
      const config = service.getConfig();

      expect(config.userLevel).toBe('B1');
      expect(config.customKnownWords.size).toBe(0);
      expect(config.customUnknownWords.size).toBe(0);
    });

    it('应该接受自定义配置', () => {
      const customService = new VocabularyService({
        userLevel: 'C1',
        customKnownWords: new Set(['hello']),
      });

      const config = customService.getConfig();

      expect(config.userLevel).toBe('C1');
      expect(config.customKnownWords.has('hello')).toBe(true);
    });
  });

  describe('updateConfig', () => {
    it('应该更新配置', () => {
      service.updateConfig({ userLevel: 'C2' });

      const config = service.getConfig();

      expect(config.userLevel).toBe('C2');
    });

    it('应该保留未更新的配置项', () => {
      service.addKnownWord('hello');
      service.updateConfig({ userLevel: 'C1' });

      const config = service.getConfig();

      expect(config.userLevel).toBe('C1');
      expect(config.customKnownWords.has('hello')).toBe(true);
    });
  });

  describe('setUserLevel', () => {
    it('应该设置用户等级', () => {
      service.setUserLevel('A2');

      expect(service.getConfig().userLevel).toBe('A2');
    });
  });

  describe('addKnownWord', () => {
    it('应该添加已知词汇', () => {
      service.addKnownWord('test');

      expect(service.getConfig().customKnownWords.has('test')).toBe(true);
    });

    it('应该从未知词汇中移除', () => {
      service.addUnknownWord('test');
      service.addKnownWord('test');

      expect(service.getConfig().customUnknownWords.has('test')).toBe(false);
      expect(service.getConfig().customKnownWords.has('test')).toBe(true);
    });

    it('应该忽略大小写', () => {
      service.addKnownWord('TEST');

      expect(service.getConfig().customKnownWords.has('test')).toBe(true);
    });
  });

  describe('addUnknownWord', () => {
    it('应该添加未知词汇', () => {
      service.addUnknownWord('difficult');

      expect(service.getConfig().customUnknownWords.has('difficult')).toBe(true);
    });

    it('应该从已知词汇中移除', () => {
      service.addKnownWord('test');
      service.addUnknownWord('test');

      expect(service.getConfig().customKnownWords.has('test')).toBe(false);
      expect(service.getConfig().customUnknownWords.has('test')).toBe(true);
    });

    it('应该忽略大小写', () => {
      service.addUnknownWord('DIFFICULT');

      expect(service.getConfig().customUnknownWords.has('difficult')).toBe(true);
    });
  });

  describe('analyzeText', () => {
    it('应该分析文本词汇', () => {
      const result = service.analyzeText('Hello world, this is a test.');

      expect(result.totalAnalyzed).toBeGreaterThan(0);
    });
  });

  describe('getRecommendations', () => {
    it('应该返回空数组（需要先分析文本）', () => {
      const recommendations = service.getRecommendations();

      expect(recommendations).toEqual([]);
    });
  });

  describe('assessWord', () => {
    it('应该评估单个单词', () => {
      const result = service.assessWord('analyze');

      expect(result.word).toBe('analyze');
      expect(result.difficulty).toBeGreaterThanOrEqual(1);
      expect(result.difficulty).toBeLessThanOrEqual(10);
    });
  });

  describe('getConfig', () => {
    it('应该返回配置的副本', () => {
      const config1 = service.getConfig();
      const config2 = service.getConfig();

      expect(config1).not.toBe(config2); // 不同的对象引用
      expect(config1).toEqual(config2); // 但内容相同
    });
  });
});