import type {
  UserProfile,
  UserSettings,
  UnknownWordEntry,
  TranslationResult,
  SyncStorageData,
  ApiConfig,
} from '@/shared/types';
import type { MasteryProfile, WordMasteryEntry } from '@/shared/types/mastery';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE, STORAGE_KEYS } from '@/shared/constants';
import { logger } from '@/shared/utils';

/**
 * Storage Manager - handles all chrome.storage operations
 */
export class StorageManager {
  /**
   * Get user profile from storage
   */
  static async getUserProfile(): Promise<UserProfile> {
    const [syncData, localData] = await Promise.all([
      chrome.storage.sync.get(STORAGE_KEYS.SYNC.USER_PROFILE),
      chrome.storage.local.get([
        STORAGE_KEYS.LOCAL.KNOWN_WORDS,
        STORAGE_KEYS.LOCAL.UNKNOWN_WORDS,
      ]),
    ]);

    const profile = syncData[STORAGE_KEYS.SYNC.USER_PROFILE] || DEFAULT_USER_PROFILE;

    return {
      ...DEFAULT_USER_PROFILE,
      ...profile,
      knownWords: localData[STORAGE_KEYS.LOCAL.KNOWN_WORDS] || [],
      unknownWords: localData[STORAGE_KEYS.LOCAL.UNKNOWN_WORDS] || [],
      createdAt: profile.createdAt || Date.now(),
      updatedAt: profile.updatedAt || Date.now(),
    };
  }

  /**
   * Save user profile to storage
   */
  static async saveUserProfile(profile: UserProfile): Promise<void> {
    // Save to sync storage (small data)
    const syncData: Partial<SyncStorageData['userProfile']> = {
      examType: profile.examType,
      examScore: profile.examScore,
      estimatedVocabulary: profile.estimatedVocabulary,
      levelConfidence: profile.levelConfidence,
      createdAt: profile.createdAt,
      updatedAt: Date.now(),
    };

    await chrome.storage.sync.set({
      [STORAGE_KEYS.SYNC.USER_PROFILE]: syncData,
    });

    // Save to local storage (large data)
    await chrome.storage.local.set({
      [STORAGE_KEYS.LOCAL.KNOWN_WORDS]: profile.knownWords,
      [STORAGE_KEYS.LOCAL.UNKNOWN_WORDS]: profile.unknownWords,
    });
  }

  /**
   * Get user settings from storage
   * 如果有激活的 API 配置，会自动应用配置中的 provider、apiUrl、modelName
   */
  static async getSettings(): Promise<UserSettings> {
    const data = await chrome.storage.sync.get(STORAGE_KEYS.SYNC.SETTINGS);
    const settings = {
      ...DEFAULT_SETTINGS,
      ...data[STORAGE_KEYS.SYNC.SETTINGS],
    };

    // 如果有激活的 API 配置（或者只有一个配置时自动激活），应用配置中的值
    if (settings.apiConfigs?.length > 0) {
      const activeId = settings.activeApiConfigId || settings.apiConfigs[0].id;
      const activeConfig = settings.apiConfigs.find(
        (config: ApiConfig) => config.id === activeId
      );
      if (activeConfig) {
        settings.apiProvider = activeConfig.provider;
        settings.customApiUrl = activeConfig.apiUrl || '';
        settings.customModelName = activeConfig.modelName || '';
      }
    }

    return settings;
  }

