import { useState, useEffect, useCallback, useRef } from 'react';
import type { ReviewReminder, MasteryUpdateResult } from '@/shared/types/mastery';
import { logger } from '@/shared/utils';

interface FlashcardReviewProps {
  isSaving: boolean;
}

interface ReviewStats {
  totalReviewed: number;
  correctCount: number;
  ratingDistribution: Record<number, number>;
  averageRating: number;
}

const RATING_LABELS: Record<number, { label: string; color: string; description: string }> = {
  1: { label: '完全忘记', color: '#ef4444', description: '完全想不起来' },
  2: { label: '模糊记忆', color: '#f97316', description: '有点印象但不清楚' },
  3: { label: '想起来', color: '#eab308', description: '想了很久才记起' },
  4: { label: '比较熟练', color: '#84cc16', description: '犹豫一下就想起来了' },
  5: { label: '完全掌握', color: '#22c55e', description: '立刻就想起来了' },
};

/**
 * 将 1-5 评分映射到 isKnown 和难度权重
 * 1-2: 标记为不认识，增加难度权重
 * 3-4: 标记为认识，中等难度权重
 * 5: 标记为认识，低难度权重（完全掌握）
 */
const mapRatingToMasteryParams = (rating: number): { isKnown: boolean; wordDifficulty: number } => {
  return {
    isKnown: rating >= 3,
    wordDifficulty: rating === 5 ? 3 : rating === 1 ? 8 : 6 - rating,
  };
};

/**
 * 格式化复习间隔天数
 */
const formatInterval = (days: number): string => {
  if (days < 1) return '今天';
  if (days === 1) return '1 天后';
  if (days < 30) return `${Math.round(days)} 天后`;
  if (days < 365) return `${Math.round(days / 30)} 个月后`;
  return `${Math.round(days / 365)} 年后`;
};

