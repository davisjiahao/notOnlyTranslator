import commonVocab from '@/data/vocabulary/common.json';
import cet4Vocab from '@/data/vocabulary/cet4.json';
import cet6Vocab from '@/data/vocabulary/cet6.json';
import toeflVocab from '@/data/vocabulary/toefl.json';
import ieltsVocab from '@/data/vocabulary/ielts.json';
import greVocab from '@/data/vocabulary/gre.json';
import { logger } from '@/shared/utils';

type WordList = Set<string>;

/**
 * Frequency Manager
 *
 * Manages word frequency/difficulty data based on exam vocabulary lists.
 * Simulates a frequency table by layering different exam levels.
 *
 * Level 0: Common/Stop words (Top 1000)
 * Level 1: CET-4 (Basic)
 * Level 2: CET-6 (Intermediate)
 * Level 3: TOEFL/IELTS (Advanced)
 * Level 4: GRE (Expert)
 */
class FrequencyManager {
  private wordSets: Map<string, WordList> = new Map();
  private initialized = false;

  // 缓存正则表达式模式
  private static readonly TOKENIZE_REGEX = /[^\w\s']/g;
  private static readonly WHITESPACE_REGEX = /\s+/g;
  private static readonly NUMBER_REGEX = /^\d+$/;

  // 词集名称常量
  private static readonly WORD_SET_NAMES = {
    COMMON: 'common',
    CET4: 'cet4',
    CET6: 'cet6',
    TOEFL: 'toefl',
    IELTS: 'ielts',
    GRE: 'gre',
  } as const;

  /**
   * 分词 - 提取为共享方法
   */
  private tokenize(text: string): string[] {
    if (!text) return [];
    return text
      .replace(FrequencyManager.TOKENIZE_REGEX, ' ')
      .replace(FrequencyManager.WHITESPACE_REGEX, ' ')
      .trim()
      .split(' ')
      .filter(w => w.length > 0);
  }

  /**
   * 获取难度阈值 - 基于词汇量
   */
  private getDifficultyThreshold(vocabularySize: number): number {
    if (vocabularySize < 3000) return 2;
    if (vocabularySize < 5000) return 3;
    if (vocabularySize < 8000) return 5;
    return 7;
  }

  /**
   * Initialize vocabulary lists
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Load all vocabularies into Sets for O(1) lookup
      this.wordSets.set('common', new Set(commonVocab.words));
      this.wordSets.set('cet4', new Set(cet4Vocab.words));
      this.wordSets.set('cet6', new Set(cet6Vocab.words));
      this.wordSets.set('toefl', new Set(toeflVocab.words));
      this.wordSets.set('ielts', new Set(ieltsVocab.words));
      this.wordSets.set('gre', new Set(greVocab.words));

      this.initialized = true;
      logger.info('FrequencyManager: Initialized with', this.wordSets.size, 'vocabularies');
    } catch (error) {
      logger.error('FrequencyManager: Initialization failed', error);
    }
  }

  /**
   * Get difficulty level (1-10) for a word
   */
  getDifficulty(word: string): number {
    if (!this.initialized) return 5;

    const lowerWord = word.toLowerCase().trim();
    const names = FrequencyManager.WORD_SET_NAMES;

    // Check lists in order of difficulty
    if (this.wordSets.get(names.COMMON)?.has(lowerWord)) return 1;
    if (this.wordSets.get(names.CET4)?.has(lowerWord)) return 3;
    if (this.wordSets.get(names.CET6)?.has(lowerWord)) return 5;
    if (this.wordSets.get(names.TOEFL)?.has(lowerWord)) return 7;
    if (this.wordSets.get(names.IELTS)?.has(lowerWord)) return 7;
    if (this.wordSets.get(names.GRE)?.has(lowerWord)) return 9;

    // Not found in any list -> likely hard or rare
    return 8;
  }

  /**
   * Check if a word is likely "Easy" (Common or CET-4)
   * Used for local filtering
   */
  isEasyWord(word: string): boolean {
    if (!this.initialized) return false;
    const lowerWord = word.toLowerCase().trim();
    const names = FrequencyManager.WORD_SET_NAMES;
    return (
      this.wordSets.get(names.COMMON)?.has(lowerWord) ||
      this.wordSets.get(names.CET4)?.has(lowerWord)
    ) || false;
  }

  /**
   * Get raw frequency rank (simulated)
   * Lower is more frequent
   */
  getFrequencyRank(word: string): number {
    if (!this.initialized) return 50000;
    const difficulty = this.getDifficulty(word);
    // Map difficulty to approximate rank
    // 1 -> 1-1000
    // 3 -> 1000-4500
    // 5 -> 4500-6000
    // 7 -> 6000-8000
    // 9 -> 8000-12000
    return difficulty * 1000;
  }

  /**
   * Check if text contains enough potential unknown words to warrant API translation
   * Used for local static filtering before API calls
   *
   * 优化说明：
   * - 不再只要有一个难词就调用 API
   * - 引入难词比例阈值：难词占比 >= 5% 才调用 API
   * - 同时考虑绝对数量：至少有 2 个难词才调用
   * - 这样可以显著减少对简单段落的 API 调用
   *
   * @param text The text to analyze
   * @param userVocabularySize Estimated user vocabulary size
   * @returns true if text needs API translation, false if can be skipped
   */
  hasPotentialUnknownWords(text: string, userVocabularySize: number): boolean {
    if (!this.initialized || !text) return true; // Fail safe: assume it needs translation

    const words = this.tokenize(text);
    if (words.length === 0) return false;

    const threshold = this.getDifficultyThreshold(userVocabularySize);

    // Count difficult words
    let difficultWordCount = 0;
    let validWordCount = 0;

    for (const word of words) {
      // Skip numbers and very short words
      if (FrequencyManager.NUMBER_REGEX.test(word) || word.length <= 2) continue;

      validWordCount++;
      const difficulty = this.getDifficulty(word);
      if (difficulty >= threshold) {
        difficultWordCount++;
      }
    }

    // 如果没有有效单词，不需要翻译
    if (validWordCount === 0) return false;

    // 只要有 1 个难词就发起翻译（保证翻译覆盖率）
    return difficultWordCount >= 1;
  }

  /**
   * 获取段落的难词分析详情（用于调试和统计）
   */
  analyzeText(text: string, userVocabularySize: number): {
    totalWords: number;
    validWords: number;
    difficultWords: number;
    difficultRatio: number;
    threshold: number;
    shouldTranslate: boolean;
  } {
    if (!this.initialized || !text) {
      return {
        totalWords: 0,
        validWords: 0,
        difficultWords: 0,
        difficultRatio: 0,
        threshold: 5,
        shouldTranslate: true,
      };
    }

    const words = this.tokenize(text);
    const threshold = this.getDifficultyThreshold(userVocabularySize);

    let difficultWordCount = 0;
    let validWordCount = 0;

    for (const word of words) {
      if (FrequencyManager.NUMBER_REGEX.test(word) || word.length <= 2) continue;
      validWordCount++;
      if (this.getDifficulty(word) >= threshold) {
        difficultWordCount++;
      }
    }

    const difficultRatio = validWordCount > 0 ? difficultWordCount / validWordCount : 0;
    const shouldTranslate = difficultWordCount >= 1;

    return {
      totalWords: words.length,
      validWords: validWordCount,
      difficultWords: difficultWordCount,
      difficultRatio,
      threshold,
      shouldTranslate,
    };
  }
}

// 导出单例实例
export const frequencyManager = new FrequencyManager();
