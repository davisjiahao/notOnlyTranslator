import { useState, useEffect, useCallback } from 'react';
import { Achievement, TIER_COLORS, TIER_NAMES } from '@/shared/types/achievements';

interface AchievementNotificationProps {
  achievements: Achievement[];
  onDismiss: (achievementId: string) => void;
  onViewAll?: () => void;
  autoHideDelay?: number;
}

interface NotificationItem {
  achievement: Achievement;
  isExiting: boolean;
}

/**
 * 成就通知组件
 * 以 Toast 形式展示新解锁的成就
 */
export function AchievementNotification({
  achievements,
  onDismiss,
  onViewAll,
  autoHideDelay = 5000,
}: AchievementNotificationProps) {
  const [items, setItems] = useState<NotificationItem[]>([]);

  // 将新成就添加到通知列表
  useEffect(() => {
    setItems(prev => {
      const existingIds = new Set(prev.map(i => i.achievement.id));
      const newItems = achievements
        .filter(a => !existingIds.has(a.id))
        .map(a => ({ achievement: a, isExiting: false }));
      return [...prev, ...newItems];
    });
  }, [achievements]);

  // 自动隐藏
  useEffect(() => {
    if (items.length === 0) return;

    const timer = setTimeout(() => {
      // 标记第一个为非退出状态的开始退出动画
      setItems(prev => {
        const firstNonExiting = prev.findIndex(i => !i.isExiting);
        if (firstNonExiting >= 0) {
          const updated = [...prev];
          updated[firstNonExiting] = { ...updated[firstNonExiting], isExiting: true };
          return updated;
        }
        return prev;
      });

      // 动画完成后真正移除
      setTimeout(() => {
        setItems(prev => {
          const firstExiting = prev.findIndex(i => i.isExiting);
          if (firstExiting >= 0) {
            const achievement = prev[firstExiting].achievement;
            onDismiss(achievement.id);
            return prev.filter((_, i) => i !== firstExiting);
          }
          return prev;
        });
      }, 300);
    }, autoHideDelay);

    return () => clearTimeout(timer);
  }, [items, autoHideDelay, onDismiss]);

  const handleDismiss = useCallback((index: number) => {
    setItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], isExiting: true };
      return updated;
    });

    setTimeout(() => {
      setItems(prev => {
        const achievement = prev[index]?.achievement;
        if (achievement) {
          onDismiss(achievement.id);
        }
        return prev.filter((_, i) => i !== index);
      });
    }, 300);
  }, [onDismiss]);

  if (items.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {items.map((item, index) => (
        <NotificationToast
          key={item.achievement.id}
          item={item}
          index={index}
          totalCount={items.length}
          onDismiss={() => handleDismiss(index)}
          onViewAll={onViewAll}
        />
      ))}
    </div>
  );
}

interface NotificationToastProps {
  item: NotificationItem;
  index: number;
  totalCount: number;
  onDismiss: () => void;
  onViewAll?: () => void;
}

function NotificationToast({
  item,
  index,
  totalCount,
  onDismiss,
  onViewAll,
}: NotificationToastProps) {
  const { achievement, isExiting } = item;
  const colors = TIER_COLORS[achievement.tier];

  return (
    <div
      className={`
        pointer-events-auto
        ${isExiting ? 'animate-out slide-out-right fade-out' : 'animate-in slide-in-from-right fade-in'}
        transition-all duration-300 ease-out
      `}
      style={{
        transform: `translateY(${index * 8}px) scale(${1 - index * 0.05})`,
        opacity: 1 - index * 0.15,
        zIndex: totalCount - index,
      }}
    >
      <div className={`
        ${colors.bg} ${colors.border} border-2
        rounded-xl shadow-lg p-4 min-w-[280px] max-w-[320px]
        relative overflow-hidden
      `}>
        {/* 闪光效果 */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent
          -translate-x-full animate-shimmer" />

        <div className="flex items-start gap-3 relative">
          {/* 图标 */}
          <div className="text-3xl animate-bounce">
            {achievement.icon}
          </div>

          {/* 内容 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${colors.bg} ${colors.text}`}>
                {TIER_NAMES[achievement.tier]}
              </span>
              <span className="text-xs text-gray-500">+{achievement.points} 积分</span>
            </div>
            <h4 className={`font-bold ${colors.text} mt-1`}>
              🎉 {achievement.name}
            </h4>
            <p className="text-xs text-gray-600 mt-0.5 line-clamp-2">
              {achievement.description}
            </p>
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={onDismiss}
            className="text-gray-400 hover:text-gray-600 transition-colors -mt-1 -mr-1"
            aria-label="关闭"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 操作按钮 */}
        {index === 0 && onViewAll && (
          <div className="mt-3 pt-3 border-t border-gray-200/50">
            <button
              onClick={onViewAll}
              className={`w-full py-1.5 text-sm font-medium rounded-lg transition-colors
                ${colors.text} hover:bg-white/50`}
            >
              查看全部成就 →
            </button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(200%); }
        }
        .animate-shimmer {
          animation: shimmer 2s ease-in-out;
        }
      `}</style>
    </div>
  );
}

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
