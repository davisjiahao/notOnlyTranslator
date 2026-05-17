
/**
 * 将中文等级映射到 CEFR 参照
 */
const levelToCEFR: Record<string, string> = {
  '初级': '~A2, 1500词',
  '中级': '~B1, 3000词',
  '中高级': '~B2, 5000词',
  '高级': '~C1, 8000词',
  '专家级': '~C2, 12000词',
};

interface Stats {
  estimatedVocabulary: number;
  knownWordsCount: number;
  unknownWordsCount: number;
  confidence: number;
  level: string;
}

interface StatsCardProps {
  stats: Stats;
}

export default function StatsCard({ stats }: StatsCardProps) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="text-sm font-medium text-gray-500 dark:text-gray-300 mb-3">学习统计</h2>

      {/* Vocabulary size */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-bold text-primary-600">
            {stats.estimatedVocabulary.toLocaleString()}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-300">词汇量</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="relative group">
            <span className="px-2 py-0.5 text-xs font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded cursor-help">
              {stats.level}
            </span>
            {/* CEFR 参照 tooltip — F2.1 */}
            {levelToCEFR[stats.level] && (
              <span className="absolute bottom-full left-0 mb-1 px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap">
                {levelToCEFR[stats.level]}
                <span className="absolute top-full left-3 -mt-px w-2 h-2 bg-gray-900 dark:bg-gray-700 transform rotate-45" />
              </span>
            )}
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-300">
            置信度: {Math.round(stats.confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Word counts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
          <div className="text-2xl font-semibold text-green-600 dark:text-green-400">
            {stats.knownWordsCount}
          </div>
          <div className="text-xs text-green-600 dark:text-green-400">已掌握</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
          <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400">
            {stats.unknownWordsCount}
          </div>
          <div className="text-xs text-amber-600 dark:text-amber-400">待学习</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-300 mb-1">
          <span>学习进度</span>
          <span>
            {stats.knownWordsCount + stats.unknownWordsCount > 0
              ? Math.round(
                  (stats.knownWordsCount /
                    (stats.knownWordsCount + stats.unknownWordsCount)) *
                    100
                )
              : 0}
            %
          </span>
        </div>
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-300"
            role="progressbar"
            aria-valuenow={stats.knownWordsCount + stats.unknownWordsCount > 0
              ? Math.round((stats.knownWordsCount / (stats.knownWordsCount + stats.unknownWordsCount)) * 100)
              : 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="学习进度"
            style={{
              width: `${
                stats.knownWordsCount + stats.unknownWordsCount > 0
                  ? (stats.knownWordsCount /
                      (stats.knownWordsCount + stats.unknownWordsCount)) *
                    100
                  : 0
              }%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
