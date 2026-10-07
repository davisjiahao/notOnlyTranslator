import type { UserSettings } from '@/shared/types';

/** 免费引擎不需要密钥；付费引擎必须检查实际激活的配置。 */
export function isTranslationReady(settings: UserSettings | null): boolean {
  return settings?.apiProvider === 'free_google_translate' || !!settings?.apiConfigs?.some(
    config => config.id === settings.activeApiConfigId && config.tested
  );
}

/** 复用设置页已有的引导标记，不增加同步存储字段。 */
export function isOnboardingDismissed(): boolean {
  try {
    return !!(localStorage.getItem('not_onboarding_completed') || localStorage.getItem('not_onboarding_skipped'));
  } catch {
    return false;
  }
}

export function dismissOnboarding(completed: boolean): void {
  try {
    localStorage.setItem(completed ? 'not_onboarding_completed' : 'not_onboarding_skipped', 'true');
  } catch {
    // 存储不可用时仍允许本次退出引导，不阻塞阅读。
  }
}
