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
  DEEPL_CACHE_EXPIRE_TIME,
  LLM_CACHE_EXPIRE_TIME,
} from '@/shared/constants';
import { logger } from '@/shared/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { paragraphCacheScope, type ParagraphCacheScope } from './paragraphCacheScope';

// 不申请 unlimitedStorage，避免扩展更新时权限重提示导致禁用；为其他本地数据预留空间。
const PERSISTENCE_BYTE_BUDGET = 8 * 1024 * 1024;

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
  private initializing: Promise<void> | null = null;
  private cacheGeneration = 0;
  private storageWrites: Promise<void> = Promise.resolve();
  /** 会话累计计数，不依赖可能已满的存储来报告失败。 */
  private persistenceFailures = 0;
  private evictedEntries = 0;

  private queueStorageWrite(write: () => Promise<void>): Promise<void> {
    const task = this.storageWrites.then(write);
    this.storageWrites = task.catch(() => undefined);
    return task;
  }

  getGeneration(): number {
    return this.cacheGeneration;
  }

  /** 初始化只执行一次，避免并发迁移重复清除新写入的条目。 */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (!this.initializing) this.initializing = this.loadFromStorage();
    return this.initializing;
  }

  private async loadFromStorage(): Promise<void> {
    const generation = this.cacheGeneration;
    try {
      const data = await chrome.storage.local.get(PARAGRAPH_CACHE_KEY);
      if (generation !== this.cacheGeneration) {
        this.initialized = true;
        return;
      }
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
        if (now - entry.createdAt > this.getCacheExpireTime(entry.source)) {
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

  /** 仅保存正文、模式和作用域的 SHA-256 摘要，不在键中暴露原文。 */
  generateHash(text: string, mode: TranslationMode, scope?: ParagraphCacheScope): string {
    const identity = JSON.stringify([mode, text, scope ? paragraphCacheScope(scope) : null]);
    return `v3_${bytesToHex(sha256(utf8ToBytes(identity)))}`;
  }

  /**
   * 获取缓存的翻译结果
   * 如果存在且未过期，返回结果并更新访问时间
   * 根据来源使用不同的过期时间策略
   */
  async get(textHash: string): Promise<TranslationResult | null> {
    await this.initialize();

    const entry = this.memoryCache.get(textHash);
    if (!entry) {
      return null;
    }

    // 检查是否过期（根据来源使用不同的过期时间）
    const now = Date.now();
    const expireTime = this.getCacheExpireTime(entry.source);
    if (now - entry.createdAt > expireTime) {
      this.memoryCache.delete(textHash);
      this.removeNode(this.nodeMap.get(textHash)!);
      this.nodeMap.delete(textHash);
      return null;
    }

    // 更新最后访问时间（用于LRU）
    entry.lastAccessedAt = now;
    this.memoryCache.set(textHash, entry);

    // 更新链表位置（O(1) LRU）
    this.moveToTail(textHash);

    logger.info(`EnhancedCacheManager: 缓存命中 (${entry.source || 'unknown'})`);
    return { ...entry.result, cached: true, _source: entry.source };
  }

  /**
   * 根据翻译来源获取缓存过期时间
   * DeepL 翻译结果更稳定，缓存时间更长
   */
  private getCacheExpireTime(source?: 'deepl' | 'llm' | 'hybrid' | 'free_google'): number {
    switch (source) {
      case 'deepl':
        // DeepL 翻译结果更稳定，缓存30天
        return DEEPL_CACHE_EXPIRE_TIME;
      case 'free_google':
        // 免费翻译缓存14天
        return 14 * 24 * 60 * 60 * 1000;
      case 'hybrid':
        // 混合翻译缓存14天
        return 14 * 24 * 60 * 60 * 1000;
      case 'llm':
      default:
        // LLM 翻译缓存7天
        return LLM_CACHE_EXPIRE_TIME;
    }
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
      const expireTime = this.getCacheExpireTime(entry?.source);

      if (entry && now - entry.createdAt <= expireTime) {
        // 更新访问时间
        entry.lastAccessedAt = now;
        hits.set(hash, { ...entry.result, cached: true, _source: entry.source });
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
   * @param source 翻译来源，影响缓存过期时间
   */
  async set(
    textHash: string,
    result: TranslationResult,
    mode: TranslationMode,
    _pageUrl: string,
    source?: 'deepl' | 'llm' | 'hybrid' | 'free_google',
    expectedGeneration = this.cacheGeneration
  ): Promise<void> {
    await this.initialize();
    if (expectedGeneration !== this.cacheGeneration) return;

    const now = Date.now();
    const entry: ParagraphCacheEntry = {
      textHash,
      result,
      mode,
      // 页面 URL 对缓存身份无影响，不在持久化条目中保留。
      pageUrl: 'background',
      createdAt: now,
      lastAccessedAt: now,
      source,
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

    // 记录缓存来源统计
    logger.info(`EnhancedCacheManager: 缓存已设置 (${source || 'unknown'})`);
  }

  /**
   * 批量设置缓存
   * @param source 翻译来源，影响缓存过期时间
   */
  async setBatch(
    entries: Array<{
      textHash: string;
      result: TranslationResult;
      mode: TranslationMode;
      pageUrl: string;
    }>,
    source?: 'deepl' | 'llm' | 'hybrid' | 'free_google',
    expectedGeneration = this.cacheGeneration
  ): Promise<void> {
    await this.initialize();
    if (expectedGeneration !== this.cacheGeneration) return;

    const now = Date.now();

    for (const { textHash, result, mode } of entries) {
      const entry: ParagraphCacheEntry = {
        textHash,
        result,
        mode,
        pageUrl: 'background',
        createdAt: now,
        lastAccessedAt: now,
        source,
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

    logger.info(`EnhancedCacheManager: 批量缓存 ${entries.length} 条 (${source || 'unknown'})`);
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

    let deletedCount = 0;
    while (this.head && deletedCount < evictCount) {
      this.evictOldest();
      deletedCount++;
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
    if (this.persistTimeout) clearTimeout(this.persistTimeout);

    // 延迟1秒后持久化；清空与写入串行，避免旧快照在清空后复活。
    this.persistTimeout = setTimeout(() => {
      this.persistTimeout = null;
      const generation = this.cacheGeneration;
      void this.queueStorageWrite(() => this.writeSnapshot(generation));
    }, 1000);
  }

  private evictOldest(): void {
    if (!this.head) return;
    const node = this.head;
    this.removeNode(node);
    this.memoryCache.delete(node.key);
    this.nodeMap.delete(node.key);
    this.evictedEntries += 1;
  }

  /** 每条仅序列化一次计算 UTF-8 字节，逐项减去尺寸，避免裁剪时反复全量序列化。 */
  private prepareSnapshot(budget: number): { storage: EnhancedCacheStorage; bytes: number } {
    const empty: EnhancedCacheStorage = { paragraphCache: {}, version: CACHE_VERSION };
    const sizes = new Map(Array.from(this.memoryCache, ([key, entry]) => [
      key, utf8ToBytes(JSON.stringify({ [key]: entry })).byteLength - 2,
    ]));
    let bytes = utf8ToBytes(JSON.stringify({ [PARAGRAPH_CACHE_KEY]: empty })).byteLength
      + Array.from(sizes.values()).reduce((sum, size) => sum + size, 0)
      + Math.max(0, sizes.size - 1);
    while (bytes > budget && this.head) {
      bytes -= sizes.get(this.head.key)! + (this.memoryCache.size > 1 ? 1 : 0);
      this.evictOldest();
    }
    return { storage: { ...empty, paragraphCache: Object.fromEntries(this.memoryCache) }, bytes };
  }

  private async writeSnapshot(generation: number): Promise<void> {
    let budget = PERSISTENCE_BYTE_BUDGET;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (generation !== this.cacheGeneration) return;
      try {
        const { storage, bytes } = this.prepareSnapshot(budget);
        // ponytail: 配额拒绝时只减半重试一次；其他数据长期占满时需独立清理策略。
        budget = Math.floor(bytes / 2);
        await chrome.storage.local.set({ [PARAGRAPH_CACHE_KEY]: storage });
        logger.info(`EnhancedCacheManager: 持久化 ${Object.keys(storage.paragraphCache).length} 条缓存`);
        return;
      } catch (error) {
        this.persistenceFailures += 1;
        logger.error('EnhancedCacheManager: 持久化失败', error);
        const message = error instanceof Error ? error.message : String(error);
        if (!/quota/i.test(message)) return;
      }
    }
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
    if (this.nodeMap.has(key)) {
      this.moveToTail(key);
      return;
    }
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
    this.cacheGeneration += 1;
    if (this.persistTimeout) {
      clearTimeout(this.persistTimeout);
      this.persistTimeout = null;
    }
    this.memoryCache.clear();
    this.nodeMap.clear();
    this.head = null;
    this.tail = null;
    await this.queueStorageWrite(() => chrome.storage.local.remove(PARAGRAPH_CACHE_KEY));
    logger.info('EnhancedCacheManager: 已清空所有缓存');
  }

  /**
   * 清理过期缓存
   * 根据来源使用不同的过期时间
   */
  async cleanExpired(): Promise<number> {
    await this.initialize();

    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.memoryCache) {
      const expireTime = this.getCacheExpireTime(entry.source);
      if (now - entry.createdAt > expireTime) {
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

  /** 无原文和位置映射时不得近似复用；保留精确匹配接口兼容旧调用方。 */
  async fuzzyGet(
    text: string,
    mode: TranslationMode,
    _threshold: number = 0.85,
    scope?: ParagraphCacheScope
  ): Promise<{ result: TranslationResult; similarity: number } | null> {
    const exact = await this.get(this.generateHash(text, mode, scope));
    return exact ? { result: exact, similarity: 1 } : null;
  }

  /**
   * 获取缓存统计信息
   */
  async getStats(): Promise<{
    totalEntries: number;
    memoryUsage: number;
    oldestEntry: number | null;
    newestEntry: number | null;
    persistenceFailures: number;
    evictedEntries: number;
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
      persistenceFailures: this.persistenceFailures,
      evictedEntries: this.evictedEntries,
    };
  }
}

// 导出单例
export const enhancedCache = new EnhancedCacheManager();
