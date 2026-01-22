import { useState, useMemo } from 'react';
import type { TestQuestion } from '@/shared/types';

interface QuickTestProps {
  onComplete: (estimatedVocabulary: number) => void;
  onCancel: () => void;
}

// Sample test questions (in production, these would be loaded from a data file)
const sampleQuestions: TestQuestion[] = [
  {
    id: '1',
    word: 'abandon',
    options: ['放弃', '收养', '保护', '攻击'],
    correctIndex: 0,
    difficulty: 3,
  },
  {
    id: '2',
    word: 'sophisticated',
    options: ['简单的', '复杂精密的', '愚蠢的', '友好的'],
    correctIndex: 1,
    difficulty: 5,
  },
  {
    id: '3',
    word: 'ubiquitous',
    options: ['罕见的', '独特的', '无处不在的', '危险的'],
    correctIndex: 2,
    difficulty: 7,
  },
  {
    id: '4',
    word: 'ephemeral',
    options: ['永恒的', '短暂的', '重要的', '美丽的'],
    correctIndex: 1,
    difficulty: 8,
  },
  {
    id: '5',
    word: 'benevolent',
    options: ['恶意的', '仁慈的', '无聊的', '困难的'],
    correctIndex: 1,
    difficulty: 6,
  },
  {
    id: '6',
    word: 'paradigm',
    options: ['范例', '悖论', '段落', '参数'],
    correctIndex: 0,
    difficulty: 7,
  },
  {
    id: '7',
    word: 'resilient',
    options: ['脆弱的', '坚韧的', '沉默的', '透明的'],
    correctIndex: 1,
    difficulty: 5,
  },
  {
    id: '8',
    word: 'pragmatic',
    options: ['浪漫的', '理论的', '务实的', '戏剧的'],
    correctIndex: 2,
    difficulty: 6,
  },
  {
    id: '9',
    word: 'ambiguous',
    options: ['清晰的', '模糊的', '巨大的', '野心的'],
    correctIndex: 1,
    difficulty: 5,
  },
  {
    id: '10',
    word: 'meticulous',
    options: ['粗心的', '一丝不苟的', '虚假的', '微小的'],
    correctIndex: 1,
    difficulty: 6,
  },
  {
    id: '11',
    word: 'eloquent',
    options: ['沉默的', '雄辩的', '优雅的', '电子的'],
    correctIndex: 1,
    difficulty: 6,
  },
  {
    id: '12',
    word: 'eclectic',
    options: ['电气的', '折衷的', '生态的', '经济的'],
    correctIndex: 1,
    difficulty: 7,
  },
  {
    id: '13',
    word: 'paradox',
    options: ['天堂', '悖论', '范例', '段落'],
    correctIndex: 1,
    difficulty: 5,
  },
  {
    id: '14',
    word: 'ameliorate',
    options: ['恶化', '改善', '美化', '融化'],
    correctIndex: 1,
    difficulty: 8,
  },
  {
    id: '15',
    word: 'superfluous',
    options: ['必要的', '多余的', '超级的', '流动的'],
    correctIndex: 1,
    difficulty: 7,
  },
  {
    id: '16',
    word: 'sycophant',
    options: ['大象', '交响乐', '马屁精', '症状'],
    correctIndex: 2,
    difficulty: 9,
  },
  {
    id: '17',
    word: 'recalcitrant',
    options: ['顺从的', '桀骜不驯的', '计算的', '召回的'],
    correctIndex: 1,
    difficulty: 9,
  },
  {
    id: '18',
    word: 'obviate',
    options: ['显而易见', '排除', '反对', '观察'],
    correctIndex: 1,
    difficulty: 8,
  },
  {
    id: '19',
    word: 'alacrity',
    options: ['警报', '敏捷', '清晰', '代数'],
    correctIndex: 1,
    difficulty: 8,
  },
  {
    id: '20',
    word: 'perfunctory',
    options: ['完美的', '敷衍的', '芳香的', '功能的'],
    correctIndex: 1,
    difficulty: 8,
  },
];

