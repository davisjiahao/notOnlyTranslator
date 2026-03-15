import type { UnknownWordEntry } from '@/shared/types';
import type {
  WordMasteryEntry,
  MasteryProfile,
  MasteryUpdateResult,
  CEFRLevel,
  WordMasteryStats,
  MasteryTrend,
  ReviewReminder,
  LearningStatistics,
} from '@/shared/types/mastery';
import { StorageManager } from './storage';
import { logger } from '@/shared/utils';
import {
  createWordMasteryEntry,
  updateWordMastery,
  calculateMasteryStats,
  calculateOverallCEFRLevel,
  getReviewReminders,
  calculateMasteryTrend,
  calculateLearningStatistics,
} from '@/shared/utils/mastery';

/**
 * MasteryManager - 词汇掌握度管理器
 *
 * 协调掌握度系统的所有操作：
 * 1. 用户标记单词时的掌握度更新
 * 2. 与 StorageManager 的掌握度数据同步
 * 3. 用户整体 CEFR 水平估算
 * 4. 与现有 UserProfile 系统的协同
 */
export class MasteryManager {
  /**
   * 处理用户标记单词事件
   *
   * @param wordEntry - 单词信息
   * @param isKnown - 用户是否认识该单词
   * @param wordDifficulty - 单词难度 1-10
   * @returns 更新结果
   */
  static async markWord(
    wordEntry: UnknownWordEntry,
    isKnown: boolean,
    wordDifficulty: number = 5
  ): Promise<MasteryUpdateResult> {
    const word = wordEntry.word.toLowerCase();

    logger.info('MasteryManager.markWord: 开始处理单词标记', {
      word,
      isKnown,
      difficulty: wordDifficulty,
    });

    // 获取用户档案用于词汇量估算
    const userProfile = await StorageManager.getUserProfile();
    const userVocabularySize = userProfile.estimatedVocabulary || 3000;

    // 获取现有掌握度条目
    let entry = await StorageManager.getWordMastery(word);

    if (!entry) {
      // 首次标记该单词，创建新条目
      logger.info('MasteryManager.markWord: 首次标记，创建新条目', { word });
      entry = createWordMasteryEntry(wordEntry, wordDifficulty, isKnown);
      await StorageManager.updateWordMastery(entry);

      return {
        newMasteryLevel: entry.masteryLevel,
        newConfidence: entry.confidence,
        nextReviewInterval: Math.round(
          (entry.nextReviewAt - Date.now()) / (24 * 60 * 60 * 1000)
        ),
        levelUpgraded: false,
        newLevel: entry.estimatedLevel,
      };
    }

    // 已有条目，使用贝叶斯更新
    logger.info('MasteryManager.markWord: 更新现有条目', {
      word,
      currentMastery: entry.masteryLevel,
      currentConfidence: entry.confidence,
    });

    const updateResult = updateWordMastery(
      entry,
      isKnown,
      wordDifficulty,
      userVocabularySize
    );

    // 更新条目
    const updatedEntry: WordMasteryEntry = {
      ...entry,
      ...wordEntry, // 更新上下文信息
      word: entry.word, // 保持原单词（小写）
      masteryLevel: updateResult.newMasteryLevel,
      confidence: updateResult.newConfidence,
      knownCount: entry.knownCount + (isKnown ? 1 : 0),
      unknownCount: entry.unknownCount + (isKnown ? 0 : 1),
      lastReviewAt: Date.now(),
      nextReviewAt: Date.now() + updateResult.nextReviewInterval * 24 * 60 * 60 * 1000,
      estimatedLevel: updateResult.newLevel,
    };

    await StorageManager.updateWordMastery(updatedEntry);

    // 如果升级了 CEFR 等级，记录日志
    if (updateResult.levelUpgraded) {
      logger.info('MasteryManager.markWord: 单词 CEFR 等级升级', {
        word,
        oldLevel: entry.estimatedLevel,
        newLevel: updateResult.newLevel,
      });
    }

    logger.info('MasteryManager.markWord: 更新完成', {
      word,
      newMastery: updateResult.newMasteryLevel,
      newConfidence: updateResult.newConfidence,
    });

    return updateResult;
  }

