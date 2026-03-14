import type { CEFRLevel } from '@/shared/types/mastery';
import {
  CEFR_LEVEL_ORDER,
  getCEFRLevelByDifficulty,
} from '@/shared/constants/mastery';
import { logger } from '@/shared/utils';

/**
 * CEFR 词汇服务
 *
 * 提供基于 CEFR 等级的词汇过滤和难度评估功能。
 * 用于识别和筛选超出用户当前水平（A1-C2）的英语单词。
 */

/**
 * 单词难度评估结果
 */
export interface WordDifficultyResult {
  /** 单词本身 */
  word: string;
  /** 预估的 CEFR 等级 */
  level: CEFRLevel;
  /** 难度分数 1-10 */
  difficulty: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 是否为常见词 */
  isCommon: boolean;
}

/**
 * 词汇过滤结果
 */
export interface VocabularyFilterResult {
  /** 超出用户水平的单词 */
  wordsAboveLevel: WordDifficultyResult[];
  /** 用户已知范围内的单词 */
  wordsWithinLevel: WordDifficultyResult[];
  /** 总计分析的单词数 */
  totalAnalyzed: number;
}

/**
 * 用户词汇配置
 */
export interface UserVocabularyConfig {
  /** 用户 CEFR 等级 */
  userLevel: CEFRLevel;
  /** 是否包含用户标记的已知词汇 */
  includeKnownWords: boolean;
  /** 用户自定义已知词汇列表 */
  customKnownWords: Set<string>;
  /** 用户自定义未知词汇列表（优先级最高） */
  customUnknownWords: Set<string>;
}

/**
 * 常用词列表（简化版）
 * A1-A2 级别的常见基础词汇
 */
const COMMON_WORDS = new Set([
  // A1 基础词汇 (约 500 词)
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
  'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
  'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what',
  'so', 'up', 'out', 'if', 'about', 'who', 'get', 'which', 'go', 'me',
  'when', 'make', 'can', 'like', 'time', 'no', 'just', 'him', 'know', 'take',
  'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also',
  'back', 'after', 'use', 'two', 'how', 'our', 'work', 'first', 'well', 'way',
  'even', 'new', 'want', 'because', 'any', 'these', 'give', 'day', 'most', 'us',
  'is', 'was', 'are', 'were', 'been', 'has', 'had', 'did', 'does', 'doing',
  'am', 's', 're', 've', 'd', 'll', 'm',

  // A2 扩展词汇 (约 500 词)
  'life', 'very', 'much', 'own', 'under', 'right', 'old', 'too', 'never', 'here',
  'home', 'move', 'both', 'each', 'must', 'last', 'tell', 'great', 'why', 'men',
  'ask', 'went', 'read', 'need', 'feel', 'seem', 'turn', 'hand', 'high', 'sure',
  'upon', 'head', 'help', 'home', 'side', 'long', 'little', 'found', 'show', 'part',
  'called', 'again', 'put', 'set', 'let', 'place', 'made', 'live', 'where', 'many',
  'following', 'came', 'every', 'three', 'small', 'while', 'point', 'fact', 'land', 'line',
  'kind', 'next', 'word', 'came', 'show', 'every', 'good', 'me', 'our', 'under',
  'name', 'through', 'just', 'form', 'sentence', 'great', 'think', 'say', 'where', 'help',
  'through', 'much', 'before', 'line', 'right', 'too', 'means', 'old', 'any', 'same',
  'tell', 'boy', 'follow', 'came', 'want', 'show', 'also', 'around', 'farm', 'three',
]);

/**
 * 学术词汇列表 (B1-C1 级别)
 */
