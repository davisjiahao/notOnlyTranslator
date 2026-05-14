/**
 * Service Worker 请求队列持久化
 *
 * 解决 Manifest V3 Service Worker 随时被终止的问题：
 * 1. 翻译请求发出前持久化到 chrome.storage.local
 * 2. Service Worker 重启后自动恢复未完成的请求
 * 3. 请求完成或失败后从存储中清除
 */

import { logger } from '@/shared/utils/logger';

const STORAGE_KEY = 'pendingTranslationRequests';

/**
 * 持久化的请求条目
 */
export interface PendingRequestEntry {
  /** 唯一 ID */
  id: string;
  /** 原始文本 */
  text: string;
  /** 翻译模式 */
  mode: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 重试次数 */
  retries: number;
  /** 所属 tab ID（用于结果回调） */
  tabId?: number;
  /** 请求来源标识 */
  source?: string;
}

/**
 * 持久化存储结构
 */
interface PendingRequestStorage {
  requests: Record<string, PendingRequestEntry>;
}

/**
 * 请求完成回调
 */
export type RequestCompleteCallback = (entry: PendingRequestEntry, result: unknown) => void;
export type RequestFailCallback = (entry: PendingRequestEntry, error: Error) => void;

/**
 * 持久化请求队列管理器
 */
export class PendingRequestQueue {
  /** 内存中的回调映射 */
  private resolveCallbacks: Map<string, RequestCompleteCallback> = new Map();
  private rejectCallbacks: Map<string, RequestFailCallback> = new Map();
  /** 是否已加载 */
  private initialized = false;

  /**
   * 初始化，从存储恢复未完成的请求
   */
  async initialize(): Promise<PendingRequestEntry[]> {
    if (this.initialized) return [];

    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const storage: PendingRequestStorage = data[STORAGE_KEY] || { requests: {} };

      // 过滤出未过期（< 5 分钟）的请求
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 分钟
      const recovered: PendingRequestEntry[] = [];

      for (const [id, entry] of Object.entries(storage.requests)) {
        if (now - entry.createdAt < maxAge) {
          recovered.push(entry);
          logger.info(`PendingRequestQueue: 恢复未完成请求 ${id}`);
        } else {
          // 过期请求直接清除
          delete storage.requests[id];
        }
      }

      // 保存清理后的状态
      await chrome.storage.local.set({ [STORAGE_KEY]: storage });

      this.initialized = true;
      logger.info(`PendingRequestQueue: 已初始化，恢复 ${recovered.length} 个未完成请求`);
      return recovered;
    } catch (error) {
      logger.error('PendingRequestQueue: 初始化失败', error);
      this.initialized = true;
      return [];
    }
  }

  /**
   * 添加请求到持久化队列
   */
  async add(entry: PendingRequestEntry): Promise<void> {
    await this.ensureInitialized();

    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const storage: PendingRequestStorage = data[STORAGE_KEY] || { requests: {} };
      storage.requests[entry.id] = entry;
      await chrome.storage.local.set({ [STORAGE_KEY]: storage });
      logger.info(`PendingRequestQueue: 已添加请求 ${entry.id}`);
    } catch (error) {
      logger.error('PendingRequestQueue: 添加请求失败', error);
    }
  }

  /**
   * 请求完成，从存储中移除
   */
  async complete(id: string): Promise<void> {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const storage: PendingRequestStorage = data[STORAGE_KEY] || { requests: {} };
      delete storage.requests[id];
      await chrome.storage.local.set({ [STORAGE_KEY]: storage });
      logger.info(`PendingRequestQueue: 请求 ${id} 已完成并移除`);
    } catch (error) {
      logger.error('PendingRequestQueue: 完成请求失败', error);
    }
  }

  /**
   * 请求失败，标记重试或清除
   */
  async fail(id: string, maxRetries: number = 2): Promise<boolean> {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const storage: PendingRequestStorage = data[STORAGE_KEY] || { requests: {} };
      const entry = storage.requests[id];

      if (!entry) return false;

      if (entry.retries < maxRetries) {
        // 重试：增加重试计数，保留在队列中
        entry.retries++;
        await chrome.storage.local.set({ [STORAGE_KEY]: storage });
        logger.info(`PendingRequestQueue: 请求 ${id} 第 ${entry.retries} 次重试`);
        return true; // 需要重试
      } else {
        // 超过最大重试次数，清除
        delete storage.requests[id];
        await chrome.storage.local.set({ [STORAGE_KEY]: storage });
        logger.info(`PendingRequestQueue: 请求 ${id} 重试失败，已清除`);
        return false;
      }
    } catch (error) {
      logger.error('PendingRequestQueue: 失败处理失败', error);
      return false;
    }
  }

  /**
   * 获取所有待处理的请求
   */
  async getAll(): Promise<PendingRequestEntry[]> {
    await this.ensureInitialized();

    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const storage: PendingRequestStorage = data[STORAGE_KEY] || { requests: {} };
      return Object.values(storage.requests);
    } catch (error) {
      logger.error('PendingRequestQueue: 获取所有请求失败', error);
      return [];
    }
  }

  /**
   * 获取待处理请求数量
   */
  async size(): Promise<number> {
    const all = await this.getAll();
    return all.length;
  }

  /**
   * 注册请求完成的回调
   */
  onResolve(id: string, callback: RequestCompleteCallback): void {
    this.resolveCallbacks.set(id, callback);
  }

  /**
   * 注册请求失败的回调
   */
  onReject(id: string, callback: RequestFailCallback): void {
    this.rejectCallbacks.set(id, callback);
  }

  /**
   * 触发完成回调
   */
  triggerResolve(entry: PendingRequestEntry, result: unknown): void {
    const callback = this.resolveCallbacks.get(entry.id);
    if (callback) {
      callback(entry, result);
      this.resolveCallbacks.delete(entry.id);
    }
  }

  /**
   * 触发失败回调
   */
  triggerReject(entry: PendingRequestEntry, error: Error): void {
    const callback = this.rejectCallbacks.get(entry.id);
    if (callback) {
      callback(entry, error);
      this.rejectCallbacks.delete(entry.id);
    }
  }

  /**
   * 清理过期请求（> 5 分钟）
   */
  async cleanupExpired(): Promise<number> {
    try {
      const data = await chrome.storage.local.get(STORAGE_KEY);
      const storage: PendingRequestStorage = data[STORAGE_KEY] || { requests: {} };
      const now = Date.now();
      const maxAge = 5 * 60 * 1000;
      let cleanedCount = 0;

      for (const [id, entry] of Object.entries(storage.requests)) {
        if (now - entry.createdAt > maxAge) {
          delete storage.requests[id];
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        await chrome.storage.local.set({ [STORAGE_KEY]: storage });
        logger.info(`PendingRequestQueue: 清理 ${cleanedCount} 个过期请求`);
      }

      return cleanedCount;
    } catch (error) {
      logger.error('PendingRequestQueue: 清理过期请求失败', error);
      return 0;
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}

// 导出单例
export const pendingRequestQueue = new PendingRequestQueue();