  /**
   * 批量处理用户标记单词
   *
   * @param entries - 单词条目和标记状态数组
   * @returns 更新结果数组
   */
  static async batchMarkWords(
    entries: Array<{
      wordEntry: UnknownWordEntry;
      isKnown: boolean;
      wordDifficulty?: number;
    }>
  ): Promise<MasteryUpdateResult[]> {
    logger.info('MasteryManager.batchMarkWords: 批量标记', {
      count: entries.length,
    });

    const userProfile = await StorageManager.getUserProfile();
    const userVocabularySize = userProfile.estimatedVocabulary || 3000;

    const results: MasteryUpdateResult[] = [];
    const updatedEntries: WordMasteryEntry[] = [];

    for (const { wordEntry, isKnown, wordDifficulty = 5 } of entries) {
      const word = wordEntry.word.toLowerCase();
      let entry = await StorageManager.getWordMastery(word);

      if (!entry) {
        entry = createWordMasteryEntry(wordEntry, wordDifficulty, isKnown);
        updatedEntries.push(entry);
        results.push({
          newMasteryLevel: entry.masteryLevel,
          newConfidence: entry.confidence,
          nextReviewInterval: Math.round(
            (entry.nextReviewAt - Date.now()) / (24 * 60 * 60 * 1000)
          ),
          levelUpgraded: false,
          newLevel: entry.estimatedLevel,
        });
      } else {
        const updateResult = updateWordMastery(
          entry,
          isKnown,
          wordDifficulty,
          userVocabularySize
        );

        const updatedEntry: WordMasteryEntry = {
          ...entry,
          ...wordEntry,
          word: entry.word,
          masteryLevel: updateResult.newMasteryLevel,
          confidence: updateResult.newConfidence,
          knownCount: entry.knownCount + (isKnown ? 1 : 0),
          unknownCount: entry.unknownCount + (isKnown ? 0 : 1),
          lastReviewAt: Date.now(),
          nextReviewAt: Date.now() + updateResult.nextReviewInterval * 24 * 60 * 60 * 1000,
          estimatedLevel: updateResult.newLevel,
        };

        updatedEntries.push(updatedEntry);
        results.push(updateResult);
      }
    }

    // 批量保存
    if (updatedEntries.length > 0) {
      await StorageManager.batchUpdateWordMastery(updatedEntries);
    }

    logger.info('MasteryManager.batchMarkWords: 批量标记完成', {
      count: updatedEntries.length,
    });

    return results;
  }

  /**
   * 获取用户掌握度档案概览
   */
  static async getMasteryOverview(): Promise<{
    profile: MasteryProfile | null;
    stats: WordMasteryStats | null;
  }> {
    const profile = await StorageManager.getMasteryProfile();

    if (!profile) {
      return { profile: null, stats: null };
    }

    const stats = calculateMasteryStats(profile.wordMastery);
    return { profile, stats };
  }

  /**
   * 获取用户整体 CEFR 水平建议
   *
   * @returns 估算的 CEFR 等级和置信度
   */
  static async getUserCEFRLevel(): Promise<{
    level: CEFRLevel;
    confidence: number;
    vocabularyEstimate: number;
  }> {
    const [profile, userProfile] = await Promise.all([
      StorageManager.getMasteryProfile(),
      StorageManager.getUserProfile(),
    ]);

    const estimatedVocabulary = userProfile.estimatedVocabulary || 3000;

    if (!profile) {
      // 没有掌握度数据时，基于词汇量估算
      return {
        level: this.vocabularyToCEFR(estimatedVocabulary),
        confidence: 0.3,
        vocabularyEstimate: estimatedVocabulary,
      };
    }

    const level = calculateOverallCEFRLevel(profile.wordMastery, estimatedVocabulary);

    // 计算置信度：基于数据量和平均置信度
    const entries = Object.values(profile.wordMastery);
    const avgConfidence =
      entries.length > 0
        ? entries.reduce((sum, e) => sum + e.confidence, 0) / entries.length
        : 0;
    const dataAmountConfidence = Math.min(1, entries.length / 100); // 100个单词以上置信度为1
    const confidence = avgConfidence * 0.5 + dataAmountConfidence * 0.5;

    // 更新整体 CEFR 等级
    await StorageManager.updateOverallCEFRLevel(level);

    return {
      level,
      confidence,
      vocabularyEstimate: estimatedVocabulary,
    };
  }

