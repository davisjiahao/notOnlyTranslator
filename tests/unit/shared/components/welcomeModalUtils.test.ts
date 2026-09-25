/**
 * welcomeModalUtils 测试
 *
 * 覆盖实验分组分配、进度追踪、欢迎弹窗显示判断
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTrackEvent = vi.fn();
const mockStorage: Record<string, string> = {};

vi.mock('@/shared/analytics/init', () => ({
  trackEvent: (...args: any[]) => mockTrackEvent(...args),
}));

describe('welcomeModalUtils', () => {
  let utils: typeof import('@/shared/components/welcomeModalUtils');

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);

    // Mock localStorage
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
    });

    vi.resetModules();
    utils = await import('@/shared/components/welcomeModalUtils');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getExperimentGroup', () => {
    it('返回存储的实验组', () => {
      localStorage.setItem('not_onboarding_experiment_group', 'B');
      expect(utils.getExperimentGroup()).toBe('B');
    });

    it('随机分配新实验组', () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);
      const group = utils.getExperimentGroup();
      expect(['A', 'B', 'C']).toContain(group);
      expect(localStorage.getItem('not_onboarding_experiment_group')).toBe(group);
    });

    it('存储无效值时重新分配', () => {
      localStorage.setItem('not_onboarding_experiment_group', 'X');
      vi.spyOn(Math, 'random').mockReturnValue(0);
      expect(utils.getExperimentGroup()).toBe('A');
    });
  });

  describe('trackExperimentProgress', () => {
    it('追踪实验进度事件', () => {
      utils.trackExperimentProgress('A', 'welcome', 'start', { time: 100 });

      expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding_Progress', {
        experiment: 'EXP-001',
        group: 'A',
        step: 'welcome',
        action: 'start',
        time: 100,
      });
    });

    it('无 metadata 时正常工作', () => {
      utils.trackExperimentProgress('B', 'level', 'complete');

      expect(mockTrackEvent).toHaveBeenCalledWith('Onboarding_Progress', {
        experiment: 'EXP-001',
        group: 'B',
        step: 'level',
        action: 'complete',
      });
    });
  });

  describe('shouldShowWelcomeModal', () => {
    it('首次使用返回 true', () => {
      expect(utils.shouldShowWelcomeModal()).toBe(true);
    });

    it('已完成引导返回 false', () => {
      localStorage.setItem('not_onboarding_completed', 'true');
      expect(utils.shouldShowWelcomeModal()).toBe(false);
    });

    it('跳过引导返回 false', () => {
      localStorage.setItem('not_onboarding_skipped', 'true');
      expect(utils.shouldShowWelcomeModal()).toBe(false);
    });

    it('已完成且跳过返回 false', () => {
      localStorage.setItem('not_onboarding_completed', 'true');
      localStorage.setItem('not_onboarding_skipped', 'true');
      expect(utils.shouldShowWelcomeModal()).toBe(false);
    });
  });
});
