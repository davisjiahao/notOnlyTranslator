// 翻译历史记录存储模块 - 使用 IndexedDB
// CMP-87: 翻译历史记录功能

import type { TranslationResult, TranslationMode, UserProfile } from '@/shared/types';
import { logger } from '@/shared/utils';

// IndexedDB 配置
const DB_NAME = 'NotOnlyTranslatorHistory';
const DB_VERSION = 1;
const STORE_NAME = 'translationHistory';

// 数据保留配置
const MAX_ENTRIES = 1000; // 最大保留条目数
const RETENTION_DAYS = 30; // 数据保留天数

/**
 * 翻译历史记录条目
 */
export interface TranslationHistoryEntry {
  /** 唯一标识符 */
  id: string;
  /** 原文 */
  originalText: string;
  /** 译文 */
  translation: TranslationResult;
  /** 页面 URL */
  pageUrl: string;
  /** 页面标题 */
  pageTitle?: string;
  /** 翻译模式 */
  mode: TranslationMode;
  /** 时间戳 */
  timestamp: number;
  /** 用户等级信息（快照） */
  userLevel?: {
    estimatedVocabulary: number;
    level: string;
  };
  /** 字符数统计 */
  charCount: number;
}

/**
 * 翻译历史查询参数
 */
export interface HistoryQueryParams {
  /** 开始时间 */
  startTime?: number;
  /** 结束时间 */
  endTime?: number;
  /** 页面 URL 过滤 */
  pageUrl?: string;
  /** 搜索关键词 */
  keyword?: string;
  /** 每页数量 */
  limit?: number;
  /** 偏移量 */
  offset?: number;
}

/**
 * 翻译历史查询结果
 */
export interface HistoryQueryResult {
  entries: TranslationHistoryEntry[];
  total: number;
  hasMore: boolean;
}

/**
 * 翻译历史统计
 */
export interface HistoryStats {
  totalEntries: number;
  totalCharacters: number;
  uniquePages: number;
  last7Days: number;
  last30Days: number;
}

// IndexedDB 连接实例
let dbInstance: IDBDatabase | null = null;

/**
 * 打开 IndexedDB 数据库连接
 */
async function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      logger.error('打开 IndexedDB 失败:', request.error);
      reject(new Error('无法打开翻译历史数据库'));
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // 创建翻译历史存储
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });

        // 创建索引
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('pageUrl', 'pageUrl', { unique: false });
        store.createIndex('charCount', 'charCount', { unique: false });

        logger.info('IndexedDB: 翻译历史存储已创建');
      }
    };
  });
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 保存翻译历史记录
 */
export async function saveTranslationHistory(
  originalText: string,
  translation: TranslationResult,
  pageUrl: string,
  mode: TranslationMode,
  userProfile?: UserProfile,
  pageTitle?: string
): Promise<TranslationHistoryEntry> {
  const db = await openDB();

  const entry: TranslationHistoryEntry = {
    id: generateId(),
    originalText,
    translation,
    pageUrl,
    pageTitle,
    mode,
    timestamp: Date.now(),
    userLevel: userProfile
      ? {
          estimatedVocabulary: userProfile.estimatedVocabulary,
          level: getLevelLabel(userProfile.estimatedVocabulary),
        }
      : undefined,
    charCount: originalText.length,
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.put(entry);

    request.onsuccess = () => {
      logger.debug('翻译历史已保存:', entry.id);
      resolve(entry);
    };

    request.onerror = () => {
      logger.error('保存翻译历史失败:', request.error);
      reject(new Error('保存翻译历史失败'));
    };

    transaction.oncomplete = () => {
      // 异步执行清理，不阻塞主操作
      cleanupOldEntries().catch((err) => {
        logger.error('清理历史记录失败:', err);
      });
    };
  });
}

/**
 * 根据词汇量获取等级标签
 */
function getLevelLabel(vocabSize: number): string {
  if (vocabSize >= 12000) return '专家级';
  if (vocabSize >= 8000) return '高级';
  if (vocabSize >= 5000) return '中高级';
  if (vocabSize >= 3000) return '中级';
  return '初级';
}

/**
 * 查询翻译历史记录
 */