export default function FlashcardReview({ isSaving: _isSaving }: FlashcardReviewProps) {
  const [reviewWords, setReviewWords] = useState<ReviewReminder[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [stats, setStats] = useState<ReviewStats>({
    totalReviewed: 0,
    correctCount: 0,
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    averageRating: 0,
  });
  const [lastUpdateResult, setLastUpdateResult] = useState<MasteryUpdateResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const handleRatingRef = useRef<(rating: number) => Promise<void>>();

  // 加载复习单词
  const loadReviewWords = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_REVIEW_WORDS',
        payload: { limit: 20 },
      });

      if (response.success && response.data && response.data.length > 0) {
        setReviewWords(response.data);
        setCurrentIndex(0);
        setIsFlipped(false);
        setIsComplete(false);
      } else {
        setReviewWords([]);
      }
    } catch (error) {
      logger.error('Failed to load review words:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReviewWords();
  }, [loadReviewWords]);

  // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isComplete || isSubmitting) return;

      // 空格键：翻转卡片
      if (e.code === 'Space') {
        e.preventDefault();
        if (!isFlipped) {
          setIsFlipped(true);
        }
        return;
      }

      // 数字键 1-5：评分（仅在卡片翻转后可用）
      if (isFlipped) {
        const rating = parseInt(e.key, 10);
        if (rating >= 1 && rating <= 5) {
          e.preventDefault();
          handleRatingRef.current?.(rating);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, isComplete, isSubmitting]);

  // 处理评分
  const handleRating = async (rating: number) => {
    if (isSubmitting || currentIndex >= reviewWords.length) return;

    setIsSubmitting(true);
    const currentWord = reviewWords[currentIndex];
    const { isKnown, wordDifficulty } = mapRatingToMasteryParams(rating);

    try {
      // 更新掌握度
      const response = await chrome.runtime.sendMessage({
        type: 'MARK_WORD_KNOWN',
        payload: {
          word: currentWord.word,
          context: currentWord.context,
          translation: currentWord.translation,
          isKnown,
          wordDifficulty,
        },
      });

      if (response.success && response.data?.masteryResult) {
        setLastUpdateResult(response.data.masteryResult as MasteryUpdateResult);
      }

      // 更新统计
      setStats((prev) => {
        const newTotal = prev.totalReviewed + 1;
        const newCorrectCount = rating >= 4 ? prev.correctCount + 1 : prev.correctCount;
        const newDistribution = {
          ...prev.ratingDistribution,
          [rating]: prev.ratingDistribution[rating] + 1,
        };
        const newAverage =
          (prev.averageRating * prev.totalReviewed + rating) / newTotal;

        return {
          totalReviewed: newTotal,
          correctCount: newCorrectCount,
          ratingDistribution: newDistribution,
          averageRating: newAverage,
        };
      });

      // 延迟后显示下一张卡片
      setTimeout(() => {
        if (currentIndex + 1 >= reviewWords.length) {
          setIsComplete(true);
        } else {
          setCurrentIndex((prev) => prev + 1);
          setIsFlipped(false);
          setLastUpdateResult(null);
        }
        setIsSubmitting(false);
      }, 800);
    } catch (error) {
      logger.error('Failed to update word mastery:', error);
      setIsSubmitting(false);
    }
  };

  // 更新 ref 以便键盘事件使用
  handleRatingRef.current = handleRating;

  // 跳过当前单词
  const handleSkip = () => {
    if (isSubmitting) return;

    if (currentIndex + 1 >= reviewWords.length) {
      setIsComplete(true);
    } else {
      setCurrentIndex((prev) => prev + 1);
      setIsFlipped(false);
      setLastUpdateResult(null);
    }
  };

  // 重新开始
  const handleRestart = () => {
    setStats({
      totalReviewed: 0,
      correctCount: 0,
      ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      averageRating: 0,
    });
    setLastUpdateResult(null);
    loadReviewWords();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4" />
        <p className="text-gray-500 dark:text-gray-400">加载复习单词...</p>
      </div>
    );
  }

  if (reviewWords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center px-4">
        <div className="text-6xl mb-4">🎉</div>
        <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
          没有需要复习的单词
        </h3>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          太棒了！你当前的单词都还没到复习时间。继续浏览网页学习新单词吧。
        </p>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">🎊</div>
          <h3 className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">
            复习完成！
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            本次复习了 {stats.totalReviewed} 个单词
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-4">复习统计</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {stats.totalReviewed}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">总复习数</div>
            </div>
            <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {stats.correctCount}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">熟练掌握</div>
            </div>
            <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
              <div className="text-2xl font-bold text-yellow-600">
                {Math.round(stats.averageRating * 10) / 10}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">平均评分</div>
            </div>
            <div className="text-center p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
              <div className="text-2xl font-bold text-purple-600">
                {stats.totalReviewed > 0
                  ? Math.round((stats.correctCount / stats.totalReviewed) * 100)
                  : 0}
                %
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">掌握率</div>
            </div>
          </div>

          <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mt-6 mb-4">评分分布</h4>
          <div className="space-y-2">
            {[5, 4, 3, 2, 1].map((rating) => {
              const count = stats.ratingDistribution[rating];
              const percentage =
                stats.totalReviewed > 0
                  ? (count / stats.totalReviewed) * 100
                  : 0;
              const { label, color } = RATING_LABELS[rating];
              return (
                <div key={rating} className="flex items-center gap-3">
                  <div className="w-20 text-sm text-gray-600 dark:text-gray-400">{label}</div>
                  <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: color,
                      }}
                    />
                  </div>
                  <div className="w-12 text-right text-sm text-gray-600 dark:text-gray-400">
                    {count}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={handleRestart}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium
                       hover:bg-blue-700 transition-colors shadow-sm"
          >
            再来一轮
          </button>
          <button
            onClick={() => setIsComplete(false)}
            className="px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg font-medium
                       hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            查看卡片
          </button>
        </div>
      </div>
    );
  }

  const currentWord = reviewWords[currentIndex];
  const progress = ((currentIndex + 1) / reviewWords.length) * 100;

  return (
    <div className="max-w-2xl mx-auto">
      {/* 进度条 */}
      <div className="mb-6">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            卡片 {currentIndex + 1} / {reviewWords.length}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {Math.round(progress)}%
          </span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-600 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* 闪卡 */}
      <div
        ref={cardRef}
        className="relative h-80 mb-6 cursor-pointer select-none"
        onClick={() => !isFlipped && setIsFlipped(true)}
      >
        <div
          className={`absolute inset-0 transition-all duration-500 transform-gpu preserve-3d ${
            isFlipped ? 'rotate-y-180' : ''
          }`}
          style={{
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* 正面 - 单词 */}
          <div
            className="absolute inset-0 backface-hidden"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div
              className="h-full flex flex-col items-center justify-center bg-white dark:bg-gray-800 rounded-2xl
                         shadow-lg border border-gray-200 dark:border-gray-700 p-8"
            >
              <div className="text-4xl font-bold text-gray-800 dark:text-gray-200 mb-4 text-center">
                {currentWord.word}
              </div>
              <div className="text-sm text-gray-400 dark:text-gray-500 mb-6">
                点击卡片或按空格键查看释义
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
                <span>掌握度:</span>
                <div className="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full"
                    style={{ width: `${currentWord.masteryLevel * 100}%` }}
                  />
                </div>
                <span>{Math.round(currentWord.masteryLevel * 100)}%</span>
              </div>
              {currentWord.daysOverdue > 0 && (
                <div className="mt-3 text-xs text-orange-500">
                  已逾期 {currentWord.daysOverdue} 天
                </div>
              )}
            </div>
          </div>

          {/* 背面 - 释义 */}
          <div
            className="absolute inset-0 backface-hidden rotate-y-180"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div
              className="h-full flex flex-col bg-blue-50 dark:bg-blue-900/20 rounded-2xl shadow-lg
                         border border-blue-200 dark:border-blue-800 p-8"
            >
              <div className="flex-1">
                <div className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">
                  {currentWord.word}
                </div>
                <div className="text-xl text-blue-700 dark:text-blue-400 mb-4">
                  {currentWord.translation}
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 italic mb-2">
                  &ldquo;{currentWord.context}&rdquo;
                </div>
              </div>

              {lastUpdateResult && (
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-4 p-3 bg-white/50 dark:bg-black/20 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span>下次复习:</span>
                    <span className="font-medium text-blue-600 dark:text-blue-400">
                      {formatInterval(lastUpdateResult.nextReviewInterval)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span>掌握度:</span>
                    <span className="font-medium">
                      {Math.round(lastUpdateResult.newMasteryLevel * 100)}%
                    </span>
                    {lastUpdateResult.levelUpgraded && (
                      <span className="text-green-600 dark:text-green-400 font-medium">
                        ↑ 升级!
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 评分按钮 */}
      {isFlipped && (
        <div className="mb-6">
          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mb-3">
            你对这个单词的掌握程度如何？（按数字键 1-5）
          </p>
          <div className="flex justify-center gap-2">
            {[1, 2, 3, 4, 5].map((rating) => {
              const { label, color } = RATING_LABELS[rating];
              return (
                <button
                  key={rating}
                  onClick={() => handleRating(rating)}
                  disabled={isSubmitting}
                  className="flex flex-col items-center p-3 rounded-lg border-2 transition-all
                             hover:scale-105 active:scale-95 disabled:opacity-50"
                  style={{
                    borderColor: color,
                    backgroundColor: `${color}10`,
                  }}
                  title={label}
                >
                  <span
                    className="text-lg font-bold"
                    style={{ color }}
                  >
                    {rating}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 mt-1 hidden sm:block">
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 跳过按钮 */}
      <div className="flex justify-center gap-4">
        <button
          onClick={handleSkip}
          disabled={isSubmitting}
          className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors
                     disabled:opacity-50"
        >
          跳过
        </button>
      </div>

      {/* 键盘快捷键提示 */}
      <div className="mt-8 flex flex-wrap justify-center gap-4 text-xs text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">空格</kbd>
          <span>翻转卡片</span>
        </span>
        <span className="flex items-center gap-1">
          <kbd className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">1-5</kbd>
          <span>评分</span>
        </span>
      </div>
    </div>
  );
}
