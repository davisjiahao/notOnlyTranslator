import { useState, useEffect, useCallback } from 'react';
import {
  getUnlockedAchievements,
  getAchievementProgress,
  markAchievementAsViewed,
} from '@/shared/analytics/achievements';
import type { Achievement, AchievementProgress } from '@/shared/types/achievements';
import { AchievementCard } from './AchievementCard';
import { AchievementUnlockModal } from './AchievementUnlockModal';
import { ShareCardModal } from './ShareCardModal';

interface AchievementGalleryProps {
  onClose?: () => void;
}

/**
 * 成就展示画廊组件
 * 展示所有成就和解锁进度
 */
export function AchievementGallery({ onClose }: AchievementGalleryProps) {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [progress, setProgress] = useState<AchievementProgress[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
  const [showShareModal, setShowShareModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all');

  const loadAchievements = useCallback(async () => {
    try {
      setLoading(true);
      const [unlocked, progressData] = await Promise.all([
        getUnlockedAchievements(),
        getAchievementProgress(),
      ]);

      setAchievements(unlocked);
      setProgress(progressData);
      setTotalPoints(unlocked.reduce((sum, a) => sum + a.points, 0));
    } catch (error) {
      console.error('Failed to load achievements:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAchievements();
  }, [loadAchievements]);

  const handleAchievementClick = async (achievement: Achievement) => {
    setSelectedAchievement(achievement);

    // 标记为已查看
    if (achievement.isNew) {
      await markAchievementAsViewed(achievement.id);
      await loadAchievements();
    }
  };

  const handleShare = () => {
    if (selectedAchievement) {
      setShowShareModal(true);
    }
  };

  const filteredProgress = progress.filter(p => {
    if (filter === 'unlocked') return p.isUnlocked;
    if (filter === 'locked') return !p.isUnlocked;
    return true;
  });

  const unlockedCount = progress.filter(p => p.isUnlocked).length;
  const totalCount = progress.length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
      {/* 头部 */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-4 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">🏆 我的成就</h2>
            <p className="text-blue-100 text-sm mt-1">
              已解锁 {unlockedCount}/{totalCount} 个成就 · 总积分 {totalPoints}
            </p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="text-white/80 hover:text-white transition-colors p-2"
              aria-label="关闭"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 筛选器 */}
      <div className="px-6 py-3 border-b border-gray-100">
        <div className="flex gap-2">
          {(['all', 'unlocked', 'locked'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-blue-100 text-blue-700'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f === 'all' && '全部'}
              {f === 'unlocked' && '已解锁'}
              {f === 'locked' && '未解锁'}
            </button>
          ))}
        </div>
      </div>

      {/* 成就列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProgress.map(p => {
            const achievement = achievements.find(a => a.id === p.achievementId);
            if (!achievement) return null;

            return (
              <AchievementCard
                key={achievement.id}
                achievement={achievement}
                progress={p}
                onClick={() => handleAchievementClick(achievement)}
              />
            );
          })}
        </div>

        {filteredProgress.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <p className="text-4xl mb-2">🎯</p>
            <p>暂无{filter === 'unlocked' ? '已解锁' : filter === 'locked' ? '未解锁' : ''}成就</p>
          </div>
        )}
      </div>

      {/* 解锁详情弹窗 */}
      {selectedAchievement && !showShareModal && (
        <AchievementUnlockModal
          achievement={selectedAchievement}
          onClose={() => setSelectedAchievement(null)}
          onShare={handleShare}
        />
      )}

      {/* 分享弹窗 */}
      {showShareModal && selectedAchievement && (
        <ShareCardModal
          achievementId={selectedAchievement.id}
          onClose={() => {
            setShowShareModal(false);
            setSelectedAchievement(null);
          }}
        />
      )}
    </div>
  );
}
