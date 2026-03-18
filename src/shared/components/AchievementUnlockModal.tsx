import { useState, useEffect } from 'react';
import { Achievement, TIER_COLORS, TIER_NAMES } from '@/shared/types/achievements';

interface AchievementUnlockModalProps {
  achievement: Achievement;
  onClose: () => void;
  onShare?: () => void;
}

/**
 * 成就解锁弹窗组件
 * 展示成就解锁的庆祝效果
 */
export function AchievementUnlockModal({
  achievement,
  onClose,
  onShare,
}: AchievementUnlockModalProps) {
  const [showConfetti, setShowConfetti] = useState(true);
  const colors = TIER_COLORS[achievement.tier];
  const isUnlocked = !!achievement.unlockedAt;

  // 5秒后隐藏 confetti
  useEffect(() => {
    const timer = setTimeout(() => setShowConfetti(false), 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      {/* Confetti 效果 */}
      {showConfetti && isUnlocked && <ConfettiAnimation />}

      <div className={`
        relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-8
        animate-in fade-in zoom-in duration-300
      `}>
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="关闭"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* 图标 */}
        <div className={`
          w-24 h-24 mx-auto rounded-full flex items-center justify-center text-5xl mb-4
          ${colors.bg} ${colors.border} border-4
          ${isUnlocked ? 'animate-bounce' : 'grayscale'}
        `}>
          {achievement.icon}
        </div>

        {/* 解锁标签 */}
        {isUnlocked && (
          <div className="text-center mb-4">
            <span className="inline-block bg-gradient-to-r from-yellow-400 to-orange-500 text-white text-sm font-bold px-4 py-1 rounded-full">
              🎉 成就解锁！
            </span>
          </div>
        )}

        {/* 标题 */}
        <h2 className={`text-2xl font-bold text-center mb-2 ${colors.text}`}>
          {achievement.name}
        </h2>

        {/* 描述 */}
        <p className="text-gray-600 text-center mb-6">
          {achievement.description}
        </p>

        {/* 等级和积分 */}
        <div className="flex justify-center gap-4 mb-6">
          <div className={`${colors.bg} ${colors.text} px-4 py-2 rounded-lg text-center`}>
            <div className="text-xs opacity-70">等级</div>
            <div className="font-bold">{TIER_NAMES[achievement.tier]}</div>
          </div>
          <div className="bg-blue-50 text-blue-700 px-4 py-2 rounded-lg text-center">
            <div className="text-xs opacity-70">积分</div>
            <div className="font-bold">+{achievement.points}</div>
          </div>
        </div>

        {/* 条件 */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="text-sm text-gray-500 mb-1">解锁条件</div>
          <div className="font-medium text-gray-700">
            {achievement.condition.description}
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-xl font-medium
              hover:bg-gray-50 transition-colors"
          >
            知道了
          </button>
          {isUnlocked && onShare && (
            <button
              onClick={onShare}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white
                rounded-xl font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              分享成就
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 简单的 confetti 动画组件
 */
function ConfettiAnimation() {
  const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7'];

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 50 }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 2;
        const duration = 2 + Math.random() * 2;
        const color = colors[Math.floor(Math.random() * colors.length)];

        return (
          <div
            key={i}
            className="absolute w-2 h-2 rounded-full animate-confetti"
            style={{
              left: `${left}%`,
              top: '-10px',
              backgroundColor: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
              transform: `rotate(${Math.random() * 360}deg)`,
            }}
          />
        );
      })}

      <style>{`
        @keyframes confetti {
          0% {
            transform: translateY(0) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(100vh) rotate(720deg);
            opacity: 0;
          }
        }
        .animate-confetti {
          animation: confetti linear forwards;
        }
      `}</style>
    </div>
  );
}
