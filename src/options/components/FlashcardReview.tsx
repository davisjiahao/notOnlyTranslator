import { useState, useEffect, useCallback, useRef } from 'react';
import type { UnknownWordEntry } from '@/shared/types';
import type { ReviewReminder, MasteryUpdateResult } from '@/shared/types/mastery';
import { logger } from '@/shared/utils';
import { getOptionsUrl } from '@/shared/utils/extensionPages';

interface FlashcardReviewProps {
  isSaving: boolean;
  initialWords?: UnknownWordEntry[];
  onExit?: () => void;
}
type ReviewWord = Pick<ReviewReminder, 'word' | 'context' | 'translation'> & Partial<ReviewReminder>;
const RATINGS = [
  { label: '完全忘记', description: '完全想不起来' },
  { label: '模糊记忆', description: '有点印象但不清楚' },
  { label: '想起来', description: '想了一会儿才记起' },
  { label: '比较熟练', description: '犹豫一下就想起来了' },
  { label: '立即想起', description: '立刻就想起来了' },
];
const primary = 'px-4 py-2 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500';
const secondary = 'px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';

export default function FlashcardReview({ isSaving, initialWords, onExit }: FlashcardReviewProps) {
  const [words, setWords] = useState<ReviewWord[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [rating, setRating] = useState<number | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState<MasteryUpdateResult | null>(null);
  const [ratings, setRatings] = useState<number[]>([]);
  const [skipped, setSkipped] = useState(0);
  const pending = useRef(false);
  const requestId = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = initialWords ? { success: true, data: initialWords } : await chrome.runtime.sendMessage({ type: 'GET_REVIEW_WORDS', payload: { limit: 20 } });
      if (!response?.success || !Array.isArray(response.data)) throw new Error('加载失败');
      if (id !== requestId.current) return;
      setWords(response.data);
      setIndex(0);
      setFlipped(false);
      setRating(null);
      setRatings([]);
      setSkipped(0);
      setSaved(false);
      setSaveError(false);
      setResult(null);
      pending.current = false;
      returnFocus.current = true;
    } catch (error) {
      if (id === requestId.current) { setLoadError(true); logger.error('加载复习单词失败', error); }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [initialWords]);
  useEffect(() => {
    const generation = requestId;
    void load();
    return () => { generation.current++; };
  }, [load]);

  const complete = !isLoading && !loadError && words.length > 0 && index >= words.length;
  useEffect(() => {
    if (!returnFocus.current || isLoading) return;
    returnFocus.current = false;
    if (document.activeElement !== document.body && !root.current?.contains(document.activeElement)) return;
    (complete ? heading.current : saved ? nextButton.current : card.current)?.focus();
  }, [index, complete, isLoading, saved]);

  const chooseRating = (value: number) => {
    if (pending.current || isSaving || !flipped || saved) return;
    setRating(value);
    setSaveError(false);
  };
  const saveRating = async () => {
    if (pending.current || isSaving || rating === null || !words[index] || saved) return;
    const hadFocus = !!root.current?.contains(document.activeElement);
    pending.current = true;
    setSubmitting(true);
    setSaveError(false);
    const current = words[index];
    const id = requestId.current;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'MARK_WORD_KNOWN', payload: {
        word: current.word, context: current.context, translation: current.translation,
        isKnown: rating >= 3, wordDifficulty: rating === 5 ? 3 : rating === 1 ? 8 : 6 - rating,
      } });
      if (!response?.success) throw new Error('保存未成功');
      if (id !== requestId.current) return;
      returnFocus.current = !!root.current?.contains(document.activeElement) || (hadFocus && document.activeElement === document.body);
      setRatings(previous => [...previous, rating]);
      setResult(response.data?.masteryResult ?? null);
      setSaved(true);
    } catch (error) {
      if (id === requestId.current) { setSaveError(true); logger.error('保存复习评分失败', error); }
      pending.current = false;
    } finally {
      if (id === requestId.current) setSubmitting(false);
    }
  };
  const advance = (skip = false) => {
    if (submitting || isSaving) return;
    if (skip) setSkipped(count => count + 1);
    returnFocus.current = true;
    setIndex(value => value + 1);
    setFlipped(false);
    setRating(null);
    setSaved(false);
    setResult(null);
    setSaveError(false);
    pending.current = false;
  };
  const exit = () => {
    if (submitting) return;
    if (onExit) onExit();
    else window.location.href = getOptionsUrl('vocabulary');
  };
  const current = words[index];

  return (
    <div ref={root} className="max-w-2xl mx-auto space-y-5 text-gray-900 dark:text-gray-100" onKeyDown={event => {
      if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || isLoading || loadError || complete || submitting || saved) return;
      const target = event.target as HTMLElement;
      if (target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],button,a')) return;
      if (flipped && /^[1-5]$/.test(event.key)) { event.preventDefault(); chooseRating(Number(event.key)); }
    }}>
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <h2 className="text-lg font-semibold">{initialWords ? '生词本复习' : '到期复习'}</h2>
        <button className={secondary} onClick={exit} disabled={submitting}>返回生词本</button>
      </div>
      {isLoading ? <p role="status">加载复习单词...</p> : loadError ? (
        <div role="alert" className="text-red-700 dark:text-red-300">加载复习单词失败。<button onClick={() => void load()} className={`${secondary} ml-2`}>重试加载</button></div>
      ) : words.length === 0 ? (
        <div className="py-8 space-y-3" role="status">
          <h3 className="font-medium">没有需要复习的单词</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">暂无到期记录，不代表全部词汇已掌握。可以从生词本选择词汇手动复习。</p>
          <button onClick={() => void load()} className={secondary}>重新检查</button>
        </div>
      ) : complete ? (
        <section className="space-y-5">
          <h3 ref={heading} tabIndex={-1} className="text-2xl font-semibold">本轮已结束</h3>
          <p role="status">已保存 {ratings.length} 个评分，跳过 {skipped} 个。跳过的词未计入复习结果。</p>
          {ratings.length > 0 && <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div><dt>本轮自评熟练（4–5 分）</dt><dd className="text-xl font-semibold">{ratings.filter(value => value >= 4).length} / {ratings.length}</dd></div>
            <div><dt>本轮平均自评分</dt><dd className="text-xl font-semibold">{(ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(1)} / 5</dd></div>
          </dl>}
          <p className="text-sm text-gray-600 dark:text-gray-300">自评分不是测试正确率，也不代表全部词汇已掌握。已确认的评分不能在此回滚。</p>
          <button onClick={() => void load()} className={primary}>{initialWords ? '再练本轮词汇' : '检查剩余到期词'}</button>
        </section>
      ) : current && (
        <>
          <p className="text-sm text-gray-600 dark:text-gray-300">卡片 {index + 1} / {words.length}</p>
          <progress className="w-full h-2 accent-primary-600" aria-label="本轮已处理卡片" max={words.length} value={index} />
          <div ref={card} role="button" tabIndex={0} aria-label={flipped ? '查看释义' : '点击或按空格查看释义'}
            className="min-h-48 sm:min-h-64 p-5 sm:p-8 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 cursor-pointer break-words focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500"
            onClick={() => setFlipped(true)} onKeyDown={event => {
              if (event.repeat || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setFlipped(true); }
            }}>
            <h3 className={`${flipped ? 'text-2xl' : 'text-4xl'} font-semibold text-gray-800 dark:text-gray-100`}>{current.word}</h3>
            {flipped ? <div className="mt-5 space-y-3"><p className="text-xl text-primary-700 dark:text-primary-300">{current.translation || '暂无释义'}</p>{current.context && <p className="text-gray-600 dark:text-gray-300">{current.context}</p>}</div>
              : <p className="mt-5 text-sm text-gray-600 dark:text-gray-300">点击卡片或按空格键查看释义</p>}
            {current.masteryLevel !== undefined && <p className="mt-5 text-sm text-gray-600 dark:text-gray-300">当前掌握度估算：{Math.round(current.masteryLevel * 100)}%</p>}
            {(current.daysOverdue ?? 0) > 0 && <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">已逾期 {current.daysOverdue} 天</p>}
          </div>
          {flipped && !saved && <div className="space-y-3">
            <p className="text-sm">选择本题自评分（卡片聚焦时可按 1–5），确认前可更改。</p>
            <div role="group" aria-label="本题自评分" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5.5rem),1fr))] gap-2">
              {RATINGS.map((item, i) => <button key={item.label} aria-pressed={rating === i + 1} aria-label={`${i + 1} - ${item.label}：${item.description}`} disabled={submitting || isSaving} onClick={() => chooseRating(i + 1)}
                className={`min-w-0 py-3 px-1 rounded-lg text-sm border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:opacity-50 ${rating === i + 1 ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800'}`}>
                <span className="block font-semibold text-lg">{i + 1}</span><span className="block mt-1 break-words">{item.label}</span>
              </button>)}
            </div>
            {rating !== null && <div className="space-y-3">
              <p className="text-sm text-gray-600 dark:text-gray-300">{rating >= 3 ? '确认后将标记为认识，并移出生词本。' : '确认后将标记为不认识，并保留在生词本。'}评分会影响学习估算和复习时间；保存后不能在此撤销。</p>
              <div className="flex flex-wrap gap-3"><button onClick={() => void saveRating()} disabled={submitting || isSaving} className={primary}>{submitting ? '正在保存…' : '确认保存评分'}</button><button onClick={() => { setRating(null); setSaveError(false); card.current?.focus(); }} disabled={submitting} className={secondary}>撤销本题评分</button></div>
            </div>}
          </div>}
          {saveError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">未确认保存成功，当前题目已保留。后台可能已完成部分写入，请核对学习数据后重试。</p>}
          {saved ? <div className="space-y-3">
            <p role="status" className="text-sm text-green-800 dark:text-green-300">评分已保存。{result && `下次复习：${result.nextReviewInterval < 1 ? '今天' : `${result.nextReviewInterval} 天后`}；掌握度估算 ${Math.round(result.newMasteryLevel * 100)}%。`}</p>
            <button ref={nextButton} onClick={() => advance()} className={primary}>{index + 1 === words.length ? '查看本轮结果' : '下一词'}</button>
          </div> : <button onClick={() => advance(true)} disabled={submitting || isSaving} className={secondary}>跳过（不保存）</button>}
        </>
      )}
    </div>
  );
}
