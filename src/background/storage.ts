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
import { PARTIAL_PROFILE_IMPORT_ERROR } from '@/shared/utils/importErrors';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

type SettingsUpdate = Partial<UserSettings> & {
  hybridTranslationPatch?: Partial<NonNullable<UserSettings['hybridTranslation']>>;
};

/**
 * Storage Manager - handles all chrome.storage operations
 */
export class StorageManager {
  private static profileUpdates: Promise<unknown> = Promise.resolve();
  private static settingsUpdates: Promise<unknown> = Promise.resolve();
  private static readonly LEGACY_API_KEY_INVALIDATED = 'legacyApiKeyInvalidated';
  private static readonly TRADITIONAL_API_KEY_OWNERS = 'traditionalApiKeyOwners';
  private static readonly MAX_IMPORT_ENTRIES = 5000;
  private static readonly MAX_PROFILE_BYTES = 8 * 1024 * 1024;

  private static async saveImportedProfile(next: UserProfile, current: UserProfile): Promise<void> {
    const bytes = new TextEncoder().encode(JSON.stringify({
      knownWords: next.knownWords,
      unknownWords: next.unknownWords,
    })).length;
    if (bytes > this.MAX_PROFILE_BYTES) throw new Error('导入数据超出可用存储空间');
    try {
      await this.saveUserProfile(next);
    } catch {
      try {
        await this.saveUserProfile(current);
      } catch {
        throw new Error(PARTIAL_PROFILE_IMPORT_ERROR);
      }
      throw new Error('导入失败，原档案已恢复');
    }
  }

