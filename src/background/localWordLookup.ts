/**
 * 本地单词查询与候选解析服务（local-first）
 *
 * 职责：
 * 1. 单词查词链：用户生词本（完整语境匹配）→ 语境释义缓存 → 离线词典
 * 2. 文本候选词本地筛选（生词本 / CEFR 难度 / knownWords 排除）与原句位置计算、验证
 * 3. 可注入离线词典源（数据资产 src/data/offline-dictionary.json 由数据侧准备后接入）
 *
 * 设计约束：
 * - 语境释义缓存按「词 + 语境哈希」作键，禁止跨语境混用释义
 * - 所有原文位置均在本地计算并回读验证，不信任模型生成的字符偏移
 * - 离线释义为通用义项，不代表当前语境下的精准义项（语境精准释义由模型补充）
 * - 查词不因单词等级低被拒绝：knownWords 中的词仍可手动查词
 */

import type {
  TranslationResult,
  TranslatedWord,
  UserProfile,
  UnknownWordEntry,
} from '@/shared/types';
import type { CEFRLevel } from '@/shared/types/mastery';
import { logger } from '@/shared/utils';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { getCEFRLevelByVocabulary } from '@/shared/constants/mastery';
import {
  assessWordDifficulty,
  isWordAboveLevel,
} from '@/shared/utils/vocabularyService';
// 真实离线词典（ECDICT 常用/考试子集；许可证见 src/data/ECDICT-LICENSE，构建产物含 meta.json 校验和）
import offlineDictionaryData from '@/data/offline-dictionary.json';

// ============ 类型定义 ============

/** 离线词典词条（ECDICT 数据资产契约：lemma 为小写原形） */
export interface OfflineDictionaryEntry {
  /** 通用义项，多个义项用「；」分隔 */
  translation: string;
  phonetic?: string;
  /** 常见屈折变形（如 book 的 forms 含 books/booking），用于反向索引 */
  forms?: string[];
}

/** 离线词典查询接口（可注入，便于测试与未来替换数据源） */
export interface OfflineWordSource {
  /** 按小写原形查询 */
  lookup(lemma: string): OfflineDictionaryEntry | undefined;
  /** 按屈折变形反查原形（可选，数据侧提供 forms 索引时启用） */
  findByForm?(form: string): (OfflineDictionaryEntry & { lemma?: string }) | undefined;
}

/** 单词释义来源 */
export type WordLookupSource = 'user_vocab' | 'sense_cache' | 'dictionary';

/** 单词查词结果 */
export interface WordLookupResult {
  /** 规范化原形 */
  word: string;
  /** 用户输入原文（保留大小写与标点） */
  original: string;
  translation: string;
  phonetic?: string;
  source: WordLookupSource;
  /** 是否来自用户生词本 */
  inUserVocab: boolean;
}

/** 本地候选词（位置已本地计算并验证） */
export interface LocalCandidate {
  lemma: string;
  /** 文本中的原样（保留大小写） */
  original: string;
  position: [number, number];
  /** 本地难度评估 1-10，不经模型评级 */
  difficulty: number;
  /** 本地可得的释义（生词本/语境缓存/词典），为空表示需要语境（模型）释义 */
  translation?: string;
  phonetic?: string;
  source?: WordLookupSource;
  /** 恢复时仅待模型确认是否超纲，即使有词典释义也不能直接高亮。 */
  requiresLevelAssessment?: boolean;
}

/** 本地候选解析结果 */
export interface LocalResolution {
  candidates: LocalCandidate[];
  /** 无本地释义或需要模型复核是否超纲的候选子集 */
  needsContext: LocalCandidate[];
  /** 已释义候选构成的完整结果（inline-only 场景直接可用） */
  result: TranslationResult;
}

export interface WordLookupOptions {
  userProfile?: UserProfile;
  context?: string;
  cacheScope?: string;
}

export interface LocalResolveOptions {
  context?: string;
  cacheScope?: string;
  /** 仅输出耗尽恢复使用：复核低置信度零候选，默认筛选语义不变。 */
  reassessUncertain?: boolean;
}

// ============ 模块状态 ============

/**
 * 由静态 JSON 构建默认词典源（含 forms → 原形反向索引，模块加载时构建一次）
 */
