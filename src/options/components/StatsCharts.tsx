interface StatsChartsProps {
  vocabularySize: number;
  knownCount: number;
  unknownCount: number;
  confidence: number;
}

/** 当前快照没有时间序列，不用模拟图表补齐历史。主题沿用页面根元素。 */
export function StatsCharts({ vocabularySize, knownCount, unknownCount, confidence }: StatsChartsProps) {
  const metrics = [
    ['学习估算词汇量', vocabularySize.toLocaleString()],
    ['已标记认识', knownCount.toLocaleString()],
    ['生词本收藏', unknownCount.toLocaleString()],
    ['词汇量估算置信度', `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`],
  ];
  return (
    <div className="space-y-5 text-sm text-gray-700 dark:text-gray-300">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">{value}</dd>
          </div>
        ))}
      </dl>
      <p>已标记认识是你的选择，不等于通过复习估算已掌握；置信度也不是正确率。</p>
      <section className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <h3 className="font-medium text-gray-900 dark:text-white">词汇量历史：数据不足</h3>
        <p className="mt-2">尚未记录历史词汇量，暂不展示增长趋势。当前估算会随标记和水平设置变化。</p>
      </section>
    </div>
  );
}
