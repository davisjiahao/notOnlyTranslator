/**
 * 数据导出/导入管理模块
 * Data Export/Import Management Module
 *
 * 提供完整的数据备份、恢复、验证功能
 * Provides comprehensive data backup, restore, and validation capabilities
 */

import type { UserProfile, UserSettings } from '@/shared/types';
import type { MasteryProfile } from '@/shared/types/mastery';
import { StorageManager } from '@/background/storage';
import { logger } from '@/shared/utils';
import { PROVIDER_CONFIGS } from '@/shared/constants/providers';
import { escapeCSVCell } from './csv';
import { PARTIAL_PROFILE_IMPORT_ERROR } from './importErrors';

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

export function validateImportedSettings(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['用户设置格式无效'];
  const settings = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof settings.enabled !== 'boolean') errors.push('用户设置缺少启用状态');
  if (settings.apiProvider !== undefined
    && (typeof settings.apiProvider !== 'string'
      || !Object.prototype.hasOwnProperty.call(PROVIDER_CONFIGS, settings.apiProvider))) {
    errors.push('用户设置的 API 提供商无效');
  }
  if (settings.customApiUrl !== undefined && settings.customApiUrl !== '') {
    errors.push('备份中的自定义 API 端点不可导入，请在设置页手动配置');
  }
  if (settings.apiConfigs !== undefined && (!Array.isArray(settings.apiConfigs)
    || settings.apiConfigs.some(config => !config || typeof config !== 'object'
      || typeof config.id !== 'string' || typeof config.provider !== 'string'
      || !Object.prototype.hasOwnProperty.call(PROVIDER_CONFIGS, config.provider)
      || typeof config.apiKey !== 'string'))) errors.push('用户设置的 API 配置格式无效');
  if (Array.isArray(settings.apiConfigs) && settings.apiConfigs.some(config => config
    && typeof config === 'object' && config.apiUrl !== undefined && config.apiUrl !== '')) {
    errors.push('备份中的自定义 API 端点不可导入，请在设置页手动配置');
  }
  return errors;
}

function isValidMasteryEntry(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const entry = raw as Record<string, unknown>;
  const validDate = (value: unknown) => typeof value === 'number'
    && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
  const validCount = (value: unknown) => typeof value === 'number'
    && Number.isSafeInteger(value) && value >= 0;
  return typeof entry.word === 'string' && !!entry.word.trim() && entry.word.length <= 200
    && typeof entry.translation === 'string' && entry.translation.length <= 10000
    && typeof entry.context === 'string' && entry.context.length <= 10000
    && validDate(entry.markedAt) && validCount(entry.reviewCount)
    && (entry.lastReviewAt === undefined || validDate(entry.lastReviewAt))
    && typeof entry.masteryLevel === 'number' && Number.isFinite(entry.masteryLevel)
    && entry.masteryLevel >= 0 && entry.masteryLevel <= 1
    && typeof entry.confidence === 'number' && Number.isFinite(entry.confidence)
    && entry.confidence >= 0 && entry.confidence <= 1
    && validCount(entry.knownCount) && validCount(entry.unknownCount)
    && validDate(entry.nextReviewAt)
    && ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(String(entry.estimatedLevel));
}

/**
 * 验证导入数据
 *
 * @param data - 待验证的数据
 * @returns 验证结果
 */