  /**
   * 获取需要复习的单词列表
   *
   * @param limit - 最大返回数量
   * @returns 复习提醒列表
   */
  static async getReviewWords(limit: number = 20): Promise<ReviewReminder[]> {
    const profile = await StorageManager.getMasteryProfile();

    if (!profile) {
      return [];
    }

    return getReviewReminders(profile.wordMastery, limit);
  }

  /**
   * 获取掌握度趋势数据
   *
   * @param days - 统计天数
   * @returns 趋势数据
   */
  static async getMasteryTrend(days: number = 30): Promise<MasteryTrend | null> {
    const profile = await StorageManager.getMasteryProfile();

    if (!profile) {
      return null;
    }

    return calculateMasteryTrend(profile.wordMastery, days);
  }

  /**
   * 同步用户档案的词汇量估算到掌握度系统
   *
   * 当用户更新考试成绩时调用，保持数据一致性
   */
  static async syncUserVocabulary(): Promise<void> {
    const userProfile = await StorageManager.getUserProfile();
    const masteryProfile = await StorageManager.getMasteryProfile();

    if (!masteryProfile) {
      logger.info('MasteryManager.syncUserVocabulary: 无掌握度数据，跳过同步');
      return;
    }

    // 更新整体等级（会使用新的词汇量估算重新计算）
    const newLevel = calculateOverallCEFRLevel(
      masteryProfile.wordMastery,
      userProfile.estimatedVocabulary || 3000
    );

    if (newLevel !== masteryProfile.estimatedOverallLevel) {
      logger.info('MasteryManager.syncUserVocabulary: 更新整体 CEFR 等级', {
        oldLevel: masteryProfile.estimatedOverallLevel,
        newLevel,
      });
      await StorageManager.updateOverallCEFRLevel(newLevel);
    }
  }

  /**
   * 获取指定单词的掌握度信息
   */
  static async getWordMasteryInfo(
    word: string
  ): Promise<(WordMasteryEntry & { daysUntilReview: number }) | null> {
    const entry = await StorageManager.getWordMastery(word.toLowerCase());

    if (!entry) {
      return null;
    }

    const now = Date.now();
    const daysUntilReview = Math.max(
      0,
      Math.ceil((entry.nextReviewAt - now) / (24 * 60 * 60 * 1000))
    );

    return {
      ...entry,
      daysUntilReview,
    };
  }

  /**
   * 获取学习统计数据（用于统计仪表盘）
   *
   * @param days - 统计天数
   * @returns 学习统计数据
   */
  static async getLearningStatistics(days: number = 90): Promise<LearningStatistics | null> {
    const profile = await StorageManager.getMasteryProfile();

    if (!profile) {
      return null;
    }

    return calculateLearningStatistics(profile.wordMastery, days);
  }

  /**
   * 导出所有掌握度数据（用于备份）
   */
  static async exportData(): Promise<{
    masteryProfile: MasteryProfile | null;
    stats: WordMasteryStats | null;
  }> {
    const profile = await StorageManager.exportMasteryData();

    if (!profile) {
      return { masteryProfile: null, stats: null };
    }

    const stats = calculateMasteryStats(profile.wordMastery);
    return { masteryProfile: profile, stats };
  }

  /**
   * 导入掌握度数据
   */
  static async importData(data: Partial<MasteryProfile>): Promise<void> {
    await StorageManager.importMasteryData(data);
    logger.info('MasteryManager.importData: 掌握度数据导入完成');
  }

  /**
   * 重置所有掌握度数据
   */
  static async resetData(): Promise<void> {
    await StorageManager.clearMasteryData();
    logger.info('MasteryManager.resetData: 掌握度数据已重置');
  }

  /**
   * 词汇量转 CEFR 等级（辅助方法）
   */
  private static vocabularyToCEFR(vocabularySize: number): CEFRLevel {
    if (vocabularySize < 1500) return 'A1';
    if (vocabularySize < 2500) return 'A2';
    if (vocabularySize < 4000) return 'B1';
    if (vocabularySize < 6000) return 'B2';
    if (vocabularySize < 9000) return 'C1';
    return 'C2';
  }
}