function buildJsonWordSource(
  data: Record<string, OfflineDictionaryEntry>
): OfflineWordSource {
  const formsIndex = new Map<string, OfflineDictionaryEntry & { lemma: string }>();
  for (const [lemma, entry] of Object.entries(data)) {
    const indexedEntry = { ...entry, lemma };
    for (const form of entry.forms || []) {
      const normalizedForm = normalizeWord(form);
      if (normalizedForm && !formsIndex.has(normalizedForm)) {
        formsIndex.set(normalizedForm, indexedEntry);
      }
    }
  }
  return {
    // hasOwnProperty 守卫：排除 constructor/toString 等原型继承键的误命中
    lookup: (lemma) =>
      Object.prototype.hasOwnProperty.call(data, lemma) ? data[lemma] : undefined,
    findByForm: (form) => formsIndex.get(normalizeWord(form)),
  };
}

const defaultWordSource: OfflineWordSource = buildJsonWordSource(
  offlineDictionaryData as Record<string, OfflineDictionaryEntry>
);

let offlineWordSource: OfflineWordSource | null = defaultWordSource;

/** 语境释义缓存：key = 词 + 语境哈希，跨语境不共享 */
const senseCache = new Map<string, { translation: string; createdAt: number }>();
const SENSE_CACHE_MAX = 500;

/**
 * 设置离线词典源（测试注入/未来替换数据源）；传入 null 表示无词典（全部走 fallback）
 */
export function setOfflineWordSource(source: OfflineWordSource | null): void {
  offlineWordSource = source;
}

/**
 * 恢复默认真实离线词典源（测试隔离用）
 */
export function resetOfflineWordSource(): void {
  offlineWordSource = defaultWordSource;
}

// ============ 词形归一化 ============

/**
 * 归一化单词：去首尾非字母字符并转小写（保留词内连字符）
 */
export function normalizeWord(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '').toLowerCase();
}

/**
 * 生成词形变体链（首项恒为归一化原词）
 * 保守规则：复数 -s/-es/-ies、动词 -ing/-ed（含尾双写辅音还原）
 */
export function getWordVariants(raw: string): string[] {
  const base = normalizeWord(raw);
  if (!base) return [];

  const variants = new Set<string>([base]);

  if (base.endsWith('ies') && base.length > 4) {
    variants.add(`${base.slice(0, -3)}y`);
  }
  if (base.endsWith('es') && base.length > 3) {
    variants.add(base.slice(0, -2));
  }
  if (base.endsWith('s') && base.length >= 4) {
    variants.add(base.slice(0, -1));
  }

  for (const suffix of ['ing', 'ed']) {
    if (base.endsWith(suffix) && base.length > suffix.length + 2) {
      const stem = base.slice(0, -suffix.length);
      variants.add(stem);
      variants.add(`${stem}e`);
      if (stem.length >= 3 && stem.charAt(stem.length - 1) === stem.charAt(stem.length - 2)) {
        variants.add(stem.slice(0, -1));
      }
    }
  }

  return [...variants];
}

// ============ 语境处理 ============

