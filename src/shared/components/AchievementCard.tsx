import type { Achievement, AchievementProgress } from '@/shared/types/achievements';
import { TIER_COLORS, TIER_NAMES } from '@/shared/types/achievements';

interface AchievementCardProps {
  achievement: Achievement;
  progress: AchievementProgress;
  onClick?: () => void;
}

/**
 * 成就卡片组件
 * 展示单个成就的图标、名称和进度
 */
export function AchievementCard({ achievement, progress, onClick }: AchievementCardProps) {
  const colors = TIER_COLORS[achievement.tier];
  const isUnlocked = progress.isUnlocked;

  return (
    <div
      onClick={onClick}
      className={`
        relative p-4 rounded-xl border-2 transition-all cursor-pointer
        ${isUnlocked
          ? `${colors.bg} ${colors.border} hover:shadow-md`
          : 'bg-gray-50 border-gray-200 opacity-70 hover:opacity-90'
        }
      `}
    >
      {/* 新成就标记 */}
      {achievement.isNew && (
        <div className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
          NEW
        </div>
      )}

      {/* 图标和名称 */}
      <div className="flex items-start gap-3">
        <div className={`
          text-3xl p-2 rounded-lg
          ${isUnlocked ? 'bg-white/60' : 'bg-gray-200'}
        `}>
          {achievement.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-bold text-sm ${isUnlocked ? colors.text : 'text-gray-600'}`}>
            {achievement.name}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
            {achievement.description}
          </p>
        </div>
      </div>

      {/* 进度条 */}
      <div className="mt-3">
        <div className="flex justify-between text-xs mb-1">
          <span className={isUnlocked ? colors.text : 'text-gray-500'}>
            {isUnlocked ? '已解锁' : `${progress.currentValue}/${progress.targetValue}`}
          </span>
          <span className="text-gray-400">{achievement.points} 积分</span>
        </div>
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isUnlocked
                ? achievement.tier === 'platinum'
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500'
                  : achievement.tier === 'gold'
                    ? 'bg-gradient-to-r from-yellow-400 to-orange-500'
                    : achievement.tier === 'silver'
                      ? 'bg-gradient-to-r from-slate-400 to-slate-500'
                      : 'bg-gradient-to-r from-amber-500 to-amber-600'
                : 'bg-gray-400'
            }`}
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </div>

      {/* 等级标签 */}
      <div className="mt-2 flex justify-between items-center">
        <span className={`
          text-xs px-2 py-0.5 rounded-full font-medium
          ${isUnlocked ? colors.bg : 'bg-gray-200'} ${isUnlocked ? colors.text : 'text-gray-500'}
        `}>
          {TIER_NAMES[achievement.tier]}
        </span>
        {isUnlocked && achievement.unlockedAt && (
          <span className="text-xs text-gray-400">
            {new Date(achievement.unlockedAt).toLocaleDateString('zh-CN')}
          </span>
        )}
      </div>
    </div>
  );
}
