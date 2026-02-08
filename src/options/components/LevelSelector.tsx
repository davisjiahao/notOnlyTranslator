import { useState } from 'react';
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
  onUpdate: (updates: Partial<UserProfile>) => Promise<void>;
  isSaving: boolean;
}

const examTypes: ExamType[] = ['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'];

export default function LevelSelector({
  profile,
  onUpdate,
  isSaving,
}: LevelSelectorProps) {
  const [examType, setExamType] = useState<ExamType>(profile.examType);
  const [examScore, setExamScore] = useState<number | undefined>(profile.examScore);
  const [customVocabulary, setCustomVocabulary] = useState<number>(
    profile.estimatedVocabulary
  );

  const scoreRange = EXAM_SCORE_RANGES[examType];
  const estimatedVocab =
    examType === 'custom'
      ? customVocabulary
      : calculateVocabularySize(examType, examScore);

  const handleSave = async () => {
    await onUpdate({
      examType,
      examScore: examType === 'custom' ? undefined : examScore,
      estimatedVocabulary: estimatedVocab,
    });
  };

  const handleExamTypeChange = (type: ExamType) => {
    setExamType(type);
    if (type !== 'custom') {
      const range = EXAM_SCORE_RANGES[type];
      setExamScore(Math.round((range.min + range.max) / 2));
    }
  };

  return (
    <div className="space-y-6">
      {/* 卡片 1：水平设置 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">设置英语水平</h2>

        {/* 考试类型选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-3">
            选择考试类型
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {examTypes.map((type) => (
              <button
                key={type}
                onClick={() => handleExamTypeChange(type)}
                className={`px-4 py-3 rounded-lg border text-sm font-medium transition-colors ${
                  examType === type
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                }`}
              >
                {EXAM_DISPLAY_NAMES[type]}
              </button>
            ))}
          </div>
        </div>

        {/* 分数输入 */}
        {examType !== 'custom' && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              考试分数
            </label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min={scoreRange.min}
                max={scoreRange.max}
                step={scoreRange.step}
                value={examScore || scoreRange.min}
                onChange={(e) => setExamScore(Number(e.target.value))}
                className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600"
              />
              <input
                type="number"
                min={scoreRange.min}
                max={scoreRange.max}
                step={scoreRange.step}
                value={examScore || scoreRange.min}
                onChange={(e) => setExamScore(Number(e.target.value))}
                className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-center focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1">
              <span>{scoreRange.min}</span>
              <span>{scoreRange.max}</span>
            </div>
          </div>
        )}

        {/* 自定义词汇量输入 */}
        {examType === 'custom' && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              估计词汇量
            </label>
            <input
              type="number"
              min={1000}
              max={20000}
              step={100}
              value={customVocabulary}
              onChange={(e) => setCustomVocabulary(Number(e.target.value))}
              className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              输入您估计的词汇量 (1000-20000)
            </p>
          </div>
        )}

        {/* 估计词汇量展示 */}
        <div className="mb-6 p-5 bg-gradient-to-br from-primary-50 to-indigo-50 rounded-xl border border-primary-100">
          <div className="text-sm text-gray-600 mb-1">估计词汇量</div>
          <div className="text-4xl font-bold text-primary-600 mb-2">
            {estimatedVocab.toLocaleString()}
          </div>
          {examType !== 'custom' && (
            <div className="text-sm text-gray-500">
              {EXAM_DISPLAY_NAMES[examType]} 基准: {EXAM_VOCABULARY_SIZES[examType].toLocaleString()} 词
            </div>
          )}
        </div>

        {/* 词汇水平进度条 */}
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-2">
            <span>初级</span>
            <span>中级</span>
            <span>高级</span>
            <span>专家</span>
          </div>
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-400 via-yellow-400 to-red-400 rounded-full transition-all duration-300"
              style={{ width: `${Math.min(100, (estimatedVocab / 15000) * 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>2000</span>
            <span>5000</span>
            <span>10000</span>
            <span>15000+</span>
          </div>
        </div>

        {/* 置信度提示 */}
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
          <div className="flex items-start gap-3 text-sm text-blue-700">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div className="font-medium">
                当前水平置信度: {Math.round(profile.levelConfidence * 100)}%
              </div>
              <div className="text-xs text-blue-600 mt-1">
                使用插件标记词汇后，系统会自动调整您的水平估计
              </div>
            </div>
          </div>
        </div>

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="w-full py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm hover:shadow-md"
        >
          {isSaving ? '保存中...' : '保存设置'}
        </button>
      </div>

      {/* 卡片 2：能力分析图表 */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">能力分析</h2>
          <span className="text-xs text-gray-400">数据实时更新</span>
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
