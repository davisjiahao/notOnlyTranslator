import { useState, useEffect } from 'react';
import type { WordContext } from '@/shared/types/vocabulary';

interface ContextualLearningCardProps {
  /** 单词 */
  word: string;
  /** 单词翻译 */
  translation?: string;
  /** 上下文列表 */
  contexts: WordContext[];
  /** 是否显示答案 */
  showAnswer: boolean;
  /** 评分回调 */
  onRate: (rating: number) => void;
  /** 是否正在提交 */
  isSubmitting?: boolean;
}

/**
 * 语境学习卡片组件
 *
 * 在真实语境中展示单词，帮助用户理解单词的用法。
 */
export default function ContextualLearningCard({
  word,
  translation,
  contexts,
  showAnswer,
  onRate,
  isSubmitting = false,
}: ContextualLearningCardProps) {
  const [currentContextIndex, setCurrentContextIndex] = useState(0);

  // 切换上下文时重置索引
  useEffect(() => {
    setCurrentContextIndex(0);
  }, [word]);

  // 没有上下文时显示提示
  if (contexts.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 text-center">
        <p className="text-gray-500 dark:text-gray-400">
          该词汇暂无上下文记录
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
          在阅读时会自动捕获生词的上下文
        </p>
      </div>
    );
  }

  const currentContext = contexts[currentContextIndex];

  // 高亮句子中的目标单词
  const highlightWordInSentence = (sentence: string, targetWord: string): React.ReactNode => {
    const lowerSentence = sentence.toLowerCase();
    const lowerWord = targetWord.toLowerCase();
    const index = lowerSentence.indexOf(lowerWord);

    if (index === -1) {
      return sentence;
    }

    const before = sentence.slice(0, index);
    const match = sentence.slice(index, index + targetWord.length);
    const after = sentence.slice(index + targetWord.length);

    return (
      <>
        {before}
        <span className="bg-yellow-200 dark:bg-yellow-800 text-yellow-900 dark:text-yellow-100 px-1 rounded font-medium">
          {match}
        </span>
        {highlightWordInSentence(after, targetWord)}
      </>
    );
  };

  const handlePrevContext = () => {
    setCurrentContextIndex(prev => (prev > 0 ? prev - 1 : contexts.length - 1));
  };

  const handleNextContext = () => {
    setCurrentContextIndex(prev => (prev < contexts.length - 1 ? prev + 1 : 0));
  };

  const ratingOptions = [
    { rating: 1, label: '不认识', color: 'bg-red-500 hover:bg-red-600', description: '完全不记得' },
    { rating: 2, label: '模糊', color: 'bg-orange-500 hover:bg-orange-600', description: '有点印象' },
    { rating: 3, label: '想起来', color: 'bg-yellow-500 hover:bg-yellow-600', description: '想了很久' },
    { rating: 4, label: '熟练', color: 'bg-lime-500 hover:bg-lime-600', description: '基本掌握' },
    { rating: 5, label: '精通', color: 'bg-green-500 hover:bg-green-600', description: '完全掌握' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
      {/* 语境来源标签 */}
      {currentContext.source && (
        <div className="bg-gray-50 dark:bg-gray-700 px-4 py-2 text-sm text-gray-500 dark:text-gray-400 flex items-center justify-between">
          <span className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {currentContext.source}
          </span>
          {contexts.length > 1 && (
            <span className="text-xs">
              {currentContextIndex + 1} / {contexts.length}
            </span>
          )}
        </div>
      )}

      {/* 主内容区 */}
      <div className="p-6">
        {/* 语境句子 */}
        <div className="mb-6">
          <p className="text-lg text-gray-700 dark:text-gray-200 leading-relaxed">
            {highlightWordInSentence(currentContext.sentence, word)}
          </p>
        </div>

        {/* 单词和翻译（答案） */}
        <div
          className={`transition-all duration-300 ${
            showAnswer
              ? 'opacity-100 transform translate-y-0'
              : 'opacity-0 transform -translate-y-2'
          }`}
        >
          <div className="border-t border-gray-200 dark:border-gray-600 pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {word}
                </p>
                {translation && (
                  <p className="text-gray-600 dark:text-gray-300 mt-1">
                    {translation}
                  </p>
                )}
              </div>
              {currentContext.url && (
                <a
                  href={currentContext.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-500 hover:text-blue-600 flex items-center gap-1"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  查看原文
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 上下文导航 */}
      {contexts.length > 1 && (
        <div className="px-6 pb-4 flex items-center justify-center gap-4">
          <button
            onClick={handlePrevContext}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="上一个语境"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex gap-1">
            {contexts.map((_, index) => (
              <button
                key={index}
                onClick={() => setCurrentContextIndex(index)}
                className={`w-2 h-2 rounded-full transition-colors ${
                  index === currentContextIndex
                    ? 'bg-blue-500'
                    : 'bg-gray-300 dark:bg-gray-600 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>
          <button
            onClick={handleNextContext}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            title="下一个语境"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* 评分按钮 */}
      {showAnswer && (
        <div className="bg-gray-50 dark:bg-gray-700 px-6 py-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-3">
            你认识这个单词吗？
          </p>
          <div className="flex justify-center gap-2">
            {ratingOptions.map(({ rating, label, color, description }) => (
              <button
                key={rating}
                onClick={() => onRate(rating)}
                disabled={isSubmitting}
                className={`${color} text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center min-w-[60px]`}
                title={description}
              >
                <span>{label}</span>
                <span className="text-xs opacity-80">{rating}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}