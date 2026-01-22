
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
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h2 className="text-sm font-medium text-gray-500 mb-3">学习统计</h2>

      {/* Vocabulary size */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-bold text-primary-600">
            {stats.estimatedVocabulary.toLocaleString()}
          </span>
          <span className="text-sm text-gray-500">词汇量</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="px-2 py-0.5 text-xs font-medium bg-primary-100 text-primary-700 rounded">
            {stats.level}
          </span>
          <span className="text-xs text-gray-400">
            置信度: {Math.round(stats.confidence * 100)}%
          </span>
        </div>
      </div>

      {/* Word counts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-green-50 rounded-lg p-3">
          <div className="text-2xl font-semibold text-green-600">
            {stats.knownWordsCount}
          </div>
          <div className="text-xs text-green-600">已掌握</div>
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <div className="text-2xl font-semibold text-amber-600">
            {stats.unknownWordsCount}
          </div>
          <div className="text-xs text-amber-600">待学习</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
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
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-300"
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
