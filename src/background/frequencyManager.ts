import commonVocab from '@/data/vocabulary/common.json';
import cet4Vocab from '@/data/vocabulary/cet4.json';
import cet6Vocab from '@/data/vocabulary/cet6.json';
import toeflVocab from '@/data/vocabulary/toefl.json';
import ieltsVocab from '@/data/vocabulary/ielts.json';
import greVocab from '@/data/vocabulary/gre.json';

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
export class FrequencyManager {
  private static instance: FrequencyManager;
  private wordSets: Map<string, WordList> = new Map();
  private initialized = false;

  private constructor() {}

  static getInstance(): FrequencyManager {
    if (!FrequencyManager.instance) {
      FrequencyManager.instance = new FrequencyManager();
    }
    return FrequencyManager.instance;
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
      console.log('FrequencyManager: Initialized with', this.wordSets.size, 'vocabularies');
    } catch (error) {
      console.error('FrequencyManager: Initialization failed', error);
    }
  }

  /**
   * Get difficulty level (1-10) for a word
   * 1-2: Common/Stop words
   * 3-4: CET-4
   * 5-6: CET-6
   * 7-8: TOEFL/IELTS
   * 9-10: GRE/Unknown
   */
  getDifficulty(word: string): number {
    if (!this.initialized) return 5;

    const lowerWord = word.toLowerCase().trim();

    // Check lists in order of difficulty
    if (this.wordSets.get('common')?.has(lowerWord)) return 1;
    if (this.wordSets.get('cet4')?.has(lowerWord)) return 3;
    if (this.wordSets.get('cet6')?.has(lowerWord)) return 5;
    if (this.wordSets.get('toefl')?.has(lowerWord)) return 7;
    if (this.wordSets.get('ielts')?.has(lowerWord)) return 7;
    if (this.wordSets.get('gre')?.has(lowerWord)) return 9;

    // Not found in any list -> likely hard or rare
    // Apply heuristics for length/suffix if not found (fallback handled by UserLevelManager)
    return 8;
  }

  /**
   * Check if a word is likely "Easy" (Common or CET-4)
   * Used for local filtering
   */
  isEasyWord(word: string): boolean {
    if (!this.initialized) return false;
    const lowerWord = word.toLowerCase().trim();
    return (
      this.wordSets.get('common')?.has(lowerWord) ||
      this.wordSets.get('cet4')?.has(lowerWord)
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
   * Check if text contains any potential unknown words for the user
   * Used for local static filtering before API calls
   *
   * @param text The text to analyze
   * @param userVocabularySize Estimated user vocabulary size
   * @returns true if text might contain difficult words, false if all words are likely known
   */
  hasPotentialUnknownWords(text: string, userVocabularySize: number): boolean {
    if (!this.initialized || !text) return true; // Fail safe: assume it needs translation

    // Simple tokenizer: remove punctuation, split by space
    const words = text
      .replace(/[^\w\s']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ');

    if (words.length === 0) return false;

    // Determine difficulty threshold based on vocabulary size
    // <3000 (Beginner): Threshold 2 (needs help with almost everything except basic)
    // 3000-5000 (CET4): Threshold 3
    // 5000-7000 (CET6): Threshold 5
    // >7000 (Advanced): Threshold 7
    let threshold = 3;
    if (userVocabularySize < 3000) threshold = 2;
    else if (userVocabularySize < 5000) threshold = 3;
    else if (userVocabularySize < 8000) threshold = 5;
    else threshold = 7;

    // Check each word
    for (const word of words) {
      // Skip numbers and very short words
      if (/^\d+$/.test(word) || word.length <= 2) continue;

      const difficulty = this.getDifficulty(word);
      if (difficulty >= threshold) {
        // Found a word that is harder than the threshold
        return true;
      }
    }

    // All words passed the filter (are easier than threshold)
    return false;
  }
}

// Export singleton
export const frequencyManager = FrequencyManager.getInstance();
