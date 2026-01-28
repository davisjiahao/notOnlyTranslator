import type {
  TranslationResult,
  TranslationMode,
  ParagraphCacheEntry,
  EnhancedCacheStorage,
} from '@/shared/types';
import {
  DEFAULT_BATCH_CONFIG,
  PARAGRAPH_CACHE_KEY,
  CACHE_VERSION,
} from '@/shared/constants';

/**
 * 增强缓存管理器
 *
 * 特性：
 * - 段落级别缓存，基于文本内容哈希
 * - LRU（最近最少使用）淘汰策略
 * - 支持跨页面复用（相同文本内容）
 * - 自动过期清理
 */
export class EnhancedCacheManager {
  /** 内存缓存，加速访问 */
  private memoryCache: Map<string, ParagraphCacheEntry> = new Map();

  /** 是否已从存储加载 */
  private initialized: boolean = false;

  /**
   * 初始化缓存管理器，从存储加载缓存
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const data = await chrome.storage.local.get(PARAGRAPH_CACHE_KEY);
      const storage: EnhancedCacheStorage = data[PARAGRAPH_CACHE_KEY] || {
        paragraphCache: {},
        version: CACHE_VERSION,
      };

      // 检查版本，必要时迁移
      if (storage.version !== CACHE_VERSION) {
        console.log('EnhancedCacheManager: 缓存版本不匹配，清空缓存');
        await this.clearAll();
        this.initialized = true;
        return;
      }

      // 加载到内存缓存
      const now = Date.now();
      for (const [hash, entry] of Object.entries(storage.paragraphCache)) {
        // 跳过过期条目
        if (now - entry.createdAt > DEFAULT_BATCH_CONFIG.cacheExpireTime) {
          continue;
        }
        this.memoryCache.set(hash, entry);
      }

      console.log(`EnhancedCacheManager: 已加载 ${this.memoryCache.size} 条缓存`);
      this.initialized = true;
    } catch (error) {
      console.error('EnhancedCacheManager: 初始化失败', error);
      this.initialized = true;
    }
  }

  /**
   * 生成文本内容的哈希值
   * 使用简单但高效的哈希算法
   */
  generateHash(text: string, mode: TranslationMode): string {
    // 规范化文本：去除多余空白，转小写
    const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();

    // 使用 DJB2 哈希算法
    let hash = 5381;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    }

