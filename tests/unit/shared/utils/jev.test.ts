import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import type { ApiProvider, UserProfile, UserSettings } from '@/shared/types';
import { getJevEligibility, JEV_REASON_LABELS } from '@/shared/utils/jev';

const profile: UserProfile = { ...DEFAULT_USER_PROFILE, estimatedVocabulary: 3000, unknownWords: [] };
const settings: UserSettings = { ...DEFAULT_SETTINGS, vocabularyAssessmentProvider: 'jev',
  phraseTranslationEnabled: false, grammarTranslationEnabled: false };

describe('Jev 实验识别范围', () => {
  it('默认及旧设置保持关闭', () => {
    expect(DEFAULT_SETTINGS.vocabularyAssessmentProvider).toBe('legacy');
    expect(getJevEligibility({ ...settings, vocabularyAssessmentProvider: undefined }, profile, 'inline-only')).toBe('disabled');
    expect(getJevEligibility(DEFAULT_SETTINGS, profile, 'inline-only')).toBe('disabled');
  });

  it.each(['openai', 'anthropic', 'gemini', 'ollama', 'custom'] as ApiProvider[])('B1纯行内支持%s释义', apiProvider => {
    expect(getJevEligibility({ ...settings, apiProvider }, profile, 'inline-only')).toBeUndefined();
  });

  it.each(['bilingual', 'full-translate'] as const)('%s显示原引擎原因', mode => {
    expect(getJevEligibility(settings, profile, mode)).toBe('unsupported-mode');
  });

  it.each(['phraseTranslationEnabled', 'grammarTranslationEnabled'] as const)('%s开启时不接管', field => {
    expect(getJevEligibility({ ...settings, [field]: true }, profile, 'inline-only')).toBe('enhancements-enabled');
  });

  it.each([0, 1000, 2000, 5000, 8000, NaN])('未校准词汇量%s不启用', estimatedVocabulary => {
    expect(getJevEligibility(settings, { ...profile, estimatedVocabulary }, 'inline-only')).toBe('unsupported-level');
  });

  it.each(['deepl', 'google_translate', 'youdao', 'free_google_translate'] as ApiProvider[])('传统引擎%s不支持候选释义', apiProvider => {
    expect(getJevEligibility({ ...settings, apiProvider }, profile, 'inline-only')).toBe('unsupported-provider');
  });

  it.each(['baidu', 'unknown-provider'] as ApiProvider[])('未验收服务%s不启用实验识别', apiProvider => {
    expect(getJevEligibility({ ...settings, apiProvider }, profile, 'inline-only')).toBe('unsupported-provider');
  });

  it('混合路由启用时保留原流程', () => {
    expect(getJevEligibility({ ...settings, hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation!, enabled: true } }, profile, 'inline-only')).toBe('unsupported-provider');
  });

  it('原因文案是固定的中文字符串', () => {
    expect(Object.keys(JEV_REASON_LABELS)).toEqual(expect.arrayContaining(['disabled', 'unsupported-mode', 'enhancements-enabled', 'unsupported-level', 'unsupported-provider']));
    expect(Object.values(JEV_REASON_LABELS).every(value => typeof value === 'string' && value.length > 0)).toBe(true);
  });
});