export async function queryTranslationHistory(
  params: HistoryQueryParams = {}
): Promise<HistoryQueryResult> {
  const db = await openDB();
  const { startTime, endTime, pageUrl, keyword, limit = 50, offset = 0 } = params;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    // 默认按时间戳倒序
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');

    const entries: TranslationHistoryEntry[] = [];
    let skipped = 0;
    let totalMatched = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;

      if (!cursor) {
        resolve({
          entries,
          total: totalMatched,
          hasMore: totalMatched > offset + entries.length,
        });
        return;
      }

      const entry = cursor.value as TranslationHistoryEntry;
      let matches = true;

      // 应用过滤条件
      if (startTime && entry.timestamp < startTime) matches = false;
      if (endTime && entry.timestamp > endTime) matches = false;
      if (pageUrl && !entry.pageUrl.includes(pageUrl)) matches = false;
      if (keyword) {
        const lowerKeyword = keyword.toLowerCase();
        const textMatch = entry.originalText.toLowerCase().includes(lowerKeyword);
        const translationMatch = entry.translation.fullText?.toLowerCase().includes(lowerKeyword);
        const titleMatch = entry.pageTitle?.toLowerCase().includes(lowerKeyword);
        if (!textMatch && !translationMatch && !titleMatch) matches = false;
      }

      if (matches) {
        totalMatched++;

        // 跳过偏移量之前的条目
        if (skipped < offset) {
          skipped++;
        } else if (entries.length < limit) {
          entries.push(entry);
        }
      }

      cursor.continue();
    };

    request.onerror = () => {
      logger.error('查询翻译历史失败:', request.error);
      reject(new Error('查询翻译历史失败'));
    };
  });
}

/**
 * 根据 ID 获取单条历史记录
 */
export async function getHistoryById(id: string): Promise<TranslationHistoryEntry | null> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.get(id);

    request.onsuccess = () => {
      resolve(request.result as TranslationHistoryEntry | null);
    };

    request.onerror = () => {
      logger.error('获取历史记录失败:', request.error);
      reject(new Error('获取历史记录失败'));
    };
  });
}

/**
 * 删除单条历史记录
 */
export async function deleteHistoryEntry(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.delete(id);

    request.onsuccess = () => {
      logger.debug('历史记录已删除:', id);
      resolve();
    };

    request.onerror = () => {
      logger.error('删除历史记录失败:', request.error);
      reject(new Error('删除历史记录失败'));
    };
  });
}

/**
 * 批量删除历史记录
 */
export async function deleteHistoryEntries(ids: string[]): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    let completed = 0;
    let hasError = false;

    ids.forEach((id) => {
      const request = store.delete(id);

      request.onsuccess = () => {
        completed++;
        if (completed === ids.length && !hasError) {
          resolve();
        }
      };

      request.onerror = () => {
        hasError = true;
        logger.error('批量删除历史记录失败:', request.error);
        reject(new Error('批量删除历史记录失败'));
      };
    });

    if (ids.length === 0) {
      resolve();
    }
  });
}

/**
 * 清空所有历史记录
 */
export async function clearAllHistory(): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.clear();

    request.onsuccess = () => {
      logger.info('所有翻译历史已清空');
      resolve();
    };

    request.onerror = () => {
      logger.error('清空历史记录失败:', request.error);
      reject(new Error('清空历史记录失败'));
    };
  });
}

/**
 * 清理过期历史记录
 * - 保留最近 1000 条
 * - 删除 30 天前的记录
 */
