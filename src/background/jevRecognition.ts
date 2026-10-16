import type { JevConfig, UserProfile } from '@/shared/types';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { TransportError } from '@/shared/utils/translationErrors';
import { buildJevRequest, parseJevResponse, JEV_MODEL, JEV_THRESHOLD, JEV_PROMPT } from '@/shared/utils/jevProtocol';
import { resolveJevConfig } from '@/shared/utils/jevConfig';
import type { JevItem } from '@/shared/utils/jevProtocol';
import { executeTransportRequest } from './translationRequest';
import type { TranslationApiRequestOptions } from './translationRequest';
import { getWordVariants, normalizeWord } from './localWordLookup';

export type JevRecognitionOptions = Pick<TranslationApiRequestOptions, 'signal' | 'timeoutMs'> & {
  config?: JevConfig;
  deadlineAt?: number;
  onRequest?: () => void;
};

export { JEV_MODEL, JEV_THRESHOLD } from '@/shared/utils/jevProtocol';
export type JevCandidate = JevItem & Readonly<{
  occurrence: number;
  position: readonly [number, number];
  forced: boolean;
  profileFingerprint: string;
}>;

const TIMEOUT_MS = 3000;
const TRANSIENT_COOLDOWN_MS = 1000;
const RATE_LIMIT_COOLDOWN_MS = 30_000;
const CACHE_LIMIT = 512;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CONCURRENCY = 2;
const digest = (value: unknown) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(value))));
const normalized = (value: string) => normalizeWord(value.normalize('NFC'));
const failure = (statusCode?: number, retryAfterMs?: number) =>
  new TransportError('unavailable', 'Jev 识别暂不可用', { statusCode, retryAfterMs, retryable: false });

let keyFingerprint: string | null = null;
let generation = new AbortController();
let cache = new Map<string, Readonly<{ score: number; expiresAt: number }>>();
let pausedStatus: number | undefined;
let cooldownUntil = 0;
let active = 0;
let waiting: readonly (() => void)[] = [];

/** 外层捕获此信号，可在后续释义阶段识别配置切换、密钥重置及同值重存。 */
export function getJevRecognitionSignal(): AbortSignal {
  return generation.signal;
}

/** 显式测试、配置或密钥变更使旧请求、缓存和暂停状态一起失效。 */
export function resetJevRecognition(): void {
  generation.abort();
  generation = new AbortController();
  keyFingerprint = null;
  cache = new Map();
  pausedStatus = undefined;
  cooldownUntil = 0;
}

function sentences(text: string): Iterable<{ segment: string; index: number }> {
  const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: string }) => {
    segment(value: string): Iterable<{ segment: string; index: number }>;
  } }).Segmenter;
  if (Segmenter) return new Segmenter('en', { granularity: 'sentence' }).segment(text);
  return Array.from(text.matchAll(/[^.!?\n]+(?:[.!?]+\s*|\n|$)/gu), match => ({ segment: match[0], index: match.index! }));
}

export function collectJevCandidates(text: string, profile: UserProfile): JevCandidate[] {
  if (typeof text !== 'string' || !profile || !Array.isArray(profile.knownWords) || !Array.isArray(profile.unknownWords) ||
    !profile.knownWords.every(word => typeof word === 'string') ||
    !profile.unknownWords.every(entry => entry && typeof entry.word === 'string')) throw failure();
  const known = new Set(profile.knownWords.map(normalized));
  const unknown = new Set(profile.unknownWords.flatMap(entry => getWordVariants(entry.word.normalize('NFC'))));
  const profileFingerprint = digest([JEV_MODEL, JEV_THRESHOLD, profile.examType, profile.examScore, profile.estimatedVocabulary,
    profile.updatedAt, [...known].sort(), [...unknown].sort()]);
  let result: JevCandidate[] = [];
  for (const { segment: sentence, index } of sentences(text)) {
    const words = [...sentence.matchAll(/(?<![\p{L}\p{N}\p{M}_])\p{Script=Latin}[\p{Script=Latin}\p{M}]*(?:['’-]\p{Script=Latin}[\p{Script=Latin}\p{M}]*)*(?![\p{L}\p{N}\p{M}_])/gu)];
    const items = words.flatMap((match, wordIndex) => {
      const target = match[0];
      if (known.has(normalized(target))) return [];
      const start = match.index!;
      return [{ id: `j${index + start}`, sentence, target, start, end: start + target.length,
        occurrence: words.slice(0, wordIndex).filter(word => word[0] === target).length,
        position: [index + start, index + start + target.length] as const,
        forced: getWordVariants(target.normalize('NFC')).some(word => unknown.has(word)), profileFingerprint }];
    });
    result = [...result, ...items];
  }
  return result;
}

function cacheKey(item: JevCandidate, config: JevConfig): string {
  return digest([config, JEV_PROMPT, 'b1-v1', item.sentence, item.target, item.start, item.end,
    item.position, item.occurrence, item.profileFingerprint]);
}

function assertAvailable(): void {
  if (pausedStatus !== undefined && cooldownUntil === Infinity) throw failure(pausedStatus);
  if (Date.now() < cooldownUntil) throw failure(pausedStatus, cooldownUntil - Date.now());
}

function recordFailure(error: unknown): void {
  if (cooldownUntil === Infinity || error instanceof TransportError && error.kind === 'cancelled') return;
  const status = error instanceof TransportError ? error.statusCode : undefined;
  const until = status === 401 || status === 403 || status === 451 ? Infinity : Date.now() + (
    status === 429 ? (error as TransportError).retryAfterMs ?? RATE_LIMIT_COOLDOWN_MS : TRANSIENT_COOLDOWN_MS
  );
  if (until > cooldownUntil) { pausedStatus = status; cooldownUntil = until; }
}

function takeSlot(signal: AbortSignal): Promise<() => void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      waiting = waiting.filter(callback => callback !== tryStart);
      signal.removeEventListener('abort', abort);
    };
    const abort = () => { cleanup(); reject(TransportError.cancelled()); };
    const tryStart = () => {
      if (signal.aborted) { abort(); return; }
      if (active >= CONCURRENCY) return;
      cleanup();
      active += 1;
      resolve(() => { active -= 1; [...waiting].forEach(callback => callback()); });
    };
    waiting = [...waiting, tryStart];
    signal.addEventListener('abort', abort, { once: true });
    tryStart();
  });
}

