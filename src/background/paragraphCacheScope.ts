import type { UserProfile, UserSettings } from '@/shared/types';

/** 只参与键计算，不把配置、用户词表、语境或密钥持久化到缓存条目。 */
export interface ParagraphCacheScope {
  settings: UserSettings;
  userLevel?: UserProfile;
  context?: string;
  engine: 'llm' | 'batch' | 'deepl' | 'hybrid' | 'free_google';
}

export function paragraphCacheScope(scope: ParagraphCacheScope): string {
  const { settings, userLevel, context = '', engine } = scope;
  const activeId = settings.activeApiConfigId || settings.apiConfigs?.[0]?.id;
  const active = settings.apiConfigs?.find(config => config.id === activeId);
  const hybrid = settings.hybridTranslation;
  return JSON.stringify([
    engine, context,
    settings.apiProvider, settings.customModelName, settings.customApiUrl,
    settings.promptVersion, settings.phraseTranslationEnabled, settings.grammarTranslationEnabled,
    settings.activeApiConfigId, settings.secondaryApiKey,
    // 凭据只进入瞬时摘要输入，最终缓存键不保留密钥或其明文片段。
    active && [active.provider, active.modelName, active.apiUrl, active.apiKey, active.secondaryApiKey],
    hybrid && [hybrid.enabled, hybrid.defaultEngine, hybrid.traditionalProvider,
      hybrid.simpleTextThreshold, hybrid.enableSmartRouting, hybrid.priority, hybrid.traditionalApiKey],
    engine === 'deepl' && settings.apiConfigs?.find(config => config.provider === 'deepl')?.apiKey,
    // 所有模式均由展示层过滤已知词；词汇标记与 Bayesian 桶内微调不使段落缓存失效。
    // 新标记 unknown 词缺少释义时，等待跨桶或正文变化后重新翻译。
    userLevel && [userLevel.examType, userLevel.examScore,
      Math.floor(userLevel.estimatedVocabulary / 100) * 100],
  ]);
}