const ACADEMIC_WORDS = new Set([
  'analyze', 'approach', 'area', 'assessment', 'assume', 'authority', 'available',
  'benefit', 'concept', 'consistent', 'constitutional', 'context', 'contract',
  'create', 'data', 'definition', 'derived', 'distribution', 'economic',
  'environment', 'established', 'estimate', 'evidence', 'export', 'factor',
  'financial', 'formula', 'function', 'identified', 'income', 'indicate',
  'individual', 'interpretation', 'involved', 'issue', 'labor', 'legal',
  'legislation', 'major', 'method', 'occur', 'percent', 'period', 'policy',
  'principle', 'procedure', 'process', 'required', 'research', 'response',
  'role', 'section', 'sector', 'significant', 'similar', 'source', 'specific',
  'structure', 'theory', 'variable', 'achieve', 'acquisition', 'administration',
  'affect', 'appropriate', 'aspect', 'category', 'chapter', 'commission',
  'community', 'complex', 'computation', 'concentrate', 'conclude', 'consequence',
  'construct', 'consumer', 'credit', 'culture', 'design', 'distinct', 'element',
  'equation', 'evaluate', 'feature', 'final', 'focus', 'impact', 'injury',
  'institute', 'invest', 'item', 'journal', 'maintenance', 'normal', 'obtain',
  'participate', 'perceive', 'positive', 'potential', 'previous', 'primary',
  'purchase', 'range', 'region', 'regulate', 'relevant', 'resource', 'restrict',
  'secure', 'seek', 'select', 'site', 'strategy', 'survey', 'text', 'tradition',
  'transfer', 'alternative', 'circumstance', 'comment', 'compensate', 'component',
  'consent', 'considerable', 'constant', 'constrain', 'contribute', 'convene',
  'coordinate', 'core', 'corporate', 'correspond', 'criteria', 'deduce',
  'demonstrate', 'document', 'dominate', 'emphasis', 'ensure', 'exclude',
  'framework', 'fundamental', 'illustrate', 'immigrate', 'imply', 'initial',
  'instance', 'interact', 'justify', 'layer', 'link', 'locate', 'maximize',
  'minor', 'negate', 'outcome', 'partner', 'philosophy', 'physical', 'proportion',
  'publish', 'react', 'register', 'rely', 'remove', 'scheme', 'sequence',
  'sex', 'shift', 'specify', 'sufficient', 'task', 'technical', 'technology',
  'valid', 'volume',
]);

/**
 * 高难度词汇特征 (C1-C2 级别指示)
 */
const ADVANCED_INDICATORS = {
  // 长单词（10+ 字符）通常难度较高
  longWordThreshold: 10,
  // 复杂前缀
  complexPrefixes: ['inter', 'trans', 'counter', 'under', 'over', 'super', 'ultra', 'hyper'],
  // 学术后缀
  academicSuffixes: ['ology', 'ography', 'ization', 'ification', 'iveness', 'ability'],
  // 拉丁/希腊词根
  latinRoots: ['spect', 'struct', 'dict', 'duc', 'fer', 'mit', 'cept', 'ject'],
};

/**
 * 基于规则评估单词难度
 *
 * 使用多种启发式方法估算单词难度：
 * 1. 常用词列表匹配
 * 2. 学术词汇匹配
 * 3. 单词长度分析
 * 4. 词根/前缀复杂度
 *
 * @param word - 要评估的单词
 * @returns 难度评估结果
 */
export function assessWordDifficulty(word: string): WordDifficultyResult {
  const normalizedWord = word.toLowerCase().trim();

  if (!normalizedWord) {
    return {
      word: normalizedWord,
      level: 'A1',
      difficulty: 1,
      confidence: 0.1,
      isCommon: true,
    };
  }

  // 1. 检查常用词列表 (A1-A2)
  if (COMMON_WORDS.has(normalizedWord)) {
    return {
      word: normalizedWord,
      level: 'A1',
      difficulty: Math.random() * 2 + 1, // 1-3
      confidence: 0.8,
      isCommon: true,
    };
  }

  // 2. 检查学术词汇 (B1-C1)
  if (ACADEMIC_WORDS.has(normalizedWord)) {
    return {
      word: normalizedWord,
      level: 'B1',
      difficulty: Math.random() * 2 + 4, // 4-6
      confidence: 0.75,
      isCommon: false,
    };
  }

  // 3. 基于单词特征评估
  const score = calculateComplexityScore(normalizedWord);
  const difficulty = Math.min(10, Math.max(1, score));
  const level = getCEFRLevelByDifficulty(difficulty);

  return {
    word: normalizedWord,
    level,
    difficulty,
    confidence: 0.6,
    isCommon: false,
  };
}

/**
 * 计算单词复杂度分数 (1-10)
 */
