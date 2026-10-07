import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import manifest from '../../../../public/manifest.json';
import { getOptionsUrl, HELP_URL } from '@/shared/utils/extensionPages';
import { dismissOnboarding, isOnboardingDismissed, isTranslationReady } from '@/shared/utils/onboarding';

afterEach(() => vi.unstubAllGlobals());

describe('扩展界面状态', () => {
  it('设置路径与 manifest 一致，标签参数正确编码', () => {
    vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://test/${path}` } });
    expect(getOptionsUrl()).toBe(`chrome-extension://test/${manifest.options_ui.page}`);
    expect(getOptionsUrl('vocabulary')).toBe(`chrome-extension://test/${manifest.options_ui.page}?tab=vocabulary`);
    expect(getOptionsUrl('a&b')).toContain('tab=a%26b');
    expect(HELP_URL).not.toContain('yourusername');
  });

  it('仅认可免费引擎或实际激活且已测试的配置', () => {
    expect(isTranslationReady(null)).toBe(false);
    expect(isTranslationReady(DEFAULT_SETTINGS)).toBe(false);
    expect(isTranslationReady({ ...DEFAULT_SETTINGS, apiProvider: 'free_google_translate' })).toBe(true);
    const settings = { ...DEFAULT_SETTINGS, activeApiConfigId: 'failed', apiConfigs: [
      { id: 'tested', provider: 'openai' as const, name: '成功配置', apiKey: '', createdAt: 1, tested: true },
      { id: 'failed', provider: 'openai' as const, name: '失败配置', apiKey: '', createdAt: 1, tested: false },
    ] };
    expect(isTranslationReady(settings)).toBe(false);
    expect(isTranslationReady({ ...settings, activeApiConfigId: 'tested' })).toBe(true);
  });

  it.each([true, false])('复用现有引导标记，完成状态为 %s', completed => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) });
    expect(isOnboardingDismissed()).toBe(false);
    dismissOnboarding(completed);
    expect(values.get(completed ? 'not_onboarding_completed' : 'not_onboarding_skipped')).toBe('true');
    expect(isOnboardingDismissed()).toBe(true);
  });

  it('引导标记存储失败不阻塞页面', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('拒绝访问'); }, setItem: () => { throw new Error('拒绝访问'); } });
    expect(isOnboardingDismissed()).toBe(false);
    expect(() => dismissOnboarding(false)).not.toThrow();
  });
});