  private static updateProfile<T>(update: (profile: UserProfile) => Promise<T>): Promise<T> {
    const operation = this.profileUpdates.then(async () => update(await this.getUserProfile()));
    this.profileUpdates = operation.catch(() => undefined);
    return operation;
  }

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
      apiConfigsRevision: data[STORAGE_KEYS.SYNC.SETTINGS]?.apiConfigsRevision ?? 0,
      hybridCredentialsRevision: data[STORAGE_KEYS.SYNC.SETTINGS]?.hybridCredentialsRevision ?? 0,
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
   * @param verified 队列内调用传入版本校验所基于的快照；写入前复核版本未被外部推进，
   * 否则基于旧快照的写入会使旧 apiConfigs 复活、版本停滞或倒退。
   */
  static async saveSettings(
    settings: UserSettings, invalidateHybridCredentials = false, verified?: UserSettings
  ): Promise<void> {
    const current = await this.getSettings();
    if (!verified && (settings.apiConfigsRevision ?? 0) < (current.apiConfigsRevision ?? 0)) {
      throw new Error('API 配置已变更或缺少版本，请刷新设置后重试');
    }
    // 版本校验与写入之间不能存在无防护窗口：Chrome Sync 外部写入会先落到上面的读取里，
    // 此处必须拒绝而不是让校验前的旧快照覆盖新写入。
    if (verified) {
      if ((verified.apiConfigsRevision ?? 0) !== (current.apiConfigsRevision ?? 0)) {
        throw new Error('API 配置已变更或缺少版本，请刷新设置后重试');
      }
      if ((verified.hybridCredentialsRevision ?? 0) !== (current.hybridCredentialsRevision ?? 0)) {
        throw new Error('混合翻译凭据已变更或缺少版本，请刷新设置后重试');
      }
    }
    const previousHybrid = current.hybridTranslation;
    const nextHybrid = Object.prototype.hasOwnProperty.call(settings, 'hybridTranslation')
      ? settings.hybridTranslation
      : DEFAULT_SETTINGS.hybridTranslation;
    // 归属记录前复用 provider/key 输入校验：非法提供商一旦写入指纹归属表，
    // 同密钥换任何合法提供商都会被判错主清空，污染无法自行恢复。
    // provider 为 undefined 时放行：兼容缺字段的旧版完整设置数据（缺省即默认 deepl）。
    if (nextHybrid && ((nextHybrid.traditionalProvider !== undefined && !this.isValidTraditionalProvider(nextHybrid.traditionalProvider)) ||
        (nextHybrid.traditionalApiKey !== undefined && typeof nextHybrid.traditionalApiKey !== 'string'))) {
      throw new Error('混合翻译设置格式无效');
    }
    const data = previousHybrid?.traditionalApiKey || nextHybrid?.traditionalApiKey
      ? await chrome.storage.sync.get(this.TRADITIONAL_API_KEY_OWNERS)
      : {};
    const owners: Record<string, string> = data[this.TRADITIONAL_API_KEY_OWNERS] ?? {};
    const fingerprint = (key: string) => bytesToHex(sha256(utf8ToBytes(key)));
    const previousHash = previousHybrid?.traditionalApiKey ? fingerprint(previousHybrid.traditionalApiKey) : '';
    const nextHash = nextHybrid?.traditionalApiKey ? fingerprint(nextHybrid.traditionalApiKey) : '';
    // 归属独立于可重放的设置载荷持久化；只保存指纹，清键及后台重启后也不能改绑。
    const knownOwners = previousHash && !owners[previousHash]
      ? { ...owners, [previousHash]: previousHybrid!.traditionalProvider }
      : owners;
    const wrongOwner = nextHash && knownOwners[nextHash] && knownOwners[nextHash] !== nextHybrid!.traditionalProvider;
    const safeHybrid = wrongOwner ? { ...nextHybrid!, traditionalApiKey: '' } : nextHybrid;
    const credentialsChanged = invalidateHybridCredentials || wrongOwner ||
      previousHybrid?.traditionalProvider !== safeHybrid?.traditionalProvider ||
      (previousHybrid?.traditionalApiKey ?? '') !== (safeHybrid?.traditionalApiKey ?? '');
    const hybridRevision = (current.hybridCredentialsRevision ?? 0) + (credentialsChanged ? 1 : 0);
    const { hybridCredentialsRevision: _importedRevision, ...fields } = settings;
    const safeSettings = {
      ...fields,
      ...(wrongOwner ? { hybridTranslation: safeHybrid } : {}),
      ...(hybridRevision > 0 ? { hybridCredentialsRevision: hybridRevision } : {}),
    };
    const nextOwners = nextHash && !wrongOwner
      ? { ...knownOwners, [nextHash]: nextHybrid!.traditionalProvider }
      : knownOwners;
    const invalidateLegacyKey = !this.isLegacyOpenAISettings(current) ||
      !this.isLegacyOpenAISettings({ ...DEFAULT_SETTINGS, ...settings });
    // 同一次写入提交设置、清键及持久失效标记；恢复旧设置不能恢复旧字段的归属。
    // Chrome Storage 不提供跨调用事务，其他写入者也不得删除该标记。
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SYNC.SETTINGS]: safeSettings,
      ...(Object.keys(nextOwners).length ? { [this.TRADITIONAL_API_KEY_OWNERS]: nextOwners } : {}),
      ...(invalidateLegacyKey ? {
        [STORAGE_KEYS.SYNC.API_KEY]: '',
        [this.LEGACY_API_KEY_INVALIDATED]: true,
      } : {}),
    });
  }

  private static queueSettingsUpdate(
    update: (current: UserSettings) => UserSettings, invalidateHybridCredentials = false
  ): Promise<void> {
    const operation = this.settingsUpdates.then(async () => {
      const current = await this.getSettings();
      // 校验、合并与写入必须基于同一快照：把校验快照传入，写入前复核版本未被外部推进。
      await this.saveSettings(update(current), invalidateHybridCredentials, current);
    });
    this.settingsUpdates = operation.catch(() => undefined);
    return operation;
  }

  /** 传统提供商白名单：增量校验与完整写入的归属记录共用同一判定。 */
  private static isValidTraditionalProvider(value: unknown): boolean {
    return ['deepl', 'google_translate', 'youdao'].includes(value as string);
  }

  private static validateHybridPatch(patch: unknown): void {
    const validators: Record<string, (value: unknown) => boolean> = {
      enabled: value => typeof value === 'boolean',
      defaultEngine: value => ['llm', 'traditional', 'hybrid'].includes(value as string),
      traditionalProvider: value => this.isValidTraditionalProvider(value),
      traditionalApiKey: value => value === undefined || typeof value === 'string',
      simpleTextThreshold: value => typeof value === 'number' && Number.isFinite(value) && value >= 0,
      enableSmartRouting: value => typeof value === 'boolean',
      priority: value => ['quality', 'speed', 'balanced'].includes(value as string),
    };
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      Object.entries(patch).some(([key, value]) => !Object.prototype.hasOwnProperty.call(validators, key) || !validators[key](value))) {
      throw new Error('混合翻译设置格式无效');
    }
  }

  static updateSettings(
    updates: SettingsUpdate, expectedApiConfigsRevision?: number, expectedHybridCredentialsRevision?: number
  ): Promise<void> {
    const has = (object: unknown, key: string) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
    const changesCredentials = has(updates, 'hybridTranslation') ||
      has(updates?.hybridTranslationPatch, 'traditionalProvider') || has(updates?.hybridTranslationPatch, 'traditionalApiKey');
    return this.queueSettingsUpdate(current => {
      if (!updates || typeof updates !== 'object' || Array.isArray(updates)) throw new Error('设置格式无效');
      const { hybridTranslationPatch, ...fields } = updates;
      const hasPatch = has(updates, 'hybridTranslationPatch');
      if (hasPatch) {
        if (has(updates, 'hybridTranslation')) throw new Error('不能同时提交混合翻译设置与增量');
        this.validateHybridPatch(hybridTranslationPatch);
      }
      const revision = current.apiConfigsRevision ?? 0;
      const changesConfigs = has(updates, 'apiConfigs');
      // 所有版本校验和嵌套合并均在队列内完成，不能拼接旧窗口的完整凭据快照。
      if (changesConfigs && (!Number.isSafeInteger(expectedApiConfigsRevision) || expectedApiConfigsRevision !== revision)) {
        throw new Error('API 配置已变更或缺少版本，请刷新设置后重试');
      }
      if (changesCredentials && (!Number.isSafeInteger(expectedHybridCredentialsRevision) ||
        expectedHybridCredentialsRevision !== (current.hybridCredentialsRevision ?? 0))) {
        throw new Error('混合翻译凭据已变更或缺少版本，请刷新设置后重试');
      }
      return {
        ...current, ...fields,
        ...(hasPatch ? { hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation!, ...current.hybridTranslation, ...hybridTranslationPatch } } : {}),
        apiConfigsRevision: revision + (changesConfigs ? 1 : 0),
        hybridCredentialsRevision: current.hybridCredentialsRevision ?? 0,
      };
    }, changesCredentials);
  }

  /** 仅用于显式恢复备份；备份中的版本不能回退或伪造后台版本。 */
  static replaceSettings(settings: Partial<UserSettings>): Promise<void> {
    return this.queueSettingsUpdate(current => ({
      ...DEFAULT_SETTINGS,
      ...settings,
      apiConfigsRevision: (current.apiConfigsRevision ?? 0) + 1,
    }), true);
  }

  /** 清空与设置、档案队列共用屏障，不能让清空前的写入在返回后回填。 */
  static clearAllData(): Promise<void> {
    const operation = Promise.all([this.settingsUpdates, this.profileUpdates]).then(async () => {
      const data = await chrome.storage.sync.get(null);
      const revision = data[STORAGE_KEYS.SYNC.SETTINGS]?.apiConfigsRevision ?? 0;
      const hybridRevision = data[STORAGE_KEYS.SYNC.SETTINGS]?.hybridCredentialsRevision ?? 0;
      if ([revision, hybridRevision].some(value => !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER)) {
        throw new Error('配置版本无效，无法安全清除数据');
      }
      // 不调用 sync.clear()：先原子替换为无用户数据的版本墓碑，避免出现版本 0 的窗口。
      await chrome.storage.sync.set({ [STORAGE_KEYS.SYNC.SETTINGS]: {
        apiConfigsRevision: revision + 1, hybridCredentialsRevision: hybridRevision + 1,
      } });
      await chrome.storage.sync.remove(Object.keys(data).filter(key => key !== STORAGE_KEYS.SYNC.SETTINGS));
      await chrome.storage.local.clear();
    });
    this.settingsUpdates = operation.catch(() => undefined);
    this.profileUpdates = operation.catch(() => undefined);
    return operation;
  }

  private static isLegacyOpenAISettings(settings: UserSettings): boolean {
    return settings.apiProvider === 'openai' && !settings.customApiUrl &&
      !settings.apiConfigs?.length && !settings.activeApiConfigId;
  }

  /**
   * 获取与请求快照归属一致的密钥。
   * 显式配置使用快照内的密钥；旧字段仅兼容未迁移的默认 OpenAI 配置。
   */
  static async getApiKey(settings?: UserSettings): Promise<string> {
    settings ??= await this.getSettings();

    logger.info('StorageManager.getApiKey: 检查配置', {
      activeApiConfigId: settings.activeApiConfigId,
      apiConfigsCount: settings.apiConfigs?.length || 0,
      apiConfigs: settings.apiConfigs?.map(c => ({ id: c.id, name: c.name, hasKey: !!c.apiKey })),
    });

    // 如果有激活的 API 配置，从配置中读取 API Key
    if (settings.apiConfigs?.length > 0) {
      const activeId = settings.activeApiConfigId || settings.apiConfigs[0].id;
      const activeConfig = settings.apiConfigs.find(
        (config) => config.id === activeId
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

    if (!this.isLegacyOpenAISettings(settings)) return '';

    // 设置页会在切换配置后改写旧字段，必须同次读取设置与密钥核验归属，避免拼接新密钥和旧端点。
    const data = await chrome.storage.sync.get([
      STORAGE_KEYS.SYNC.SETTINGS, STORAGE_KEYS.SYNC.API_KEY, this.LEGACY_API_KEY_INVALIDATED,
    ]);
    if (data[this.LEGACY_API_KEY_INVALIDATED] !== undefined) return '';
    const currentSettings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEYS.SYNC.SETTINGS] };
    if (!this.isLegacyOpenAISettings(currentSettings)) return '';

    const apiKey = data[STORAGE_KEYS.SYNC.API_KEY];
    return typeof apiKey === 'string' ? apiKey : '';
  }

  /**
   * 兼容旧写入入口，但裸密钥不能证明提供商归属；可用凭据必须保存在显式 apiConfigs 中。
   */
  static async saveApiKey(apiKey: string): Promise<void> {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SYNC.API_KEY]: apiKey,
      [this.LEGACY_API_KEY_INVALIDATED]: true,
    });
  }

  /**
   * Add a word to known words
   */
  static async addKnownWord(word: string): Promise<void> {
    return this.updateProfile(async (profile) => {
      const lowerWord = word.toLowerCase().trim();
      await this.saveUserProfile({
        ...profile,
        knownWords: profile.knownWords.includes(lowerWord)
          ? profile.knownWords
          : [...profile.knownWords, lowerWord],
        unknownWords: profile.unknownWords.filter((w) => w.word.toLowerCase() !== lowerWord),
      });
    });
  }

  /**
   * Remove a word from known words
   */
  static async removeKnownWord(word: string): Promise<void> {
    return this.updateProfile(async (profile) => {
      const lowerWord = word.toLowerCase();
      await this.saveUserProfile({
        ...profile,
        knownWords: profile.knownWords.filter((w) => w !== lowerWord),
      });
    });
  }

  /**
   * Remove a word from unknown words
   */
  static async removeUnknownWord(word: string): Promise<void> {
    return this.removeFromVocabulary(word);
  }

  /**
   * Add a word to unknown words (vocabulary)
   */
  static async addUnknownWord(
    entry: UnknownWordEntry,
    options?: { skipIfExists: boolean }
  ): Promise<boolean> {
    if (options?.skipIfExists) {
      const result = await this.importUnknownWords([entry]);
      return result.imported === 1;
    }

    return this.updateProfile(async (profile) => {
      const lowerWord = entry.word.toLowerCase().trim();
      await this.saveUserProfile({
        ...profile,
        unknownWords: [
          ...profile.unknownWords.filter((w) => w.word.toLowerCase() !== lowerWord),
          { ...entry, word: lowerWord },
        ],
        knownWords: profile.knownWords.filter((w) => w !== lowerWord),
      });
      return true;
    });
  }

  private static normalizeImportedEntry(
    raw: unknown, now: number, allowEmptyTranslation = false
  ): UnknownWordEntry {
    if (!raw || typeof raw !== 'object') throw new Error('数据格式无效');
    const item = raw as Record<string, unknown>;
    const validDate = (value: unknown) => typeof value === 'number'
      && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
    if (typeof item.word !== 'string' || !item.word.trim() || item.word.length > 200
      || typeof item.translation !== 'string'
      || (!allowEmptyTranslation && !item.translation.trim()) || item.translation.length > 10000
      || (item.context !== undefined && (typeof item.context !== 'string' || item.context.length > 10000))
      || (item.markedAt !== undefined && !validDate(item.markedAt))
      || (item.lastReviewAt !== undefined && !validDate(item.lastReviewAt))
      || (item.reviewCount !== undefined && (typeof item.reviewCount !== 'number'
        || !Number.isSafeInteger(item.reviewCount) || item.reviewCount < 0))) {
      throw new Error('数据格式无效');
    }
    return {
      word: item.word.toLowerCase().trim(),
      translation: item.translation,
      context: (item.context as string | undefined) ?? '',
      markedAt: (item.markedAt as number | undefined) ?? now,
      reviewCount: (item.reviewCount as number | undefined) ?? 0,
      lastReviewAt: item.lastReviewAt as number | undefined,
    };
  }

  static async importUnknownWords(entries: unknown): Promise<{ imported: number; skipped: number }> {
    if (!Array.isArray(entries) || entries.length > this.MAX_IMPORT_ENTRIES) {
      throw new Error('数据格式无效：词条数量超出限制');
    }
    const now = Date.now();
    const validated: UnknownWordEntry[] = entries.map((raw) => this.normalizeImportedEntry(raw, now));

    return this.updateProfile(async (profile) => {
      const existing = new Set([
        ...profile.unknownWords.map((entry) => entry.word.toLowerCase().trim()),
        ...profile.knownWords.map((word) => word.toLowerCase().trim()),
      ]);
      const firstByWord = new Map(validated.slice().reverse().map((entry) => [entry.word, entry]));
      const additions = validated.filter(
        (entry) => !existing.has(entry.word) && firstByWord.get(entry.word) === entry
      );
      if (additions.length > 0) {
        await this.saveImportedProfile(
          { ...profile, unknownWords: [...profile.unknownWords, ...additions] },
          profile
        );
      }
      return { imported: additions.length, skipped: validated.length - additions.length };
    });
  }

  /**
   * Remove a word from vocabulary
   */
  static async removeFromVocabulary(word: string): Promise<void> {
    return this.updateProfile(async (profile) => {
      const lowerWord = word.toLowerCase();
      await this.saveUserProfile({
        ...profile,
        unknownWords: profile.unknownWords.filter((w) => w.word.toLowerCase() !== lowerWord),
      });
    });
  }

  static async importUserProfile(
    imported: UserProfile,
    mergeVocabulary: boolean
  ): Promise<{ wordsMerged: number }> {
    const validDate = (value: unknown) => typeof value === 'number'
      && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
    if (!imported || !['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'].includes(imported.examType)
      || typeof imported.estimatedVocabulary !== 'number'
      || !Number.isFinite(imported.estimatedVocabulary)
      || imported.estimatedVocabulary < 0 || imported.estimatedVocabulary > 1000000
      || typeof imported.levelConfidence !== 'number' || !Number.isFinite(imported.levelConfidence)
      || imported.levelConfidence < 0 || imported.levelConfidence > 1
      || !validDate(imported.createdAt) || !validDate(imported.updatedAt)
      || (imported.examScore !== undefined && (typeof imported.examScore !== 'number'
        || !Number.isFinite(imported.examScore) || imported.examScore < 0 || imported.examScore > 1000))
      || !Array.isArray(imported.knownWords) || !Array.isArray(imported.unknownWords)
      || imported.knownWords.some((word) => typeof word !== 'string'
        || !word.trim() || word.length > 200)) {
      throw new Error('数据格式无效');
    }
    const unknownEntries = imported.unknownWords.map(
      (entry) => this.normalizeImportedEntry(entry, Date.now(), true)
    );
    const validated: UserProfile = {
      examType: imported.examType,
      examScore: imported.examScore,
      estimatedVocabulary: imported.estimatedVocabulary,
      levelConfidence: imported.levelConfidence,
      createdAt: imported.createdAt,
      updatedAt: imported.updatedAt,
      knownWords: imported.knownWords.map((word) => word.toLowerCase().trim()),
      unknownWords: unknownEntries,
    };

    return this.updateProfile(async (current) => {
      if (!mergeVocabulary) {
        await this.saveImportedProfile(validated, current);
        return { wordsMerged: 0 };
      }
      const currentUnknown = new Set(current.unknownWords.map((entry) => entry.word.toLowerCase().trim()));
      const knownWords = Array.from(new Set([
        ...current.knownWords.map((word) => word.toLowerCase().trim()),
        ...validated.knownWords.filter((word) => !currentUnknown.has(word)),
      ]));
      const known = new Set(knownWords);
      const unknownWords = new Map(current.unknownWords.map((entry) => [entry.word.toLowerCase().trim(), entry]));
      for (const entry of validated.unknownWords) {
        if (known.has(entry.word)) continue;
        const previous = unknownWords.get(entry.word);
        if (!previous || entry.markedAt > previous.markedAt) {
          unknownWords.set(entry.word, entry);
        }
      }
      await this.saveImportedProfile({
        ...validated,
        knownWords,
        unknownWords: Array.from(unknownWords.values()),
      }, current);
      return { wordsMerged: knownWords.length - current.knownWords.length };
    });
  }

  static async updateLevelProfile(updates: unknown): Promise<UserProfile> {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      throw new Error('数据格式无效');
    }
    const fields = updates as Record<string, unknown>;
    const allowed = ['examType', 'examScore', 'estimatedVocabulary', 'levelConfidence'];
    if (Object.keys(fields).some((key) => !allowed.includes(key))
      || (fields.examType !== undefined
        && !['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'].includes(fields.examType as string))
      || (fields.examScore !== undefined && (typeof fields.examScore !== 'number'
        || !Number.isFinite(fields.examScore) || fields.examScore < 0 || fields.examScore > 1000))
      || (fields.estimatedVocabulary !== undefined && (typeof fields.estimatedVocabulary !== 'number'
        || !Number.isFinite(fields.estimatedVocabulary)
        || fields.estimatedVocabulary < 0 || fields.estimatedVocabulary > 1000000))
      || (fields.levelConfidence !== undefined && (typeof fields.levelConfidence !== 'number'
        || !Number.isFinite(fields.levelConfidence)
        || fields.levelConfidence < 0 || fields.levelConfidence > 1))) {
      throw new Error('数据格式无效');
    }
    return this.updateUserProfile(fields as Partial<UserProfile>);
  }

  static async updateUserProfile(
    updates: Partial<UserProfile> | ((profile: UserProfile) => Partial<UserProfile>)
  ): Promise<UserProfile> {
    return this.updateProfile(async (profile) => {
      const changes = typeof updates === 'function' ? updates(profile) : updates;
      await this.saveUserProfile({ ...profile, ...changes });
      return this.getUserProfile();
    });
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
      await this.updateUserProfile(data.profile);
    }

    if (data.settings) {
      const settings = data.settings;
      // 旧格式导入属于显式恢复，保留增量语义但忽略备份内的版本。
      await this.queueSettingsUpdate(current => ({
        ...current, ...settings,
        apiConfigsRevision: (current.apiConfigsRevision ?? 0) + (Object.prototype.hasOwnProperty.call(settings, 'apiConfigs') ? 1 : 0),
      }), Object.prototype.hasOwnProperty.call(settings, 'hybridTranslation'));
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

  /**
   * 获取新用户列表（用于用户研究招募）
   * 返回最近 N 天内安装的用户数据
   */
  static async getNewUsers(days: number = 7): Promise<{
    totalUsers: number;
    recentUsers: Array<{
      createdAt: number;
      estimatedVocabulary: number;
      examType: string;
      knownWordsCount: number;
      unknownWordsCount: number;
    }>;
  }> {
    const profile = await this.getUserProfile();
    const now = Date.now();
    const cutoffTime = now - days * 24 * 60 * 60 * 1000;

    // 检查是否为近期用户（基于 profile.createdAt）
    const isRecentUser = profile.createdAt >= cutoffTime;

    const userData = {
      createdAt: profile.createdAt,
      estimatedVocabulary: profile.estimatedVocabulary,
      examType: profile.examType,
      knownWordsCount: profile.knownWords.length,
      unknownWordsCount: profile.unknownWords.length,
    };

    return {
      totalUsers: 1, // 单用户扩展
      recentUsers: isRecentUser ? [userData] : [],
    };
  }

  /**
   * 导出用户数据为 CSV 格式（用于邮件列表）
   */
  static async exportUserDataForResearch(): Promise<{
    csv: string;
    json: string;
    stats: {
      totalUsers: number;
      avgVocabulary: number;
      avgKnownWords: number;
      avgUnknownWords: number;
    };
  }> {
    const profile = await this.getUserProfile();
    const settings = await this.getSettings();

    // CSV 格式数据
    const headers = ['安装时间', '词汇量估算', '考试类型', '已掌握词汇', '待学习词汇', '主题设置'];
    const row = [
      new Date(profile.createdAt).toISOString(),
      profile.estimatedVocabulary,
      profile.examType,
      profile.knownWords.length,
      profile.unknownWords.length,
      settings.theme,
    ];

    const csv = [headers.join(','), row.join(',')].join('\n');

    // JSON 格式数据
    const jsonData = {
      profile: {
        createdAt: profile.createdAt,
        estimatedVocabulary: profile.estimatedVocabulary,
        examType: profile.examType,
        knownWordsCount: profile.knownWords.length,
        unknownWordsCount: profile.unknownWords.length,
        levelConfidence: profile.levelConfidence,
      },
      settings: {
        theme: settings.theme,
        translationMode: settings.translationMode,
        enabled: settings.enabled,
      },
      exportedAt: Date.now(),
    };

    const json = JSON.stringify(jsonData, null, 2);

    // 统计信息
    const stats = {
      totalUsers: 1,
      avgVocabulary: profile.estimatedVocabulary,
      avgKnownWords: profile.knownWords.length,
      avgUnknownWords: profile.unknownWords.length,
    };

    return { csv, json, stats };
  }
}
