import { useState, useEffect, useRef, useCallback } from 'react';
import type { UnknownWordEntry } from '@/shared/types';
import { formatDate, logger } from '@/shared/utils';
import VocabularyExportImport from './VocabularyExportImport';
import FlashcardReview from './FlashcardReview';

interface VocabularySettingsProps { isSaving: boolean }
const action = 'px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500';

export default function VocabularySettings({ isSaving }: VocabularySettingsProps) {
  const [words, setWords] = useState<UnknownWordEntry[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'recent' | 'alpha'>('recent');
  const [pendingClear, setPendingClear] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState<UnknownWordEntry | null>(null);
  const [review, setReview] = useState<UnknownWordEntry[] | null>(null);
  const lock = useRef(false);
  const loadId = useRef(0);
  const search = useRef<HTMLInputElement>(null);
  const undo = useRef<HTMLButtonElement>(null);
  const restoreSearchFocus = useRef(false);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true);
    setLoadError(false);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_VOCABULARY' });
      if (!response?.success || !Array.isArray(response.data)) throw new Error('加载失败');
      if (id === loadId.current) setWords(response.data);
    } catch (failure) {
      if (id === loadId.current) { setLoadError(true); logger.error('加载生词本失败', failure); }
    } finally { if (id === loadId.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const generation = loadId;
    void load();
    return () => { generation.current++; };
  }, [load]);
  useEffect(() => {
    if (removed && document.activeElement === document.body) undo.current?.focus();
  }, [removed]);
  useEffect(() => {
    if (restoreSearchFocus.current && !isLoading && !review) {
      restoreSearchFocus.current = false;
      if (document.activeElement === document.body) search.current?.focus();
    }
  }, [isLoading, review]);

  const mutate = async (operation: () => Promise<void>) => {
    if (lock.current || isSaving) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try { await operation(); } finally { lock.current = false; setBusy(false); }
  };
  const removeWord = (entry: UnknownWordEntry) => void mutate(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'REMOVE_FROM_VOCABULARY', payload: { word: entry.word } });
      if (!response?.success) throw new Error('移除未成功');
      setWords(previous => previous.filter(word => word.word !== entry.word));
      setRemoved(entry);
      setNotice(`已移除 ${entry.word}。仅移出生词本，掌握度记录不变。`);
    } catch (failure) { setError('移除失败，词条已保留。请核对后重试。'); logger.error('移除词条失败', failure); }
  });
  const undoRemove = () => void mutate(async () => {
    if (!removed) return;
    try {
      // 恢复保留原词条并跳过已有新状态的词，允许应用自身保存的空释义。
      const response = await chrome.runtime.sendMessage({ type: 'ADD_TO_VOCABULARY', payload: { ...removed, skipIfExists: true } });
      if (!response?.success) throw new Error('恢复未成功');
      setRemoved(null);
      setNotice(response.data?.added === true ? `已恢复 ${removed.word}。` : '词条已有新状态，未覆盖；请核对当前生词本。');
      restoreSearchFocus.current = true;
      await load();
    } catch (failure) { setError('恢复失败，可再次撤销移除。'); logger.error('恢复词条失败', failure); }
  });
  const clearAll = () => void mutate(async () => {
    let count = 0;
    setRemoved(null);
    try {
      for (const entry of words) {
        const response = await chrome.runtime.sendMessage({ type: 'REMOVE_FROM_VOCABULARY', payload: { word: entry.word } });
        if (!response?.success) throw new Error('清空未完成');
        count++;
        setWords(previous => previous.filter(word => word.word !== entry.word));
      }
      setNotice(`已移除 ${count} 个收藏，掌握度记录不变。`);
    } catch (failure) {
      setError(`清空未完成：已移除 ${count} 个，其余词条已保留，请核对后重试。`);
      logger.error('清空生词本失败', failure);
    } finally { setPendingClear(false); search.current?.focus(); }
  });
  const filtered = words.filter(word => `${word.word}\n${word.translation}`.toLowerCase().includes(searchTerm.trim().toLowerCase()))
    .sort((a, b) => sortBy === 'recent' ? b.markedAt - a.markedAt : a.word.localeCompare(b.word));
  const disabled = busy || isSaving;

  if (review) return <FlashcardReview isSaving={isSaving} initialWords={review} onExit={() => { setReview(null); restoreSearchFocus.current = true; void load(); }} />;
  if (isLoading) return <p role="status" aria-label="加载生词本" className="py-8 text-gray-600 dark:text-gray-300">加载生词本…</p>;
  if (loadError) return <div role="alert" className="text-red-700 dark:text-red-300">加载生词本失败，无法确认收藏数量。<button onClick={() => void load()} className={`${action} ml-2`}>重试加载</button></div>;

  return (
    <div className="space-y-6 text-gray-900 dark:text-gray-100">
      <fieldset disabled={disabled}><legend className="sr-only">生词本导入导出</legend><VocabularyExportImport words={words} onImportComplete={load} /></fieldset>
      <section className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 sm:p-6 space-y-4">
        <h2 className="text-lg font-semibold">生词本收藏</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">收藏不等于掌握度记录。可直接复习当前列表，每轮最多 20 词；到期复习另按已建立的掌握度记录安排。</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 min-w-0"><label htmlFor="vocab-search" className="sr-only">搜索单词或翻译</label><input ref={search} id="vocab-search" value={searchTerm} onChange={event => setSearchTerm(event.target.value)} placeholder="搜索单词或翻译..." className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500" /></div>
          <label htmlFor="vocab-sort" className="sr-only">排序方式</label><select id="vocab-sort" value={sortBy} onChange={event => setSortBy(event.target.value as 'recent' | 'alpha')} className="px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 dark:bg-gray-900"><option value="recent">最近添加</option><option value="alpha">字母排序</option></select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">共 {filtered.length} 个词汇{searchTerm && `（筛选自 ${words.length} 个）`}</p>
          <button disabled={disabled || filtered.length === 0} onClick={() => { setRemoved(null); setPendingClear(false); setError(''); setNotice(''); setReview(filtered.slice(0, 20)); }} className="px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500">{searchTerm ? `复习筛选结果（${Math.min(filtered.length, 20)}）` : `开始复习（${Math.min(filtered.length, 20)}）`}</button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
        {(notice || removed) && <div className="flex flex-wrap gap-3 items-center text-sm"><p role="status">{notice}</p>{removed && <button ref={undo} disabled={disabled} onClick={undoRemove} className={action}>撤销移除</button>}</div>}
        {words.length === 0 ? <div role="status" className="py-8 text-center"><p>生词本为空</p><p className="text-sm text-gray-600 dark:text-gray-300 mt-2">阅读时收藏词汇，或从文件导入后开始复习。</p></div> : filtered.length === 0 ? <div role="status" className="py-8 text-center"><p>未找到匹配的词汇</p><button onClick={() => { setSearchTerm(''); search.current?.focus(); }} className={`${action} mt-3`}>清除筛选</button></div> : <ul className="space-y-2 max-h-[480px] overflow-y-auto">
          {filtered.map(entry => <li key={entry.word} className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 flex items-start gap-3">
            <div className="flex-1 min-w-0 break-words"><h3 className="font-medium">{entry.word}</h3><p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{entry.translation || '暂无释义'}</p>{entry.context && <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{entry.context}</p>}<p className="text-xs text-gray-600 dark:text-gray-300 mt-2">收藏于 {formatDate(entry.markedAt)}</p></div>
            <button onClick={() => removeWord(entry)} aria-label={`移除：${entry.word}`} disabled={disabled} className={`${action} text-sm shrink-0`}>移除</button>
          </li>)}
        </ul>}
        {words.length > 0 && <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          {pendingClear ? <div className="flex flex-wrap items-center gap-3"><p className="text-sm text-red-700 dark:text-red-300">清空整个生词本的 {words.length} 个收藏？不受当前筛选限制，无法批量撤销。</p><button onClick={clearAll} disabled={disabled} className={action}>确认清空</button><button onClick={() => setPendingClear(false)} disabled={disabled} className={action}>取消</button></div> : <button onClick={() => setPendingClear(true)} disabled={disabled} className={`${action} text-sm text-red-700 dark:text-red-300`}>清空生词本</button>}
        </div>}
      </section>
    </div>
  );
}
