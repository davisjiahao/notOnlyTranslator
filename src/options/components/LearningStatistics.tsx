import { useState, useEffect, useMemo } from 'react';
import type {
  CEFRLevel,
  WordMasteryStats,
  MasteryTrend,
  LearningStatistics as LearningStatisticsType,
} from '@/shared/types/mastery';
import { logger } from '@/shared/utils';
import {
  ResponsiveContainer,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  LineChart,
  Line,
  ComposedChart,
} from 'recharts';

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

interface LearningStatisticsProps {
  isSaving: boolean;
}

type TimeRange = 7 | 30 | 90 | 365;
type ChartTab = 'vocabulary' | 'activity' | 'progress';

/**
 * 学习统计仪表盘组件
 *
 * 功能：
 * - 总词汇量统计（已掌握/学习中/待学习）
 * - 日/周/月学习趋势图表
 * - 阅读文章数和时长统计
 * - CEFR 等级变化曲线
 * - 学习热力图
 * - 时间范围筛选
 * - 响应式布局
 */
export default function LearningStatistics({ isSaving }: LearningStatisticsProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>(30);
  const [activeTab, setActiveTab] = useState<ChartTab>('vocabulary');
  const [isLoading, setIsLoading] = useState(true);

  // 数据状态
  const [stats, setStats] = useState<WordMasteryStats | null>(null);
  const [trend, setTrend] = useState<MasteryTrend | null>(null);
  const [learningStats, setLearningStats] = useState<LearningStatisticsType | null>(null);
  const [cefrLevel, setCefrLevel] = useState<CEFRLevel | null>(null);
  const [cefrHistory, setCefrHistory] = useState<{ date: string; level: CEFRLevel; levelValue: number }[]>([]);

  useEffect(() => {
    loadStatisticsData();
  }, [timeRange]);

  const loadStatisticsData = async () => {
    setIsLoading(true);
    try {
      // 并行获取所有数据
      const [overviewResponse, trendResponse, statsResponse, levelResponse] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_MASTERY_OVERVIEW' }),
        chrome.runtime.sendMessage({
          type: 'GET_MASTERY_TREND',
          payload: { days: timeRange },
        }),
        chrome.runtime.sendMessage({
          type: 'GET_LEARNING_STATISTICS',
          payload: { days: timeRange },
        }),
        chrome.runtime.sendMessage({ type: 'GET_CEFR_LEVEL' }),
      ]);

      if (overviewResponse.success && overviewResponse.data) {
        setStats(overviewResponse.data.stats);
      }

      if (trendResponse.success && trendResponse.data) {
        setTrend(trendResponse.data);
        // 生成模拟 CEFR 历史数据（实际应用中应该从 API 获取）
        generateCEFRHistory(trendResponse.data);
      }

      if (statsResponse.success && statsResponse.data) {
        setLearningStats(statsResponse.data);
      }

      if (levelResponse.success && levelResponse.data) {
        setCefrLevel(levelResponse.data.level);
      }
    } catch (error) {
      logger.error('Failed to load statistics data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * 生成 CEFR 等级历史数据
   */
  const generateCEFRHistory = (trendData: MasteryTrend) => {
    const history: { date: string; level: CEFRLevel; levelValue: number }[] = [];
    let currentLevelIndex = 2; // 默认从 B1 开始

    trendData.last30Days.forEach((day, index) => {
      // 根据词汇量估算模拟等级变化
      const vocabEstimate = day.estimatedVocabulary;
      let levelIndex = 0;
      if (vocabEstimate < 1500) levelIndex = 0;
      else if (vocabEstimate < 2500) levelIndex = 1;
      else if (vocabEstimate < 4000) levelIndex = 2;
      else if (vocabEstimate < 6000) levelIndex = 3;
      else if (vocabEstimate < 9000) levelIndex = 4;
      else levelIndex = 5;

      currentLevelIndex = Math.max(currentLevelIndex, levelIndex);
      history.push({
        date: day.date,
        level: CEFR_LEVELS[currentLevelIndex].level,
        levelValue: currentLevelIndex + 1,
      });
    });

    setCefrHistory(history);
  };

  // 计算总词汇量
  const totalVocabulary = useMemo(() => {
    if (!stats) return { total: 0, mastered: 0, learning: 0, pending: 0 };
    return {
      total: stats.totalWords,
      mastered: stats.masteredWords,
      learning: stats.learningWords,
      pending: stats.strugglingWords + stats.dueForReview,
    };
  }, [stats]);

  // 计算学习时长（分钟转换为小时/分钟）
  const formatStudyTime = (minutes: number): string => {
    if (minutes < 60) return `${minutes} 分钟`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
  };

  // 准备词汇量趋势数据
  const vocabularyTrendData = useMemo(() => {
    if (!trend) return [];
    return trend.last30Days.map((day) => ({
      date: formatDateLabel(day.date),
      mastered: day.masteredCount,
      learning: day.learningCount,
      newWords: day.newWordsCount,
      total: day.masteredCount + day.learningCount,
    }));
  }, [trend]);

  // 准备学习活动数据
  const activityData = useMemo(() => {
    if (!learningStats) return [];
    return learningStats.recentActivity.map((activity) => ({
      date: formatDateLabel(activity.date),
      newWords: activity.newWords,
      reviewWords: activity.reviewWords,
      totalActivity: activity.newWords + activity.reviewWords,
      studyMinutes: activity.studyMinutes,
      knownCount: activity.knownCount,
      unknownCount: activity.unknownCount,
    }));
  }, [learningStats]);

  // 准备 CEFR 进度数据
  const cefrProgressData = useMemo(() => {
    return cefrHistory.map((item) => ({
      date: formatDateLabel(item.date),
      level: item.level,
      levelValue: item.levelValue,
      levelLabel: CEFR_LEVELS[item.levelValue - 1]?.label || item.level,
    }));
  }, [cefrHistory]);

  // 格式化日期标签
  function formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr);
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${month}/${day}`;
  }

  // 获取当前 CEFR 等级信息
  const currentLevelInfo = cefrLevel ? CEFR_LEVELS.find((l) => l.level === cefrLevel) : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题和时间范围选择 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">学习统计仪表盘</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">追踪你的学习进度和成就</p>
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-lg">
          {[7, 30, 90, 365].map((days) => (
            <button
              key={days}
              onClick={() => setTimeRange(days as TimeRange)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                timeRange === days
                  ? 'bg-white dark:bg-gray-700 text-primary-600 dark:text-primary-400 shadow-sm'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              {days === 365 ? '1年' : `${days}天`}
            </button>
          ))}
        </div>
      </div>

      {/* 核心统计卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* 总词汇量 */}
        <StatCard
          title="总词汇量"
          value={totalVocabulary.total.toLocaleString()}
          subtitle={`+${trend?.last30Days[trend.last30Days.length - 1]?.newWordsCount || 0} 新增`}
          icon="📚"
          color="blue"
        />

        {/* 已掌握 */}
        <StatCard
          title="已掌握"
          value={totalVocabulary.mastered.toLocaleString()}
          subtitle={`${totalVocabulary.total > 0 ? Math.round((totalVocabulary.mastered / totalVocabulary.total) * 100) : 0}%`}
          icon="✅"
          color="green"
        />

        {/* 当前连续学习 */}
        <StatCard
          title="连续学习"
          value={`${learningStats?.currentStreak || 0} 天`}
          subtitle={`最长 ${learningStats?.longestStreak || 0} 天`}
          icon="🔥"
          color="orange"
        />

        {/* 学习时长 */}
        <StatCard
          title="学习时长"
          value={formatStudyTime(learningStats?.totalStudyMinutes || 0)}
          subtitle={`日均 ${learningStats?.averageDailyWords || 0} 词`}
          icon="⏱️"
          color="purple"
        />
      </div>

      {/* CEFR 等级进度 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">CEFR 等级进度</h3>
          {currentLevelInfo && (
            <span
              className="text-sm font-medium px-3 py-1 rounded-full text-white"
              style={{ backgroundColor: currentLevelInfo.color }}
            >
              {currentLevelInfo.label}
            </span>
          )}
        </div>

        {/* CEFR 等级进度条 */}
        <div className="relative pt-4 pb-2">
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
            {CEFR_LEVELS.map((l) => (
              <span
                key={l.level}
                className={`transition-colors ${l.level === cefrLevel ? 'font-bold text-gray-900 dark:text-white' : ''}`}
              >
                {l.level}
              </span>
            ))}
          </div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-purple-600 rounded-full transition-all duration-700"
              style={{ width: `${((CEFR_LEVELS.findIndex((l) => l.level === cefrLevel) + 1) / CEFR_LEVELS.length) * 100}%` }}
            />
          </div>
        </div>

        {/* CEFR 各等级词汇分布 */}
        <div className="mt-6 grid grid-cols-3 md:grid-cols-6 gap-3">
          {CEFR_LEVELS.map((level) => {
            const count = stats?.levelDistribution[level.level] || 0;
            const isCurrentLevel = level.level === cefrLevel;
            return (
              <div
                key={level.level}
                className={`text-center p-3 rounded-lg border-2 transition-all ${
                  isCurrentLevel
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50'
                }`}
              >
                <div
                  className="text-lg font-bold mb-1"
                  style={{ color: level.color }}
                >
                  {level.level}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{count} 词</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 图表标签页 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        {/* 标签页头部 */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex">
            <ChartTabButton
              active={activeTab === 'vocabulary'}
              onClick={() => setActiveTab('vocabulary')}
              icon="📈"
              label="词汇趋势"
            />
            <ChartTabButton
              active={activeTab === 'activity'}
              onClick={() => setActiveTab('activity')}
              icon="📊"
              label="学习活动"
            />
            <ChartTabButton
              active={activeTab === 'progress'}
              onClick={() => setActiveTab('progress')}
              icon="🎯"
              label="等级进度"
            />
          </div>
        </div>

        {/* 图表内容 */}
        <div className="p-6">
          {/* 词汇趋势图 */}
          {activeTab === 'vocabulary' && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                词汇量增长趋势（{timeRange}天）
              </h3>
              <div className="h-72">
                {vocabularyTrendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={vocabularyTrendData}>
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
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
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
                ) : (
                  <EmptyChart message="暂无词汇趋势数据" />
                )}
              </div>
            </div>
          )}

          {/* 学习活动图 */}
          {activeTab === 'activity' && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                每日学习活动（{timeRange}天）
              </h3>
              <div className="h-72">
                {activityData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={activityData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis yAxisId="left" tick={{ fontSize: 12 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                      />
                      <Bar yAxisId="left" dataKey="newWords" name="新学单词" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="left" dataKey="reviewWords" name="复习单词" fill="#10b981" radius={[4, 4, 0, 0]} />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="studyMinutes"
                        name="学习时长(分钟)"
                        stroke="#f59e0b"
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="暂无学习活动数据" />
                )}
              </div>
            </div>
          )}

          {/* 等级进度图 */}
          {activeTab === 'progress' && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-4">
                CEFR 等级变化曲线（{timeRange}天）
              </h3>
              <div className="h-72">
                {cefrProgressData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cefrProgressData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        domain={[1, 6]}
                        ticks={[1, 2, 3, 4, 5, 6]}
                        tickFormatter={(value) => CEFR_LEVELS[value - 1]?.level || value}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e5e7eb',
                          borderRadius: '8px',
                          fontSize: '12px',
                        }}
                        formatter={(value: number | undefined) => {
                        const levelValue = value ?? 1;
                        return [CEFR_LEVELS[levelValue - 1]?.label || levelValue, '等级'];
                      }}
                      />
                      <Line
                        type="stepAfter"
                        dataKey="levelValue"
                        name="CEFR 等级"
                        stroke="#8b5cf6"
                        strokeWidth={3}
                        dot={{ fill: '#8b5cf6', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="暂无等级进度数据" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 详细统计表格 */}
      {learningStats && learningStats.recentActivity.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">最近学习记录</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700">
                  <th className="text-left py-3 px-4 font-medium text-gray-600 dark:text-gray-400">日期</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">新学</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">复习</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">认识</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">不认识</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600 dark:text-gray-400">时长</th>
                </tr>
              </thead>
              <tbody>
                {learningStats.recentActivity
                  .slice()
                  .reverse()
                  .map((activity, index) => (
                    <tr
                      key={activity.date}
                      className={`border-b border-gray-100 dark:border-gray-800 last:border-0 ${
                        index % 2 === 0 ? 'bg-gray-50/50 dark:bg-gray-900/30' : ''
                      }`}
                    >
                      <td className="py-3 px-4 text-gray-900 dark:text-white">{activity.date}</td>
                      <td className="py-3 px-4 text-center text-blue-600 dark:text-blue-400">{activity.newWords}</td>
                      <td className="py-3 px-4 text-center text-green-600 dark:text-green-400">{activity.reviewWords}</td>
                      <td className="py-3 px-4 text-center text-green-600 dark:text-green-400">{activity.knownCount}</td>
                      <td className="py-3 px-4 text-center text-red-600 dark:text-red-400">{activity.unknownCount}</td>
                      <td className="py-3 px-4 text-center text-gray-600 dark:text-gray-400">{activity.studyMinutes} 分钟</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 刷新按钮 */}
      <div className="flex justify-end">
        <button
          onClick={loadStatisticsData}
          disabled={isLoading || isSaving}
          className="px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded-lg transition-colors disabled:opacity-50"
        >
          {isLoading ? '加载中...' : '刷新数据'}
        </button>
      </div>
    </div>
  );
}

/**
 * 统计卡片组件
 */
interface StatCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: string;
  color: 'blue' | 'green' | 'orange' | 'purple' | 'red';
}

const COLOR_MAP = {
  blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-100 dark:border-blue-800',
  green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-100 dark:border-green-800',
  orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-100 dark:border-orange-800',
  purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border-purple-100 dark:border-purple-800',
  red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-100 dark:border-red-800',
};

function StatCard({ title, value, subtitle, icon, color }: StatCardProps) {
  return (
    <div className={`rounded-xl border p-4 ${COLOR_MAP[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium opacity-80">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          <p className="text-xs opacity-70 mt-1">{subtitle}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

/**
 * 图表标签页按钮
 */
interface ChartTabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
}

function ChartTabButton({ active, onClick, icon, label }: ChartTabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
        active
          ? 'border-primary-500 text-primary-600 dark:text-primary-400'
          : 'border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/**
 * 空图表占位
 */
function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-gray-500">
      <svg
        className="w-12 h-12 mb-3 opacity-50"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
        />
      </svg>
      <p className="text-sm">{message}</p>
    </div>
  );
}
