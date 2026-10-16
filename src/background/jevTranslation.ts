import type { JevConfig, TranslationResult, UserProfile, UserSettings } from '@/shared/types';
import { getJevPermissionOrigin, resolveJevConfig } from '@/shared/utils/jevConfig';
import { extractJsonFromResponse } from '@/shared/utils';
import { TransportError } from '@/shared/utils/translationErrors';
import { StorageManager } from './storage';
import { TranslationApiService } from './translationApi';
import { TRANSPORT_DEFAULTS } from './translationRequest';
import type { TranslationApiRequestOptions } from './translationRequest';
import { getJevApiKey } from './jevCredentials';
import { collectJevCandidates, assessJevCandidates, getJevRecognitionSignal } from './jevRecognition';
import type { JevCandidate } from './jevRecognition';
import { getLocalWordDifficulty } from './localWordLookup';

export class JevConfigChangedError extends Error {}

/** 仅识别阶段失败可回退；校验闭包使回退也受原快照约束。 */
export class JevAssessmentError extends Error {
  constructor(
    public readonly reason = 'unavailable',
    public readonly apiCallCount = 0,
    public readonly assertCurrent: () => Promise<void> = async () => {},
    public readonly signal?: AbortSignal,
  ) { super('Jev 识别暂不可用'); }
}

let lastAssessment: (NonNullable<TranslationResult['vocabularyAssessment']> & { at: number }) | undefined;
export function getLastJevAssessment(): typeof lastAssessment {
  return lastAssessment ? { ...lastAssessment } : undefined;
}
export function clearLastJevAssessment(): void {
  lastAssessment = undefined;
}
export function recordJevAssessment(assessment: NonNullable<TranslationResult['vocabularyAssessment']>): void {
  lastAssessment = { ...assessment, at: Date.now() };
}

export interface JevReadingInput {
  text: string;
  context?: string;
  profile: UserProfile;
  settings: UserSettings;
  apiKey: string;
  snapshot?: JevSnapshot;
  generationSignal?: AbortSignal;
}
export interface JevReadingOptions extends Pick<TranslationApiRequestOptions, 'signal' | 'timeoutMs'> {
  deadlineAt?: number;
}
export interface JevReadingOutcome { result: TranslationResult; apiCallCount: number }
export interface JevSnapshot {
  readonly config: JevConfig;
  readonly jevKey: string | null;
  readonly fingerprint: string;
  readonly signal: AbortSignal;
}

/** 原始配置/密钥/词表仅保留于在途内存，绝不持久化或记录。 */
function fingerprintOf(settings: UserSettings, apiKey: string, profile: UserProfile, jevKey: string | null): string {
  return JSON.stringify([settings, apiKey, profile, jevKey]);
}
export async function createJevSnapshot(input: Omit<JevReadingInput, 'text' | 'context' | 'snapshot'>): Promise<JevSnapshot> {
  const signal = input.generationSignal ?? getJevRecognitionSignal();
  try {
    if (signal.aborted) throw new JevConfigChangedError();
    const config = resolveJevConfig(input.settings.jevConfig);
    const jevKey = await getJevApiKey(config);
    if (signal.aborted) throw new JevConfigChangedError();
    return { config, jevKey, fingerprint: fingerprintOf(input.settings, input.apiKey, input.profile, jevKey), signal };
  } catch { throw new JevConfigChangedError('Jev 凭据状态不可用'); }
}
export async function assertJevSnapshotCurrent(snapshot: JevSnapshot): Promise<void> {
  try {
    if (snapshot.signal.aborted) throw new JevConfigChangedError();
    const settings = await StorageManager.getSettings();
    if (snapshot.signal.aborted) throw new JevConfigChangedError();
    const config = resolveJevConfig(settings.jevConfig);
    const [profile, apiKey, jevKey] = await Promise.all([
      StorageManager.getUserProfile(), StorageManager.getApiKey(settings), getJevApiKey(config),
    ]);
    if (snapshot.signal.aborted) throw new JevConfigChangedError();
    // 凭据读取可能让出事件循环，再读取配置与词表才能覆盖该等待窗口的切换。
    const [latestSettings, latestProfile] = await Promise.all([
      StorageManager.getSettings(), StorageManager.getUserProfile(),
    ]);
    if (snapshot.signal.aborted || fingerprintOf(settings, apiKey, profile, jevKey) !== snapshot.fingerprint
      || JSON.stringify([settings, profile]) !== JSON.stringify([latestSettings, latestProfile])) {
      throw new JevConfigChangedError('Jev 配置或词表已变化');
    }
  } catch { throw new JevConfigChangedError('Jev 配置或词表已变化'); }
}

/** 总截止信号贯穿识别、释义和回退；子识别的 3 秒预算独立处理。 */
export function createJevBudget(settings: UserSettings, options: JevReadingOptions = {}) {
  const timeoutMs = options.timeoutMs ?? (settings.apiProvider === 'ollama'
    ? TRANSPORT_DEFAULTS.localLlmTimeoutMs : TRANSPORT_DEFAULTS.llmTimeoutMs);
  const deadlineAt = options.deadlineAt ?? Date.now() + timeoutMs;
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(TransportError.timeout(timeoutMs)), Math.max(0, deadlineAt - Date.now()));
  return {
    signal: controller.signal, deadlineAt,
    check() {
      options.signal?.throwIfAborted();
      if (Date.now() >= deadlineAt) throw TransportError.timeout(timeoutMs);
      controller.signal.throwIfAborted();
    },
    remaining() { this.check(); return deadlineAt - Date.now(); },
    dispose() { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); },
  };
}