export function validateImportData(data: unknown, options?: ImportOptions): ValidationResult {
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
  if (options?.importProfile !== false && obj.profile) {
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
    const validDate = (value: unknown) => typeof value === 'number'
      && Number.isFinite(value) && Math.abs(value) <= 8.64e15;
    if (Array.isArray(profile.unknownWords) && profile.unknownWords.some(raw => {
      if (!raw || typeof raw !== 'object') return true;
      const entry = raw as Record<string, unknown>;
      return typeof entry.word !== 'string' || !entry.word.trim() || entry.word.length > 200
        || typeof entry.translation !== 'string' || entry.translation.length > 10000
        || (entry.context !== undefined && (typeof entry.context !== 'string' || entry.context.length > 10000))
        || (entry.markedAt !== undefined && !validDate(entry.markedAt))
        || (entry.lastReviewAt !== undefined && !validDate(entry.lastReviewAt))
        || (entry.reviewCount !== undefined && (typeof entry.reviewCount !== 'number'
          || !Number.isSafeInteger(entry.reviewCount) || entry.reviewCount < 0));
    })) errors.push('生词记录格式无效');
    if (!['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'].includes(String(profile.examType))
      || typeof profile.estimatedVocabulary !== 'number'
      || !Number.isFinite(profile.estimatedVocabulary) || profile.estimatedVocabulary < 0
      || profile.estimatedVocabulary > 1000000
      || typeof profile.levelConfidence !== 'number'
      || !Number.isFinite(profile.levelConfidence) || profile.levelConfidence < 0
      || profile.levelConfidence > 1
      || !validDate(profile.createdAt) || !validDate(profile.updatedAt)
      || (profile.examScore !== undefined && (typeof profile.examScore !== 'number'
        || !Number.isFinite(profile.examScore) || profile.examScore < 0 || profile.examScore > 1000))
      || (Array.isArray(profile.knownWords) && profile.knownWords.some(
        word => typeof word !== 'string' || !word.trim() || word.length > 200
      ))) {
      errors.push('用户配置字段无效');
    }
  } else if (options?.importProfile !== false) {
    warnings.push('缺少用户配置数据');
  }

  // 检查 settings
  if (options?.importSettings !== false) {
    if (Object.prototype.hasOwnProperty.call(obj, 'settings')) {
      errors.push(...validateImportedSettings(obj.settings));
    } else {
      warnings.push('缺少用户设置数据');
    }
  }

  // 检查 mastery
  if (options?.importMastery !== false && obj.mastery) {
    const mastery = obj.mastery as Record<string, unknown>;
    if (!mastery.wordMastery || typeof mastery.wordMastery !== 'object'
      || Array.isArray(mastery.wordMastery)
      || Object.values(mastery.wordMastery).some(entry => !isValidMasteryEntry(entry))) {
      errors.push('掌握度数据格式不正确');
    }
  }

  if (options?.importCache && obj.translationCache !== undefined && obj.translationCache !== null
    && (typeof obj.translationCache !== 'object' || Array.isArray(obj.translationCache))) {
    errors.push('翻译缓存格式无效');
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
  let confirmationMissing = false;

  try {
    const validation = validateImportData(data, options);
    if (!validation.valid) {
      return { ...result, success: false, message: '数据验证失败', errors: validation.errors, warnings: validation.warnings };
    }
    // 导入用户配置
    if (options.importProfile && data.profile) {
      confirmationMissing = true;
      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_USER_PROFILE',
        payload: { profile: data.profile, mergeVocabulary: options.mergeVocabulary },
      });
      if (response?.success === false) {
        confirmationMissing = false;
        throw new Error(response.error === PARTIAL_PROFILE_IMPORT_ERROR
          ? PARTIAL_PROFILE_IMPORT_ERROR : '导入用户档案失败');
      }
      if (response?.success !== true || !Number.isSafeInteger(response.data?.wordsMerged)) {
        throw new Error('导入用户档案失败');
      }
      confirmationMissing = false;
      result.details.wordsMerged = response.data.wordsMerged;
      result.details.profileImported = true;
      result.details.wordsImported = data.profile.knownWords.length + data.profile.unknownWords.length;
    }

    // 导入用户设置
    if (options.importSettings && data.settings) {
      confirmationMissing = true;
      const response = await chrome.runtime.sendMessage({ type: 'REPLACE_SETTINGS', payload: data.settings });
      if (response?.success === false) {
        confirmationMissing = false;
        throw new Error('导入用户设置失败');
      }
      if (response?.success !== true) throw new Error('导入用户设置失败');
      confirmationMissing = false;
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
    const completed = [
      result.details.profileImported && '用户配置',
      result.details.settingsImported && '设置',
      result.details.masteryImported && '掌握度',
      result.details.cacheImported && '缓存',
    ].filter((item): item is string => Boolean(item));
    result.errors.push(error instanceof Error && error.message === PARTIAL_PROFILE_IMPORT_ERROR
      ? PARTIAL_PROFILE_IMPORT_ERROR
      : confirmationMissing
        ? '导入状态未知：未收到后台确认，请核对已存储数据，避免重复导入'
        : completed.length > 0
          ? `部分数据已导入（${completed.join('、')}），其余未完成，请核对或从备份恢复`
          : '数据导入失败，请检查备份或稍后重试');
    logger.error('DataImport: 导入失败');
  }

  return result;
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

  const validation = validateImportData(data, options);

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
    ...rows.map(row => row.map(escapeCSVCell).join(',')),
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