// 反馈存储管理模块
import type {
  Feedback,
  FeedbackStorageConfig,
  FeedbackQueryParams,
  FeedbackListResponse
} from './types';
import { FEEDBACK_STORAGE_KEY, FEEDBACK_CONFIG_KEY, DEFAULT_FEEDBACK_CONFIG } from './constants';

/**
 * 获取反馈存储配置
 */
export async function getFeedbackConfig(): Promise<FeedbackStorageConfig> {
  try {
    const result = await chrome.storage.local.get(FEEDBACK_CONFIG_KEY);
    return {
      ...DEFAULT_FEEDBACK_CONFIG,
      ...result[FEEDBACK_CONFIG_KEY]
    };
  } catch (error) {
    console.error('获取反馈配置失败:', error);
    return DEFAULT_FEEDBACK_CONFIG;
  }
}

/**
 * 更新反馈存储配置
 */
export async function updateFeedbackConfig(
  config: Partial<FeedbackStorageConfig>
): Promise<void> {
  try {
    const currentConfig = await getFeedbackConfig();
    const newConfig = { ...currentConfig, ...config };
    await chrome.storage.local.set({ [FEEDBACK_CONFIG_KEY]: newConfig });
  } catch (error) {
    console.error('更新反馈配置失败:', error);
    throw new Error('更新反馈配置失败');
  }
}

/**
 * 获取所有反馈列表
 */
export async function getAllFeedbacks(): Promise<Feedback[]> {
  try {
    const result = await chrome.storage.local.get(FEEDBACK_STORAGE_KEY);
    return result[FEEDBACK_STORAGE_KEY] || [];
  } catch (error) {
    console.error('获取反馈列表失败:', error);
    return [];
  }
}

/**
 * 根据ID获取单个反馈
 */
export async function getFeedbackById(id: string): Promise<Feedback | null> {
  try {
    const feedbacks = await getAllFeedbacks();
    return feedbacks.find(f => f.id === id) || null;
  } catch (error) {
    console.error('获取反馈详情失败:', error);
    return null;
  }
}

/**
 * 查询反馈列表
 */
export async function queryFeedbacks(
  params: FeedbackQueryParams = {}
): Promise<FeedbackListResponse> {
  try {
    let feedbacks = await getAllFeedbacks();

    // 按类型筛选
    if (params.category) {
      feedbacks = feedbacks.filter(f => f.category === params.category);
    }

    // 按状态筛选
    if (params.status) {
      feedbacks = feedbacks.filter(f => f.status === params.status);
    }

    // 按日期范围筛选
    if (params.startDate) {
      feedbacks = feedbacks.filter(f => f.createdAt >= params.startDate!);
    }
    if (params.endDate) {
      feedbacks = feedbacks.filter(f => f.createdAt <= params.endDate!);
    }

    // 按时间倒序排序
    feedbacks.sort((a, b) => b.createdAt - a.createdAt);

    const total = feedbacks.length;

    // 分页
    const offset = params.offset || 0;
    const limit = params.limit || 20;
    feedbacks = feedbacks.slice(offset, offset + limit);

    return {
      feedbacks,
      total,
      hasMore: offset + limit < total
    };
  } catch (error) {
    console.error('查询反馈列表失败:', error);
    return {
      feedbacks: [],
      total: 0,
      hasMore: false
    };
  }
}

/**
 * 保存单个反馈
 */
export async function saveFeedback(feedback: Feedback): Promise<void> {
  try {
    const feedbacks = await getAllFeedbacks();
    const existingIndex = feedbacks.findIndex(f => f.id === feedback.id);

    if (existingIndex >= 0) {
      // 更新现有反馈
      feedbacks[existingIndex] = feedback;
    } else {
      // 添加新反馈
      feedbacks.push(feedback);
    }

    // 应用存储限制
    const config = await getFeedbackConfig();
    if (feedbacks.length > config.maxEntries) {
      // 移除最旧的未同步反馈，或最旧的已同步反馈
      const sortedFeedbacks = [...feedbacks].sort((a, b) => a.createdAt - b.createdAt);
      const toRemove = sortedFeedbacks.slice(0, feedbacks.length - config.maxEntries);

      for (const item of toRemove) {
        const index = feedbacks.findIndex(f => f.id === item.id);
        if (index >= 0) {
          feedbacks.splice(index, 1);
        }
      }
    }

    await chrome.storage.local.set({ [FEEDBACK_STORAGE_KEY]: feedbacks });
  } catch (error) {
    console.error('保存反馈失败:', error);
    throw new Error('保存反馈失败');
  }
}