function runtimeReason(error: unknown): string {
  if (!(error instanceof TransportError)) return 'unavailable';
  if (error.kind === 'timeout') return 'timeout';
  if (error.statusCode === 401 || error.statusCode === 403) return 'unauthorized';
  if (error.statusCode === 451) return 'region-restricted';
  if (error.statusCode === 429) return 'rate-limited';
  return 'unavailable';
}

/** 每个入选 occurrence ID 必须恰有一条非空释义，不能按词形猜测归属。 */
function parseGlosses(content: string, selected: readonly JevCandidate[]): Map<string, string> {
  try {
    const parsed = JSON.parse(extractJsonFromResponse(content) || 'null') as { words?: unknown } | null;
    if (!parsed || !Array.isArray(parsed.words) || parsed.words.length !== selected.length) throw new Error();
    const allowed = new Set(selected.map(item => item.id));
    const glosses = new Map<string, string>();
    for (const item of parsed.words) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error();
      const { id, translation } = item as Record<string, unknown>;
      if (typeof id !== 'string' || !allowed.has(id) || glosses.has(id)
        || typeof translation !== 'string' || !translation.trim()) throw new Error();
      glosses.set(id, translation.trim());
    }
    return glosses;
  } catch { throw new Error('模型未返回有效的语境释义，请重试'); }
}

/** Jev 只筛选；原 LLM 只释义入选 ID，坐标始终来自本地，不读写旧段落缓存。 */
export async function translateJevReading(
  input: JevReadingInput, options: JevReadingOptions = {},
): Promise<JevReadingOutcome> {
  const budget = createJevBudget(input.settings, options);
  try {
    budget.check();
    const snapshot = input.snapshot ?? await createJevSnapshot(input);
    const signal = AbortSignal.any([budget.signal, snapshot.signal]);
    const assertCurrent = async () => {
      budget.check();
      await assertJevSnapshotCurrent(snapshot);
      budget.check();
      if (snapshot.signal.aborted) throw new JevConfigChangedError('Jev 请求代际已变化');
    };
    const finish = async (words: TranslationResult['words'], apiCallCount: number): Promise<JevReadingOutcome> => {
      await assertCurrent();
      signal.throwIfAborted();
      const assessment = { provider: 'jev' as const };
      recordJevAssessment(assessment);
      return { result: { words, sentences: [], vocabularyAssessment: assessment }, apiCallCount };
    };
    await assertCurrent();
    const candidates = collectJevCandidates(input.text, input.profile);
    if (!candidates.length) return await finish([], 0);
    if (!snapshot.jevKey) throw new JevAssessmentError('missing-key', 0, assertCurrent, snapshot.signal);
    let permitted = false;
    try { permitted = await chrome.permissions.contains({ origins: [getJevPermissionOrigin(snapshot.config)] }); } catch { /* 权限读取失败按未授权处理。 */ }
    await assertCurrent();
    if (!permitted) throw new JevAssessmentError('missing-permission', 0, assertCurrent, snapshot.signal);
    let apiCallCount = 0;
    let selected: JevCandidate[];
    try {
      selected = await assessJevCandidates(candidates, snapshot.jevKey, {
        config: snapshot.config, signal, timeoutMs: budget.remaining(), deadlineAt: budget.deadlineAt,
        onRequest: () => { apiCallCount += 1; },
      });
    } catch (error) {
      await assertCurrent();
      // 核心代际取消不能降级到旧链；用户与总截止已由 assertCurrent 中的 budget.check 排除。
      if (error instanceof TransportError && error.kind === 'cancelled') throw new JevConfigChangedError('Jev 请求代际已变化');
      throw new JevAssessmentError(runtimeReason(error), apiCallCount, assertCurrent, snapshot.signal);
    }
    await assertCurrent();
    if (!selected.length) return await finish([], apiCallCount);
    if (!input.apiKey && input.settings.apiProvider !== 'ollama') throw new Error('请先配置翻译服务后重试');
    const systemPrompt = '你是英语语境词义助手。仅为给定 occurrence ID 的 target 提供该 sentence 中的简短中文释义。每个 ID 恰好返回一次，禁止添加其他 ID、重新识别生词、输出位置或全文翻译。只输出 JSON：{"words":[{"id":"j0","translation":"语境释义"}]}。';
    const items = selected.map(({ id, sentence, target, start, end }) => ({ id, sentence, target, start, end }));
    const userPrompt = `候选词：\n${JSON.stringify(items)}${input.context ? `\n上下文：\n${input.context}` : ''}`;
    // 无重试使释义统计精确，也避免释义失败重新识别整段。
    let content: string;
    try {
      content = await TranslationApiService.callWithSystem(
        systemPrompt, userPrompt, input.apiKey, input.settings, { maxRetries: 0 },
        { signal, timeoutMs: budget.remaining() },
      );
    } catch (error) {
      await assertCurrent();
      throw error;
    }
    apiCallCount += 1;
    await assertCurrent();
    const glosses = parseGlosses(content, selected);
    const words = selected.map(candidate => ({
      original: candidate.target, translation: glosses.get(candidate.id)!,
      position: [candidate.position[0], candidate.position[1]] as [number, number],
      difficulty: getLocalWordDifficulty(candidate.target), isPhrase: false,
    }));
    return await finish(words, apiCallCount);
  } finally { budget.dispose(); }
}
