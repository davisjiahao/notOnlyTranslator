import { useEffect, useState } from 'react';
import type { WordMasteryStats, ReviewReminder } from '@/shared/types/mastery';
import { logger } from '@/shared/utils';
import { getOptionsUrl } from '@/shared/utils/extensionPages';

export default function MasteryCard() {
  const [stats, setStats] = useState<WordMasteryStats | null>(null);
  const [reviewWords, setReviewWords] = useState<ReviewReminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showReviews, setShowReviews] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const [overview, reviews] = await Promise.all([
        chrome.runtime.sendMessage({ type: 'GET_MASTERY_OVERVIEW' }),
        chrome.runtime.sendMessage({ type: 'GET_REVIEW_WORDS', payload: { limit: 5 } }),
      ]);
      if (!overview?.success || !overview.data || !reviews?.success || !Array.isArray(reviews.data)) throw new Error('加载失败');
      setStats(overview.data.stats ?? null);
      setReviewWords(reviews.data);
    } catch (error) {
      logger.error('加载掌握度概览失败', error);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const openOptions = (tab: string) => { void chrome.tabs.create({ url: getOptionsUrl(tab) }); };
  const buttonClass = 'text-xs text-primary-700 dark:text-primary-300 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';
  if (isLoading) return <div role="status" aria-label="加载掌握度数据" className="p-4 text-sm text-gray-600 dark:text-gray-300">加载掌握度数据…</div>;

  return (
    <section className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">词汇掌握度估算</h3>
        <button onClick={() => openOptions('vocabulary')} className={buttonClass}>查看全部</button>
      </div>
      {loadError ? (
        <div role="alert" className="text-sm text-red-700 dark:text-red-300">
          掌握度加载失败，无法确认当前数量。
          <button onClick={() => void load()} className="mt-2 block underline">重试加载</button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 mb-3 text-center text-sm text-gray-700 dark:text-gray-300">
            <button onClick={() => setShowReviews(!showReviews)} aria-expanded={showReviews} aria-label={`待复习单词：${stats?.dueForReview ?? 0} 个`} className="rounded-lg p-2 bg-gray-50 dark:bg-gray-900/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">
              <span className="block text-lg font-semibold tabular-nums">{stats?.dueForReview ?? 0}</span>到期待复习
            </button>
            <div className="p-2"><span className="block text-lg font-semibold tabular-nums">{stats?.masteredWords ?? 0}</span>估算已掌握</div>
            <div className="p-2"><span className="block text-lg font-semibold tabular-nums">{stats?.totalWords ?? 0}</span>跟踪词汇</div>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300">估算已掌握：标记与复习模型的掌握度 ≥ 80%，不等同于已标记认识。</p>
          {showReviews && (
            <div className="mt-3 text-sm text-gray-700 dark:text-gray-300">
              {reviewWords.length ? <ul className="space-y-2">{reviewWords.map(word => <li key={word.word} className="break-words"><strong>{word.word}</strong> · {word.translation || word.context}{word.daysOverdue > 0 && `（逾期 ${word.daysOverdue} 天）`}</li>)}</ul> : <p>暂无到期待复习词，可从生词本手动开始。</p>}
            </div>
          )}
          {(stats?.dueForReview ?? 0) > 0 && (
            <button onClick={() => openOptions('review')} className="mt-3 w-full py-2 px-3 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500">开始复习 ({stats?.dueForReview})</button>
          )}
        </>
      )}
      <button onClick={() => openOptions('mastery')} className={`${buttonClass} mt-3`}>详情</button>
    </section>
  );
}
