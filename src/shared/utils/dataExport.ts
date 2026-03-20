/**
 * 数据导出/导入管理模块
 * Data Export/Import Management Module
 *
 * 提供完整的数据备份、恢复、验证功能
 * Provides comprehensive data backup, restore, and validation capabilities
 */

import type { UserProfile, UserSettings, UnknownWordEntry } from '@/shared/types';
import type { MasteryProfile } from '@/shared/types/mastery';
import { StorageManager } from '@/background/storage';
import { logger } from '@/shared/utils';

/**
 * 导出数据格式版本
 */
export const EXPORT_VERSION = '1.0.0';

/**
 * 完整导出数据结构
 */
export interface FullExportData {
  /** 导出格式版本 */
  version: string;
  /** 导出时间戳 */
  exportedAt: number;
  /** 应用版本 */
  appVersion: string;
  /** 用户配置 */
  profile: UserProfile;
  /** 用户设置 */
  settings: UserSettings;
  /** 掌握度数据 */
  mastery: MasteryProfile | null;
  /** 翻译缓存 */
  translationCache: Record<string, unknown>;
  /** 元数据 */
  metadata: {
    knownWordsCount: number;
    unknownWordsCount: number;
    masteryWordsCount: number;
    cacheSize: number;
  };
}

/**
 * 导入选项
 */
export interface ImportOptions {
  /** 是否覆盖现有数据 */
  overwrite: boolean;
  /** 是否导入用户配置 */
  importProfile: boolean;
  /** 是否导入用户设置 */
  importSettings: boolean;
  /** 是否导入掌握度数据 */
  importMastery: boolean;
  /** 是否导入翻译缓存 */
  importCache: boolean;
  /** 是否合并词汇列表（而非替换） */
  mergeVocabulary: boolean;
}

/**
 * 导入结果
 */
export interface ImportResult {
  success: boolean;
  message: string;
  details: {
    profileImported: boolean;
    settingsImported: boolean;
    masteryImported: boolean;
    cacheImported: boolean;
    wordsImported: number;
    wordsMerged: number;
  };
  errors: string[];
  warnings: string[];
}

/**
 * 数据验证结果
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: FullExportData;
}

/**
 * 获取应用版本
 */
function getAppVersion(): string {
  return chrome.runtime.getManifest().version;
}

/**
 * 导出所有用户数据
 *
 * @returns 完整导出数据
 */
export async function exportAllData(): Promise<FullExportData> {
  const profile = await StorageManager.getUserProfile();
  const settings = await StorageManager.getSettings();
  const mastery = await StorageManager.getMasteryProfile();
  const translationCache = await StorageManager.getTranslationCache();

  const exportData: FullExportData = {
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    appVersion: getAppVersion(),
    profile,
    settings,
    mastery,
    translationCache,
    metadata: {
      knownWordsCount: profile.knownWords.length,
      unknownWordsCount: profile.unknownWords.length,
      masteryWordsCount: mastery ? Object.keys(mastery.wordMastery).length : 0,
      cacheSize: Object.keys(translationCache).length,
    },
  };

  logger.info('DataExport: 导出完成', {
    version: EXPORT_VERSION,
    knownWords: exportData.metadata.knownWordsCount,
    unknownWords: exportData.metadata.unknownWordsCount,
    masteryWords: exportData.metadata.masteryWordsCount,
  });

  return exportData;
}

/**
 * 验证导入数据
 *
 * @param data - 待验证的数据
 * @returns 验证结果
 */
