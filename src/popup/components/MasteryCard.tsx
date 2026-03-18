import { useEffect, useState } from 'react';
import type {
  WordMasteryStats,
  ReviewReminder,
  LearningStatistics,
} from '@/shared/types/mastery';
import { logger } from '@/shared/utils';

interface MasteryData {
  stats: WordMasteryStats | null;
  reviewWords: ReviewReminder[];
  learningStats: LearningStatistics | null;
}

export default function MasteryCard() {
  const [data, setData] = useState<MasteryData>({
    stats: null,
    reviewWords: [],
    learningStats: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [showReviews, setShowReviews] = useState(false);

  useEffect(() => {
    loadMasteryData();
  }, []);

  const loadMasteryData = async () => {
    setIsLoading(true);
    try {
      const [overviewRes, reviewRes, statsRes] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_MASTERY_OVERVIEW' }),
        chrome.runtime.sendMessage({
          type: 'GET_REVIEW_WORDS',
          payload: { limit: 5 },
        }),
        chrome.runtime.sendMessage({
          type: 'GET_LEARNING_STATISTICS',
          payload: { days: 30 },
        }),
      ]);

      setData({
        stats: overviewRes.success ? overviewRes.data : null,
        reviewWords: reviewRes.success ? reviewRes.data : [],
        learningStats: statsRes.success ? statsRes.data : null,
      });
    } catch (error) {
      logger.error('Failed to load mastery data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openOptions = (tab: string) => {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`options.html?tab=${tab}`),
    });
  };

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary-600 border-t-transparent"></div>
        </div>
      </div>
    );
  }

  const { stats, reviewWords, learningStats } = data;
  const dueCount = stats?.dueForReview || 0;
  const streak = learningStats?.currentStreak || 0;
  const masteredCount = stats?.masteredWords || 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-100 dark:border-gray-700">
      {/* 头部标题 */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
          词汇掌握度
        </h3>
        <button
          onClick={() => openOptions('vocabulary')}
          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
        >
          查看全部
        </button>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div
          onClick={() => setShowReviews(!showReviews)}
          className={`cursor-pointer rounded-lg p-2 text-center transition-colors ${
            dueCount > 0
              ? 'bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/30'
              : 'bg-gray-50 dark:bg-gray-700/50'
          }`}
        >
          <div
            className={`text-lg font-bold ${
              dueCount > 0 ? 'text-orange-600' : 'text-gray-700 dark:text-gray-300'
            }`}
          >
            {dueCount}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">待复习</div>
        </div>

        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-green-600">{masteredCount}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">已掌握</div>
        </div>

        <div className="bg-primary-50 dark:bg-primary-900/20 rounded-lg p-2 text-center">
          <div className="text-lg font-bold text-primary-600">{streak}</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">连续天数</div>
        </div>
      </div>

      {/* 待复习单词列表 */}
      {showReviews && reviewWords.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3 mb-3">
          <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
            需要复习的单词
          </div>
          <div className="space-y-2 max-h-32 overflow-y-auto">
            {reviewWords.map((word, index) => (
              <div
                key={index}
                className="flex items-center justify-between py-1.5 px-2 bg-gray-50 dark:bg-gray-700/50 rounded-md"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                    {word.word}
                  </div>
                  {word.context && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                      {word.translation || word.context}
                    </div>
                  )}
                </div>
                {word.daysOverdue > 0 && (
                  <span className="text-xs text-orange-500 ml-2 flex-shrink-0">
                    逾期 {word.daysOverdue} 天
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 学习热力图缩略 */}
      {learningStats?.heatmapData && learningStats.heatmapData.length > 0 && (
        <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              近7天学习
            </span>
            <button
              onClick={() => openOptions('mastery')}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              详情
            </button>
          </div>
          <div className="flex gap-1">
            {learningStats.heatmapData.slice(-7).map((day, index) => (
              <div
                key={index}
                className={`flex-1 h-6 rounded-sm ${
                  day.intensity === 0
                    ? 'bg-gray-100 dark:bg-gray-700'
                    : day.intensity === 1
                      ? 'bg-green-200 dark:bg-green-900/40'
                      : day.intensity === 2
                        ? 'bg-green-300 dark:bg-green-800/50'
                        : day.intensity === 3
                          ? 'bg-green-400 dark:bg-green-700/60'
                          : 'bg-green-500 dark:bg-green-600'
                }`}
                title={`${day.date}: ${day.count} 个单词`}
              />
            ))}
          </div>
        </div>
      )}

      {/* 复习提醒按钮 */}
      {dueCount > 0 && !showReviews && (
        <button
          onClick={() => setShowReviews(true)}
          className="mt-3 w-full py-2 px-3 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          开始复习 ({dueCount})
        </button>
      )}
    </div>
  );
}
