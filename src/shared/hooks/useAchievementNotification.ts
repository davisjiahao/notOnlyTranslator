import { useState, useCallback } from 'react';
import type { Achievement } from '@/shared/types/achievements';

/**
 * 简化的成就通知 Hook
 * 用于在组件中快速显示成就通知
 */
export function useAchievementNotification() {
  const [notifications, setNotifications] = useState<Achievement[]>([]);

  const showNotification = useCallback((achievement: Achievement) => {
    setNotifications(prev => {
      if (prev.some(a => a.id === achievement.id)) {
        return prev;
      }
      return [...prev, achievement];
    });
  }, []);

  const dismissNotification = useCallback((achievementId: string) => {
    setNotifications(prev => prev.filter(a => a.id !== achievementId));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    notifications,
    showNotification,
    dismissNotification,
    clearAll,
  };
}