export async function cleanupOldEntries(): Promise<void> {
  const db = await openDB();

  const cutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    // 获取所有条目计数
    const countRequest = store.count();

    countRequest.onsuccess = () => {
      const totalCount = countRequest.result;

      // 如果总数未超过限制，只清理过期数据
      if (totalCount <= MAX_ENTRIES) {
        // 删除 30 天前的记录
        const range = IDBKeyRange.upperBound(cutoffTime);
        const deleteRequest = index.openCursor(range);

        deleteRequest.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest).result;
          if (cursor) {
            store.delete(cursor.primaryKey);
            cursor.continue();
          } else {
            logger.debug('过期历史记录清理完成');
            resolve();
          }
        };

        deleteRequest.onerror = () => {
          logger.error('清理过期记录失败:', deleteRequest.error);
          reject(new Error('清理过期记录失败'));
        };

        return;
      }

      // 总数超过限制，需要删除最旧的记录
      const entriesToDelete = totalCount - MAX_ENTRIES;
      logger.info(`历史记录超过限制，将删除最旧的 ${entriesToDelete} 条记录`);

      const cursorRequest = index.openCursor();
      let deletedCount = 0;

      cursorRequest.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && deletedCount < entriesToDelete) {
          store.delete(cursor.primaryKey);
          deletedCount++;
          cursor.continue();
        } else {
          logger.info(`已清理 ${deletedCount} 条历史记录，当前保留 ${MAX_ENTRIES} 条`);
          resolve();
        }
      };

      cursorRequest.onerror = () => {
        logger.error('清理历史记录失败:', cursorRequest.error);
        reject(new Error('清理历史记录失败'));
      };
    };

    countRequest.onerror = () => {
      logger.error('获取记录数失败:', countRequest.error);
      reject(new Error('获取记录数失败'));
    };
  });
}

/**
 * 获取翻译历史统计
 */
export async function getHistoryStats(): Promise<HistoryStats> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.openCursor();

    let totalEntries = 0;
    let totalCharacters = 0;
    const uniqueUrls = new Set<string>();

    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;
    const thirtyDays = 30 * oneDay;

    let last7Days = 0;
    let last30Days = 0;

    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;

      if (cursor) {
        const entry = cursor.value as TranslationHistoryEntry;

        totalEntries++;
        totalCharacters += entry.charCount;
        uniqueUrls.add(entry.pageUrl);

        const age = now - entry.timestamp;
        if (age <= sevenDays) last7Days++;
        if (age <= thirtyDays) last30Days++;

        cursor.continue();
      } else {
        resolve({
          totalEntries,
          totalCharacters,
          uniquePages: uniqueUrls.size,
          last7Days,
          last30Days,
        });
      }
    };

    request.onerror = () => {
      logger.error('获取历史统计失败:', request.error);
      reject(new Error('获取历史统计失败'));
    };
  });
}

/**
 * 导出翻译历史数据（用于数据导出功能 CMP-89）
 */
export async function exportHistoryData(): Promise<{
  entries: TranslationHistoryEntry[];
  exportedAt: number;
}> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const request = store.getAll();

    request.onsuccess = () => {
      const entries = request.result as TranslationHistoryEntry[];
      // 按时间戳倒序排序
      entries.sort((a, b) => b.timestamp - a.timestamp);

      resolve({
        entries,
        exportedAt: Date.now(),
      });
    };

    request.onerror = () => {
      logger.error('导出历史数据失败:', request.error);
      reject(new Error('导出历史数据失败'));
    };
  });
}

/**
 * 导入翻译历史数据（用于数据导入功能 CMP-89）
 */
export async function importHistoryData(
  entries: TranslationHistoryEntry[]
): Promise<{ imported: number; skipped: number }> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    let imported = 0;
    let skipped = 0;
    let processed = 0;

    // 先获取所有现有 ID 用于去重
    const idRequest = store.getAllKeys();

    idRequest.onsuccess = () => {
      const existingIds = new Set(idRequest.result as string[]);

      entries.forEach((entry) => {
        // 跳过已存在的条目（去重）
        if (existingIds.has(entry.id)) {
          skipped++;
          processed++;
          if (processed === entries.length) {
            resolve({ imported, skipped });
          }
          return;
        }

        // 验证条目格式
        if (!entry.id || !entry.originalText || !entry.timestamp) {
          skipped++;
          processed++;
          if (processed === entries.length) {
            resolve({ imported, skipped });
          }
          return;
        }

        const request = store.put(entry);

        request.onsuccess = () => {
          imported++;
          processed++;
          if (processed === entries.length) {
            resolve({ imported, skipped });
          }
        };

        request.onerror = () => {
          skipped++;
          processed++;
          if (processed === entries.length) {
            resolve({ imported, skipped });
          }
        };
      });

      if (entries.length === 0) {
        resolve({ imported: 0, skipped: 0 });
      }
    };

    idRequest.onerror = () => {
      logger.error('获取现有记录失败:', idRequest.error);
      reject(new Error('导入数据失败'));
    };
  });
}

/**
 * 关闭数据库连接
 */
export function closeDB(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    logger.info('IndexedDB 连接已关闭');
  }
}
