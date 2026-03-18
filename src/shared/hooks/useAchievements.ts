import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getNewAchievements,
  markAchievementAsViewed,
  recordActivityDay,
  recordTranslationCompleted,
  recordWordMarked,
  checkAndUnlockAchievements,
  type Achievement,
} from '@/shared/analytics/achievements';

interface UseAchievementsReturn {
  /** 新解锁的成就列表 */
  newAchievements: Achievement[];
  /** 是否有新成就 */
  hasNewAchievements: boolean;
  /** 标记成就已查看 */
  markAsViewed: (achievementId: string) => Promise<void>;
  /** 清除所有新成就通知 */
  clearAllNotifications: () => Promise<void>;
  /** 记录翻译完成 */
  trackTranslation: () => Promise<void>;
  /** 记录词汇标记 */
  trackWordMarked: (isKnown: boolean) => Promise<void>;
  /** 记录活跃天数 */
  trackActivity: () => Promise<void>;
}

/**
 * 成就追踪 Hook
 * 自动检测成就解锁并显示通知
 *
 * @example
 * ```tsx
 * function App() {
 *   const { newAchievements, hasNewAchievements, markAsViewed } = useAchievements();
 *
 *   return (
 *     <>
 *       {hasNewAchievements && (
 *         <AchievementNotification
 *           achievements={newAchievements}
 *           onDismiss={markAsViewed}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 */
export function useAchievements(): UseAchievementsReturn {
  const [newAchievements, setNewAchievements] = useState<Achievement[]>([]);
  const isCheckingRef = useRef(false);

  // 定期检查新成就
  useEffect(() => {
    const checkNewAchievements = async () => {
      if (isCheckingRef.current) return;
      isCheckingRef.current = true;

      try {
        const newOnes = await getNewAchievements();
        setNewAchievements(newOnes);
      } catch (error) {
        console.error('[useAchievements] Failed to check achievements:', error);
      } finally {
        isCheckingRef.current = false;
      }
    };

    // 立即检查一次
    checkNewAchievements();

    // 每30秒检查一次
    const interval = setInterval(checkNewAchievements, 30000);

    return () => clearInterval(interval);
  }, []);

  const markAsViewed = useCallback(async (achievementId: string) => {
    await markAchievementAsViewed(achievementId);
    setNewAchievements(prev => prev.filter(a => a.id !== achievementId));
  }, []);

  const clearAllNotifications = useCallback(async () => {
    for (const achievement of newAchievements) {
      await markAchievementAsViewed(achievement.id);
    }
    setNewAchievements([]);
  }, [newAchievements]);

  const trackTranslation = useCallback(async () => {
    await recordTranslationCompleted();
  }, []);

  const trackWordMarked = useCallback(async (isKnown: boolean) => {
    await recordWordMarked(isKnown);
  }, []);

  const trackActivity = useCallback(async () => {
    await recordActivityDay();
  }, []);

  return {
    newAchievements,
    hasNewAchievements: newAchievements.length > 0,
    markAsViewed,
    clearAllNotifications,
    trackTranslation,
    trackWordMarked,
    trackActivity,
  };
}

/**
 * 批量检查成就
 * 用于页面加载时一次性检查多个条件
 */
export async function checkAchievementsBatch(stats: {
  wordsMarked?: number;
  wordsKnown?: number;
  consecutiveDays?: number;
  totalTranslations?: number;
}): Promise<Achievement[]> {
  const newlyUnlocked: Achievement[] = [];

  if (stats.wordsMarked !== undefined) {
    const unlocked = await checkAndUnlockAchievements('words_marked_total', stats.wordsMarked);
    newlyUnlocked.push(...unlocked);
  }

  if (stats.wordsKnown !== undefined) {
    const unlocked = await checkAndUnlockAchievements('words_known_total', stats.wordsKnown);
    newlyUnlocked.push(...unlocked);
  }

  if (stats.consecutiveDays !== undefined) {
    const unlocked = await checkAndUnlockAchievements('consecutive_days', stats.consecutiveDays);
    newlyUnlocked.push(...unlocked);
  }

  if (stats.totalTranslations !== undefined) {
    const unlocked = await checkAndUnlockAchievements('total_translations', stats.totalTranslations);
    newlyUnlocked.push(...unlocked);
  }

  return newlyUnlocked;
}
