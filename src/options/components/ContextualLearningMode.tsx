import { useState, useEffect, useCallback } from 'react';
import type { WordContext } from '@/shared/types/vocabulary';
import ContextualLearningCard from './ContextualLearningCard';
import { logger } from '@/shared/utils';

type LearningMode = 'flashcard' | 'contextual';

interface ContextualWord {
  word: string;
  translation?: string;
  contexts: WordContext[];
}

interface ContextualLearningStats {
  totalReviewed: number;
  correctCount: number;
  averageRating: number;
}

/**
 * 语境学习模式组件
 *
 * 在真实语境中复习生词，帮助用户理解单词用法。
 */
export default function ContextualLearningMode() {
  const [mode, setMode] = useState<LearningMode>('contextual');
  const [words, setWords] = useState<ContextualWord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [stats, setStats] = useState<ContextualLearningStats>({
    totalReviewed: 0,
    correctCount: 0,
    averageRating: 0,
  });

  // 加载有上下文的词汇
  const loadWords = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_CONTEXTUAL_WORDS',
        payload: { limit: 15 },
      });

      if (response.success && response.data && response.data.length > 0) {
        setWords(response.data);
        setCurrentIndex(0);
        setShowAnswer(false);
        setIsComplete(false);
      } else {
        setWords([]);
      }
    } catch (error) {
      logger.error('Failed to load contextual words:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWords();
  }, [loadWords]);

  // 处理评分
  const handleRate = async (rating: number) => {
    if (isSubmitting || currentIndex >= words.length) return;

    setIsSubmitting(true);
    const currentWord = words[currentIndex];

    try {
      await chrome.runtime.sendMessage({
        type: 'MARK_WORD_KNOWN',
        payload: {
          word: currentWord.word,
          isKnown: rating >= 3,
          wordDifficulty: 6 - rating,
        },
      });

      // 更新统计
      setStats(prev => {
        const newTotal = prev.totalReviewed + 1;
        const newCorrect = rating >= 4 ? prev.correctCount + 1 : prev.correctCount;
        return {
          totalReviewed: newTotal,
          correctCount: newCorrect,
          averageRating: (prev.averageRating * prev.totalReviewed + rating) / newTotal,
        };
      });

      // 下一个单词
      if (currentIndex + 1 < words.length) {
        setCurrentIndex(prev => prev + 1);
        setShowAnswer(false);
      } else {
        setIsComplete(true);
      }
    } catch (error) {
      logger.error('Failed to rate word:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 重新开始
  const handleRestart = () => {
    setStats({ totalReviewed: 0, correctCount: 0, averageRating: 0 });
    loadWords();
  };

  // 翻转卡片
  const handleFlip = () => {
    if (!showAnswer) {
      setShowAnswer(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4" />
        <p className="text-gray-500 dark:text-gray-400">加载语境词汇...</p>
      </div>
    );
  }

  if (words.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-center px-4">
        <div className="text-6xl mb-4">📖</div>
        <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
          暂无语境词汇
        </h3>
        <p className="text-gray-500 dark:text-gray-400 max-w-md">
          在阅读网页时，系统会自动捕获生词的上下文。
          继续浏览英文内容，积累语境素材吧！
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
            语境学习完成！
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            本次学习了 {stats.totalReviewed} 个词汇的语境用法
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
              <div className="text-2xl font-bold text-blue-600">
                {stats.totalReviewed}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">学习词汇</div>
            </div>
            <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div className="text-2xl font-bold text-green-600">
                {stats.correctCount}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">熟练掌握</div>
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
        </div>

        <div className="flex justify-center gap-4">
          <button
            onClick={handleRestart}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            再来一轮
          </button>
        </div>
      </div>
    );
  }

  const currentWord = words[currentIndex];

  return (
    <div className="max-w-2xl mx-auto">
      {/* 模式切换 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            进度: {currentIndex + 1} / {words.length}
          </span>
        </div>
        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          <button
            onClick={() => setMode('contextual')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'contextual'
                ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            📖 语境模式
          </button>
          <button
            onClick={() => setMode('flashcard')}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              mode === 'flashcard'
                ? 'bg-white dark:bg-gray-600 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            🎴 闪卡模式
          </button>
        </div>
      </div>

      {/* 学习卡片 */}
      {mode === 'contextual' ? (
        <ContextualLearningCard
          word={currentWord.word}
          translation={currentWord.translation}
          contexts={currentWord.contexts}
          showAnswer={showAnswer}
          onRate={handleRate}
          isSubmitting={isSubmitting}
        />
      ) : (
        <div
          onClick={handleFlip}
          className="cursor-pointer select-none"
        >
          {/* 简化的闪卡模式 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center min-h-[300px] flex flex-col items-center justify-center">
            {!showAnswer ? (
              <>
                <p className="text-4xl font-bold text-gray-800 dark:text-gray-200 mb-4">
                  {currentWord.word}
                </p>
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  点击查看释义
                </p>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-gray-800 dark:text-gray-200 mb-2">
                  {currentWord.word}
                </p>
                {currentWord.translation && (
                  <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
                    {currentWord.translation}
                  </p>
                )}
                <div className="flex gap-2 mt-4">
                  {[1, 2, 3, 4, 5].map(rating => (
                    <button
                      key={rating}
                      onClick={e => {
                        e.stopPropagation();
                        handleRate(rating);
                      }}
                      disabled={isSubmitting}
                      className={`px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 ${
                        rating <= 2
                          ? 'bg-red-500 hover:bg-red-600'
                          : rating === 3
                          ? 'bg-yellow-500 hover:bg-yellow-600'
                          : 'bg-green-500 hover:bg-green-600'
                      }`}
                    >
                      {rating}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 提示 */}
      <div className="mt-4 text-center text-sm text-gray-400 dark:text-gray-500">
        {mode === 'contextual' ? (
          <span>💡 在真实语境中学习单词用法，加深记忆</span>
        ) : (
          <span>💡 空格键翻转卡片，数字键 1-5 评分</span>
        )}
      </div>
    </div>
  );
}