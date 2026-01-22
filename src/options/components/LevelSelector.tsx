import { useState } from 'react';
import type { UserProfile, ExamType } from '@/shared/types';
import {
  EXAM_DISPLAY_NAMES,
  EXAM_SCORE_RANGES,
  EXAM_VOCABULARY_SIZES,
} from '@/shared/constants';
import { calculateVocabularySize } from '@/shared/utils';

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
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">设置英语水平</h2>

      {/* Exam type selection */}
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

      {/* Score input */}
      {examType !== 'custom' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
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

      {/* Custom vocabulary input */}
      {examType === 'custom' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
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

      {/* Estimated vocabulary display */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="text-sm text-gray-500 mb-1">估计词汇量</div>
        <div className="text-3xl font-bold text-primary-600">
          {estimatedVocab.toLocaleString()}
        </div>
        <div className="text-sm text-gray-500 mt-1">
          {examType !== 'custom' && (
            <span>
              {EXAM_DISPLAY_NAMES[examType]} 基准: {EXAM_VOCABULARY_SIZES[examType].toLocaleString()} 词
            </span>
          )}
        </div>
      </div>

      {/* Vocabulary level indicator */}
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

      {/* Current confidence */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg">
        <div className="flex items-center gap-2 text-sm text-blue-700">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            当前水平置信度: {Math.round(profile.levelConfidence * 100)}%
          </span>
        </div>
        <p className="text-xs text-blue-600 mt-1">
          使用插件标记词汇后，系统会自动调整您的水平估计
        </p>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={isSaving}
        className="w-full py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSaving ? '保存中...' : '保存设置'}
      </button>
    </div>
  );
}