/** 保留完整 Unicode 及标点；不同句子即使共享背景词也不能借用旧义。 */
function normalizeContext(context?: string): string {
  return (context || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function senseCacheKey(lemma: string, context?: string, cacheScope?: string): string {
  const identity = JSON.stringify([lemma, context?.normalize('NFC') ?? '', cacheScope ?? null]);
  return `word-sense-v2_${bytesToHex(sha256(utf8ToBytes(identity)))}`;
}

/**
 * 写入语境释义缓存（按词 + 语境哈希作键，不跨语境混用）
 */
export function storeWordSense(word: string, context: string, translation: string, cacheScope?: string): void {
  const lemma = normalizeWord(word);
  if (!lemma || !translation) return;

  const key = senseCacheKey(lemma, context, cacheScope);
  if (senseCache.size >= SENSE_CACHE_MAX && !senseCache.has(key)) {
    // 淘汰最早写入的条目（Map 保持插入序）
    const oldest = senseCache.keys().next().value;
    if (oldest !== undefined) senseCache.delete(oldest);
  }
  senseCache.set(key, { translation, createdAt: Date.now() });
}

/**
 * 清空语境释义缓存（测试与用户主动重置用）
 */
export function clearWordSenseCache(): void {
  senseCache.clear();
}

function lookupSenseCache(lemma: string, context?: string, cacheScope?: string): string | undefined {
  return senseCache.get(senseCacheKey(lemma, context, cacheScope))?.translation;
}

// ============ 查词链 ============

/** 生词本义项只在完整语境一致时复用；无语境查词沿用首个匹配条目。 */
function selectUserVocabEntry(
  lemma: string,
  userProfile: UserProfile,
  context?: string
): UnknownWordEntry | null {
  const variants = new Set(getWordVariants(lemma));
  // 未填写释义的生词仍需继续查语境缓存或词典，不能阻断查词链。
  const entries = (userProfile.unknownWords || []).filter((entry) =>
    variants.has(normalizeWord(entry.word)) && typeof entry.translation === 'string' && entry.translation.trim().length > 0
  );
  if (!entries.length) return null;
  const normalizedContext = normalizeContext(context);
  if (!normalizedContext) return entries[0];
  return entries.find((entry) => normalizeContext(entry.context) === normalizedContext) ?? null;
}

function lookupInDictionary(
  raw: string,
  normalized: string
): { lemma: string; entry: OfflineDictionaryEntry } | null {
  if (!offlineWordSource) return null;

  // 1) 原形直查
  const direct = offlineWordSource.lookup(normalized);
  if (direct) return { lemma: normalized, entry: direct };

  const variants = getWordVariants(raw).slice(1);

  // 2) 屈折变形反查（词典提供 forms 索引时优先，覆盖不规则变形）
  if (offlineWordSource.findByForm) {
    for (const form of [normalized, ...variants]) {
      const byForm = offlineWordSource.findByForm(form);
      if (byForm) return { lemma: byForm.lemma ?? normalizeWord(form), entry: byForm };
    }
  }

  // 3) 变体链逐个试查（books → book、running → run）
  for (const variant of variants) {
    const hit = offlineWordSource.lookup(variant);
    if (hit) return { lemma: variant, entry: hit };
  }

  return null;
}

/**
 * 单词查词链：用户生词本（语境匹配）→ 语境释义缓存 → 离线词典
 *
 * knownWords 中的词不会被拒绝：仍走语境缓存与词典链返回通用释义。
 * 未命中返回 null，由调用方决定 fallback（LLM / 免费引擎），不伪装成功。
 */
export async function lookupWord(
  raw: string,
  opts: WordLookupOptions = {}
): Promise<WordLookupResult | null> {
  const normalized = normalizeWord(raw);
  if (!normalized) return null;

  // 1) 用户生词本（仅复用完整语境一致的旧义）
  if (opts.userProfile) {
    const entry = selectUserVocabEntry(normalized, opts.userProfile, opts.context);
    if (entry) {
      return {
        word: normalized,
        original: raw,
        translation: entry.translation,
        source: 'user_vocab',
        inUserVocab: true,
      };
    }
  }

  // 2) 语境释义缓存（词 + 语境哈希，同语境才命中）
  const sense = lookupSenseCache(normalized, opts.context, opts.cacheScope);
  if (sense) {
    return {
      word: normalized,
      original: raw,
      translation: sense,
      source: 'sense_cache',
      inUserVocab: false,
    };
  }

  // 3) 离线词典（通用义项）
  const dictHit = lookupInDictionary(raw, normalized);
  if (dictHit) {
    return {
      word: dictHit.lemma,
      original: raw,
      translation: dictHit.entry.translation,
      phonetic: dictHit.entry.phonetic,
      source: 'dictionary',
      inUserVocab: false,
    };
  }

  return null;
}

/**
 * 本地单词难度（1-10），供查词结果标注，无需模型评级
 */
export function getLocalWordDifficulty(lemma: string): number {
  const assessed = assessWordDifficulty(normalizeWord(lemma));
  return clampDifficulty(assessed.difficulty);
}

function clampDifficulty(difficulty: number): number {
  if (!Number.isFinite(difficulty)) return 5;
  return Math.min(10, Math.max(1, Math.round(difficulty)));
}

// ============ 候选解析与位置验证 ============

interface TextToken {
  text: string;
  start: number;
  end: number;
}

const WORD_TOKEN_REGEX = /[a-zA-Z]+(?:-[a-zA-Z]+)*/g;
// 词表匹配置信度最低为 0.75；更低的词形启发式不能证明恢复任务已无难词。
const RELIABLE_DIFFICULTY_CONFIDENCE = 0.75;

function tokenizeWithPositions(text: string): TextToken[] {
  const tokens: TextToken[] = [];
  WORD_TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WORD_TOKEN_REGEX.exec(text)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

/** 位置回读验证：切片必须与词条一致才可信 */
function verifyPosition(text: string, token: TextToken, lemma: string): [number, number] | null {
  const slice = text.slice(token.start, token.end);
  return slice.toLowerCase() === lemma ? [token.start, token.end] : null;
}

/**
 * 本地候选解析：
 * 1. knownWords 永不入选（用户明确认识），但不影响单独查词
 * 2. 生词本词强制入选（优先级最高），携带条目释义
 * 3. 其余词按本地 CEFR 难度评估，超纲才入选
 * 4. 超纲词依次查语境缓存、离线词典；仍无释义才进入 needsContext（需模型）
 */
export function resolveLocalCandidates(
  text: string,
  userProfile: UserProfile,
  opts: LocalResolveOptions = {}
): LocalResolution {
  const candidates: LocalCandidate[] = [];
  if (!text || typeof text !== 'string') {
    return finishResolution(text || '', candidates);
  }

  const knownWords = new Set((userProfile.knownWords || []).map((w) => normalizeWord(w)));
  const unknownWords = new Set((userProfile.unknownWords || []).flatMap((entry) => getWordVariants(entry.word)));
  const userLevel: CEFRLevel = getCEFRLevelByVocabulary(userProfile.estimatedVocabulary);
  const seen = new Set<string>();

  for (const token of tokenizeWithPositions(text)) {
    const lemma = normalizeWord(token.text);
    if (lemma.length < 2 || seen.has(lemma)) continue;
    seen.add(lemma);

    if (knownWords.has(lemma)) continue;

    const position = verifyPosition(text, token, lemma);
    if (!position) continue;

    // 生词本强制入选（含释义），优先级高于难度评估
    const vocabEntry = selectUserVocabEntry(lemma, userProfile, opts.context);
    if (vocabEntry) {
      candidates.push({
        lemma,
        original: token.text,
        position,
        difficulty: getLocalWordDifficulty(lemma),
        translation: vocabEntry.translation,
        source: 'user_vocab',
      });
      continue;
    }

    // 已标记未知的词即使旧释义不适合当前语境，仍须入选
    const isUnknown = getWordVariants(lemma).some((variant) => unknownWords.has(variant));
    const assessed = assessWordDifficulty(lemma);
    const requiresLevelAssessment = !isUnknown && !isWordAboveLevel(assessed.level, userLevel);
    if (requiresLevelAssessment && !(opts.reassessUncertain && userLevel !== 'C2'
      && !assessed.isCommon && assessed.confidence < RELIABLE_DIFFICULTY_CONFIDENCE)) continue;
    const assessmentFlag = requiresLevelAssessment ? { requiresLevelAssessment: true } : {};

    // 未匹配旧释义时查同语境缓存与通用词典，仍无释义才需要模型
    const sense = lookupSenseCache(lemma, opts.context, opts.cacheScope);
    if (sense) {
      candidates.push({
        lemma,
        original: token.text,
        position,
        difficulty: clampDifficulty(assessed.difficulty),
        translation: sense,
        source: 'sense_cache',
        ...assessmentFlag,
      });
      continue;
    }

    const dictHit = lookupInDictionary(token.text, lemma);
    candidates.push({
      lemma,
      original: token.text,
      position,
      difficulty: clampDifficulty(assessed.difficulty),
      translation: dictHit?.entry.translation,
      phonetic: dictHit?.entry.phonetic,
      source: dictHit ? 'dictionary' : undefined,
      ...assessmentFlag,
    });
  }

  logger.info(`LocalWordLookup: 本地候选解析完成，${candidates.length} 个候选，${candidates.filter((c) => !c.translation || c.requiresLevelAssessment).length} 个需语境释义或等级复核`);
  return finishResolution(text, candidates);
}

function finishResolution(text: string, candidates: LocalCandidate[]): LocalResolution {
  return {
    candidates,
    needsContext: candidates.filter((c) => !c.translation || c.requiresLevelAssessment),
    result: buildLocalTranslationResult(text, candidates),
  };
}

/**
 * 由已释义候选构建结果（inline-only 场景：仅词表，无全文）
 */
export function buildLocalTranslationResult(_text: string, candidates: LocalCandidate[]): TranslationResult {
  const words: TranslatedWord[] = candidates
    .filter((c) => !!c.translation && !c.requiresLevelAssessment)
    .map((c) => ({
      original: c.original,
      translation: c.translation as string,
      position: c.position,
      difficulty: c.difficulty,
      isPhrase: false,
      ...(c.phonetic ? { phonetic: c.phonetic } : {}),
    }));

  const result: TranslationResult = {
    words,
    sentences: [],
    grammarPoints: [],
  };
  return markLocalSource(result);
}

/**
 * 返回带本地来源的新结果，保留调用方对象不变。
 */
export function markLocalSource(result: TranslationResult): TranslationResult {
  return { ...result, _source: 'local' };
}
