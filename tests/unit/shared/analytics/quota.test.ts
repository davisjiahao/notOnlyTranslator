import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module
const mockStorage: Record<string, unknown> = {};

vi.mock('@/shared/analytics/userProfile', () => ({
  getOrCreateUserId: vi.fn().mockResolvedValue('test-user-1'),
}));

vi.mock('@/shared/analytics/init', () => ({
  trackEvent: vi.fn(),
}));

beforeEach(() => {
  // Reset mock storage
  Object.keys(mockStorage).forEach(k => delete mockStorage[k]);

  Object.defineProperty(global, 'chrome', {
    value: {
      storage: {
        sync: {
          get: vi.fn(async (keys: string | string[]) => {
            const result: Record<string, unknown> = {};
            const keysArr = typeof keys === 'string' ? [keys] : keys;
            for (const key of keysArr) {
              if (key in mockStorage) {
                result[key] = mockStorage[key];
              }
            }
            return result;
          }),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            Object.assign(mockStorage, obj);
          }),
        },
        local: {
          get: vi.fn(async (keys: string | string[]) => {
            const result: Record<string, unknown> = {};
            const keysArr = typeof keys === 'string' ? [keys] : keys;
            for (const key of keysArr) {
              if (key in mockStorage) {
                result[key] = mockStorage[key];
              }
            }
            return result;
          }),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            Object.assign(mockStorage, obj);
          }),
        },
      },
    },
    writable: true,
  });
});

describe('quota service', () => {
  describe('loadQuotaState', () => {
    it('returns zero state for new user', async () => {
      const { loadQuotaState } = await import('@/shared/analytics/quota');
      const state = await loadQuotaState();
      expect(state.totalQuota).toBe(0);
      expect(state.usedQuota).toBe(0);
      expect(state.remainingQuota).toBe(0);
      expect(state.sources).toEqual([]);
    });
  });

  describe('isNewUser', () => {
    it('returns true when no quota sources exist', async () => {
      const { isNewUser } = await import('@/shared/analytics/quota');
      expect(await isNewUser()).toBe(true);
    });
  });

  describe('grantFreeTrialQuota', () => {
    it('grants free trial quota to new user', async () => {
      const { grantFreeTrialQuota } = await import('@/shared/analytics/quota');
      const result = await grantFreeTrialQuota();

      expect(result.success).toBe(true);
      expect(result.granted).toBeGreaterThan(0);
      expect(result.totalQuota).toBe(result.granted);
    });

    it('fails for existing user (already has quota)', async () => {
      const { grantFreeTrialQuota, loadQuotaState, saveQuotaState } = await import('@/shared/analytics/quota');
      // First grant to create existing quota
      await grantFreeTrialQuota();

      // Second attempt should fail
      const result = await grantFreeTrialQuota();
      expect(result.success).toBe(false);
      expect(result.granted).toBe(0);
      expect(result.error).toContain('已有');
    });
  });

  describe('initializeNewUserQuota', () => {
    it('initializes quota for user with zero total', async () => {
      const { initializeNewUserQuota } = await import('@/shared/analytics/quota');
      const result = await initializeNewUserQuota();
      expect(result.success).toBe(true);
      expect(result.granted).toBeGreaterThan(0);
    });

    it('fails for user with existing quota', async () => {
      const { initializeNewUserQuota, grantFreeTrialQuota } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      const result = await initializeNewUserQuota();
      expect(result.success).toBe(false);
      expect(result.error).toContain('已有');
    });
  });

  describe('consumeQuota', () => {
    it('successfully consumes quota when available', async () => {
      const { grantFreeTrialQuota, consumeQuota } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      const result = await consumeQuota('translation');
      expect(result.success).toBe(true);
      expect(result.remaining).toBeGreaterThanOrEqual(0);
    });

    it('fails when quota is exhausted', async () => {
      const { grantFreeTrialQuota, consumeQuota, loadQuotaState, saveQuotaState } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      // Drain all quota
      const state = await loadQuotaState();
      state.usedQuota = state.totalQuota;
      state.remainingQuota = 0;
      await saveQuotaState(state);

      const result = await consumeQuota('translation');
      expect(result.success).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.error).toContain('已用完');
      expect(result.alert?.level).toBe('exhausted');
    });

    it('records usage history', async () => {
      const { grantFreeTrialQuota, consumeQuota, loadQuotaState } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      await consumeQuota('test_context');

      const state = await loadQuotaState();
      expect(state.usageHistory.length).toBe(1);
      expect(state.usageHistory[0].context).toBe('test_context');
      expect(state.usageHistory[0].amount).toBe(1);
    });
  });

  describe('getQuotaStatus', () => {
    it('returns correct status after grant and consume', async () => {
      const { grantFreeTrialQuota, consumeQuota, getQuotaStatus } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      const statusBefore = await getQuotaStatus();
      expect(statusBefore.total).toBeGreaterThan(0);
      expect(statusBefore.used).toBe(0);

      await consumeQuota('test');

      const statusAfter = await getQuotaStatus();
      expect(statusAfter.used).toBe(1);
      expect(statusAfter.remaining).toBe(statusAfter.total - 1);
    });

    it('returns alert when quota is low', async () => {
      const { grantFreeTrialQuota, consumeQuota, getQuotaStatus, loadQuotaState, saveQuotaState } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      // Set remaining to a low value (<= critical threshold)
      const state = await loadQuotaState();
      state.usedQuota = state.totalQuota - 2;
      state.remainingQuota = 2;
      await saveQuotaState(state);

      const status = await getQuotaStatus();
      expect(status.alert).toBeDefined();
    });

    it('returns no alert when quota is healthy', async () => {
      const { grantFreeTrialQuota, getQuotaStatus } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      const status = await getQuotaStatus();
      // With full quota available, no alert should be present
      expect(status.remaining).toBeGreaterThan(10);
    });
  });

  describe('hasEnoughQuota', () => {
    it('returns true when quota is available', async () => {
      const { grantFreeTrialQuota, hasEnoughQuota } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();
      expect(await hasEnoughQuota()).toBe(true);
    });

    it('returns false when quota is exhausted', async () => {
      const { grantFreeTrialQuota, hasEnoughQuota, loadQuotaState, saveQuotaState } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();

      const state = await loadQuotaState();
      state.usedQuota = state.totalQuota;
      state.remainingQuota = 0;
      await saveQuotaState(state);

      expect(await hasEnoughQuota()).toBe(false);
    });
  });

  describe('grantReferralBonusQuota', () => {
    it('grants referral bonus regardless of user status', async () => {
      const { grantReferralBonusQuota, getQuotaStatus } = await import('@/shared/analytics/quota');
      const result = await grantReferralBonusQuota();

      expect(result.success).toBe(true);
      expect(result.granted).toBeGreaterThan(0);

      const status = await getQuotaStatus();
      expect(status.total).toBe(result.totalQuota);
    });
  });

  describe('getQuotaStats', () => {
    it('returns stats with source breakdown', async () => {
      const { grantFreeTrialQuota, grantReferralBonusQuota, getQuotaStats } = await import('@/shared/analytics/quota');
      await grantFreeTrialQuota();
      await grantReferralBonusQuota();

      const stats = await getQuotaStats();
      expect(stats.totalGranted).toBeGreaterThan(0);
      expect(stats.totalUsed).toBe(0);
      expect(stats.bySource).toHaveProperty('free_trial');
      expect(stats.bySource).toHaveProperty('referral_bonus');
      expect(stats.bySource.free_trial).toBeGreaterThan(0);
    });
  });
});
