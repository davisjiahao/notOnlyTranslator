/**
 * 语境捕获服务
 * Context Capture Service
 *
 * 捕获用户阅读时遇到生词的上下文，用于语境学习模式。
 */

import type { WordContext, VocabularyEntry } from '@/shared/types/vocabulary';
import { logger } from '@/shared/utils';

/**
 * 存储键名
 */
const STORAGE_KEY = 'vocabularyWithContexts';

/**
 * 语境捕获配置
 */
export interface ContextCaptureConfig {
  /** 是否启用语境捕获 */
  enabled: boolean;
  /** 最大上下文数量（每个单词） */
  maxContextsPerWord: number;
  /** 最大句子长度 */
  maxSentenceLength: number;
  /** 最小句子长度 */
  minSentenceLength: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONTEXT_CAPTURE_CONFIG: ContextCaptureConfig = {
  enabled: true,
  maxContextsPerWord: 5,
  maxSentenceLength: 300,
  minSentenceLength: 10,
};

/**
 * 带上下文的词汇条目
 */
export interface VocabularyWithContextEntry extends VocabularyEntry {
  contexts: WordContext[];
}

/**
 * 语境捕获管理器
 */
export class ContextCaptureManager {
  private config: ContextCaptureConfig;
  private vocabulary: Map<string, VocabularyWithContextEntry> = new Map();

  constructor(config: ContextCaptureConfig = DEFAULT_CONTEXT_CAPTURE_CONFIG) {
    this.config = config;
  }

  /**
   * 加载词汇数据
   */
  async load(): Promise<void> {
    try {
      const result = await chrome.storage.local.get(STORAGE_KEY);
      if (result[STORAGE_KEY]) {
        const data = result[STORAGE_KEY] as VocabularyWithContextEntry[];
        this.vocabulary = new Map(data.map(entry => [entry.word.toLowerCase(), entry]));
      }
      logger.info('ContextCaptureManager: 数据加载完成');
    } catch (error) {
      logger.error('ContextCaptureManager: 加载失败', error);
    }
  }

  /**
   * 保存词汇数据
   */
  async save(): Promise<void> {
    try {
      const data = Array.from(this.vocabulary.values());
      await chrome.storage.local.set({ [STORAGE_KEY]: data });
      logger.debug('ContextCaptureManager: 数据保存完成');
    } catch (error) {
      logger.error('ContextCaptureManager: 保存失败', error);
    }
  }

  /**
   * 捕获单词的上下文
   *
   * @param word 单词
   * @param sentence 包含该单词的句子
   * @param source 来源（网站名称）
   * @param url 来源 URL
   */
  async captureContext(
    word: string,
    sentence: string,
    source?: string,
    url?: string
  ): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const normalizedWord = word.toLowerCase().trim();
    const trimmedSentence = sentence.trim();

    // 验证句子长度
    if (
      trimmedSentence.length < this.config.minSentenceLength ||
      trimmedSentence.length > this.config.maxSentenceLength
    ) {
      return false;
    }

    // 验证句子是否包含该单词
    if (!trimmedSentence.toLowerCase().includes(normalizedWord)) {
      return false;
    }

    const entry = this.vocabulary.get(normalizedWord);

    if (entry) {
      // 检查是否已有相同句子
      const exists = entry.contexts.some(
        c => c.sentence.toLowerCase() === trimmedSentence.toLowerCase()
      );
      if (exists) {
        return false;
      }

      // 添加新上下文
      if (entry.contexts.length >= this.config.maxContextsPerWord) {
        // 移除最旧的上下文
        entry.contexts.shift();
      }

      entry.contexts.push({
        sentence: trimmedSentence,
        source,
        url,
        capturedAt: Date.now(),
      });

      entry.contexts.sort((a, b) => b.capturedAt - a.capturedAt);
    } else {
      // 创建新条目
      this.vocabulary.set(normalizedWord, {
        word: normalizedWord,
        mastery: {
          word: normalizedWord,
          level: 0,
          firstSeenAt: Date.now(),
          lastReviewedAt: Date.now(),
          reviewCount: 0,
          correctCount: 0,
          consecutiveCorrect: 0,
          difficulty: 0.5,
          contextCount: 1,
        },
        addedAt: Date.now(),
        contexts: [
          {
            sentence: trimmedSentence,
            source,
            url,
            capturedAt: Date.now(),
          },
        ],
      });
    }

    await this.save();
    return true;
  }

  /**
   * 批量捕获上下文
   */
  async captureContexts(
    items: Array<{ word: string; sentence: string; source?: string; url?: string }>
  ): Promise<number> {
    let captured = 0;
    for (const item of items) {
      const success = await this.captureContext(
        item.word,
        item.sentence,
        item.source,
        item.url
      );
      if (success) captured++;
    }
    return captured;
  }

  /**
   * 获取单词的上下文
   */
  getContexts(word: string): WordContext[] {
    const normalizedWord = word.toLowerCase().trim();
    const entry = this.vocabulary.get(normalizedWord);
    return entry?.contexts || [];
  }

  /**
   * 获取所有有上下文的词汇
   */
  getVocabularyWithContexts(): VocabularyWithContextEntry[] {
    return Array.from(this.vocabulary.values()).filter(entry => entry.contexts.length > 0);
  }

  /**
   * 获取随机上下文用于学习
   *
   * @param count 数量
   * @param minLength 最小句子长度（过滤太短的句子）
   */
  getRandomContexts(count: number, minLength = 20): Array<{
    word: string;
    context: WordContext;
  }> {
    const allContexts: Array<{ word: string; context: WordContext }> = [];

    for (const entry of this.vocabulary.values()) {
      for (const context of entry.contexts) {
        if (context.sentence.length >= minLength) {
          allContexts.push({ word: entry.word, context });
        }
      }
    }

    // 随机打乱
    for (let i = allContexts.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allContexts[i], allContexts[j]] = [allContexts[j], allContexts[i]];
    }

    return allContexts.slice(0, count);
  }

  /**
   * 删除单词的上下文
   */
  async removeContext(word: string, capturedAt: number): Promise<boolean> {
    const normalizedWord = word.toLowerCase().trim();
    const entry = this.vocabulary.get(normalizedWord);

    if (!entry) return false;

    const index = entry.contexts.findIndex(c => c.capturedAt === capturedAt);
    if (index === -1) return false;

    entry.contexts.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * 清除所有上下文数据
   */
  async clearAll(): Promise<void> {
    this.vocabulary.clear();
    await chrome.storage.local.remove(STORAGE_KEY);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalWords: number;
    totalContexts: number;
    averageContextsPerWord: number;
    topSources: Array<{ source: string; count: number }>;
  } {
    const entries = Array.from(this.vocabulary.values());
    const totalWords = entries.length;
    const totalContexts = entries.reduce((sum, e) => sum + e.contexts.length, 0);

    // 统计来源
    const sourceCounts = new Map<string, number>();
    for (const entry of entries) {
      for (const context of entry.contexts) {
        const source = context.source || '未知来源';
        sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
      }
    }

    const topSources = Array.from(sourceCounts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalWords,
      totalContexts,
      averageContextsPerWord: totalWords > 0 ? totalContexts / totalWords : 0,
      topSources,
    };
  }
}

// 导出单例
export const contextCaptureManager = new ContextCaptureManager();