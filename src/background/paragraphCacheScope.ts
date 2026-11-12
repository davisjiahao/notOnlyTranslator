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
    // 词表参与缓存身份：认识/生词变化后不能复用旧释义。
    // 等级桶仍保留，避免仅 Bayesian 微调之外的水平变化被词表指纹掩盖。
    userLevel && [userLevel.examType, userLevel.examScore,
      Math.floor(userLevel.estimatedVocabulary / 100) * 100,
      [...(userLevel.knownWords ?? [])].map(word => word.toLowerCase()).sort(),
      [...(userLevel.unknownWords ?? [])].flatMap(entry => typeof entry?.word === 'string' ? [entry.word.toLowerCase()] : []).sort()],
    // 仅实验识别追加身份，避免不适用的 Jev 请求与原链 join 后丢失原因；旧设置键保持兼容。
    ...(settings.vocabularyAssessmentProvider === 'jev' ? ['jev'] : []),
  ]);
}
