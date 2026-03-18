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
import { logger } from '@/shared/utils';
import { generateCacheKey } from '@/shared/utils';

/**
 * 双向链表节点 - 用于O(1) LRU淘汰
 */
interface CacheListNode {
  key: string;
  prev: CacheListNode | null;
  next: CacheListNode | null;
}

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

  /** 双向链表节点映射 - 用于O(1) LRU操作 */
  private nodeMap: Map<string, CacheListNode> = new Map();

  /** 链表头节点（最旧的） */
  private head: CacheListNode | null = null;

  /** 链表尾节点（最新的） */
  private tail: CacheListNode | null = null;

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
        logger.info('EnhancedCacheManager: 缓存版本不匹配，清空缓存');
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
        // 重建链表 - 按加载顺序添加到尾部
        this.addToTail(hash);
      }

      logger.info(`EnhancedCacheManager: 已加载 ${this.memoryCache.size} 条缓存`);
      this.initialized = true;
    } catch (error) {
      logger.error('EnhancedCacheManager: 初始化失败', error);
      this.initialized = true;
    }
  }

  /**
   * 生成文本内容的哈希值
   * 使用共享工具函数 generateCacheKey
   */
  generateHash(text: string, mode: TranslationMode): string {
    return generateCacheKey(text, mode);
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

    // 更新链表位置（O(1) LRU）
    this.moveToTail(textHash);

    logger.info(`EnhancedCacheManager: 缓存命中 ${textHash}`);
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
        // 更新链表位置（O(1) LRU）
        this.moveToTail(hash);
      } else {
        if (entry) {
          // 过期，删除
          this.memoryCache.delete(hash);
          this.removeNode(this.nodeMap.get(hash)!);
          this.nodeMap.delete(hash);
        }
        misses.push(hash);
      }
    }

    logger.info(`EnhancedCacheManager: 批量查询 ${textHashes.length} 条，命中 ${hits.size} 条`);
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

    // 添加到链表尾部（最新）-O(1) LRU
    this.addToTail(textHash);

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

      // 添加到链表尾部（最新）-O(1) LRU
      this.addToTail(textHash);
    }

    // 批量添加后检查一次是否需要淘汰
    if (this.shouldEvict()) {
      await this.evictLRU();
    }

    // 异步持久化到存储
    this.persistToStorage();

    logger.info(`EnhancedCacheManager: 批量缓存 ${entries.length} 条`);
  }

  /**
   * LRU批量淘汰：一次删除最旧的 10% 条目
   *
   * 优化说明：
   * - 使用双向链表实现 O(1) 淘汰，从头节点（最旧）开始删除
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

    if (evictCount <= 0 || !this.head) return;

    // 从头节点（最旧）开始删除 - O(1) 操作
    let node: CacheListNode | null = this.head;
    let deletedCount = 0;

    while (node && deletedCount < evictCount) {
      const key = node.key;
      const nextNode: CacheListNode | null = node.next;

      // 从 memoryCache 和 nodeMap 中删除
      this.memoryCache.delete(key);
      this.nodeMap.delete(key);

      // 移动头指针
      this.head = nextNode;
      if (this.head) {
        this.head.prev = null;
      }

      deletedCount++;
      node = nextNode;
    }

    // 如果删空了，重置尾指针
    if (deletedCount === currentSize) {
      this.tail = null;
    }

    logger.info(
      `EnhancedCacheManager: LRU批量淘汰 ${deletedCount} 条`,
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
        logger.info(`EnhancedCacheManager: 持久化 ${this.memoryCache.size} 条缓存`);
      } catch (error) {
        logger.error('EnhancedCacheManager: 持久化失败', error);
      }
    }, 1000);
  }

  /**
   * 从链表中移除节点
   */
  private removeNode(node: CacheListNode): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      // 是头节点
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      // 是尾节点
      this.tail = node.prev;
    }

    node.prev = null;
    node.next = null;
  }

  /**
   * 将节点移到链表尾部（最新）
   */
  private moveToTail(key: string): void {
    const node = this.nodeMap.get(key);
    if (!node) return;

    // 如果已经在尾部，无需移动
    if (node === this.tail) return;

    // 从当前位置移除
    this.removeNode(node);

    // 添加到尾部
    this.addToTailNode(node);
  }

  /**
   * 添加新节点到链表尾部
   */
  private addToTail(key: string): void {
    const node: CacheListNode = {
      key,
      prev: null,
      next: null,
    };
    this.nodeMap.set(key, node);
    this.addToTailNode(node);
  }

  /**
   * 将已有节点添加到链表尾部
   */
  private addToTailNode(node: CacheListNode): void {
    if (!this.tail) {
      // 空链表
      this.head = node;
      this.tail = node;
    } else {
      // 添加到尾部
      node.prev = this.tail;
      node.next = null;
      this.tail.next = node;
      this.tail = node;
    }
  }

  /**
   * 清空所有缓存
   */
  async clearAll(): Promise<void> {
    this.memoryCache.clear();
    this.nodeMap.clear();
    this.head = null;
    this.tail = null;
    await chrome.storage.local.remove(PARAGRAPH_CACHE_KEY);
    logger.info('EnhancedCacheManager: 已清空所有缓存');
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
        // 从 memoryCache 删除
        this.memoryCache.delete(key);

        // 从链表中移除并清理 nodeMap（保持链表完整性）
        const node = this.nodeMap.get(key);
        if (node) {
          this.removeNode(node);
          this.nodeMap.delete(key);
        }

        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.persistToStorage();
      logger.info(`EnhancedCacheManager: 清理 ${cleanedCount} 条过期缓存`);
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
