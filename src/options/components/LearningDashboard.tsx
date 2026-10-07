import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserProfile } from '@/shared/types';
import type { MasteryProfile, WordMasteryStats } from '@/shared/types/mastery';
import { CEFR_LEVEL_ORDER, getCEFRLevelByVocabulary } from '@/shared/constants/mastery';
import { getLearningRecordDays } from '@/shared/utils/learningRecords';
import { getOptionsUrl } from '@/shared/utils/extensionPages';
import { logger } from '@/shared/utils';
import { StatsCharts } from './StatsCharts';

interface Snapshot {
  user: UserProfile;
  mastery: MasteryProfile | null;
  stats: WordMasteryStats | null;
}
interface LearningDashboardProps { isSaving: boolean; mode: 'statistics' | 'mastery' }
const panel = 'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6';
const action = 'rounded-lg px-3 py-2 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';

/** 两个统计入口共用同一快照口径，不把当前掌握度回填成历史。 */
export default function LearningDashboard({ isSaving, mode }: LearningDashboardProps) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [days, setDays] = useState(30);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setFailed(false);
    setData(null);
    try {
      const [overview, profile] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_MASTERY_OVERVIEW' }),
        chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE' }),
      ]);
      if (!overview?.success || !overview.data || !profile?.success || !profile.data) throw new Error('学习数据不可用');
      if (id === requestId.current) setData({ user: profile.data, mastery: overview.data.profile ?? null, stats: overview.data.stats ?? null });
    } catch (error) {
      if (id === requestId.current) { setFailed(true); logger.error('加载学习数据失败', error); }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const generation = requestId;
    void load();
    return () => { generation.current++; };
  }, [load]);
  const records = useMemo(() => getLearningRecordDays(Object.values(data?.mastery?.wordMastery ?? {}), days), [data, days]);
  const stats = data?.stats;
  const groups = [
    ['跟踪词汇', stats?.totalWords ?? 0],
    ['估算已掌握', stats?.masteredWords ?? 0],
    ['学习中', stats?.learningWords ?? 0],
    ['需加强', stats?.strugglingWords ?? 0],
  ] as const;

  return (
    <div className="space-y-6 text-gray-900 dark:text-gray-100">
      <header className="flex flex-wrap gap-3 justify-between items-center">
        <h2 className="text-lg font-semibold">{mode === 'mastery' ? '词汇掌握度概览' : '学习统计'}</h2>
        <button onClick={() => void load()} disabled={isSaving || loading} className={action}>刷新数据</button>
      </header>
      {loading ? <p role="status" aria-label="加载学习统计数据" className="py-8 text-gray-600 dark:text-gray-300">加载学习数据…</p>
        : failed ? <p role="alert" className="text-red-700 dark:text-red-300">加载学习数据失败，暂不显示数量。请刷新数据重试。</p>
        : data && <>
          <section className={panel}>
            <h3 className="font-semibold mb-4">当前掌握度</h3>
            {!stats?.totalWords && <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">暂无掌握度记录</p>}
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {groups.map(([label, count]) => <div key={label}><dt className="text-sm text-gray-600 dark:text-gray-300">{label}</dt><dd className="text-2xl font-semibold tabular-nums mt-1">{count.toLocaleString()}</dd></div>)}
            </dl>
            <p className="mt-5 text-sm text-gray-600 dark:text-gray-300">掌握度来自标记与复习模型：≥80% 为估算已掌握，30%–80% 为学习中，低于30% 为需加强。跟踪词汇不是你的总词汇量。</p>
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-4 items-center justify-between">
              <div><p className="font-medium">到期待复习：{stats?.dueForReview ?? 0} 词</p><p className="mt-1 text-sm text-gray-600 dark:text-gray-300">到期待复习与上述分类重叠，不另外相加。</p></div>
              <a href={getOptionsUrl((stats?.dueForReview ?? 0) > 0 ? 'review' : 'vocabulary')} className="rounded-lg px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500">{(stats?.dueForReview ?? 0) > 0 ? '开始到期复习' : '前往生词本'}</a>
            </div>
          </section>
          <section className={panel}>
            <h3 className="font-semibold mb-4">学习估算与标记</h3>
            <StatsCharts vocabularySize={data.user.estimatedVocabulary} confidence={data.user.levelConfidence} knownCount={data.user.knownWords.length} unknownCount={data.user.unknownWords.length} />
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-300">CEFR 词汇量参考：{getCEFRLevelByVocabulary(data.user.estimatedVocabulary)}。仅按词汇量区间映射，不是语言能力认证；未保存等级变化历史。</p>
          </section>
          {mode === 'mastery' && <section className={panel}>
            <h3 className="font-semibold mb-2">当前词条难度分布</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">模型对已跟踪词条的 CEFR 难度估计，不是你的各项语言能力得分。</p>
            <dl className="grid grid-cols-3 sm:grid-cols-6 gap-4">{CEFR_LEVEL_ORDER.map(level => <div key={level}><dt>{level}</dt><dd className="font-semibold tabular-nums">{stats?.levelDistribution[level] ?? 0} 词</dd></div>)}</dl>
          </section>}
          <section className={panel}>
            <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
              <h3 className="font-semibold">可追溯词条记录</h3>
              <div role="group" aria-label="记录时间范围" className="flex flex-wrap gap-2">{[7, 30, 90, 365].map(value => <button key={value} aria-pressed={days === value} onClick={() => setDays(value)} className={`${action} text-sm ${days === value ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-800 dark:text-primary-200' : ''}`}>{value}天</button>)}</div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">按本地日期汇总当前保留的保存时间与最近一次复习时间，不是完整学习历史。更早的复习未逐次记录，因此不展示连续天数、学习时长或增长率。</p>
            {records.length ? <div role="region" aria-label="词条记录，可横向滚动" tabIndex={0} className="overflow-x-auto rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"><table aria-label="可追溯词条记录" className="w-full min-w-[24rem] text-sm text-left tabular-nums">
              <thead><tr className="border-b border-gray-200 dark:border-gray-700"><th scope="col" className="py-3 pr-3">日期</th><th scope="col" className="py-3 pr-3">保存词条</th><th scope="col" className="py-3">最近复习词条</th></tr></thead>
              <tbody>{records.map(record => <tr key={record.date} className="border-b last:border-0 border-gray-100 dark:border-gray-700"><th scope="row" className="py-3 pr-3 font-normal whitespace-nowrap">{record.date}</th><td className="py-3 pr-3">{record.savedWords}</td><td className="py-3">{record.reviewedWords}</td></tr>)}</tbody>
            </table></div> : <p className="py-6 text-sm text-gray-600 dark:text-gray-300" role="status">所选范围没有可追溯记录</p>}
          </section>
        </>}
    </div>
  );
}
