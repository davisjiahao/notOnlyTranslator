import { useEffect, useState } from 'react';
import type { UserProfile, ExamType } from '@/shared/types';
import {
  EXAM_DISPLAY_NAMES,
  EXAM_SCORE_RANGES,
  EXAM_VOCABULARY_SIZES,
} from '@/shared/constants';
import { calculateVocabularySize } from '@/shared/utils';
import { StatsCharts } from './StatsCharts';

interface LevelSelectorProps {
  profile: UserProfile;
  onUpdate: (updates: Partial<UserProfile>) => Promise<boolean>;
  isSaving: boolean;
}

const examTypes: ExamType[] = ['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'];

export default function LevelSelector({
  profile,
  onUpdate,
  isSaving,
}: LevelSelectorProps) {
  const [examType, setExamType] = useState<ExamType>(profile.examType);
  const [examScore, setExamScore] = useState<number | undefined>(profile.examScore ?? EXAM_SCORE_RANGES[profile.examType].min);
  const [customVocabulary, setCustomVocabulary] = useState<number | ''>(profile.estimatedVocabulary);
  const [replaceEstimate, setReplaceEstimate] = useState(false);

  // 学习数据在外部变化后，旧的替换确认不再有效；不覆盖用户未保存的输入。
  useEffect(() => setReplaceEstimate(false), [profile.estimatedVocabulary]);

  const scoreRange = EXAM_SCORE_RANGES[examType];
  const estimatedVocab =
    examType === 'custom'
      ? Number(customVocabulary)
      : calculateVocabularySize(examType, examScore);
  const validInput = examType === 'custom'
    ? customVocabulary !== '' && Number.isInteger(customVocabulary) && customVocabulary >= 1000 && customVocabulary <= 20000
    : examScore !== undefined && Number.isFinite(examScore) && examScore >= scoreRange.min && examScore <= scoreRange.max;

  const handleSave = async () => {
    if (!validInput || isSaving) return;
    const saved = await onUpdate({
      examType,
      examScore: examType === 'custom' ? undefined : examScore,
      ...(replaceEstimate ? { estimatedVocabulary: estimatedVocab } : {}),
    });
    if (saved) setReplaceEstimate(false);
  };

  const handleScoreChange = (value: string) => {
    setExamScore(value === '' ? undefined : Number(value));
    setReplaceEstimate(false);
  };

  const handleExamTypeChange = (type: ExamType) => {
    if (type === examType) return;
    setReplaceEstimate(false);
    setExamType(type);
    if (type !== 'custom') {
      const range = EXAM_SCORE_RANGES[type];
      setExamScore(Math.round((range.min + range.max) / 2));
    }
  };

  return (
    <div className="space-y-6">
      {/* 卡片 1：水平设置 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-6">设置英语水平</h2>

        <div className="mb-6 rounded-lg bg-gray-50 dark:bg-gray-900/50 p-4">
          <div className="text-sm text-gray-600 dark:text-gray-300">当前学习估算</div>
          <output aria-label="当前学习估算" className="block text-2xl font-semibold text-gray-900 dark:text-white">{profile.estimatedVocabulary.toLocaleString()} 词</output>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">用于当前阅读难度判断，会随标词记录调整。下方预览尚未应用。</p>
        </div>

        {/* 考试类型选择 */}
        <div className="mb-6">
          <label id="exam-type-label" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            选择考试类型
          </label>
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3"
            role="radiogroup"
            aria-labelledby="exam-type-label"
          >
            {examTypes.map((type) => (
              <button
                key={type}
                onClick={() => handleExamTypeChange(type)}
                role="radio"
                aria-checked={examType === type}
                tabIndex={examType === type ? 0 : -1}
                onKeyDown={event => {
                  const index = examTypes.indexOf(type);
                  const next = event.key === 'Home' ? 0 : event.key === 'End' ? examTypes.length - 1
                    : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % examTypes.length
                    : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index - 1 + examTypes.length) % examTypes.length : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  handleExamTypeChange(examTypes[next]);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]')[next]?.focus();
                }}
                className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
                  examType === type
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
                    : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
                }`}
              >
                {EXAM_DISPLAY_NAMES[type]}
              </button>
            ))}
          </div>
        </div>

        {/* 分数输入 */}
        {examType !== 'custom' && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <label htmlFor="exam-score-slider" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              考试分数
            </label>
            <div className="flex flex-col min-[480px]:flex-row items-center gap-4">
              <input
                id="exam-score-slider"
                type="range"
                min={scoreRange.min}
                max={scoreRange.max}
                step={scoreRange.step}
                value={examScore ?? scoreRange.min}
                onChange={(e) => handleScoreChange(e.target.value)}
                aria-valuemin={scoreRange.min}
                aria-valuemax={scoreRange.max}
                aria-valuenow={Math.min(scoreRange.max, Math.max(scoreRange.min, examScore ?? scoreRange.min))}
                className="w-full min-[480px]:flex-1 min-w-0 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary-600"
              />
              <input
                type="number"
                min={scoreRange.min}
                max={scoreRange.max}
                step={scoreRange.step}
                value={examScore ?? ''}
                onChange={(e) => handleScoreChange(e.target.value)}
                aria-label="考试分数数值"
                aria-invalid={!validInput}
                aria-describedby={!validInput ? 'level-input-error' : undefined}
                className="w-full min-[480px]:w-24 px-3 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white"
              />
            </div>
            <div className="flex flex-wrap justify-between gap-x-2 text-xs text-gray-400 dark:text-gray-300 mt-1">
              <span>{scoreRange.min}</span>
              <span>{scoreRange.max}</span>
            </div>
          </div>
        )}

        {/* 自定义词汇量输入 */}
        {examType === 'custom' && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-900/50 rounded-lg">
            <label htmlFor="custom-vocab-input" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              估计词汇量
            </label>
            <input
              id="custom-vocab-input"
              type="number"
              min={1000}
              max={20000}
              step={100}
              value={customVocabulary}
              onChange={(e) => {
                setCustomVocabulary(e.target.value === '' ? '' : Number(e.target.value));
                setReplaceEstimate(false);
              }}
              aria-invalid={!validInput}
              aria-describedby={!validInput ? 'level-input-error' : undefined}
              className="w-full px-4 py-2 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-white"
            />
            <p className="text-xs text-gray-500 dark:text-gray-300 mt-1">
              输入您估计的词汇量 (1000-20000)
            </p>
          </div>
        )}

        {!validInput && <p id="level-input-error" role="alert" className="mb-4 text-sm text-red-700 dark:text-red-300">
          {examType === 'custom' ? '请输入 1000–20000 之间的整数词汇量。' : `请输入 ${scoreRange.min}–${scoreRange.max} 之间的考试分数。`}
        </p>}

        {/* 预览不代表当前已保存的学习估算 */}
        <div className="mb-6 p-5 bg-gradient-to-br from-primary-50 to-indigo-50 dark:from-primary-900/20 dark:to-indigo-900/20 rounded-xl border border-primary-100 dark:border-primary-800">
          <div className="text-sm text-gray-600 dark:text-gray-300 mb-1">{examType === 'custom' ? '自定义词汇量预览' : '考试推算预览'}</div>
          <output aria-label={examType === 'custom' ? '自定义词汇量预览' : '考试推算预览'} aria-live="polite" className="block text-4xl font-bold text-primary-600 dark:text-primary-400 mb-2">
            {validInput ? estimatedVocab.toLocaleString() : '—'}
          </output>
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">仅保存考试或水平信息不会替换当前学习估算；应用预览需要在下方确认。</p>
          {examType !== 'custom' && (
            <div className="text-sm text-gray-500 dark:text-gray-300">
              {EXAM_DISPLAY_NAMES[examType]} 基准: {EXAM_VOCABULARY_SIZES[examType].toLocaleString()} 词
            </div>
          )}
        </div>

        {/* 词汇水平进度条 — WCAG 4.1.2: 添加 role="progressbar" + aria-valuenow/min/max */}
        <div className="mb-6">
          <div className="flex flex-wrap justify-between gap-x-2 text-xs text-gray-500 dark:text-gray-300 mb-2">
            <span>初级</span>
            <span>中级</span>
            <span>高级</span>
            <span>专家</span>
          </div>
          <div
            className="h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={validInput ? Math.min(20000, estimatedVocab) : 0}
            aria-valuemin={0}
            aria-valuemax={20000}
            aria-label="预览词汇水平"
            aria-valuetext={validInput ? `${estimatedVocab.toLocaleString()} 词，尚未应用` : '请输入有效数值'}
          >
            <div
              className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-400 rounded-full transition-all duration-300"
              style={{ width: `${validInput ? Math.min(100, (estimatedVocab / 20000) * 100) : 0}%` }}
            />
          </div>
          <div className="flex flex-wrap justify-between gap-x-2 text-xs text-gray-400 dark:text-gray-300 mt-1">
            <span>2000</span>
            <span>5000</span>
            <span>10000</span>
            <span>20000</span>
          </div>
        </div>

        {/* 置信度提示 */}
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-100 dark:border-blue-800">
          <div className="flex items-start gap-3 text-sm text-blue-700 dark:text-blue-400">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div className="font-medium">
                当前学习估算置信度: {Math.round(profile.levelConfidence * 100)}%
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                使用插件标记词汇后，系统会自动调整您的水平估计
              </div>
            </div>
          </div>
        </div>

        <label className="mb-4 flex items-start gap-3 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={replaceEstimate} disabled={!validInput || isSaving}
            onChange={event => setReplaceEstimate(event.target.checked)}
            aria-label="用此预览替换当前学习估算"
            aria-describedby="replace-estimate-hint"
            className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
          <span>用此预览替换当前学习估算
            <span id="replace-estimate-hint" className="mt-1 block text-xs text-gray-600 dark:text-gray-300">
              {validInput ? `${profile.estimatedVocabulary.toLocaleString()} → ${estimatedVocab.toLocaleString()} 词。将影响后续阅读难度；不会删除已标记词汇。` : '请先输入有效数值。'}
            </span>
          </span>
        </label>

        {/* 保存按钮明确区分信息保存和估算替换 */}
        <button
          onClick={handleSave}
          disabled={isSaving || !validInput}
          className="w-full py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
        >
          {isSaving ? '保存中...' : replaceEstimate ? '应用预览并保存' : examType === 'custom' ? '保存水平信息' : '保存考试信息'}
        </button>
      </div>

      {/* 卡片 2：能力分析图表 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3 sm:p-6">
        <div className="flex flex-wrap gap-2 items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">能力分析</h2>
          <span className="text-xs text-gray-400 dark:text-gray-300">数据实时更新</span>
        </div>
        <StatsCharts
          vocabularySize={profile.estimatedVocabulary}
          knownCount={profile.knownWords?.length || 0}
          unknownCount={profile.unknownWords?.length || 0}
          confidence={profile.levelConfidence}
        />
      </div>
    </div>
  );
}
