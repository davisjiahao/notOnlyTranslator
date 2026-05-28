/**
 * achievements 测试
 *
 * 覆盖成就系统所有导出函数
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadAchievementState,
  saveAchievementState,
  checkAndUnlockAchievements,
  getAchievementProgress,
  markAchievementAsViewed,
  getUnlockedAchievements,
  getNewAchievements,
  generateShareCardData,
  shareToPlatform,
  getOrCreateInviteCode,
  trackReferralClick,
  trackReferralInstall,
  recordTranslationCompleted,
  recordWordMarked,
  recordActivityDay,
} from '@/shared/analytics/achievements';
import { ACHIEVEMENT_CONFIGS } from '@/shared/types/achievements';

// Mock chrome storage
const mockSyncStore: Record<string, unknown> = {};
const mockLocalStore: Record<string, unknown> = {};

const mockChromeStorage = {
  sync: {
    get: vi.fn((keys: string | string[]) => {
      if (typeof keys === 'string') {
        return Promise.resolve({ [keys]: mockSyncStore[keys] });
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        result[key] = mockSyncStore[key];
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((data: Record<string, unknown>) => {
      Object.assign(mockSyncStore, data);
      return Promise.resolve();
    }),
  },
  local: {
    get: vi.fn((keys: string | string[]) => {
      if (typeof keys === 'string') {
        return Promise.resolve({ [keys]: mockLocalStore[keys] });
      }
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        result[key] = mockLocalStore[key];
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((data: Record<string, unknown>) => {
      Object.assign(mockLocalStore, data);
      return Promise.resolve();
    }),
  },
};

// Mock userProfile
vi.mock('@/shared/analytics/userProfile', () => ({
  getOrCreateUserId: vi.fn().mockResolvedValue('user-123'),
  loadUserProfile: vi.fn().mockResolvedValue({
    total_words_marked: 5,
    total_words_known: 3,
  }),
}));

// Mock init
vi.mock('@/shared/analytics/init', () => ({
  trackEvent: vi.fn(),
}));

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('achievements', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));

    // Clear stores
    Object.keys(mockSyncStore).forEach(k => delete mockSyncStore[k]);
    Object.keys(mockLocalStore).forEach(k => delete mockLocalStore[k]);

    vi.stubGlobal('chrome', { storage: mockChromeStorage });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('loadAchievementState', () => {
    it('无保存数据时返回初始状态', async () => {
      const state = await loadAchievementState();

      expect(state.achievements).toHaveLength(ACHIEVEMENT_CONFIGS.length);
      expect(state.totalPoints).toBe(0);
      expect(state.unlockedCount).toBe(0);
    });

    it('加载已保存的状态', async () => {
      const savedState = {
        achievements: ACHIEVEMENT_CONFIGS.map(a => ({
          ...a,
          unlockedAt: a.id === 'first_word' ? Date.now() : undefined,
          isNew: a.id === 'first_word',
        })),
        totalPoints: 10,
        unlockedCount: 1,
        lastCheckedAt: Date.now(),
      };
      mockSyncStore['not_achievements_state:user-123'] = savedState;

      const state = await loadAchievementState();

      expect(state.unlockedCount).toBe(1);
      expect(state.totalPoints).toBe(10);
    });

    it('sync 失败时回退到 local', async () => {
      mockChromeStorage.sync.get.mockRejectedValueOnce(new Error('Sync error'));

      const savedState = {
        achievements: ACHIEVEMENT_CONFIGS.map(a => ({ ...a, isNew: false })),
        totalPoints: 0,
        unlockedCount: 0,
        lastCheckedAt: Date.now(),
      };
      mockLocalStore['not_achievements_state:user-123'] = savedState;

      const state = await loadAchievementState();

      expect(state.achievements).toHaveLength(ACHIEVEMENT_CONFIGS.length);
    });
  });

  describe('saveAchievementState', () => {
    it('保存状态到 sync storage', async () => {
      const state = {
        achievements: ACHIEVEMENT_CONFIGS.map(a => ({ ...a, isNew: false })),
        totalPoints: 0,
        unlockedCount: 0,
        lastCheckedAt: Date.now(),
      };

      await saveAchievementState(state);

      expect(mockChromeStorage.sync.set).toHaveBeenCalled();
    });
  });

  describe('checkAndUnlockAchievements', () => {
    it('满足条件时解锁成就', async () => {
      const unlocked = await checkAndUnlockAchievements('words_marked_total', 5);

      expect(unlocked.length).toBeGreaterThanOrEqual(1);
      expect(unlocked.some(a => a.id === 'first_word')).toBe(true);
    });

    it('未满足条件时不解锁', async () => {
      const unlocked = await checkAndUnlockAchievements('consecutive_days', 1);

      expect(unlocked).toHaveLength(0);
    });

    it('已解锁的成就不再重复解锁', async () => {
      // 先解锁一次
      await checkAndUnlockAchievements('words_marked_total', 5);

      // 再次检查
      const unlocked = await checkAndUnlockAchievements('words_marked_total', 10);

      expect(unlocked).toHaveLength(0);
    });

    it('解锁时更新总分和计数', async () => {
      await checkAndUnlockAchievements('words_marked_total', 5);

      const state = await loadAchievementState();
      expect(state.unlockedCount).toBeGreaterThanOrEqual(1);
      expect(state.totalPoints).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getAchievementProgress', () => {
    it('返回所有成就进度', async () => {
      const progress = await getAchievementProgress();

      expect(progress).toHaveLength(ACHIEVEMENT_CONFIGS.length);
      expect(progress[0]).toHaveProperty('achievementId');
      expect(progress[0]).toHaveProperty('currentValue');
      expect(progress[0]).toHaveProperty('targetValue');
      expect(progress[0]).toHaveProperty('percentage');
      expect(progress[0]).toHaveProperty('isUnlocked');
    });

    it('进度百分比不超过 100', async () => {
      const progress = await getAchievementProgress();

      progress.forEach(p => {
        expect(p.percentage).toBeLessThanOrEqual(100);
        expect(p.percentage).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe('markAchievementAsViewed', () => {
    it('标记成就为已查看', async () => {
      // 先解锁成就
      await checkAndUnlockAchievements('words_marked_total', 5);

      await markAchievementAsViewed('first_word');

      const newAchievements = await getNewAchievements();
      expect(newAchievements).toHaveLength(0);
    });

    it('不存在的成就不报错', async () => {
      await expect(markAchievementAsViewed('nonexistent')).resolves.not.toThrow();
    });
  });

  describe('getUnlockedAchievements', () => {
    it('返回已解锁成就', async () => {
      await checkAndUnlockAchievements('words_marked_total', 5);

      const unlocked = await getUnlockedAchievements();

      expect(unlocked.length).toBeGreaterThanOrEqual(1);
    });

    it('无解锁时返回空数组', async () => {
      const unlocked = await getUnlockedAchievements();
      expect(unlocked).toHaveLength(0);
    });
  });

  describe('getNewAchievements', () => {
    it('返回新解锁未查看的成就', async () => {
      await checkAndUnlockAchievements('words_marked_total', 5);

      const newAchievements = await getNewAchievements();

      expect(newAchievements.length).toBeGreaterThanOrEqual(1);
      expect(newAchievements[0].isNew).toBe(true);
    });

    it('查看后不再返回', async () => {
      await checkAndUnlockAchievements('words_marked_total', 5);
      await markAchievementAsViewed('first_word');

      const newAchievements = await getNewAchievements();
      expect(newAchievements).toHaveLength(0);
    });
  });

  describe('generateShareCardData', () => {
    it('未解锁成就返回 null', async () => {
      const data = await generateShareCardData('first_word');
      expect(data).toBeNull();
    });

    it('生成分享卡片数据', async () => {
      await checkAndUnlockAchievements('words_marked_total', 5);

      const data = await generateShareCardData('first_word');

      expect(data).not.toBeNull();
      expect(data!.achievement.id).toBe('first_word');
      expect(data!.shareUrl).toContain('utm_source=share');
      expect(data!.inviteCode).toBeTruthy();
    });
  });

  describe('shareToPlatform', () => {
    it('生成 Twitter 分享链接', async () => {
      await checkAndUnlockAchievements('words_marked_total', 5);
      const cardData = await generateShareCardData('first_word');

      const result = await shareToPlatform('twitter', cardData!);

      expect(result.success).toBe(true);
      expect(result.platform).toBe('twitter');
      expect(result.url).toContain('twitter.com');
    });

    it('生成微博分享链接', async () => {
      await checkAndUnlockAchievements('words_marked_total', 5);
      const cardData = await generateShareCardData('first_word');

      const result = await shareToPlatform('weibo', cardData!);

      expect(result.success).toBe(true);
      expect(result.url).toContain('weibo.com');
    });
  });

  describe('getOrCreateInviteCode', () => {
    it('创建新邀请码', async () => {
      const code = await getOrCreateInviteCode();

      expect(code).toBeTruthy();
      expect(code).toContain('NOT');
    });

    it('已存在时返回已有邀请码', async () => {
      const firstCode = await getOrCreateInviteCode();
      const secondCode = await getOrCreateInviteCode();

      expect(secondCode).toBe(firstCode);
    });

    it('使用指定 userId', async () => {
      const code = await getOrCreateInviteCode('custom-user');
      expect(code).toBeTruthy();
    });
  });

  describe('trackReferralClick', () => {
    it('追踪邀请链接点击', async () => {
      await expect(trackReferralClick('NOTABC123')).resolves.not.toThrow();
    });
  });

  describe('trackReferralInstall', () => {
    it('追踪推荐安装', async () => {
      await expect(trackReferralInstall('NOTABC123')).resolves.not.toThrow();
    });
  });

  describe('recordTranslationCompleted', () => {
    it('记录翻译完成并增加计数', async () => {
      await recordTranslationCompleted();

      const result = await mockChromeStorage.local.get('not_total_translations');
      expect(result['not_total_translations']).toBe(1);
    });

    it('多次记录累积计数', async () => {
      await recordTranslationCompleted();
      await recordTranslationCompleted();

      const result = await mockChromeStorage.local.get('not_total_translations');
      expect(result['not_total_translations']).toBe(2);
    });
  });

  describe('recordWordMarked', () => {
    it('记录词汇标记', async () => {
      await expect(recordWordMarked(true)).resolves.not.toThrow();
    });

    it('记录不认识词汇', async () => {
      await expect(recordWordMarked(false)).resolves.not.toThrow();
    });
  });

  describe('recordActivityDay', () => {
    it('记录当天活跃', async () => {
      await recordActivityDay();

      const result = await mockChromeStorage.local.get('not_activity_dates');
      const dates = result['not_activity_dates'] as string[];

      expect(dates).toContain('2026-06-01');
    });

    it('同一天不重复记录', async () => {
      await recordActivityDay();
      await recordActivityDay();

      const result = await mockChromeStorage.local.get('not_activity_dates');
      const dates = result['not_activity_dates'] as string[];

      expect(dates.filter(d => d === '2026-06-01')).toHaveLength(1);
    });

    it('超过 90 天时移除最旧记录', async () => {
      // 预填充 90 天的数据（刚好到边界）
      const oldDates: string[] = [];
      for (let i = 90; i > 0; i--) {
        const date = new Date(Date.now() - i * 86400000);
        oldDates.push(date.toISOString().split('T')[0]);
      }
      mockLocalStore['not_activity_dates'] = oldDates;

      await recordActivityDay();

      const result = await mockChromeStorage.local.get('not_activity_dates');
      const dates = result['not_activity_dates'] as string[];

      // 90 个旧日期 + 1 个今天 = 91，shift 一次后 = 90
      expect(dates.length).toBe(90);
      expect(dates).toContain('2026-06-01');
    });
  });
});
