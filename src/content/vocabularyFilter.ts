/**
 * VocabularyFilter - 词汇过滤服务
 * 根据用户英语水平，从扫描的段落中筛选出需要翻译的生僻词
 */

import type { Paragraph } from './pageScanner';
import type { UserProfile } from '@/shared/types';
import { frequencyManager } from '@/background/frequencyManager';

// 获取 FrequencyManager 类类型
 type FrequencyManagerType = typeof frequencyManager;

/**
 * 词汇过滤器配置
 */
export interface VocabularyFilterConfig {
  /** 最小单词长度（默认 3） */
  minWordLength: number;
  /** 是否排除常见停用词（默认 true） */
  excludeCommonWords: boolean;
}

/**
 * 过滤结果
 */
export interface FilterResult {
  /** 单词 */
  word: string;
  /** 所在元素 */
  element: HTMLElement;
  /** 段落 ID */
  paragraphId: string;
  /** 难度等级 (1-10) */
  difficulty: number;
  /** 是否已知 */
  isKnown: boolean;
}

/**
 * 常见停用词列表
 * 包括冠词、介词、连词、代词、助动词等
 */
export const STOP_WORDS = new Set([
  // 冠词
  'the', 'a', 'an',
  // be 动词
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  // have 动词
  'have', 'has', 'had',
  // do 动词
  'do', 'does', 'did', 'done', 'doing',
  // 情态动词
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can',
  'need', 'dare', 'ought', 'used',
  // 介词
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  // 连词
  'and', 'but', 'or', 'yet', 'so', 'if', 'because', 'although', 'though',
  'while', 'where', 'when', 'that', 'which',
  // 关系代词
  'who', 'whom', 'whose', 'what',
  // 指示代词
  'this', 'these', 'those',
  // 人称代词
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'me', 'him', 'her', 'us', 'them',
  // 物主代词
  'my', 'your', 'his', 'its', 'our', 'their',
  // 其他常见词
  'not', 'no', 'yes', 'all', 'any', 'both', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'only', 'own', 'same', 'than', 'too', 'very',
  'just', 'now', 'then', 'here', 'there', 'up', 'down', 'out', 'off', 'over',
  'under', 'again', 'further', 'once', 'also', 'how', 'why', 'where', 'what',
  'who', 'which', 'when', 'am', 'get', 'got', 'gets', 'go', 'goes', 'went',
  'gone', 'going', 'make', 'makes', 'made', 'making', 'see', 'sees', 'saw',
  'seen', 'seeing', 'know', 'knows', 'knew', 'known', 'knowing', 'take',
  'takes', 'took', 'taken', 'taking', 'come', 'comes', 'came', 'coming',
]);

/**
 * 默认配置
 */
const DEFAULT_CONFIG: VocabularyFilterConfig = {
  minWordLength: 3,
  excludeCommonWords: true,
};

/**
 * 词汇过滤器类
 * 负责根据用户水平过滤需要高亮的单词
 */
export class VocabularyFilter {
  private userLevel: UserProfile;
  private frequencyManager: FrequencyManagerType;
  private config: VocabularyFilterConfig;
  private knownWordsSet: Set<string>;

  /**
   * 构造函数
   * @param userLevel - 用户水平配置（UserProfile）
   * @param frequencyManager - 词频管理器
   * @param config - 可选的过滤器配置
   */
  constructor(
    userLevel: UserProfile,
    frequencyManager: FrequencyManagerType,
    config?: Partial<VocabularyFilterConfig>
  ) {
    this.userLevel = userLevel;
    this.frequencyManager = frequencyManager;
    this.config = { ...DEFAULT_CONFIG, ...config };
    // 使用用户已知的词汇列表初始化 Set，用于快速查找
    this.knownWordsSet = new Set(
      userLevel.knownWords.map(w => w.toLowerCase())
    );
  }

