import { useState, useEffect, useCallback } from 'react';
import {
  RecommendationStrategy,
  getRecommendations,
  type WordRecommendation,
  type UserLearningState,
  type RecommendationResult,
} from '@/shared/utils/vocabularyRecommendation';
import type { CEFRLevel } from '@/shared/types/mastery';
import { CEFR_DISPLAY_NAMES, CEFR_LEVEL_COLORS } from '@/shared/constants/mastery';
import { getMasteryLevelText } from '@/shared/types/vocabulary';
import { logger } from '@/shared/utils';

interface VocabularyRecommendationProps {
  userLevel: CEFRLevel;
  onWordSelect?: (word: string) => void;
}

type ViewMode = 'recommendations' | 'daily' | 'settings';

/**
 * 词汇推荐组件
 *
 * 显示智能推荐的词汇列表，支持多种推荐策略
 */
export default function VocabularyRecommendation({
  userLevel,
  onWordSelect,
}: VocabularyRecommendationProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('recommendations');
  const [recommendations, setRecommendations] = useState<WordRecommendation[]>([]);
  const [dailyPlan, setDailyPlan] = useState<{
    newWords: WordRecommendation[];
    reviewWords: WordRecommendation[];
    totalEstimatedTime: number;
  } | null>(null);
  const [strategy, setStrategy] = useState<RecommendationStrategy>(RecommendationStrategy.MIXED);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWord, setSelectedWord] = useState<string | null>(null);

  // 加载推荐
  const loadRecommendations = useCallback(async () => {
    setIsLoading(true);
    try {
      // 从 background 获取用户词汇数据
      const response = await chrome.runtime.sendMessage({
        type: 'GET_VOCABULARY_WORDS',
        payload: {},
      });

      const knownWords = new Map<string, { level: number }>();
      if (response.success && response.data) {
        for (const entry of response.data) {
          knownWords.set(entry.word.toLowerCase(), {
            level: entry.mastery?.level ?? 0,
          });
        }
      }

      const userState: UserLearningState = {
        userLevel,
        recentWordsLearned: 0,
        averageMastery: 0,
        streakDays: 0,
        dailyGoalProgress: 0,
      };

      // 获取推荐
      const result: RecommendationResult = getRecommendations({
        userState,
        knownWords: knownWords as Map<string, never>,
        limit: 15,
        strategy,
      });

      setRecommendations(result.recommendations);
    } catch (error) {
      logger.error('Failed to load recommendations:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userLevel, strategy]);

  // 加载每日学习计划
  const loadDailyPlan = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_VOCABULARY_WORDS',
        payload: {},
      });

      const knownWords = new Map<string, { level: number }>();
      if (response.success && response.data) {
        for (const entry of response.data) {
          knownWords.set(entry.word.toLowerCase(), {
            level: entry.mastery?.level ?? 0,
          });
        }
      }

      const userState: UserLearningState = {
        userLevel,
        recentWordsLearned: 0,
        averageMastery: 0,
        streakDays: 0,
        dailyGoalProgress: 0,
      };

      // 获取新词推荐
      const newWordsResult = getRecommendations({
        userState,
        knownWords: knownWords as Map<string, never>,
        limit: 12,
        strategy: RecommendationStrategy.PROXIMAL,
      });

      // 获取复习推荐
      const reviewResult = getRecommendations({
        userState,
        knownWords: knownWords as Map<string, never>,
        limit: 8,
        strategy: RecommendationStrategy.SPACED_REPETITION,
      });

      const totalEstimatedTime =
        newWordsResult.recommendations.reduce((s, r) => s + r.estimatedStudyTime, 0) +
        reviewResult.recommendations.reduce((s, r) => s + r.estimatedStudyTime, 0);

      setDailyPlan({
        newWords: newWordsResult.recommendations,
        reviewWords: reviewResult.recommendations,
        totalEstimatedTime,
      });
    } catch (error) {
      logger.error('Failed to load daily plan:', error);
    } finally {
      setIsLoading(false);
    }
  }, [userLevel]);

  useEffect(() => {
    if (viewMode === 'recommendations') {
      loadRecommendations();
    } else if (viewMode === 'daily') {
      loadDailyPlan();
    }
  }, [viewMode, loadRecommendations, loadDailyPlan]);

  // 处理单词点击
  const handleWordClick = (word: string) => {
    setSelectedWord(word);
    onWordSelect?.(word);
  };

  // 策略显示名称
  const strategyLabels: Record<RecommendationStrategy, string> = {
    [RecommendationStrategy.MIXED]: '综合推荐',
    [RecommendationStrategy.PROXIMAL]: '邻近难度',
    [RecommendationStrategy.SPACED_REPETITION]: '间隔复习',
    [RecommendationStrategy.HIGH_FREQUENCY]: '高频词汇',
    [RecommendationStrategy.WEAK_AREA]: '弱项强化',
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mb-4" />
        <p className="text-gray-500 dark:text-gray-400">加载推荐词汇...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* 标签页导航 */}
      <div className="flex border-b border-gray-200 dark:border-gray-700 mb-6">
        <button
          onClick={() => setViewMode('recommendations')}
          className={`px-4 py-2 font-medium transition-colors ${
            viewMode === 'recommendations'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          推荐词汇
        </button>
        <button
          onClick={() => setViewMode('daily')}
          className={`px-4 py-2 font-medium transition-colors ${
            viewMode === 'daily'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          今日计划
        </button>
        <button
          onClick={() => setViewMode('settings')}
          className={`px-4 py-2 font-medium transition-colors ${
            viewMode === 'settings'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700 dark:text-gray-400'
          }`}
        >
          推荐设置
        </button>
      </div>

      {/* 推荐词汇视图 */}
      {viewMode === 'recommendations' && (
        <div>
          {/* 策略选择 */}
          <div className="flex flex-wrap gap-2 mb-4">
            {Object.values(RecommendationStrategy).map((s) => (
              <button
                key={s}
                onClick={() => setStrategy(s)}
                className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                  strategy === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {strategyLabels[s]}
              </button>
            ))}
          </div>

          {/* 推荐列表 */}
          {recommendations.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">📚</div>
              <p className="text-gray-500 dark:text-gray-400">
                暂无推荐词汇。继续浏览英文内容，系统会自动为你推荐适合的词汇。
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {recommendations.map((rec, index) => (
                <WordCard
                  key={`${rec.word}-${index}`}
                  recommendation={rec}
                  isSelected={selectedWord === rec.word}
                  onClick={() => handleWordClick(rec.word)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 今日计划视图 */}
      {viewMode === 'daily' && (
        <div>
          {dailyPlan ? (
            <>
              {/* 计划概览 */}
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                      今日学习计划
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      新词 {dailyPlan.newWords.length} 个 · 复习 {dailyPlan.reviewWords.length} 个
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-blue-600">
                      {Math.round(dailyPlan.totalEstimatedTime / 60)}
                    </div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">分钟</div>
                  </div>
                </div>
              </div>

              {/* 新词推荐 */}
              {dailyPlan.newWords.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">
                    🆕 新词学习
                  </h4>
                  <div className="grid gap-3">
                    {dailyPlan.newWords.slice(0, 6).map((rec, index) => (
                      <WordCard
                        key={`new-${rec.word}-${index}`}
                        recommendation={rec}
                        isSelected={selectedWord === rec.word}
                        onClick={() => handleWordClick(rec.word)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* 复习词汇 */}
              {dailyPlan.reviewWords.length > 0 && (
                <div>
                  <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">
                    🔄 复习巩固
                  </h4>
                  <div className="grid gap-3">
                    {dailyPlan.reviewWords.slice(0, 4).map((rec, index) => (
                      <WordCard
                        key={`review-${rec.word}-${index}`}
                        recommendation={rec}
                        isSelected={selectedWord === rec.word}
                        onClick={() => handleWordClick(rec.word)}
                        compact
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-12">
              <div className="text-4xl mb-4">📅</div>
              <p className="text-gray-500 dark:text-gray-400">
                加载今日计划中...
              </p>
            </div>
          )}
        </div>
      )}

      {/* 设置视图 */}
      {viewMode === 'settings' && (
        <div className="space-y-6">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">
              推荐设置
            </h3>
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    当前等级
                  </label>
                  <div
                    className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium"
                    style={{
                      backgroundColor: `${CEFR_LEVEL_COLORS[userLevel]}20`,
                      color: CEFR_LEVEL_COLORS[userLevel],
                    }}
                  >
                    {CEFR_DISPLAY_NAMES[userLevel]}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    推荐策略
                  </label>
                  <select
                    value={strategy}
                    onChange={(e) => setStrategy(e.target.value as RecommendationStrategy)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                               bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                  >
                    {Object.entries(strategyLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="pt-2">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    💡 <strong>邻近难度</strong>：刚好超出当前水平的词汇，学习效果最好
                    <br />
                    💡 <strong>间隔复习</strong>：根据遗忘曲线安排复习，巩固记忆
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 单词卡片子组件
 */
interface WordCardProps {
  recommendation: WordRecommendation;
  isSelected: boolean;
  onClick: () => void;
  compact?: boolean;
}

function WordCard({ recommendation, isSelected, onClick, compact = false }: WordCardProps) {
  const levelColor = CEFR_LEVEL_COLORS[recommendation.level] || '#9CA3AF';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-${compact ? '3' : '4'} rounded-xl border transition-all
                  ${
                    isSelected
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm'
                  }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-${compact ? 'semibold' : 'bold'} text-gray-800 dark:text-gray-200`}>
              {recommendation.word}
            </span>
            <span
              className="px-2 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: `${levelColor}20`,
                color: levelColor,
              }}
            >
              {recommendation.level}
            </span>
            {recommendation.isPriority && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400">
                优先
              </span>
            )}
          </div>

          {!compact && (
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {recommendation.reason}
            </p>
          )}

          <div className="flex items-center gap-3 mt-2">
            <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
              <span>难度:</span>
              <div className="w-12 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${recommendation.difficulty * 10}%`,
                    backgroundColor: levelColor,
                  }}
                />
              </div>
            </div>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              ~{recommendation.estimatedStudyTime}秒
            </span>
            {recommendation.mastery && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {getMasteryLevelText(recommendation.mastery.level)}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end">
          <div className="text-lg font-bold text-blue-600">
            {Math.round(recommendation.recommendationScore)}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500">推荐分</div>
        </div>
      </div>
    </button>
  );
}