function calculateComplexityScore(word: string): number {
  let score = 3; // 基础分数

  const { longWordThreshold, complexPrefixes, academicSuffixes, latinRoots } = ADVANCED_INDICATORS;

  // 长度因子
  if (word.length >= longWordThreshold) {
    score += 2;
  } else if (word.length >= 8) {
    score += 1;
  } else if (word.length <= 3) {
    score -= 1;
  }

  // 复杂前缀
  for (const prefix of complexPrefixes) {
    if (word.startsWith(prefix)) {
      score += 1.5;
      break;
    }
  }

  // 学术后缀
  for (const suffix of academicSuffixes) {
    if (word.endsWith(suffix)) {
      score += 1.5;
      break;
    }
  }

  // 拉丁词根检查
  for (const root of latinRoots) {
    if (word.includes(root)) {
      score += 0.5;
    }
  }

  // 元音比例（较少元音通常表示更复杂的词）
  const vowels = (word.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowels / word.length;
  if (vowelRatio < 0.3) {
    score += 1;
  }

  // 连字符或特殊字符（通常出现在高级词汇中）
  if (word.includes('-') || word.includes('\'')) {
    score += 0.5;
  }

  return Math.max(1, Math.min(10, score));
}

/**
 * 提取文本中的所有单词
 *
 * @param text - 输入文本
 * @returns 提取的单词数组（去重，小写）
 */
export function extractWords(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // 匹配英文单词（包含连字符）
  const matches = text.match(/[a-zA-Z]+(?:-[a-zA-Z]+)?/g);
  if (!matches) {
    return [];
  }

  // 标准化并去重
  const words = matches
    .map(w => w.toLowerCase().trim())
    .filter(w => w.length >= 2); // 过滤单字母词

  return [...new Set(words)];
}

/**
 * 检查单词是否超出用户 CEFR 水平
 *
 * @param wordLevel - 单词 CEFR 等级
 * @param userLevel - 用户 CEFR 等级
 * @returns 是否超出用户水平
 */
export function isWordAboveLevel(wordLevel: CEFRLevel, userLevel: CEFRLevel): boolean {
  const wordIndex = CEFR_LEVEL_ORDER.indexOf(wordLevel);
  const userIndex = CEFR_LEVEL_ORDER.indexOf(userLevel);
  return wordIndex > userIndex;
}

/**
 * 根据用户配置过滤词汇
 *
 * 核心功能：识别并筛选出超出用户当前 CEFR 水平的单词
 *
 * @param words - 单词数组
 * @param config - 用户词汇配置
 * @returns 过滤结果
 */
export function filterWordsByLevel(
  words: string[],
  config: UserVocabularyConfig
): VocabularyFilterResult {
  const { userLevel, customKnownWords, customUnknownWords } = config;

  const wordsAboveLevel: WordDifficultyResult[] = [];
  const wordsWithinLevel: WordDifficultyResult[] = [];

  for (const word of words) {
    const normalizedWord = word.toLowerCase().trim();

    // 跳过无效单词
    if (!normalizedWord || normalizedWord.length < 2) {
      continue;
    }

    // 1. 检查用户自定义未知词汇（优先级最高）
    if (customUnknownWords.has(normalizedWord)) {
      const assessment = assessWordDifficulty(normalizedWord);
      wordsAboveLevel.push({
        ...assessment,
        confidence: 0.95, // 用户明确标记，置信度高
      });
      continue;
    }

    // 2. 检查用户自定义已知词汇
    if (customKnownWords.has(normalizedWord)) {
      const assessment = assessWordDifficulty(normalizedWord);
      wordsWithinLevel.push({
        ...assessment,
        confidence: 0.95,
      });
      continue;
    }

    // 3. 评估单词难度
    const assessment = assessWordDifficulty(normalizedWord);

    // 4. 根据 CEFR 等级判断
    if (isWordAboveLevel(assessment.level, userLevel)) {
      wordsAboveLevel.push(assessment);
    } else {
      wordsWithinLevel.push(assessment);
    }
  }

  logger.info('VocabularyService: 词汇过滤完成', {
    total: words.length,
    aboveLevel: wordsAboveLevel.length,
    withinLevel: wordsWithinLevel.length,
    userLevel,
  });

  return {
    wordsAboveLevel,
    wordsWithinLevel,
    totalAnalyzed: words.length,
  };
}

/**
 * 批量评估文本中的单词
 *
 * @param text - 输入文本
 * @param config - 用户词汇配置
 * @returns 过滤结果
 */
export function analyzeTextVocabulary(
  text: string,
  config: UserVocabularyConfig
): VocabularyFilterResult {
  const words = extractWords(text);
  return filterWordsByLevel(words, config);
}

/**
 * 获取用户应该学习的建议单词列表
 *
 * 基于：
 * 1. 刚好超出用户水平的单词（+1 级）
 * 2. 置信度较高的评估
 * 3. 限制数量避免信息过载
 *
 * @param result - 词汇过滤结果
 * @param limit - 最大返回数量
 * @returns 建议学习的单词
 */
export function getRecommendedWords(
  result: VocabularyFilterResult,
  limit: number = 10
): WordDifficultyResult[] {
  return result.wordsAboveLevel
    .filter(w => w.confidence >= 0.5)
    .sort((a, b) => {
      // 优先推荐低一级难度的词（更容易学习）
      const aIndex = CEFR_LEVEL_ORDER.indexOf(a.level);
      const bIndex = CEFR_LEVEL_ORDER.indexOf(b.level);
      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }
      // 同等级按置信度排序
      return b.confidence - a.confidence;
    })
    .slice(0, limit);
}