  /**
   * 过滤段落，返回应高亮的单词列表
   * @param paragraphs - 段落数组
   * @returns 过滤后的单词结果数组
   */
  filter(paragraphs: Paragraph[]): FilterResult[] {
    const results: FilterResult[] = [];
    const seenWords = new Set<string>(); // 用于去重

    for (const paragraph of paragraphs) {
      const words = this.extractWords(paragraph.text);

      for (const word of words) {
        const lowerWord = word.toLowerCase();

        // 1. 检查单词资格（长度、停用词等）
        if (!this.isWordEligible(word)) {
          continue;
        }

        // 2. 检查是否已处理过（去重）
        if (seenWords.has(lowerWord)) {
          continue;
        }

        // 3. 检查是否为已知词汇
        const isKnown = this.isWordKnown(lowerWord);
        if (isKnown) {
          continue;
        }

        // 4. 获取单词难度
        const difficulty = this.getWordDifficulty(word);

        // 5. 检查是否超过用户水平阈值
        const userThreshold = this.getUserDifficultyThreshold();
        if (difficulty <= userThreshold) {
          continue;
        }

        // 6. 添加到结果
        seenWords.add(lowerWord);
        results.push({
          word,
          element: paragraph.element,
          paragraphId: paragraph.id,
          difficulty,
          isKnown: false,
        });
      }
    }

    return results;
  }

  /**
   * 判断单词是否有资格被考虑
   * 检查：最小长度、纯数字、停用词
   * @param word - 要检查的单词
   * @returns 是否有资格
   */
  isWordEligible(word: string): boolean {
    // 1. 最小长度检查
    if (word.length < this.config.minWordLength) {
      return false;
    }

    // 2. 纯数字跳过
    if (/^\d+$/.test(word)) {
      return false;
    }

    // 3. 停用词检查
    if (this.config.excludeCommonWords && this.isStopWord(word)) {
      return false;
    }

    return true;
  }

  /**
   * 获取单词难度
   * 使用 FrequencyManager 查询难度，并映射到 1-10 范围
   * @param word - 单词
   * @returns 难度等级 (1-10)
   */
  getWordDifficulty(word: string): number {
    return this.frequencyManager.getDifficulty(word);
  }

  /**
   * 检查是否为停用词
   * @param word - 单词
   * @returns 是否为停用词
   */
  private isStopWord(word: string): boolean {
    return STOP_WORDS.has(word.toLowerCase());
  }

  /**
   * 检查单词是否为用户已知
   * @param word - 小写形式的单词
   * @returns 是否已知
   */
  private isWordKnown(word: string): boolean {
    return this.knownWordsSet.has(word.toLowerCase());
  }

  /**
   * 从文本中提取单词
   * 使用正则表达式匹配英文单词
   * @param text - 文本内容
   * @returns 单词数组
   */
  private extractWords(text: string): string[] {
    // 匹配英文单词（包括带连字符的复合词）
    const matches = text.match(/[a-zA-Z]+(?:-[a-zA-Z]+)*/g);
    return matches || [];
  }

  /**
   * 获取用户难度阈值
   * 基于用户的估计词汇量计算
   * @returns 难度阈值 (1-10)
   */
  private getUserDifficultyThreshold(): number {
    const vocabularySize = this.userLevel.estimatedVocabulary;

    // 根据词汇量映射到难度阈值
    // 词汇量越小，阈值越低（显示更多"难词"）
    if (vocabularySize < 3000) {
      return 2; // 初级：显示 CET-4 及以上
    } else if (vocabularySize < 5000) {
      return 3; // 中级：显示 CET-6 及以上
    } else if (vocabularySize < 8000) {
      return 5; // 中高级：显示托福/雅思及以上
    } else if (vocabularySize < 12000) {
      return 7; // 高级：显示 GRE 级别
    } else {
      return 8; // 专家级：只显示最难的词
    }
  }

  /**
   * 更新用户水平
   * 用于用户标记单词后更新过滤器
   * @param userLevel - 新的用户水平配置
   */
  updateUserLevel(userLevel: UserProfile): void {
    this.userLevel = userLevel;
    this.knownWordsSet = new Set(
      userLevel.knownWords.map(w => w.toLowerCase())
    );
  }

  /**
   * 获取配置
   * @returns 当前配置
   */
  getConfig(): VocabularyFilterConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   * @param config - 新的配置
   */
  updateConfig(config: Partial<VocabularyFilterConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

export default VocabularyFilter;
