import { describe, bench, beforeAll } from 'vitest'

// Lightweight LRU Cache implementation for benchmarking
// Mirrors the structure of EnhancedCacheManager without Chrome storage deps

interface CacheEntry {
  value: unknown
  createdAt: number
  lastAccessedAt: number
}

interface LRUListNode {
  key: string
  prev: LRUListNode | null
  next: LRUListNode | null
}

class LRUCache {
  private cache: Map<string, CacheEntry> = new Map()
  private nodeMap: Map<string, LRUListNode> = new Map()
  private head: LRUListNode | null = null
  private tail: LRUListNode | null = null
  private maxEntries: number

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries
  }

  get(key: string): unknown | null {
    const entry = this.cache.get(key)
    if (!entry) return null

    entry.lastAccessedAt = Date.now()
    this.moveToTail(key)
    return entry.value
  }

  set(key: string, value: unknown): void {
    const now = Date.now()
    const entry: CacheEntry = { value, createdAt: now, lastAccessedAt: now }

    if (this.cache.has(key)) {
      this.cache.set(key, entry)
      this.moveToTail(key)
      return
    }

    this.cache.set(key, entry)
    this.addToTail(key)

    if (this.cache.size > this.maxEntries) {
      this.evictLRU()
    }
  }

  getBatch(keys: string[]): { hits: Map<string, unknown>; misses: string[] } {
    const hits = new Map<string, unknown>()
    const misses: string[] = []
    const now = Date.now()

    for (const key of keys) {
      const entry = this.cache.get(key)
      if (entry) {
        entry.lastAccessedAt = now
        hits.set(key, entry.value)
        this.moveToTail(key)
      } else {
        misses.push(key)
      }
    }

    return { hits, misses }
  }

  private evictLRU(): void {
    if (!this.head) return

    const key = this.head.key
    const nextNode = this.head.next

    this.cache.delete(key)
    this.nodeMap.delete(key)

    this.head = nextNode
    if (this.head) {
      this.head.prev = null
    } else {
      this.tail = null
    }
  }

  private removeNode(node: LRUListNode): void {
    if (node.prev) {
      node.prev.next = node.next
    } else {
      this.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    } else {
      this.tail = node.prev
    }

    node.prev = null
    node.next = null
  }

  private moveToTail(key: string): void {
    const node = this.nodeMap.get(key)
    if (!node) return
    if (node === this.tail) return

    this.removeNode(node)
    this.addToTailNode(node)
  }

  private addToTail(key: string): void {
    const node: LRUListNode = { key, prev: null, next: null }
    this.nodeMap.set(key, node)
    this.addToTailNode(node)
  }

  private addToTailNode(node: LRUListNode): void {
    if (!this.tail) {
      this.head = node
      this.tail = node
    } else {
      node.prev = this.tail
      node.next = null
      this.tail.next = node
      this.tail = node
    }
  }

  get size(): number {
    return this.cache.size
  }
}

// ============================================================
// Benchmark: LRU Cache Operations
// ============================================================

describe('LRU Cache - O(1) Operations', () => {
  let cache: LRUCache

  beforeAll(() => {
    cache = new LRUCache(1000)
    for (let i = 0; i < 500; i++) {
      cache.set(`key_${i}`, { data: `value_${i}`, timestamp: Date.now() })
    }
  })

  bench('cache hit (existing key)', () => {
    cache.get('key_250')
  })

  bench('cache miss (non-existing key)', () => {
    cache.get('nonexistent')
  })

  bench('cache set new key', () => {
    cache.set(`new_${Date.now()}_${Math.random()}`, { data: 'test' })
  })

  bench('cache set existing key (update)', () => {
    cache.set('key_100', { data: 'updated', timestamp: Date.now() })
  })
})

describe('LRU Cache - Batch Operations', () => {
  let cache: LRUCache
  const lookupKeys: string[] = []
  const missKeys: string[] = []

  beforeAll(() => {
    cache = new LRUCache(1000)
    for (let i = 0; i < 500; i++) {
      cache.set(`key_${i}`, { data: `value_${i}` })
    }

    // Prepare 50 keys that exist
    for (let i = 0; i < 50; i++) {
      lookupKeys.push(`key_${i * 10}`)
    }

    // Prepare 10 keys that don't exist
    for (let i = 0; i < 10; i++) {
      missKeys.push(`missing_${i}`)
    }
  })

  bench('batch get 50 keys (all hits)', () => {
    cache.getBatch(lookupKeys)
  })

  bench('batch get 10 keys (all misses)', () => {
    cache.getBatch(missKeys)
  })
})

describe('LRU Cache - Eviction', () => {
  let cache: LRUCache

  beforeAll(() => {
    cache = new LRUCache(100)
    for (let i = 0; i < 100; i++) {
      cache.set(`key_${i}`, { data: `value_${i}` })
    }
  })

  bench('evict oldest (add beyond capacity)', () => {
    cache.set('overflow', { data: 'new' })
  })
})