/**
 * 批量保存反馈
 */
export async function saveFeedbacks(feedbacks: Feedback[]): Promise<void> {
  try {
    for (const feedback of feedbacks) {
      await saveFeedback(feedback);
    }
  } catch (error) {
    console.error('批量保存反馈失败:', error);
    throw new Error('批量保存反馈失败');
  }
}

/**
 * 删除单个反馈
 */
export async function deleteFeedback(id: string): Promise<void> {
  try {
    const feedbacks = await getAllFeedbacks();
    const index = feedbacks.findIndex(f => f.id === id);

    if (index >= 0) {
      feedbacks.splice(index, 1);
      await chrome.storage.local.set({ [FEEDBACK_STORAGE_KEY]: feedbacks });
    }
  } catch (error) {
    console.error('删除反馈失败:', error);
    throw new Error('删除反馈失败');
  }
}

/**
 * 批量删除反馈
 */
export async function deleteFeedbacks(ids: string[]): Promise<void> {
  try {
    const feedbacks = await getAllFeedbacks();
    const filteredFeedbacks = feedbacks.filter(f => !ids.includes(f.id));
    await chrome.storage.local.set({ [FEEDBACK_STORAGE_KEY]: filteredFeedbacks });
  } catch (error) {
    console.error('批量删除反馈失败:', error);
    throw new Error('批量删除反馈失败');
  }
}

/**
 * 获取未同步的反馈列表
 */
export async function getUnsyncedFeedbacks(): Promise<Feedback[]> {
  try {
    const feedbacks = await getAllFeedbacks();
    return feedbacks.filter(f => !f.synced);
  } catch (error) {
    console.error('获取未同步反馈失败:', error);
    return [];
  }
}

/**
 * 标记反馈为已同步
 */
export async function markFeedbacksAsSynced(ids: string[]): Promise<void> {
  try {
    const feedbacks = await getAllFeedbacks();
    let hasChanges = false;

    for (const feedback of feedbacks) {
      if (ids.includes(feedback.id)) {
        feedback.synced = true;
        hasChanges = true;
      }
    }

    if (hasChanges) {
      await chrome.storage.local.set({ [FEEDBACK_STORAGE_KEY]: feedbacks });
    }
  } catch (error) {
    console.error('标记反馈同步状态失败:', error);
    throw new Error('标记反馈同步状态失败');
  }
}

/**
 * 清空所有反馈（谨慎使用）
 */
export async function clearAllFeedbacks(): Promise<void> {
  try {
    await chrome.storage.local.remove(FEEDBACK_STORAGE_KEY);
  } catch (error) {
    console.error('清空反馈失败:', error);
    throw new Error('清空反馈失败');
  }
}

/**
 * 获取反馈统计信息
 */
export async function getFeedbackStats(): Promise<{
  totalCount: number;
  unsyncedCount: number;
  categoryCounts: Record<string, number>;
}> {
  try {
    const feedbacks = await getAllFeedbacks();
    const unsyncedCount = feedbacks.filter(f => !f.synced).length;

    const categoryCounts: Record<string, number> = {};
    for (const feedback of feedbacks) {
      categoryCounts[feedback.category] = (categoryCounts[feedback.category] || 0) + 1;
    }

    return {
      totalCount: feedbacks.length,
      unsyncedCount,
      categoryCounts
    };
  } catch (error) {
    console.error('获取反馈统计失败:', error);
    return {
      totalCount: 0,
      unsyncedCount: 0,
      categoryCounts: {}
    };
  }
}