function batches(items: readonly JevCandidate[], config: JevConfig): JevCandidate[][] {
  let result: JevCandidate[][] = [];
  let current: JevCandidate[] = [];
  for (const item of items) {
    const next = [...current, item];
    try { buildJevRequest(next, config.model); current = next; }
    catch {
      if (!current.length) throw failure();
      result = [...result, current];
      buildJevRequest([item], config.model);
      current = [item];
    }
  }
  return current.length ? [...result, current] : result;
}

async function assessBatch(items: readonly JevCandidate[], key: string, config: JevConfig, signal: AbortSignal, keySignal: AbortSignal, onRequest?: () => void): Promise<readonly (readonly [string, number])[]> {
  const release = await takeSlot(signal);
  try {
    if (signal.aborted || keySignal.aborted) throw TransportError.cancelled();
    assertAvailable();
    const body = JSON.stringify(buildJevRequest(items, config.model));
    const serialized = await executeTransportRequest(config.apiUrl, {
      method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body,
    }, {
      signal, timeoutMs: TIMEOUT_MS, maxResponseBytes: 65_536, retry: { maxRetries: 0 }, secrets: [key], redactTexts: items.map(item => item.sentence),
      onAttemptStart: onRequest,
      onSuccess: raw => JSON.stringify(parseJevResponse(raw, items.map(item => item.id), config.model)),
    });
    if (signal.aborted || keySignal.aborted) throw TransportError.cancelled();
    const scores = JSON.parse(serialized) as Record<string, number>;
    const entries = items.map(item => [cacheKey(item, config), scores[item.id]] as const);
    cache = new Map([...cache, ...entries.map(([id, score]) => [id, { score, expiresAt: Date.now() + CACHE_TTL_MS }] as const)].slice(-CACHE_LIMIT));
    return entries;
  } catch (error) {
    if (!keySignal.aborted) recordFailure(error);
    throw error;
  } finally { release(); }
}

export async function assessJevCandidates(
  candidates: readonly JevCandidate[], key: string,
  options: JevRecognitionOptions = {},
): Promise<JevCandidate[]> {
  const config = resolveJevConfig(options.config);
  if (options.signal?.aborted) throw TransportError.cancelled();
  if (!Array.isArray(candidates) || typeof key !== 'string' || !key.trim() || /[\r\n]/u.test(key)) throw failure();
  const fingerprint = digest([key, config, JEV_PROMPT]);
  if (keyFingerprint !== fingerprint) {
    if (keyFingerprint !== null) resetJevRecognition();
    keyFingerprint = fingerprint;
  }
  if (!candidates.length) return [];
  const timeoutMs = Math.min(TIMEOUT_MS, options.timeoutMs ?? TIMEOUT_MS,
    options.deadlineAt === undefined ? TIMEOUT_MS : options.deadlineAt - Date.now());
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw TransportError.timeout(0);
  const keySignal = generation.signal;
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  keySignal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    if (new Set(candidates.map(item => item?.id)).size !== candidates.length) throw failure();
    for (const item of candidates) {
      buildJevRequest([item], config.model);
      if (!item || !/^[a-f0-9]{64}$/.test(item.profileFingerprint) || typeof item.forced !== 'boolean' ||
        !Number.isSafeInteger(item.occurrence) || item.occurrence < 0 || !Array.isArray(item.position) || item.position.length !== 2 ||
        !item.position.every(Number.isSafeInteger) || item.position[0] < 0 || item.position[1] - item.position[0] !== item.target.length) throw failure();
    }
    cache = new Map([...cache].filter(([, value]) => value.expiresAt > Date.now()));
    const cachedScores = new Map([...cache].map(([id, value]) => [id, value.score] as const));
    const pending = candidates.filter(item => !item.forced && !cachedScores.has(cacheKey(item, config)));
    const groups = batches(pending, config);
    if (groups.length) assertAvailable();
    const results = await Promise.all(groups.map(group => assessBatch(group, key, config, controller.signal, keySignal, options.onRequest)));
    if (controller.signal.aborted) throw TransportError.cancelled();
    const scores = new Map([...cachedScores, ...results.flat()]);
    return candidates.filter(item => item.forced || (scores.get(cacheKey(item, config)) ?? -1) >= config.threshold);
  } catch (error) {
    controller.abort();
    if (timedOut) {
      if (!keySignal.aborted) recordFailure(TransportError.timeout(timeoutMs));
      throw TransportError.timeout(timeoutMs);
    }
    if (options.signal?.aborted || keySignal.aborted) throw TransportError.cancelled();
    if (error instanceof TransportError) throw error;
    throw failure();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    keySignal.removeEventListener('abort', abort);
  }
}
