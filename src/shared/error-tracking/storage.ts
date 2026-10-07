// 错误追踪存储模块

import type {
  ErrorEntry,
  ErrorStats,
  ErrorQueryParams,
  ErrorListResponse,
  ErrorTrackingConfig,
  ErrorCategory,
  ErrorSeverity
} from './types';
import {
  ERROR_STORAGE_KEY,
  ERROR_CONFIG_KEY,
  DEFAULT_ERROR_TRACKING_CONFIG
} from './constants';

// 同一执行上下文串行修改错误列表；跨扩展上下文写入仍需统一由后台处理。
let errorWrites: Promise<void> = Promise.resolve();

function withErrorWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = errorWrites.then(operation);
  errorWrites = next.then(() => undefined, () => undefined);
  return next;
}

/**
 * 获取错误追踪配置
 */
export async function getErrorConfig(): Promise<ErrorTrackingConfig> {
  try {
    const result = await chrome.storage.local.get([ERROR_CONFIG_KEY]);
    return {
      ...DEFAULT_ERROR_TRACKING_CONFIG,
      ...result[ERROR_CONFIG_KEY]
    };
  } catch (error) {
    console.error('获取错误追踪配置失败:', error);
    return DEFAULT_ERROR_TRACKING_CONFIG;
  }
}

/**
 * 更新错误追踪配置
 */
export async function updateErrorConfig(
  config: Partial<ErrorTrackingConfig>
): Promise<ErrorTrackingConfig> {
  try {
    const currentConfig = await getErrorConfig();
    const newConfig = { ...currentConfig, ...config };
    await chrome.storage.local.set({ [ERROR_CONFIG_KEY]: newConfig });
    return newConfig;
  } catch (error) {
    console.error('更新错误追踪配置失败:', error);
    throw new Error('更新配置失败');
  }
}

/**
 * 获取所有错误条目
 */
export async function getAllErrors(): Promise<ErrorEntry[]> {
  try {
    const result = await chrome.storage.local.get([ERROR_STORAGE_KEY]);
    const errors: ErrorEntry[] = result[ERROR_STORAGE_KEY] || [];
    return [...errors].sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('获取错误列表失败:', error);
    throw new Error('获取错误列表失败');
  }
}

/**
 * 根据ID获取错误
 */
export async function getErrorById(id: string): Promise<ErrorEntry | null> {
  try {
    const errors = await getAllErrors();
    return errors.find(e => e.id === id) || null;
  } catch (error) {
    console.error('获取错误详情失败:', error);
    throw new Error('获取错误详情失败');
  }
}

/**
 * 查询错误列表（支持过滤和分页）
 */
export async function queryErrors(params: ErrorQueryParams = {}): Promise<ErrorListResponse> {
  try {
    const {
      category,
      severity,
      reported,
      startTime,
      endTime,
      limit = 50,
      offset = 0
    } = params;

    let errors = await getAllErrors();

    // 应用过滤
    if (category) {
      errors = errors.filter(e => e.category === category);
    }
    if (severity) {
      errors = errors.filter(e => e.severity === severity);
    }
    if (reported !== undefined) {
      errors = errors.filter(e => e.reported === reported);
    }
    if (startTime) {
      errors = errors.filter(e => e.timestamp >= startTime);
    }
    if (endTime) {
      errors = errors.filter(e => e.timestamp <= endTime);
    }

    const total = errors.length;

    // 应用分页
    errors = errors.slice(offset, offset + limit);

    return {
      errors,
      total,
      hasMore: offset + limit < total
    };
  } catch (error) {
    console.error('查询错误列表失败:', error);
    throw new Error('查询错误列表失败');
  }
}

/**
 * 保存单个错误
 */
export function saveError(error: ErrorEntry): Promise<void> {
  return withErrorWrite(() => saveErrorUnlocked(error));
}

async function saveErrorUnlocked(error: ErrorEntry): Promise<void> {
  try {
    const config = await getErrorConfig();
    const errors = await getAllErrors();

    // 检查是否已存在相同错误（用于聚合）
    const existingIndex = errors.findIndex(e =>
      e.message === error.message &&
      e.category === error.category &&
      e.stack === error.stack &&
      // 30分钟内相似错误聚合
      Date.now() - e.timestamp < 30 * 60 * 1000
    );
    const updated = existingIndex >= 0
      ? errors.map((existing, index) => index === existingIndex
        ? { ...existing, count: existing.count + 1, timestamp: error.timestamp }
        : existing)
      : [error, ...errors].slice(0, config.maxEntries);

    await chrome.storage.local.set({ [ERROR_STORAGE_KEY]: updated });
  } catch (err) {
    console.error('保存错误失败:', err);
    throw new Error('保存错误失败');
  }
}

/**
 * 批量保存错误
 */
export function saveErrors(errorsToSave: ErrorEntry[]): Promise<void> {
  return withErrorWrite(() => saveErrorsUnlocked(errorsToSave));
}

