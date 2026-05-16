import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getExperimentGroup, shouldShowWelcomeModal, trackExperimentProgress } from '@/shared/components/welcomeModalUtils';

// Mock analytics
vi.mock('@/shared/analytics/init', () => ({
  trackEvent: vi.fn(),
}));

// Mock localStorage (jsdom localStorage is incomplete)
const store: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};

vi.stubGlobal('localStorage', mockLocalStorage);

describe('welcomeModalUtils', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  describe('getExperimentGroup', () => {
    it('returns stored group A when already set', () => {
      mockLocalStorage.setItem('not_onboarding_experiment_group', 'A');
      expect(getExperimentGroup()).toBe('A');
    });

    it('returns stored group B when already set', () => {
      mockLocalStorage.setItem('not_onboarding_experiment_group', 'B');
      expect(getExperimentGroup()).toBe('B');
    });

    it('returns stored group C when already set', () => {
      mockLocalStorage.setItem('not_onboarding_experiment_group', 'C');
      expect(getExperimentGroup()).toBe('C');
    });

    it('assigns a random group and stores it when not set', () => {
      const result = getExperimentGroup();
      expect(['A', 'B', 'C']).toContain(result);
      expect(mockLocalStorage.getItem('not_onboarding_experiment_group')).toBe(result);
    });

    it('returns same group on repeated calls', () => {
      const first = getExperimentGroup();
      const second = getExperimentGroup();
      expect(first).toBe(second);
    });

    it('ignores invalid stored values and assigns new group', () => {
      mockLocalStorage.setItem('not_onboarding_experiment_group', 'D');
      const result = getExperimentGroup();
      expect(['A', 'B', 'C']).toContain(result);
    });
  });

  describe('shouldShowWelcomeModal', () => {
    it('returns true when no flags are set', () => {
      expect(shouldShowWelcomeModal()).toBe(true);
    });

    it('returns false when completed flag is set', () => {
      mockLocalStorage.setItem('not_onboarding_completed', 'true');
      expect(shouldShowWelcomeModal()).toBe(false);
    });

    it('returns false when skipped flag is set', () => {
      mockLocalStorage.setItem('not_onboarding_skipped', 'true');
      expect(shouldShowWelcomeModal()).toBe(false);
    });

    it('returns false when both flags are set', () => {
      mockLocalStorage.setItem('not_onboarding_completed', 'true');
      mockLocalStorage.setItem('not_onboarding_skipped', 'true');
      expect(shouldShowWelcomeModal()).toBe(false);
    });
  });

  describe('trackExperimentProgress', () => {
    it('calls trackEvent with correct parameters', async () => {
      const { trackEvent } = await import('@/shared/analytics/init');
      trackExperimentProgress('A', 'welcome', 'start');
      expect(trackEvent).toHaveBeenCalledWith('Onboarding_Progress', {
        experiment: 'EXP-001',
        group: 'A',
        step: 'welcome',
        action: 'start',
      });
    });

    it('includes metadata when provided', async () => {
      const { trackEvent } = await import('@/shared/analytics/init');
      trackExperimentProgress('B', 'level', 'complete', {
        nextStep: 'api',
        selectedLevel: 'intermediate',
      });
      expect(trackEvent).toHaveBeenCalledWith('Onboarding_Progress', {
        experiment: 'EXP-001',
        group: 'B',
        step: 'level',
        action: 'complete',
        nextStep: 'api',
        selectedLevel: 'intermediate',
      });
    });
  });
});