    // 加入模式标识
    return `${mode}_${Math.abs(hash).toString(36)}`;
  }

  /**
   * 获取缓存的翻译结果
   * 如果存在且未过期，返回结果并更新访问时间
   */
  async get(textHash: string): Promise<TranslationResult | null> {
    await this.initialize();

    const entry = this.memoryCache.get(textHash);
    if (!entry) {
      return null;
    }

    // 检查是否过期
    const now = Date.now();
    if (now - entry.createdAt > DEFAULT_BATCH_CONFIG.cacheExpireTime) {
      this.memoryCache.delete(textHash);
      return null;
    }

    // 更新最后访问时间（用于LRU）
    entry.lastAccessedAt = now;
    this.memoryCache.set(textHash, entry);

    console.log(`EnhancedCacheManager: 缓存命中 ${textHash}`);
    return { ...entry.result, cached: true };
  }

  /**
   * 批量获取缓存
   * 返回命中的结果和未命中的哈希列表
   */
  async getBatch(textHashes: string[]): Promise<{
    hits: Map<string, TranslationResult>;
    misses: string[];
  }> {
    await this.initialize();

    const hits = new Map<string, TranslationResult>();
    const misses: string[] = [];
    const now = Date.now();

    for (const hash of textHashes) {
      const entry = this.memoryCache.get(hash);

      if (entry && now - entry.createdAt <= DEFAULT_BATCH_CONFIG.cacheExpireTime) {
        // 更新访问时间
        entry.lastAccessedAt = now;
        hits.set(hash, { ...entry.result, cached: true });
      } else {
        if (entry) {
          // 过期，删除
          this.memoryCache.delete(hash);
        }
        misses.push(hash);
      }
    }

    console.log(`EnhancedCacheManager: 批量查询 ${textHashes.length} 条，命中 ${hits.size} 条`);
    return { hits, misses };
  }

  /**
   * 设置缓存
   */
  async set(
    textHash: string,
    result: TranslationResult,
    mode: TranslationMode,
    pageUrl: string
  ): Promise<void> {
    await this.initialize();

    const now = Date.now();
    const entry: ParagraphCacheEntry = {
      textHash,
      result,
      mode,
      pageUrl,
      createdAt: now,
      lastAccessedAt: now,
    };

    this.memoryCache.set(textHash, entry);

    // 提前检查是否需要淘汰（95% 容量时触发）
    if (this.shouldEvict()) {
      await this.evictLRU();
    }

    // 异步持久化到存储
    this.persistToStorage();
  }

  /**
   * 批量设置缓存
   */
  async setBatch(
    entries: Array<{
      textHash: string;
      result: TranslationResult;
      mode: TranslationMode;
      pageUrl: string;
    }>
  ): Promise<void> {
    await this.initialize();

    const now = Date.now();

    for (const { textHash, result, mode, pageUrl } of entries) {
      const entry: ParagraphCacheEntry = {
        textHash,
        result,
        mode,
        pageUrl,
        createdAt: now,
        lastAccessedAt: now,
      };
      this.memoryCache.set(textHash, entry);
    }

    // 批量添加后检查一次是否需要淘汰
    if (this.shouldEvict()) {
      await this.evictLRU();
    }

    // 异步持久化到存储
    this.persistToStorage();

    console.log(`EnhancedCacheManager: 批量缓存 ${entries.length} 条`);
  }

  /**
   * LRU批量淘汰：一次删除最旧的 10% 条目
   *
   * 优化说明：
   * - 批量淘汰比单条淘汰更高效（减少频繁触发淘汰的开销）
   * - 预留一定空间，避免每次添加都触发淘汰
   * - 淘汰后缓存使用率约为 90%
   */
  private async evictLRU(): Promise<void> {
    const currentSize = this.memoryCache.size;
    const maxEntries = DEFAULT_BATCH_CONFIG.maxCacheEntries;

    // 计算需要淘汰的数量（至少 10%，确保腾出足够空间）
    const evictCount = Math.max(
      Math.ceil(maxEntries * 0.1),  // 至少 10%
      currentSize - maxEntries + 1   // 确保淘汰后不超限
    );

    if (evictCount <= 0) return;

    // 将所有条目按 lastAccessedAt 排序
    const entries = Array.from(this.memoryCache.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);

    // 删除最旧的条目
    const keysToDelete = entries.slice(0, evictCount).map(([key]) => key);

    for (const key of keysToDelete) {
      this.memoryCache.delete(key);
    }

    console.log(
      `EnhancedCacheManager: LRU批量淘汰 ${keysToDelete.length} 条`,
      `缓存从 ${currentSize} 减少到 ${this.memoryCache.size}`
    );
  }

  /**
   * 检查是否需要淘汰
   * 当缓存达到 95% 容量时触发淘汰，提前腾出空间
   */
  private shouldEvict(): boolean {
    return this.memoryCache.size >= DEFAULT_BATCH_CONFIG.maxCacheEntries * 0.95;
  }

  /**
   * 持久化缓存到Chrome存储
   * 使用防抖避免频繁写入
   */
  private persistTimeout: ReturnType<typeof setTimeout> | null = null;

  private persistToStorage(): void {
    // 清除之前的定时器
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
    }

    // 延迟1秒后持久化
    this.persistTimeout = setTimeout(async () => {
      try {
        const paragraphCache: Record<string, ParagraphCacheEntry> = {};
        for (const [key, entry] of this.memoryCache) {
          paragraphCache[key] = entry;
        }

        const storage: EnhancedCacheStorage = {
          paragraphCache,
          version: CACHE_VERSION,
        };

        await chrome.storage.local.set({ [PARAGRAPH_CACHE_KEY]: storage });
        console.log(`EnhancedCacheManager: 持久化 ${this.memoryCache.size} 条缓存`);
      } catch (error) {
        console.error('EnhancedCacheManager: 持久化失败', error);
      }
    }, 1000);
  }

  /**
   * 清空所有缓存
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    await chrome.storage.local.remove(PARAGRAPH_CACHE_KEY);
    console.log('EnhancedCacheManager: 已清空所有缓存');
  }

  /**
   * 清理过期缓存
   */
  async cleanExpired(): Promise<number> {
    await this.initialize();

    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.memoryCache) {
      if (now - entry.createdAt > DEFAULT_BATCH_CONFIG.cacheExpireTime) {
        this.memoryCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.persistToStorage();
      console.log(`EnhancedCacheManager: 清理 ${cleanedCount} 条过期缓存`);
    }

    return cleanedCount;
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{
    totalEntries: number;
    memoryUsage: number;
    oldestEntry: number | null;
    newestEntry: number | null;
  }> {
    await this.initialize();

    let oldestEntry: number | null = null;
    let newestEntry: number | null = null;
    let memoryUsage = 0;

    for (const entry of this.memoryCache.values()) {
      // 估算内存占用
      memoryUsage += JSON.stringify(entry).length * 2; // UTF-16 编码

      if (oldestEntry === null || entry.createdAt < oldestEntry) {
        oldestEntry = entry.createdAt;
      }
      if (newestEntry === null || entry.createdAt > newestEntry) {
        newestEntry = entry.createdAt;
      }
    }

    return {
      totalEntries: this.memoryCache.size,
      memoryUsage,
      oldestEntry,
      newestEntry,
    };
  }
}

// 导出单例
export const enhancedCache = new EnhancedCacheManager();
