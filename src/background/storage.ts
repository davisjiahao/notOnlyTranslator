import type {
  UserProfile,
  UserSettings,
  UnknownWordEntry,
  TranslationResult,
  SyncStorageData,
} from '@/shared/types';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE, STORAGE_KEYS } from '@/shared/constants';

/**
 * Storage Manager - handles all chrome.storage operations
 */
export class StorageManager {
  /**
   * Get user profile from storage
   */
  static async getUserProfile(): Promise<UserProfile> {
    const syncData = await chrome.storage.sync.get(STORAGE_KEYS.SYNC.USER_PROFILE);
    const localData = await chrome.storage.local.get([
      STORAGE_KEYS.LOCAL.KNOWN_WORDS,
      STORAGE_KEYS.LOCAL.UNKNOWN_WORDS,
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
   */
  static async getSettings(): Promise<UserSettings> {
    const data = await chrome.storage.sync.get(STORAGE_KEYS.SYNC.SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...data[STORAGE_KEYS.SYNC.SETTINGS],
    };
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
   */
  static async getApiKey(): Promise<string> {
    const data = await chrome.storage.sync.get(STORAGE_KEYS.SYNC.API_KEY);
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
}
