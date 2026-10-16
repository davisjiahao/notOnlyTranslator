import type { TranslationMode, UserProfile, UserSettings } from '@/shared/types';
import { getCEFRLevelByVocabulary } from '@/shared/constants/mastery';

export const JEV_REASON_LABELS = {
  disabled: '当前使用原生词识别',
  'unsupported-mode': 'Jev 实验识别仅支持行内阅读，当前使用原识别流程',
  'enhancements-enabled': '启用短语或语法增强时使用原识别流程',
  'unsupported-level': 'Jev 实验识别目前仅校准 B1，当前使用原识别流程',
  'unsupported-provider': '当前翻译服务不支持候选词释义，使用原识别流程',
} as const;

export type JevEligibilityReason = keyof typeof JEV_REASON_LABELS;

/** 固定运行原因同时用于后台投影与界面文案，不展示服务返回的原始错误。 */
export const JEV_RUNTIME_REASON_LABELS = {
  'missing-key': '未配置 Jev 密钥，已使用原识别流程',
  'missing-permission': '未授权 Jev 站点访问，已使用原识别流程',
  unauthorized: 'Jev 密钥未通过验证，请更新密钥',
  'region-restricted': 'Jev 服务访问受限，已使用原识别流程',
  'rate-limited': 'Jev 请求受到限流，已使用原识别流程',
  timeout: 'Jev 识别超时，已使用原识别流程',
  unavailable: 'Jev 暂不可用，已使用原识别流程',
} as const;

/** 前后端共享适用范围，密钥与主机权限仍由可信后台检查。 */
export function getJevEligibility(
  settings: UserSettings,
  profile: UserProfile,
  mode: TranslationMode,
): JevEligibilityReason | undefined {
  if (settings.vocabularyAssessmentProvider !== 'jev') return 'disabled';
  if (mode !== 'inline-only') return 'unsupported-mode';
  if (settings.phraseTranslationEnabled || settings.grammarTranslationEnabled) return 'enhancements-enabled';
  if (getCEFRLevelByVocabulary(profile.estimatedVocabulary) !== 'B1') return 'unsupported-level';
  if (settings.hybridTranslation?.enabled || !['openai', 'anthropic', 'gemini', 'ollama', 'custom'].includes(settings.apiProvider)) {
    return 'unsupported-provider';
  }
  return undefined;
}