export default function QuickTest({ onComplete, onCancel }: QuickTestProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);

  // Shuffle and select 20 questions
  const questions = useMemo(() => {
    const shuffled = [...sampleQuestions].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 20);
  }, []);

  const currentQuestion = questions[currentIndex];
  const progress = ((currentIndex + 1) / questions.length) * 100;

  const handleAnswer = (index: number) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(index);

    // Wait a moment to show feedback
    setTimeout(() => {
      setAnswers([...answers, index]);
      setSelectedAnswer(null);

      if (currentIndex < questions.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        setShowResult(true);
      }
    }, 500);
  };

  const calculateResult = () => {
    let correctCount = 0;
    let totalDifficulty = 0;
    let correctDifficulty = 0;

    questions.forEach((q, i) => {
      totalDifficulty += q.difficulty;
      if (answers[i] === q.correctIndex) {
        correctCount++;
        correctDifficulty += q.difficulty;
      }
    });

    const accuracy = correctCount / questions.length;
    const weightedScore = correctDifficulty / totalDifficulty;

    // Estimate vocabulary (2000 - 15000 range)
    const estimatedVocabulary = Math.round(2000 + weightedScore * 13000);

    return {
      correctCount,
      totalQuestions: questions.length,
      accuracy,
      estimatedVocabulary,
    };
  };

  if (showResult) {
    const result = calculateResult();

    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">测评完成</h2>
          <p className="text-gray-500">
            答对 {result.correctCount} / {result.totalQuestions} 题
          </p>
        </div>

        <div className="bg-gray-50 rounded-lg p-6 mb-6 text-center">
          <div className="text-sm text-gray-500 mb-2">估计词汇量</div>
          <div className="text-4xl font-bold text-primary-600">
            {result.estimatedVocabulary.toLocaleString()}
          </div>
          <div className="text-sm text-gray-500 mt-2">
            正确率: {Math.round(result.accuracy * 100)}%
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3 px-4 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            返回
          </button>
          <button
            onClick={() => onComplete(result.estimatedVocabulary)}
            className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 transition-colors"
          >
            使用此结果
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">快速测评</h2>
          <p className="text-sm text-gray-500">
            第 {currentIndex + 1} / {questions.length} 题
          </p>
        </div>
        <button
          onClick={onCancel}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-8">
        <div
          className="h-full bg-primary-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Question */}
      <div className="mb-8">
        <div className="text-center mb-6">
          <span className="text-3xl font-bold text-gray-900">
            {currentQuestion.word}
          </span>
        </div>
        <p className="text-center text-gray-500">选择正确的中文释义</p>
      </div>

      {/* Options */}
      <div className="space-y-3">
        {currentQuestion.options.map((option, index) => {
          const isSelected = selectedAnswer === index;
          const isCorrect = index === currentQuestion.correctIndex;
          const showFeedback = selectedAnswer !== null;

          let buttonClass = 'border-gray-200 bg-white hover:border-primary-300 hover:bg-primary-50';

          if (showFeedback) {
            if (isCorrect) {
              buttonClass = 'border-green-500 bg-green-50 text-green-700';
            } else if (isSelected && !isCorrect) {
              buttonClass = 'border-red-500 bg-red-50 text-red-700';
            } else {
              buttonClass = 'border-gray-200 bg-gray-50 opacity-50';
            }
          }

          return (
            <button
              key={index}
              onClick={() => handleAnswer(index)}
              disabled={selectedAnswer !== null}
              className={`w-full p-4 border rounded-lg text-left font-medium transition-colors ${buttonClass}`}
            >
              <span className="inline-flex items-center justify-center w-6 h-6 bg-gray-100 rounded-full text-sm text-gray-500 mr-3">
                {String.fromCharCode(65 + index)}
              </span>
              {option}
            </button>
          );
        })}
      </div>

      {/* Difficulty indicator */}
      <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400">
        <span>难度:</span>
        <div className="flex gap-0.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div
              key={i}
              className={`w-2 h-2 rounded-full ${
                i < currentQuestion.difficulty ? 'bg-primary-500' : 'bg-gray-200'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
