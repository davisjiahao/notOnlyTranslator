import type { HeatmapDataPoint } from '@/shared/types/mastery';

interface LearningHeatmapProps {
  data: HeatmapDataPoint[];
  weeks?: number;
}

const INTENSITY_COLORS = {
  0: 'bg-gray-100 dark:bg-gray-800',
  1: 'bg-green-200 dark:bg-green-900/40',
  2: 'bg-green-300 dark:bg-green-800/50',
  3: 'bg-green-400 dark:bg-green-700/60',
  4: 'bg-green-600 dark:bg-green-600/80',
};

const TYPE_INDICATORS = {
  new: 'border-l-4 border-l-blue-400',
  review: 'border-l-4 border-l-amber-400',
  mixed: '',
};

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

export default function LearningHeatmap({ data, weeks = 26 }: LearningHeatmapProps) {
  // 按周分组数据
  const weeksData: HeatmapDataPoint[][] = [];
  for (let i = 0; i < weeks; i++) {
    const weekStart = i * 7;
    const weekData = data.slice(weekStart, weekStart + 7);
    weeksData.push(weekData);
  }

  // 计算统计信息
  const totalActivity = data.reduce((sum, d) => sum + d.count, 0);
  const activeDays = data.filter((d) => d.count > 0).length;
  const maxStreak = calculateMaxStreak(data);

  // 获取月份标签
  const monthLabels = getMonthLabels(data, weeks);

  return (
    <div className="space-y-4">
      {/* 统计摘要 */}
      <div className="flex items-center gap-6 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400">总活动:</span>{' '}
          <span className="font-semibold text-gray-900 dark:text-white">{totalActivity}</span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">活跃天数:</span>{' '}
          <span className="font-semibold text-gray-900 dark:text-white">{activeDays}</span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400">最长连续:</span>{' '}
          <span className="font-semibold text-gray-900 dark:text-white">{maxStreak} 天</span>
        </div>
      </div>

      {/* 热力图 */}
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* 月份标签 */}
          <div className="flex mb-1">
            <div className="w-8" /> {/* 星期标签占位 */}
            <div className="flex-1 flex relative h-5">
              {monthLabels.map((label, index) => (
                <div
                  key={index}
                  className="absolute text-xs text-gray-500 dark:text-gray-400"
                  style={{ left: `${label.position}%` }}
                >
                  {label.month}
                </div>
              ))}
            </div>
          </div>

          {/* 热力图主体 */}
          <div className="flex">
            {/* 星期标签 */}
            <div className="w-8 flex flex-col justify-around py-1">
              {WEEKDAY_LABELS.map((day, index) => (
                <div
                  key={day}
                  className={`text-xs text-gray-500 dark:text-gray-400 h-3 flex items-center ${
                    index % 2 === 0 ? 'invisible' : ''
                  }`}
                >
                  {day}
                </div>
              ))}
            </div>

            {/* 周数据 */}
            <div className="flex gap-1">
              {weeksData.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col gap-1">
                  {week.map((day, dayIndex) => (
                    <div
                      key={dayIndex}
                      className={`
                        w-3 h-3 rounded-sm ${INTENSITY_COLORS[day.intensity as keyof typeof INTENSITY_COLORS]}
                        ${TYPE_INDICATORS[day.type]}
                        cursor-pointer hover:ring-2 hover:ring-gray-400 transition-all
                      `}
                      title={`${day.date}: ${day.count} 个单词 (${getActivityTypeLabel(day.type)})`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {/* 图例 */}
          <div className="flex items-center gap-2 mt-3 text-xs text-gray-500 dark:text-gray-400">
            <span>少</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <div
                key={level}
                className={`w-3 h-3 rounded-sm ${INTENSITY_COLORS[level as keyof typeof INTENSITY_COLORS]}`}
              />
            ))}
            <span>多</span>

            <div className="ml-4 flex items-center gap-2">
              <div className="w-3 h-3 bg-green-300 border-l-4 border-l-blue-400 rounded-sm" />
              <span>新词</span>
              <div className="w-3 h-3 bg-green-300 border-l-4 border-l-amber-400 rounded-sm ml-2" />
              <span>复习</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// 计算最大连续天数
function calculateMaxStreak(data: HeatmapDataPoint[]): number {
  let maxStreak = 0;
  let currentStreak = 0;

  for (const day of data) {
    if (day.count > 0) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

// 获取活动类型标签
function getActivityTypeLabel(type: HeatmapDataPoint['type']): string {
  switch (type) {
    case 'new':
      return '新学';
    case 'review':
      return '复习';
    default:
      return '混合';
  }
}

// 获取月份标签位置
function getMonthLabels(
  data: HeatmapDataPoint[],
  weeks: number
): Array<{ month: string; position: number }> {
  const labels: Array<{ month: string; position: number }> = [];
  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  let lastMonth = -1;

  for (let weekIndex = 0; weekIndex < weeks; weekIndex++) {
    const dayIndex = weekIndex * 7;
    if (dayIndex >= data.length) break;

    const date = new Date(data[dayIndex].date);
    const month = date.getMonth();

    if (month !== lastMonth) {
      labels.push({
        month: monthNames[month],
        position: (weekIndex / weeks) * 100,
      });
      lastMonth = month;
    }
  }

  return labels;
}