export function validateImportData(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 基本结构检查
  if (!data || typeof data !== 'object') {
    return {
      valid: false,
      errors: ['无效的数据格式：数据必须是一个对象'],
      warnings: [],
    };
  }

  const obj = data as Record<string, unknown>;

  // 版本检查
  if (!obj.version || typeof obj.version !== 'string') {
    errors.push('缺少版本信息');
  } else {
    const [major] = obj.version.split('.');
    const [currentMajor] = EXPORT_VERSION.split('.');
    if (major !== currentMajor) {
      warnings.push(`版本不匹配：文件版本 ${obj.version}，当前版本 ${EXPORT_VERSION}，可能存在兼容性问题`);
    }
  }

  // 检查必要字段
  if (!obj.exportedAt || typeof obj.exportedAt !== 'number') {
    warnings.push('缺少导出时间戳');
  }

  // 检查 profile
  if (obj.profile) {
    const profile = obj.profile as Record<string, unknown>;
    if (!profile.examType) {
      warnings.push('用户配置缺少考试类型');
    }
    if (!Array.isArray(profile.knownWords)) {
      errors.push('用户配置缺少已知词汇列表');
    }
    if (!Array.isArray(profile.unknownWords)) {
      errors.push('用户配置缺少生词列表');
    }
  } else {
    warnings.push('缺少用户配置数据');
  }

  // 检查 settings
  if (obj.settings) {
    const settings = obj.settings as Record<string, unknown>;
    if (typeof settings.enabled !== 'boolean') {
      warnings.push('用户设置缺少启用状态');
    }
  } else {
    warnings.push('缺少用户设置数据');
  }

  // 检查 mastery
  if (obj.mastery) {
    const mastery = obj.mastery as Record<string, unknown>;
    if (!mastery.wordMastery || typeof mastery.wordMastery !== 'object') {
      warnings.push('掌握度数据格式不正确');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    data: errors.length === 0 ? (obj as unknown as FullExportData) : undefined,
  };
}

/**
 * 导入数据
 *
 * @param data - 导入数据
 * @param options - 导入选项
 * @returns 导入结果
 */
export async function importAllData(
  data: FullExportData,
  options: ImportOptions
): Promise<ImportResult> {
  const result: ImportResult = {
    success: true,
    message: '',
    details: {
      profileImported: false,
      settingsImported: false,
      masteryImported: false,
      cacheImported: false,
      wordsImported: 0,
      wordsMerged: 0,
    },
    errors: [],
    warnings: [],
  };

  try {
    // 导入用户配置
    if (options.importProfile && data.profile) {
      if (options.mergeVocabulary) {
        // 合并词汇列表
        const currentProfile = await StorageManager.getUserProfile();
        const mergedKnownWords = new Set([
          ...currentProfile.knownWords,
          ...data.profile.knownWords,
        ]);
        const mergedUnknownWords = mergeUnknownWords(
          currentProfile.unknownWords,
          data.profile.unknownWords
        );

        await StorageManager.saveUserProfile({
          ...data.profile,
          knownWords: Array.from(mergedKnownWords),
          unknownWords: mergedUnknownWords,
        });

        result.details.wordsMerged = mergedKnownWords.size - currentProfile.knownWords.length;
      } else {
        // 完全覆盖
        await StorageManager.saveUserProfile(data.profile);
      }
      result.details.profileImported = true;
      result.details.wordsImported = data.profile.knownWords.length + data.profile.unknownWords.length;
    }

    // 导入用户设置
    if (options.importSettings && data.settings) {
      await StorageManager.saveSettings(data.settings);
      result.details.settingsImported = true;
    }

    // 导入掌握度数据
    if (options.importMastery && data.mastery) {
      await StorageManager.importMasteryData(data.mastery);
      result.details.masteryImported = true;
    }

    // 导入翻译缓存
    if (options.importCache && data.translationCache) {
      await chrome.storage.local.set({
        translationCache: data.translationCache,
      });
      result.details.cacheImported = true;
    }

    result.message = '数据导入成功';
    logger.info('DataImport: 导入完成', result.details);

  } catch (error) {
    result.success = false;
    result.message = '数据导入失败';
    result.errors.push(error instanceof Error ? error.message : String(error));
    logger.error('DataImport: 导入失败', error);
  }

  return result;
}

/**
 * 合并生词列表
 */
function mergeUnknownWords(
  current: UnknownWordEntry[],
  imported: UnknownWordEntry[]
): UnknownWordEntry[] {
  const merged = new Map<string, UnknownWordEntry>();

  // 添加当前列表
  for (const entry of current) {
    merged.set(entry.word.toLowerCase(), entry);
  }

  // 合并导入列表（导入的条目会覆盖同名的当前条目，除非当前条目更新）
  for (const entry of imported) {
    const existing = merged.get(entry.word.toLowerCase());
    if (!existing || entry.markedAt > existing.markedAt) {
      merged.set(entry.word.toLowerCase(), entry);
    }
  }

  return Array.from(merged.values());
}

/**
 * 导出数据为 JSON 字符串
 */
export async function exportToJSON(): Promise<string> {
  const data = await exportAllData();
  return JSON.stringify(data, null, 2);
}

/**
 * 从 JSON 字符串导入数据
 */
export async function importFromJSON(
  jsonString: string,
  options: ImportOptions
): Promise<ImportResult> {
  let data: unknown;

  try {
    data = JSON.parse(jsonString);
  } catch {
    return {
      success: false,
      message: 'JSON 解析失败',
      details: {
        profileImported: false,
        settingsImported: false,
        masteryImported: false,
        cacheImported: false,
        wordsImported: 0,
        wordsMerged: 0,
      },
      errors: ['无效的 JSON 格式'],
      warnings: [],
    };
  }

  const validation = validateImportData(data);

  if (!validation.valid) {
    return {
      success: false,
      message: '数据验证失败',
      details: {
        profileImported: false,
        settingsImported: false,
        masteryImported: false,
        cacheImported: false,
        wordsImported: 0,
        wordsMerged: 0,
      },
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const result = await importAllData(validation.data!, options);
  result.warnings.push(...validation.warnings);

  return result;
}

/**
 * 导出词汇列表为 CSV
 */
export async function exportVocabularyToCSV(): Promise<string> {
  const profile = await StorageManager.getUserProfile();
  const mastery = await StorageManager.getMasteryProfile();

  const headers = ['单词', '状态', '添加时间', '掌握度', 'CEFR等级', '翻译'];
  const rows: string[][] = [];

  // 已知词汇
  for (const word of profile.knownWords) {
    const masteryEntry = mastery?.wordMastery[word];
    rows.push([
      word,
      '已掌握',
      '',
      masteryEntry ? String(Math.round(masteryEntry.masteryLevel * 100)) + '%' : '',
      masteryEntry?.estimatedLevel || '',
      '',
    ]);
  }

  // 生词
  for (const entry of profile.unknownWords) {
    const masteryEntry = mastery?.wordMastery[entry.word];
    rows.push([
      entry.word,
      '学习中',
      new Date(entry.markedAt).toISOString(),
      masteryEntry ? String(Math.round(masteryEntry.masteryLevel * 100)) + '%' : '',
      masteryEntry?.estimatedLevel || '',
      entry.translation || '',
    ]);
  }

  // 生成 CSV
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')),
  ].join('\n');

  return csvContent;
}

/**
 * 清除所有数据
 */
export async function clearAllData(): Promise<void> {
  await chrome.storage.sync.clear();
  await chrome.storage.local.clear();
  logger.info('DataExport: 所有数据已清除');
}

/**
 * 获取存储使用统计
 */
export async function getStorageStats(): Promise<{
  syncUsed: number;
  localUsed: number;
  syncQuota: number;
  localQuota: number;
}> {
  const syncData = await chrome.storage.sync.get(null);
  const localData = await chrome.storage.local.get(null);

  const syncUsed = new Blob([JSON.stringify(syncData)]).size;
  const localUsed = new Blob([JSON.stringify(localData)]).size;

  return {
    syncUsed,
    localUsed,
    syncQuota: chrome.storage.sync.QUOTA_BYTES,
    localQuota: chrome.storage.local.QUOTA_BYTES,
  };
}

/**
 * 默认导入选项
 */
export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  overwrite: false,
  importProfile: true,
  importSettings: true,
  importMastery: true,
  importCache: false, // 默认不导入缓存
  mergeVocabulary: true, // 默认合并词汇
};