/**
 * 创建默认用户词汇配置
 */
export function createDefaultVocabularyConfig(userLevel: CEFRLevel = 'B1'): UserVocabularyConfig {
  return {
    userLevel,
    includeKnownWords: true,
    customKnownWords: new Set(),
    customUnknownWords: new Set(),
  };
}

/**
 * 计算文本相对于用户水平的难度统计
 */
export function calculateTextDifficultyStats(
  result: VocabularyFilterResult
): {
  difficultyScore: number;
  aboveLevelRatio: number;
  averageWordDifficulty: number;
  recommendedFocus: string;
} {
  const { wordsAboveLevel, wordsWithinLevel, totalAnalyzed } = result;

  if (totalAnalyzed === 0) {
    return {
      difficultyScore: 0,
      aboveLevelRatio: 0,
      averageWordDifficulty: 0,
      recommendedFocus: '无内容可分析',
    };
  }

  const aboveLevelRatio = wordsAboveLevel.length / totalAnalyzed;

  // 计算平均难度
  const allWords = [...wordsAboveLevel, ...wordsWithinLevel];
  const averageWordDifficulty =
    allWords.reduce((sum, w) => sum + w.difficulty, 0) / allWords.length;

  // 综合难度分数 (0-100)
  const difficultyScore = Math.round(
    (aboveLevelRatio * 50 + (averageWordDifficulty / 10) * 50)
  );

  // 推荐学习重点
  let recommendedFocus = '适合当前水平';
  if (aboveLevelRatio > 0.3) {
    recommendedFocus = '难度较高，建议关注高亮词汇';
  } else if (aboveLevelRatio > 0.15) {
    recommendedFocus = '适中难度，适合学习新词汇';
  }

  return {
    difficultyScore,
    aboveLevelRatio,
    averageWordDifficulty,
    recommendedFocus,
  };
}

/**
 * 词汇服务类
 * 提供面向对象的 API 接口
 */
export class VocabularyService {
  private config: UserVocabularyConfig;

  constructor(config?: Partial<UserVocabularyConfig>) {
    this.config = {
      ...createDefaultVocabularyConfig(),
      ...config,
      customKnownWords: config?.customKnownWords || new Set(),
      customUnknownWords: config?.customUnknownWords || new Set(),
    };
  }

  /**
   * 更新用户配置
   */
  updateConfig(config: Partial<UserVocabularyConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      customKnownWords: config.customKnownWords || this.config.customKnownWords,
      customUnknownWords: config.customUnknownWords || this.config.customUnknownWords,
    };
  }

  /**
   * 设置用户 CEFR 等级
   */
  setUserLevel(level: CEFRLevel): void {
    this.config.userLevel = level;
  }

  /**
   * 添加自定义已知词汇
   */
  addKnownWord(word: string): void {
    const normalized = word.toLowerCase().trim();
    this.config.customKnownWords.add(normalized);
    this.config.customUnknownWords.delete(normalized);
  }

  /**
   * 添加自定义未知词汇
   */
  addUnknownWord(word: string): void {
    const normalized = word.toLowerCase().trim();
    this.config.customUnknownWords.add(normalized);
    this.config.customKnownWords.delete(normalized);
  }

  /**
   * 分析文本词汇
   */
  analyzeText(text: string): VocabularyFilterResult {
    return analyzeTextVocabulary(text, this.config);
  }

  /**
   * 获取建议学习的单词
   */
  getRecommendations(_limit?: number): WordDifficultyResult[] {
    // 需要先分析文本才能获取推荐
    // 这里返回空数组，实际使用时应该先调用 analyzeText
    return [];
  }

  /**
   * 评估单个单词
   */
  assessWord(word: string): WordDifficultyResult {
    return assessWordDifficulty(word);
  }

  /**
   * 获取当前配置
   */
  getConfig(): UserVocabularyConfig {
    return { ...this.config };
  }
}

// 导出默认实例
export const vocabularyService = new VocabularyService();
