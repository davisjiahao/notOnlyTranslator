import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFeedbackConfig,
  updateFeedbackConfig,
  getAllFeedbacks,
  getFeedbackById,
  queryFeedbacks,
  saveFeedback,
  deleteFeedback,
  deleteFeedbacks,
  getUnsyncedFeedbacks,
  markFeedbacksAsSynced,
  clearAllFeedbacks,
  getFeedbackStats
} from '@/shared/feedback/storage';
import { DEFAULT_FEEDBACK_CONFIG, FEEDBACK_STORAGE_KEY, FEEDBACK_CONFIG_KEY } from '@/shared/feedback/constants';
import type { Feedback, FeedbackCategory, FeedbackStatus } from '@/shared/feedback/types';

// Mock chrome API
global.chrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn()
    }
  }
} as unknown as typeof chrome;

describe('Feedback Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFeedbackConfig', () => {
    it('应该返回默认配置', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({});

      const config = await getFeedbackConfig();

      expect(config).toEqual(DEFAULT_FEEDBACK_CONFIG);
    });

    it('应该合并存储的配置', async () => {
      const storedConfig = { maxEntries: 50 };
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_CONFIG_KEY]: storedConfig
      });

      const config = await getFeedbackConfig();

      expect(config.maxEntries).toBe(50);
      expect(config.autoSync).toBe(DEFAULT_FEEDBACK_CONFIG.autoSync);
    });
  });

  describe('updateFeedbackConfig', () => {
    it('应该更新配置', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_CONFIG_KEY]: DEFAULT_FEEDBACK_CONFIG
      });

      await updateFeedbackConfig({ maxEntries: 200 });

      expect(chrome.storage.local.set).toHaveBeenCalled();
    });
  });

  describe('getAllFeedbacks', () => {
    it('应该返回空数组', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({});

      const feedbacks = await getAllFeedbacks();

      expect(feedbacks).toEqual([]);
    });

    it('应该返回所有反馈', async () => {
      const mockFeedbacks: Feedback[] = [
        {
          id: 'fb_1',
          category: 'bug' as FeedbackCategory,
          rating: 4,
          title: 'Test',
          description: 'Test description',
          createdAt: Date.now(),
          status: 'pending' as FeedbackStatus,
          synced: false
        }
      ];
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      const feedbacks = await getAllFeedbacks();

      expect(feedbacks).toHaveLength(1);
      expect(feedbacks[0].id).toBe('fb_1');
    });
  });

  describe('getFeedbackById', () => {
    it('应该根据ID返回反馈', async () => {
      const mockFeedbacks: Feedback[] = [
        {
          id: 'fb_1',
          category: 'bug',
          rating: 4,
          title: 'Test',
          description: 'Test description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        }
      ];
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      const feedback = await getFeedbackById('fb_1');

      expect(feedback).not.toBeNull();
      expect(feedback?.id).toBe('fb_1');
    });

    it('应该返回null当ID不存在', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: []
      });

      const feedback = await getFeedbackById('nonexistent');

      expect(feedback).toBeNull();
    });
  });

  describe('queryFeedbacks', () => {
    const mockFeedbacks: Feedback[] = [
      {
        id: 'fb_1',
        category: 'bug',
        rating: 4,
        title: 'Bug 1',
        description: 'Description',
        createdAt: Date.now() - 1000,
        status: 'pending',
        synced: false
      },
      {
        id: 'fb_2',
        category: 'feature',
        rating: 5,
        title: 'Feature 1',
        description: 'Description',
        createdAt: Date.now(),
        status: 'resolved',
        synced: true
      }
    ];

    it('应该按类别筛选', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      const result = await queryFeedbacks({ category: 'bug' });

      expect(result.feedbacks).toHaveLength(1);
      expect(result.feedbacks[0].category).toBe('bug');
    });

    it('应该按状态筛选', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      const result = await queryFeedbacks({ status: 'resolved' });

      expect(result.feedbacks).toHaveLength(1);
      expect(result.feedbacks[0].status).toBe('resolved');
    });

    it('应该支持分页', async () => {
      const manyFeedbacks = Array.from({ length: 25 }, (_, i) => ({
        id: `fb_${i}`,
        category: 'bug' as FeedbackCategory,
        rating: 4,
        title: `Test ${i}`,
        description: 'Description',
        createdAt: Date.now() - i * 1000,
        status: 'pending' as FeedbackStatus,
        synced: false
      }));

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: manyFeedbacks
      });

      const result = await queryFeedbacks({ limit: 10, offset: 0 });

      expect(result.feedbacks).toHaveLength(10);
      expect(result.total).toBe(25);
      expect(result.hasMore).toBe(true);
    });

    it('应该按时间倒序排序', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      const result = await queryFeedbacks();

      expect(result.feedbacks[0].id).toBe('fb_2'); // 较新的
      expect(result.feedbacks[1].id).toBe('fb_1'); // 较旧的
    });
  });

  describe('saveFeedback', () => {
    it('应该保存新反馈', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: [],
        [FEEDBACK_CONFIG_KEY]: DEFAULT_FEEDBACK_CONFIG
      });

      const newFeedback: Feedback = {
        id: 'fb_new',
        category: 'bug',
        rating: 4,
        title: 'New Feedback',
        description: 'Description',
        createdAt: Date.now(),
        status: 'pending',
        synced: false
      };

      await saveFeedback(newFeedback);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [FEEDBACK_STORAGE_KEY]: [newFeedback]
      });
    });

    it('应该更新现有反馈', async () => {
      const existingFeedback: Feedback = {
        id: 'fb_1',
        category: 'bug',
        rating: 4,
        title: 'Old Title',
        description: 'Description',
        createdAt: Date.now(),
        status: 'pending',
        synced: false
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: [existingFeedback],
        [FEEDBACK_CONFIG_KEY]: DEFAULT_FEEDBACK_CONFIG
      });

      const updatedFeedback = { ...existingFeedback, title: 'New Title' };
      await saveFeedback(updatedFeedback);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [FEEDBACK_STORAGE_KEY]: [updatedFeedback]
      });
    });
  });

  describe('deleteFeedback', () => {
    it('应该删除指定反馈', async () => {
      const mockFeedbacks: Feedback[] = [
        {
          id: 'fb_1',
          category: 'bug',
          rating: 4,
          title: 'Test',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        }
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      await deleteFeedback('fb_1');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [FEEDBACK_STORAGE_KEY]: []
      });
    });
  });

  describe('deleteFeedbacks', () => {
    it('应该批量删除反馈', async () => {
      const mockFeedbacks: Feedback[] = [
        {
          id: 'fb_1',
          category: 'bug',
          rating: 4,
          title: 'Test 1',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        },
        {
          id: 'fb_2',
          category: 'feature',
          rating: 5,
          title: 'Test 2',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        }
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      await deleteFeedbacks(['fb_1']);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [FEEDBACK_STORAGE_KEY]: [mockFeedbacks[1]]
      });
    });
  });

  describe('getUnsyncedFeedbacks', () => {
    it('应该返回未同步的反馈', async () => {
      const mockFeedbacks: Feedback[] = [
        {
          id: 'fb_1',
          category: 'bug',
          rating: 4,
          title: 'Test 1',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        },
        {
          id: 'fb_2',
          category: 'feature',
          rating: 5,
          title: 'Test 2',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: true
        }
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      const unsynced = await getUnsyncedFeedbacks();

      expect(unsynced).toHaveLength(1);
      expect(unsynced[0].id).toBe('fb_1');
    });
  });

  describe('markFeedbacksAsSynced', () => {
    it('应该标记反馈为已同步', async () => {
      const mockFeedbacks: Feedback[] = [
        {
          id: 'fb_1',
          category: 'bug',
          rating: 4,
          title: 'Test',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        }
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      await markFeedbacksAsSynced(['fb_1']);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [FEEDBACK_STORAGE_KEY]: expect.arrayContaining([
          expect.objectContaining({ id: 'fb_1', synced: true })
        ])
      });
    });
  });

  describe('clearAllFeedbacks', () => {
    it('应该清空所有反馈', async () => {
      await clearAllFeedbacks();

      expect(chrome.storage.local.remove).toHaveBeenCalledWith(FEEDBACK_STORAGE_KEY);
    });
  });

  describe('getFeedbackStats', () => {
    it('应该返回统计信息', async () => {
      const mockFeedbacks: Feedback[] = [
        {
          id: 'fb_1',
          category: 'bug',
          rating: 4,
          title: 'Test 1',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        },
        {
          id: 'fb_2',
          category: 'feature',
          rating: 5,
          title: 'Test 2',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: true
        },
        {
          id: 'fb_3',
          category: 'bug',
          rating: 3,
          title: 'Test 3',
          description: 'Description',
          createdAt: Date.now(),
          status: 'pending',
          synced: false
        }
      ];

      vi.mocked(chrome.storage.local.get).mockResolvedValue({
        [FEEDBACK_STORAGE_KEY]: mockFeedbacks
      });

      const stats = await getFeedbackStats();

      expect(stats.totalCount).toBe(3);
      expect(stats.unsyncedCount).toBe(2);
      expect(stats.categoryCounts.bug).toBe(2);
      expect(stats.categoryCounts.feature).toBe(1);
    });
  });
});
