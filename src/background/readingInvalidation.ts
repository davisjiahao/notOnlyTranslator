/**
 * 阅读上下文失效。
 *
 * 翻译模式、个人词表、翻译配置或 API 密钥变化后，在途请求必须中止，
 * 已缓存译文也不能再被后续请求命中。
 */

const TRANSLATION_FIELDS = [
  'translationMode',
  'apiProvider',
  'customApiUrl',
  'customModelName',
  'promptVersion',
  'phraseTranslationEnabled',
  'grammarTranslationEnabled',
  'apiConfigs',
  'activeApiConfigId',
  'secondaryApiKey',
  'hybridTranslation',
  'vocabularyAssessmentProvider',
  'jevConfig',
] as const;

const PROFILE_FIELDS = ['examType', 'examScore', 'estimatedVocabulary', 'knownWords', 'unknownWords'] as const;

export interface ReadingInvalidationHooks {
  /** 同步中止在途翻译与批次合并。缓存代际必须已经推进。 */
  abortTranslations: () => void;
  /** 第一行同步推进缓存代际，再清理持久化译文。 */
  clearCaches: () => Promise<void>;
}

const idleHooks: ReadingInvalidationHooks = {
  abortTranslations() {},
  clearCaches: async () => {},
};

let hooks: ReadingInvalidationHooks = idleHooks;
let clearing: Promise<void> = Promise.resolve();

export function configureReadingInvalidation(next: ReadingInvalidationHooks): void {
  hooks = next;
}

export function resetReadingInvalidationForTests(): void {
  hooks = idleHooks;
  clearing = Promise.resolve();
}

function identity(value: unknown, fields: readonly string[]): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const record = value as Record<string, unknown>;
  return JSON.stringify(fields.map(field => record[field]));
}

function changed(before: unknown, after: unknown, fields: readonly string[]): boolean {
  return identity(before, fields) !== identity(after, fields);
}

/** 只关心会影响译文内容的存储变化，外观设置不使缓存失效。 */
export function readingContextChanged(
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string,
): boolean {
  if (area === 'sync') {
    if (Object.prototype.hasOwnProperty.call(changes, 'settings')
      && changed(changes.settings?.oldValue, changes.settings?.newValue, TRANSLATION_FIELDS)) return true;
    if (Object.prototype.hasOwnProperty.call(changes, 'userProfile')
      && changed(changes.userProfile?.oldValue, changes.userProfile?.newValue, PROFILE_FIELDS)) return true;
    if (Object.prototype.hasOwnProperty.call(changes, 'apiKey')
      && JSON.stringify(changes.apiKey?.oldValue) !== JSON.stringify(changes.apiKey?.newValue)) return true;
    if (Object.prototype.hasOwnProperty.call(changes, 'legacyApiKeyInvalidated')
      && JSON.stringify(changes.legacyApiKeyInvalidated?.oldValue) !== JSON.stringify(changes.legacyApiKeyInvalidated?.newValue)) {
      return true;
    }
  }
  if (area === 'local') {
    for (const key of ['knownWords', 'unknownWords']) {
      if (Object.prototype.hasOwnProperty.call(changes, key)
        && JSON.stringify(changes[key]?.oldValue) !== JSON.stringify(changes[key]?.newValue)) return true;
    }
  }
  return false;
}

/** 先推进缓存代际，再中止在途请求，避免旧响应在失效后写入。 */
export function invalidateReadingContext(): void {
  const clear = hooks.clearCaches();
  hooks.abortTranslations();
  clearing = clearing.then(() => clear).catch(() => undefined);
}

export function settleReadingInvalidation(): Promise<void> {
  return clearing;
}
