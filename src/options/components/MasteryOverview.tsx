import { useState, useEffect } from 'react';
import type {
  CEFRLevel,
  WordMasteryStats,
  MasteryTrend,
  ReviewReminder,
  LearningStatistics,
} from '@/shared/types/mastery';
import { logger } from '@/shared/utils';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import LearningHeatmap from './LearningHeatmap';

interface CEFRLevelData {
  level: CEFRLevel;
  label: string;
  color: string;
  description: string;
}

const CEFR_LEVELS: CEFRLevelData[] = [
  { level: 'A1', label: 'A1 初级', color: '#22c55e', description: '入门' },
  { level: 'A2', label: 'A2 初级', color: '#84cc16', description: '基础' },
  { level: 'B1', label: 'B1 中级', color: '#eab308', description: '中等' },
  { level: 'B2', label: 'B2 中高级', color: '#f97316', description: '流利' },
  { level: 'C1', label: 'C1 高级', color: '#ef4444', description: '精通' },
  { level: 'C2', label: 'C2 专家', color: '#a855f7', description: '母语' },
];

const MASTERY_COLORS = {
  mastered: '#22c55e',
  learning: '#3b82f6',
  struggling: '#ef4444',
  review: '#f59e0b',
};

interface MasteryOverviewProps {
  isSaving: boolean;
}

type TimeRange = 7 | 30 | 90;