  /**
   * Save user settings to storage
   */
  static async saveSettings(settings: UserSettings): Promise<void> {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SYNC.SETTINGS]: settings,
    });
  }

  /**
   * Get API key from storage
   * 优先从当前激活的 API 配置中读取，如果没有则使用旧版的 apiKey 字段
   */
  static async getApiKey(): Promise<string> {
    const settings = await this.getSettings();

    logger.info('StorageManager.getApiKey: 检查配置', {
      activeApiConfigId: settings.activeApiConfigId,
      apiConfigsCount: settings.apiConfigs?.length || 0,
      apiConfigs: settings.apiConfigs?.map(c => ({ id: c.id, name: c.name, hasKey: !!c.apiKey })),
    });

    // 如果有激活的 API 配置，从配置中读取 API Key
    if (settings.activeApiConfigId && settings.apiConfigs?.length > 0) {
      const activeConfig = settings.apiConfigs.find(
        (config) => config.id === settings.activeApiConfigId
      );
      logger.info('StorageManager.getApiKey: 激活配置', {
        found: !!activeConfig,
        configId: activeConfig?.id,
        hasApiKey: !!activeConfig?.apiKey,
      });
      if (activeConfig?.apiKey) {
        return activeConfig.apiKey;
      }
    }

    // 回退到旧版的 apiKey 字段
    const data = await chrome.storage.sync.get(STORAGE_KEYS.SYNC.API_KEY);
    logger.info('StorageManager.getApiKey: 回退到旧版 apiKey', {
      hasKey: !!data[STORAGE_KEYS.SYNC.API_KEY],
    });
    return data[STORAGE_KEYS.SYNC.API_KEY] || '';
  }

  /**
   * Save API key to storage
   */
  static async saveApiKey(apiKey: string): Promise<void> {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SYNC.API_KEY]: apiKey,
    });
  }

  /**
   * Add a word to known words
   */
  static async addKnownWord(word: string): Promise<void> {
    const profile = await this.getUserProfile();
    const lowerWord = word.toLowerCase();

    if (!profile.knownWords.includes(lowerWord)) {
      profile.knownWords.push(lowerWord);
    }

    // Remove from unknown words if present
    profile.unknownWords = profile.unknownWords.filter(
      (w) => w.word.toLowerCase() !== lowerWord
    );

    await this.saveUserProfile(profile);
  }

  /**
   * Add a word to unknown words (vocabulary)
   */
  static async addUnknownWord(entry: UnknownWordEntry): Promise<void> {
    const profile = await this.getUserProfile();
    const lowerWord = entry.word.toLowerCase();

    // Remove existing entry if present
    profile.unknownWords = profile.unknownWords.filter(
      (w) => w.word.toLowerCase() !== lowerWord
    );

    // Add new entry
    profile.unknownWords.push({
      ...entry,
      word: lowerWord,
    });

    // Remove from known words if present
    profile.knownWords = profile.knownWords.filter((w) => w !== lowerWord);

    await this.saveUserProfile(profile);
  }

  /**
   * Remove a word from vocabulary
   */
  static async removeFromVocabulary(word: string): Promise<void> {
    const profile = await this.getUserProfile();
    const lowerWord = word.toLowerCase();

    profile.unknownWords = profile.unknownWords.filter(
      (w) => w.word.toLowerCase() !== lowerWord
    );

    await this.saveUserProfile(profile);
  }

  /**
   * Get translation cache
   */
  static async getTranslationCache(): Promise<Record<string, TranslationResult>> {
    const data = await chrome.storage.local.get(STORAGE_KEYS.LOCAL.TRANSLATION_CACHE);
    return data[STORAGE_KEYS.LOCAL.TRANSLATION_CACHE] || {};
  }

  /**
   * Save translation to cache
   */
  static async cacheTranslation(
    key: string,
    result: TranslationResult
  ): Promise<void> {
    const cache = await this.getTranslationCache();
    cache[key] = { ...result, cached: true };

    // Limit cache size (keep last 1000 entries)
    const entries = Object.entries(cache);
    if (entries.length > 1000) {
      const toRemove = entries.slice(0, entries.length - 1000);
      toRemove.forEach(([k]) => delete cache[k]);
    }

    await chrome.storage.local.set({
      [STORAGE_KEYS.LOCAL.TRANSLATION_CACHE]: cache,
    });
  }

  /**
   * Get cached translation
   */
  static async getCachedTranslation(key: string): Promise<TranslationResult | null> {
    const cache = await this.getTranslationCache();
    return cache[key] || null;
  }

  /**
   * Clear all translation cache
   */
  static async clearTranslationCache(): Promise<void> {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LOCAL.TRANSLATION_CACHE]: {},
    });
  }

  /**
   * Export all data
   */
  static async exportData(): Promise<{
    profile: UserProfile;
    settings: UserSettings;
  }> {
    const profile = await this.getUserProfile();
    const settings = await this.getSettings();

    return { profile, settings };
  }

  /**
   * Import data
   */
  static async importData(data: {
    profile?: Partial<UserProfile>;
    settings?: Partial<UserSettings>;
  }): Promise<void> {
    if (data.profile) {
      const currentProfile = await this.getUserProfile();
      await this.saveUserProfile({
        ...currentProfile,
        ...data.profile,
      });
    }

    if (data.settings) {
      const currentSettings = await this.getSettings();
      await this.saveSettings({
        ...currentSettings,
        ...data.settings,
      });
    }
  }

  // ========== 掌握度系统相关方法 ==========

  /**
   * 掌握度存储键名
   */
  private static readonly MASTERY_STORAGE_KEY = 'masteryProfile';

  /**
   * 获取掌握度档案
   */
  static async getMasteryProfile(): Promise<MasteryProfile | null> {
    const data = await chrome.storage.local.get(this.MASTERY_STORAGE_KEY);
    const profile = data[this.MASTERY_STORAGE_KEY];

    if (!profile) {
      return null;
    }

    return {
      ...this.getDefaultMasteryProfile(),
      ...profile,
    };
  }

  /**
   * 保存掌握度档案
   */
  static async saveMasteryProfile(profile: MasteryProfile): Promise<void> {
    await chrome.storage.local.set({
      [this.MASTERY_STORAGE_KEY]: {
        ...profile,
        lastUpdatedAt: Date.now(),
      },
    });
  }

  /**
   * 获取默认掌握度档案
   */
  private static getDefaultMasteryProfile(): MasteryProfile {
    return {
      userId: 'default',
      wordMastery: {},
      stats: {
        totalWords: 0,
        masteredWords: 0,
        learningWords: 0,
        strugglingWords: 0,
        dueForReview: 0,
        levelDistribution: {
          A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0,
        },
      },
      estimatedOverallLevel: 'A1',
      lastUpdatedAt: Date.now(),
    };
  }

  /**
   * 获取单个单词的掌握度
   */
  static async getWordMastery(word: string): Promise<WordMasteryEntry | null> {
    const profile = await this.getMasteryProfile();
    if (!profile) return null;

    return profile.wordMastery[word.toLowerCase()] || null;
  }

  /**
   * 更新单词掌握度
   */
  static async updateWordMastery(entry: WordMasteryEntry): Promise<void> {
    const profile = await this.getMasteryProfile() || this.getDefaultMasteryProfile();

    profile.wordMastery[entry.word.toLowerCase()] = entry;
    profile.lastUpdatedAt = Date.now();

    // 重新计算统计信息
    profile.stats = this.calculateMasteryStats(profile.wordMastery);

    await this.saveMasteryProfile(profile);
  }

  /**
   * 批量更新单词掌握度
   */
  static async batchUpdateWordMastery(entries: WordMasteryEntry[]): Promise<void> {
    const profile = await this.getMasteryProfile() || this.getDefaultMasteryProfile();

    entries.forEach(entry => {
      profile.wordMastery[entry.word.toLowerCase()] = entry;
    });

    profile.lastUpdatedAt = Date.now();
    profile.stats = this.calculateMasteryStats(profile.wordMastery);

    await this.saveMasteryProfile(profile);
  }

  /**
   * 删除单词掌握度记录
   */
  static async deleteWordMastery(word: string): Promise<void> {
    const profile = await this.getMasteryProfile();
    if (!profile) return;

    delete profile.wordMastery[word.toLowerCase()];
    profile.lastUpdatedAt = Date.now();
    profile.stats = this.calculateMasteryStats(profile.wordMastery);

    await this.saveMasteryProfile(profile);
  }

  /**
   * 更新整体 CEFR 等级
   */
  static async updateOverallCEFRLevel(level: string): Promise<void> {
    const profile = await this.getMasteryProfile();
    if (!profile) return;

    profile.estimatedOverallLevel = level as import('@/shared/types/mastery').CEFRLevel;
    profile.lastUpdatedAt = Date.now();

    await this.saveMasteryProfile(profile);
  }

  /**
   * 获取需要复习的单词列表
   */
  static async getDueForReview(limit: number = 20): Promise<WordMasteryEntry[]> {
    const profile = await this.getMasteryProfile();
    if (!profile) return [];

    const now = Date.now();
    const entries = Object.values(profile.wordMastery);

    return entries
      .filter(e => e.nextReviewAt <= now)
      .sort((a, b) => {
        // 按优先级排序：逾期时间 + (1 - 掌握度) * 5
        const daysOverdueA = (now - a.nextReviewAt) / (1000 * 60 * 60 * 24);
        const daysOverdueB = (now - b.nextReviewAt) / (1000 * 60 * 60 * 24);
        const priorityA = daysOverdueA + (1 - a.masteryLevel) * 5;
        const priorityB = daysOverdueB + (1 - b.masteryLevel) * 5;
        return priorityB - priorityA;
      })
      .slice(0, limit);
  }

  /**
   * 计算掌握度统计（静态辅助方法）
   */
  private static calculateMasteryStats(
    wordMastery: Record<string, WordMasteryEntry>
  ): import('@/shared/types/mastery').WordMasteryStats {
    const entries = Object.values(wordMastery);

    const totalWords = entries.length;
    const masteredWords = entries.filter(e => e.masteryLevel >= 0.8).length;
    const learningWords = entries.filter(
      e => e.masteryLevel >= 0.3 && e.masteryLevel < 0.8
    ).length;
    const strugglingWords = entries.filter(e => e.masteryLevel < 0.3).length;

    const now = Date.now();
    const dueForReview = entries.filter(e => e.nextReviewAt <= now).length;

    const levelDistribution: Record<string, number> = {
      A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0,
    };

    entries.forEach(e => {
      levelDistribution[e.estimatedLevel] = (levelDistribution[e.estimatedLevel] || 0) + 1;
    });

    return {
      totalWords,
      masteredWords,
      learningWords,
      strugglingWords,
      dueForReview,
      levelDistribution: levelDistribution as import('@/shared/types/mastery').WordMasteryStats['levelDistribution'],
    };
  }

  /**
   * 导出掌握度数据（用于备份）
   */
  static async exportMasteryData(): Promise<MasteryProfile | null> {
    return await this.getMasteryProfile();
  }

  /**
   * 导入掌握度数据
   */
  static async importMasteryData(data: Partial<MasteryProfile>): Promise<void> {
    const current = await this.getMasteryProfile() || this.getDefaultMasteryProfile();

    await this.saveMasteryProfile({
      ...current,
      ...data,
      lastUpdatedAt: Date.now(),
    });
  }

  /**
   * 清除所有掌握度数据
   */
  static async clearMasteryData(): Promise<void> {
    await chrome.storage.local.remove(this.MASTERY_STORAGE_KEY);
  }
}