async function saveErrorsUnlocked(errorsToSave: ErrorEntry[]): Promise<void> {
  try {
    const config = await getErrorConfig();
    const errors = await getAllErrors();
    const updated = [...errorsToSave].reverse().concat(errors).slice(0, config.maxEntries);

    await chrome.storage.local.set({ [ERROR_STORAGE_KEY]: updated });
  } catch (error) {
    console.error('批量保存错误失败:', error);
    throw new Error('批量保存错误失败');
  }
}

/**
 * 删除单个错误
 */
export function deleteError(id: string): Promise<void> {
  return withErrorWrite(() => deleteErrorUnlocked(id));
}

async function deleteErrorUnlocked(id: string): Promise<void> {
  try {
    const errors = await getAllErrors();
    const filtered = errors.filter(e => e.id !== id);
    await chrome.storage.local.set({ [ERROR_STORAGE_KEY]: filtered });
  } catch (error) {
    console.error('删除错误失败:', error);
    throw new Error('删除错误失败');
  }
}

/**
 * 批量删除错误
 */
export function deleteErrors(ids: string[]): Promise<void> {
  return withErrorWrite(() => deleteErrorsUnlocked(ids));
}

async function deleteErrorsUnlocked(ids: string[]): Promise<void> {
  try {
    const errors = await getAllErrors();
    const filtered = errors.filter(e => !ids.includes(e.id));
    await chrome.storage.local.set({ [ERROR_STORAGE_KEY]: filtered });
  } catch (error) {
    console.error('批量删除错误失败:', error);
    throw new Error('批量删除错误失败');
  }
}

/**
 * 获取未上报的错误
 */
export async function getUnreportedErrors(): Promise<ErrorEntry[]> {
  try {
    const errors = await getAllErrors();
    return errors.filter(e => !e.reported);
  } catch (error) {
    console.error('获取未上报错误失败:', error);
    throw new Error('获取未上报错误失败');
  }
}

/**
 * 标记错误为已上报
 */
export function markErrorsAsReported(ids: string[]): Promise<void> {
  return withErrorWrite(() => markErrorsAsReportedUnlocked(ids));
}

async function markErrorsAsReportedUnlocked(ids: string[]): Promise<void> {
  try {
    const errors = await getAllErrors();
    const updated = errors.map(e => {
      if (ids.includes(e.id)) {
        return {
          ...e,
          reported: true,
          reportedAt: Date.now()
        };
      }
      return e;
    });
    await chrome.storage.local.set({ [ERROR_STORAGE_KEY]: updated });
  } catch (error) {
    console.error('标记错误已上报失败:', error);
    throw new Error('标记错误已上报失败');
  }
}

/**
 * 清除所有错误
 */
export function clearAllErrors(): Promise<void> {
  return withErrorWrite(clearAllErrorsUnlocked);
}

async function clearAllErrorsUnlocked(): Promise<void> {
  try {
    await chrome.storage.local.remove([ERROR_STORAGE_KEY]);
  } catch (error) {
    console.error('清除错误失败:', error);
    throw new Error('清除错误失败');
  }
}

/**
 * 获取错误统计
 */
export async function getErrorStats(): Promise<ErrorStats> {
  try {
    const errors = await getAllErrors();
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;

    // 按分类统计
    const byCategory: Record<ErrorCategory, number> = {
      runtime: 0,
      network: 0,
      storage: 0,
      translation: 0,
      api: 0,
      ui: 0,
      unknown: 0
    };

    // 按严重程度统计
    const bySeverity: Record<ErrorSeverity, number> = {
      fatal: 0,
      error: 0,
      warning: 0
    };

    // 统计计数
    errors.forEach(e => {
      byCategory[e.category] = (byCategory[e.category] || 0) + e.count;
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + e.count;
    });

    // 计算时间范围内的错误
    const last24Hours = errors
      .filter(e => now - e.timestamp <= oneDay)
      .reduce((sum, e) => sum + e.count, 0);

    const last7Days = errors
      .filter(e => now - e.timestamp <= sevenDays)
      .reduce((sum, e) => sum + e.count, 0);

    // 获取最常发生的错误（按消息聚合）
    const errorCounts = new Map<string, { message: string; count: number; category: ErrorCategory }>();
    errors.forEach(e => {
      const key = `${e.message}_${e.category}`;
      const existing = errorCounts.get(key);
      if (existing) {
        existing.count += e.count;
      } else {
        errorCounts.set(key, {
          message: e.message,
          count: e.count,
          category: e.category
        });
      }
    });

    const topErrors = Array.from(errorCounts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalErrors: errors.reduce((sum, e) => sum + e.count, 0),
      unreportedErrors: errors.filter(e => !e.reported).reduce((sum, e) => sum + e.count, 0),
      byCategory,
      bySeverity,
      last24Hours,
      last7Days,
      topErrors
    };
  } catch (error) {
    console.error('获取错误统计失败:', error);
    throw new Error('获取错误统计失败');
  }
}
