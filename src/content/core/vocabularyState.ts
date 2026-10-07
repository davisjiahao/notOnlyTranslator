import type { CEFRLevel } from '@/shared/types/mastery';
import type { MessageResponse, UserProfile } from '@/shared/types';
import { debounce, logger } from '@/shared/utils';

/**
 * 词汇状态快照与跨标签页同步
 *
 * 职责：
 * 1. 从 background（GET_USER_PROFILE / GET_CEFR_LEVEL）拉取真实词表与等级
 * 2. 监听 chrome.storage 变化（跨标签页/其他入口修改词表或等级），去抖重新同步
 * 3. 用递增令牌丢弃过期异步响应，防止旧状态覆盖新状态
 */

/**
 * 词汇状态快照
 */
export interface VocabularySnapshot {
  /** 用户 CEFR 等级 */
  userLevel: CEFRLevel;
  /** 已知词表（已规范化小写） */
  knownWords: ReadonlySet<string>;
  /** 未知/生词表（已规范化小写） */
  unknownWords: ReadonlySet<string>;
}

/**
 * 快照消费者接口（由高亮器宿主实现）
 */
export interface VocabularySnapshotApplier {
  applyVocabularySnapshot(snapshot: VocabularySnapshot): void;
}

/** 词汇量到 CEFR 等级的映射（与用户档案的估算口径一致） */
export function vocabularySizeToCEFR(vocabularySize: number): CEFRLevel {
  if (vocabularySize < 1500) return 'A1';
  if (vocabularySize < 2500) return 'A2';
  if (vocabularySize < 4000) return 'B1';
  if (vocabularySize < 6000) return 'B2';
  if (vocabularySize < 9000) return 'C1';
  return 'C2';
}

/**
 * 规范化单词集合：小写去空白并过滤空值
 */
export function normalizeWordSet(words: Iterable<string>): Set<string> {
  return new Set(
    Array.from(words, (w) => w.toLowerCase().trim()).filter(Boolean)
  );
}

/** 用户档案中与快照相关的字段 */
type ProfileLike = Pick<UserProfile, 'knownWords' | 'unknownWords' | 'estimatedVocabulary'>;

/**
 * 从用户档案与 CEFR 响应解析词汇快照（纯函数）
 */
export function snapshotFromProfile(
  profile: ProfileLike | null | undefined,
  cefr: { level?: CEFRLevel } | null | undefined
): VocabularySnapshot {
  const userLevel = cefr?.level || vocabularySizeToCEFR(profile?.estimatedVocabulary ?? 3000);
  return {
    userLevel,
    knownWords: normalizeWordSet(profile?.knownWords ?? []),
    unknownWords: normalizeWordSet((profile?.unknownWords ?? []).map((entry) => entry.word)),
  };
}

type RuntimeSend = (message: { type: string }) => Promise<MessageResponse>;

const defaultSend: RuntimeSend = (message) =>
  chrome.runtime.sendMessage(message) as Promise<MessageResponse>;

/**
 * 通过 background 消息拉取词汇快照
 * 任一关键请求失败时返回 null（调用方保持现状）
 */
export async function fetchVocabularySnapshot(
  send: RuntimeSend = defaultSend
): Promise<VocabularySnapshot | null> {
  try {
    const [profileResponse, cefrResponse] = await Promise.all([
      send({ type: 'GET_USER_PROFILE' }),
      send({ type: 'GET_CEFR_LEVEL' }),
    ]);

    if (!profileResponse.success || !profileResponse.data) {
      return null;
    }

    const cefrData = cefrResponse.success
      ? (cefrResponse.data as { level?: CEFRLevel } | undefined)
      : undefined;
    return snapshotFromProfile(
      profileResponse.data as ProfileLike,
      cefrData ?? undefined
    );
  } catch (error) {
    logger.warn('VocabularyState: 拉取词汇快照失败', error);
    return null;
  }
}

/** 触发重新同步的 storage 键（local 与 sync 区域键名不冲突，无需区分区域） */
const STORAGE_WATCH_KEYS = new Set(['knownWords', 'unknownWords', 'userProfile', 'settings']);

type StorageChangeListener = (
  changes: Record<string, unknown>,
  areaName: string
) => void;

/**
 * 词汇状态同步器
 *
 * - start/stop 管理 storage 监听（去抖）
 * - syncNow 立即同步，带过期令牌保护
 * - stop 后彻底失效（销毁语义）
 */
export class VocabularyStateSync {
  private syncToken = 0;
  private storageListener: StorageChangeListener | null = null;
  private destroyed = false;
  private readonly debouncedSync: () => void;

  constructor(
    private readonly applier: VocabularySnapshotApplier,
    private readonly fetchSnapshot: () => Promise<VocabularySnapshot | null> = fetchVocabularySnapshot,
    debounceMs = 500
  ) {
    this.debouncedSync = debounce(() => {
      if (this.destroyed) return;
      void this.syncNow();
    }, debounceMs);
  }

  /**
   * 开始监听 storage 变化（跨标签页同步入口）
   */
  start(): void {
    if (this.destroyed || this.storageListener) return;
    this.storageListener = (changes) => {
      const changedKeys = Object.keys(changes);
      if (changedKeys.some((key) => STORAGE_WATCH_KEYS.has(key))) {
        this.debouncedSync();
      }
    };
    chrome.storage.onChanged.addListener(this.storageListener);
  }

  /**
   * 停止并销毁：解绑监听，作废在途同步
   */
  stop(): void {
    this.destroyed = true;
    if (this.storageListener) {
      chrome.storage.onChanged.removeListener(this.storageListener);
      this.storageListener = null;
    }
    this.syncToken++;
  }

  /**
   * 立即同步一次。过期响应（同步期间又发起了更新的同步）会被丢弃
   */
  async syncNow(): Promise<void> {
    if (this.destroyed) return;
    const token = ++this.syncToken;
    try {
      const snapshot = await this.fetchSnapshot();
      if (this.destroyed || token !== this.syncToken) return;
      if (!snapshot) return;
      this.applier.applyVocabularySnapshot(snapshot);
    } catch (error) {
      logger.warn('VocabularyState: 同步词汇状态失败', error);
    }
  }
}