export default function MasteryOverview({ isSaving }: MasteryOverviewProps) {
  const [cefrLevel, setCefrLevel] = useState<CEFRLevel | null>(null);
  const [confidence, setConfidence] = useState<number>(0);
  const [vocabularyEstimate, setVocabularyEstimate] = useState<number>(0);
  const [stats, setStats] = useState<WordMasteryStats | null>(null);
  const [trend, setTrend] = useState<MasteryTrend | null>(null);
  const [reviewWords, setReviewWords] = useState<ReviewReminder[]>([]);
  const [learningStats, setLearningStats] = useState<LearningStatistics | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>(30);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadMasteryData();
  }, [timeRange]);

  const loadMasteryData = async () => {
    setIsLoading(true);
    try {
      // 并行获取所有数据
      const [levelResponse, overviewResponse, reviewResponse, trendResponse, statsResponse] =
        await Promise.all([
          chrome.runtime.sendMessage({ type: 'GET_CEFR_LEVEL' }),
          chrome.runtime.sendMessage({ type: 'GET_MASTERY_OVERVIEW' }),
          chrome.runtime.sendMessage({
            type: 'GET_REVIEW_WORDS',
            payload: { limit: 10 },
          }),
          chrome.runtime.sendMessage({
            type: 'GET_MASTERY_TREND',
            payload: { days: timeRange },
          }),
          chrome.runtime.sendMessage({
            type: 'GET_LEARNING_STATISTICS',
            payload: { days: timeRange },
          }),
        ]);

      if (levelResponse.success && levelResponse.data) {
        setCefrLevel(levelResponse.data.level);
        setConfidence(levelResponse.data.confidence);
        setVocabularyEstimate(levelResponse.data.vocabularyEstimate);
      }

      if (overviewResponse.success && overviewResponse.data) {
        setStats(overviewResponse.data.stats);
      }

      if (reviewResponse.success && reviewResponse.data) {
        setReviewWords(reviewResponse.data);
      }

      if (trendResponse.success && trendResponse.data) {
        setTrend(trendResponse.data);
      }

      if (statsResponse.success && statsResponse.data) {
        setLearningStats(statsResponse.data);
      }
    } catch (error) {
      logger.error('Failed to load mastery data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // 获取当前 CEFR 等级信息
  const currentLevelInfo = cefrLevel
    ? CEFR_LEVELS.find((l) => l.level === cefrLevel)
    : null;

  // 准备等级分布数据
  const levelDistributionData = stats
    ? CEFR_LEVELS.map((level) => ({
        level: level.level,
        label: level.level,
        count: stats.levelDistribution[level.level] || 0,
        color: level.color,
      })).filter((d) => d.count > 0)
    : [];

  // 准备掌握度分布数据
  const masteryDistributionData = stats
    ? [
        {
          name: '已掌握',
          value: stats.masteredWords,
          color: MASTERY_COLORS.mastered,
        },
        {
          name: '学习中',
          value: stats.learningWords,
          color: MASTERY_COLORS.learning,
        },
        {
          name: '需加强',
          value: stats.strugglingWords,
          color: MASTERY_COLORS.struggling,
        },
      ]
    : [];

  // 准备趋势图数据
  const trendData = trend?.last30Days.map((day) => ({
    date: day.date.slice(5), // MM-DD
    mastered: day.masteredCount,
    learning: day.learningCount,
    newWords: day.newWordsCount,
    vocabulary: day.estimatedVocabulary,
  }));

  // 获取进度条宽度（基于 CEFR 等级）
  const getProgressWidth = (level: CEFRLevel | null): string => {
    if (!level) return '0%';
    const index = CEFR_LEVELS.findIndex((l) => l.level === level);
    return `${((index + 1) / CEFR_LEVELS.length) * 100}%`;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* CEFR 等级展示 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">词汇掌握度概览</h2>

        <div className="flex items-center gap-6 mb-6">
          {/* CEFR 等级徽章 */}
          <div
            className="w-24 h-24 rounded-2xl flex items-center justify-center text-3xl font-bold text-white shadow-lg"
            style={{ backgroundColor: currentLevelInfo?.color || '#9ca3af' }}
          >
            {cefrLevel || '-'}
          </div>

          <div className="flex-1">
            <div className="flex items-baseline gap-3 mb-2">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">
                {currentLevelInfo?.label || '未知等级'}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {currentLevelInfo?.description || ''}
              </span>
            </div>

            {/* 置信度 */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">置信度:</span>
              <div className="flex-1 max-w-[150px] h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-500"
                  style={{ width: `${(confidence * 100).toFixed(0)}%` }}
                />
              </div>
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {(confidence * 100).toFixed(0)}%
              </span>
            </div>

            {/* 词汇量估算 */}
            <div className="text-sm text-gray-600 dark:text-gray-400">
              估计词汇量:{' '}
              <span className="font-semibold text-gray-900 dark:text-white">
                {vocabularyEstimate.toLocaleString()}
              </span>{' '}
              词
            </div>
          </div>
        </div>

        {/* CEFR 进度条 */}
        <div className="relative pt-2">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            {CEFR_LEVELS.map((l) => (
              <span
                key={l.level}
                className={`transition-colors ${l.level === cefrLevel ? 'font-bold text-gray-900 dark:text-white' : ''}`}
              >
                {l.level}
              </span>
            ))}
          </div>
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-purple-600 rounded-full transition-all duration-700"
              style={{ width: getProgressWidth(cefrLevel) }}
            />
          </div>
        </div>
      </div>

      {/* 时间范围选择和统计卡片 */}
      {stats && (
        <div className="space-y-4">
          {/* 时间范围选择器 */}
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">学习统计</h3>
            <div className="flex gap-1">
              {[7, 30, 90].map((days) => (
                <button
                  key={days}
                  onClick={() => setTimeRange(days as TimeRange)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    timeRange === days
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                >
                  {days}天
                </button>
              ))}
            </div>
          </div>

          {/* 统计卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-sm text-gray-600 dark:text-gray-400">已掌握</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.masteredWords}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {stats.totalWords > 0
                  ? ((stats.masteredWords / stats.totalWords) * 100).toFixed(1)
                  : '0'}
                %
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span className="text-sm text-gray-600 dark:text-gray-400">学习中</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.learningWords}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {stats.totalWords > 0
                  ? ((stats.learningWords / stats.totalWords) * 100).toFixed(1)
                  : '0'}
                %
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-sm text-gray-600 dark:text-gray-400">需加强</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.strugglingWords}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {stats.totalWords > 0
                  ? ((stats.strugglingWords / stats.totalWords) * 100).toFixed(1)
                  : '0'}
                %
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                <span className="text-sm text-gray-600 dark:text-gray-400">待复习</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.dueForReview}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {stats.dueForReview > 0 ? '今日需复习' : '暂无待复习'}
              </div>
            </div>
          </div>

          {/* 学习活跃度统计 */}
          {learningStats && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">当前连续</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{learningStats.currentStreak}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">天</div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-indigo-500"></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">最长连续</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{learningStats.longestStreak}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">天</div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-teal-500"></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">学习天数</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{learningStats.totalStudyDays}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{timeRange}天内</div>
              </div>

              <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
                  <span className="text-sm text-gray-600 dark:text-gray-400">日均学习</span>
                </div>
                <div className="text-2xl font-bold text-gray-900 dark:text-white">{learningStats.averageDailyWords}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">词/天</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 图表区域 */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* CEFR 等级分布 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">CEFR 等级分布</h3>
          {levelDistributionData.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={levelDistributionData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {levelDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400 dark:text-gray-500">
              暂无数据
            </div>
          )}
        </div>

        {/* 掌握度分布饼图 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">掌握度分布</h3>
          {masteryDistributionData.some((d) => d.value > 0) ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={masteryDistributionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {masteryDistributionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                {masteryDistributionData.map((item) => (
                  <div key={item.name} className="flex items-center gap-1.5">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-xs text-gray-600 dark:text-gray-400">
                      {item.name}: {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-gray-400 dark:text-gray-500">
              暂无数据
            </div>
          )}
        </div>
      </div>

      {/* 趋势图 */}
      {trendData && trendData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">{timeRange} 天学习趋势</h3>
            {trend?.masteryChangeRate !== undefined && (
              <div className="text-sm">
                <span className="text-gray-500 dark:text-gray-400">增长率: </span>
                <span
                  className={`font-medium ${
                    trend.masteryChangeRate >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}
                >
                  {(trend.masteryChangeRate * 100).toFixed(1)}%
                </span>
              </div>
            )}
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="colorMastered" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorLearning" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval={4} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#fff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="mastered"
                  name="已掌握"
                  stroke="#22c55e"
                  fillOpacity={1}
                  fill="url(#colorMastered)"
                />
                <Area
                  type="monotone"
                  dataKey="learning"
                  name="学习中"
                  stroke="#3b82f6"
                  fillOpacity={1}
                  fill="url(#colorLearning)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 学习热力图 */}
      {learningStats?.heatmapData && learningStats.heatmapData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">学习热力图</h3>
          <LearningHeatmap data={learningStats.heatmapData} weeks={Math.ceil(timeRange / 7)} />
        </div>
      )}

      {/* 待复习单词 */}
      {reviewWords.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">
            待复习单词 ({reviewWords.length} 个)
          </h3>
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {reviewWords.map((word) => (
              <div
                key={word.word}
                className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-white">{word.word}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        word.daysOverdue > 0
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                      }`}
                    >
                      {word.daysOverdue > 0 ? `逾期 ${word.daysOverdue} 天` : '今日'}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{word.translation}</p>
                  {word.context && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-1 italic truncate">
                      "{word.context}"
                    </p>
                  )}
                </div>
                <div className="ml-4 text-right">
                  <div className="text-xs text-gray-500 dark:text-gray-400">掌握度</div>
                  <div className="text-sm font-medium text-gray-900 dark:text-white">
                    {(word.masteryLevel * 100).toFixed(0)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 数据导出/重置 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">数据管理</h3>
        <div className="flex gap-3">
          <button
            onClick={loadMasteryData}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded-lg transition-colors disabled:opacity-50"
          >
            刷新数据
          </button>
        </div>
      </div>
    </div>
  );
}
