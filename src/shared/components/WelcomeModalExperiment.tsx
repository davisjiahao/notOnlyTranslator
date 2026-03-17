import { useState, useEffect } from 'react';
import { trackEvent } from '@/shared/analytics/init';
import {
  getExperimentGroup,
  trackExperimentProgress,
  type ExperimentGroup,
  type ExperimentStep,
} from './welcomeModalUtils';

interface WelcomeModalExperimentProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

// 获取或分配实验组
function getExperimentGroup(): ExperimentGroup {
  const stored = localStorage.getItem('not_onboarding_experiment_group');
  if (stored === 'A' || stored === 'B' || stored === 'C') {
    return stored;
  }

  // 随机分配
  const groups: ExperimentGroup[] = ['A', 'B', 'C'];
  const group = groups[Math.floor(Math.random() * groups.length)];
  localStorage.setItem('not_onboarding_experiment_group', group);

  // 记录分组事件
  trackEvent('Experiment_Assigned', {
    experiment: 'EXP-001',
    group,
    timestamp: Date.now(),
  });

  return group;
}

// 记录实验进度
function trackExperimentProgress(
  group: ExperimentGroup,
  step: ExperimentStep,
  action: 'start' | 'complete' | 'skip',
  metadata?: Record<string, unknown>
) {
  trackEvent('Onboarding_Progress', {
    experiment: 'EXP-001',
    group,
    step,
    action,
    ...metadata,
  });
}

export default function WelcomeModalExperiment({
  isOpen,
  onClose,
  onComplete,
}: WelcomeModalExperimentProps) {
  const [group] = useState<ExperimentGroup>(getExperimentGroup);
  const [currentStep, setCurrentStep] = useState<ExperimentStep>('welcome');
  const [isAnimating, setIsAnimating] = useState(false);

  // 用户选择
  const [selectedLevel, setSelectedLevel] = useState<string>('');
  const [selectedProvider, setSelectedProvider] = useState<string>('openai');

  useEffect(() => {
    if (isOpen) {
      trackExperimentProgress(group, 'welcome', 'start');
    }
  }, [isOpen, group]);

  const handleNext = (nextStep: ExperimentStep) => {
    setIsAnimating(true);
    trackExperimentProgress(group, currentStep, 'complete', {
      nextStep,
      selectedLevel,
      selectedProvider,
    });

    setTimeout(() => {
      setCurrentStep(nextStep);
      setIsAnimating(false);
      trackExperimentProgress(group, nextStep, 'start');
    }, 300);
  };

  const handleSkip = () => {
    trackExperimentProgress(group, currentStep, 'skip');
    onClose();
  };

  const handleComplete = () => {
    trackExperimentProgress(group, 'complete', 'complete', {
      totalSteps: getStepCount(group),
      group,
    });

    // 标记已完成引导
    localStorage.setItem('not_onboarding_completed', 'true');
    localStorage.setItem('not_onboarding_completed_at', Date.now().toString());

    onComplete();
  };

  // 根据实验组获取步骤数
  function getStepCount(g: ExperimentGroup): number {
    switch (g) {
      case 'A':
        return 5; // 对照组：5步
      case 'B':
        return 3; // 实验组B：3步
      case 'C':
        return 2; // 实验组C：2步
      default:
        return 5;
    }
  }

  // 获取当前步骤进度
  function getStepProgress(): number {
    const stepMap: Record<ExperimentStep, number> = {
      welcome: 1,
      level: 2,
      api: 3,
      demo: 4,
      complete: 5,
    };

    const current = stepMap[currentStep];

    // 根据实验组调整进度显示
    if (group === 'B') {
      // B组：welcome+level合并，api，demo
      if (currentStep === 'welcome') return 1;
      if (currentStep === 'api') return 2;
      if (currentStep === 'demo' || currentStep === 'complete') return 3;
    }

    if (group === 'C') {
      // C组：welcome+level+api合并，demo
      if (currentStep === 'welcome') return 1;
      if (currentStep === 'demo' || currentStep === 'complete') return 2;
    }

    return current;
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-hidden transition-all duration-300 ${
          isAnimating ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}
      >
        {/* 进度条 */}
        <div className="bg-gray-100 dark:bg-gray-700 h-1">
          <div
            className="bg-primary-600 h-full transition-all duration-500"
            style={{
              width: `${(getStepProgress() / getStepCount(group)) * 100}%`,
            }}
          />
        </div>

        {/* 内容区域 */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-4rem)]">
          {currentStep === 'welcome' && (
            <WelcomeStep
              group={group}
              onNext={() => {
                if (group === 'C') {
                  // C组：极简流程，直接到demo
                  handleNext('demo');
                } else if (group === 'B') {
                  // B组：合并welcome和level
                  handleNext('api');
                } else {
                  handleNext('level');
                }
              }}
              onSkip={handleSkip}
            />
          )}

          {currentStep === 'level' && group === 'A' && (
            <LevelStep
              selectedLevel={selectedLevel}
              onSelect={setSelectedLevel}
              onNext={() => handleNext('api')}
              onBack={() => setCurrentStep('welcome')}
            />
          )}

          {currentStep === 'api' && (
            <ApiStep
              group={group}
              selectedProvider={selectedProvider}
              onSelect={setSelectedProvider}
              onNext={() => handleNext('demo')}
              onBack={() => {
                if (group === 'B') {
                  setCurrentStep('welcome');
                } else {
                  setCurrentStep('level');
                }
              }}
              onSkip={handleSkip}
            />
          )}

          {currentStep === 'demo' && (
            <DemoStep
              onNext={handleComplete}
              onBack={() => setCurrentStep('api')}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ========== 各步骤组件 ==========

function WelcomeStep({
  group,
  onNext,
  onSkip,
}: {
  group: ExperimentGroup;
  onNext: () => void;
  onSkip: () => void;
}) {
  const titles: Record<ExperimentGroup, string> = {
    A: '欢迎使用 NotOnlyTranslator',
    B: '开启智能翻译之旅',
    C: '只翻译你不会的词',
  };

  const subtitles: Record<ExperimentGroup, string> = {
    A: '让我们一步步完成设置',
    B: '3步完成设置，开始高效学习',
    C: '2步快速开始，告别全文翻译',
  };

  return (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto mb-6 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
        <svg
          className="w-10 h-10 text-primary-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        {titles[group]}
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        {subtitles[group]}
      </p>

      {/* 核心价值点 */}
      <div className="space-y-3 mb-8 text-left">
        <div className="flex items-start gap-3">
          <div className="w-6 h-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg
              className="w-4 h-4 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              智能分级翻译
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              只翻译超出你词汇量的单词
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-6 h-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg
              className="w-4 h-4 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              自然积累词汇
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              在阅读中不知不觉提升词汇量
            </div>
          </div>
        </div>

        <div className="flex items-start gap-3">
          <div className="w-6 h-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg
              className="w-4 h-4 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <div className="font-medium text-gray-900 dark:text-white">
              隐私保护
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              使用你自己的 API Key，数据完全私有
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          稍后再说
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors shadow-sm hover:shadow-md"
        >
          开始设置
        </button>
      </div>
    </div>
  );
}

function LevelStep({
  selectedLevel,
  onSelect,
  onNext,
  onBack,
}: {
  selectedLevel: string;
  onSelect: (level: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const levels = [
    { id: 'beginner', name: '初级', desc: 'CET-4 或相当水平', vocab: '3000-5000' },
    { id: 'intermediate', name: '中级', desc: 'CET-6 或相当水平', vocab: '5000-8000' },
    { id: 'advanced', name: '高级', desc: '雅思/托福或相当', vocab: '8000+' },
  ];

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">
        选择你的英语水平
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8 text-center">
        这将帮助我们决定哪些单词需要翻译
      </p>

      <div className="space-y-3 mb-8">
        {levels.map((level) => (
          <button
            key={level.id}
            onClick={() => onSelect(level.id)}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              selectedLevel === level.id
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900 dark:text-white">
                  {level.name}
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {level.desc}
                </div>
              </div>
              <div className="text-sm text-primary-600 dark:text-primary-400">
                {level.vocab} 词
              </div>
            </div>
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          disabled={!selectedLevel}
          className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          下一步
        </button>
      </div>
    </div>
  );
}

function ApiStep({
  group,
  selectedProvider,
  onSelect,
  onNext,
  onBack,
  onSkip,
}: {
  group: ExperimentGroup;
  selectedProvider: string;
  onSelect: (provider: string) => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const providers = [
    { id: 'openai', name: 'OpenAI', desc: 'GPT-4o-mini, GPT-4', recommended: true },
    { id: 'anthropic', name: 'Anthropic', desc: 'Claude 3 Haiku, Sonnet' },
    { id: 'custom', name: '自定义', desc: '使用其他 API 服务' },
  ];

  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2 text-center">
        {group === 'C' ? '快速开始' : '配置翻译服务'}
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8 text-center">
        {group === 'C'
          ? '选择服务商，稍后在设置中添加密钥'
          : '选择并配置你的翻译服务提供商'}
      </p>

      {/* 服务商选择 */}
      <div className="space-y-3 mb-6">
        {providers.map((provider) => (
          <button
            key={provider.id}
            onClick={() => onSelect(provider.id)}
            className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
              selectedProvider === provider.id
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    selectedProvider === provider.id
                      ? 'border-primary-500 bg-primary-500'
                      : 'border-gray-300 dark:border-gray-600'
                  }`}
                >
                  {selectedProvider === provider.id && (
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
                <span className="font-medium text-gray-900 dark:text-white">
                  {provider.name}
                </span>
                {provider.recommended && (
                  <span className="px-2 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-full">
                    推荐
                  </span>
                )}
              </div>
            </div>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 ml-7">
              {provider.desc}
            </div>
          </button>
        ))}
      </div>

      {/* API Key 输入 (仅A、B组显示) */}
      {group !== 'C' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            API 密钥
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              {showKey ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                  />
                </svg>
              )}
            </button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
            密钥仅存储在本地浏览器中，我们不会也无法访问。
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          disabled={group !== 'C' && !apiKey}
          className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {group === 'C' ? '进入演示' : '下一步'}
        </button>
      </div>

      {group === 'C' && (
        <button
          onClick={onSkip}
          className="w-full mt-3 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
        >
          跳过，稍后配置
        </button>
      )}
    </div>
  );
}

function DemoStep({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  return (
    <div className="text-center">
      <div className="w-20 h-20 mx-auto mb-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
        <svg
          className="w-10 h-10 text-green-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
        设置完成！
      </h2>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        让我们试一下吧
      </p>

      {/* 演示卡片 */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-8 text-left">
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
          试着访问任意英文网页，比如：
        </div>
        <div className="flex gap-2 flex-wrap">
          <a
            href="https://www.bbc.com/news"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white dark:bg-gray-700 rounded-lg text-sm text-primary-600 hover:bg-primary-50 dark:hover:bg-gray-600 transition-colors"
          >
            BBC News
          </a>
          <a
            href="https://techcrunch.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white dark:bg-gray-700 rounded-lg text-sm text-primary-600 hover:bg-primary-50 dark:hover:bg-gray-600 transition-colors"
          >
            TechCrunch
          </a>
          <a
            href="https://www.nytimes.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 bg-white dark:bg-gray-700 rounded-lg text-sm text-primary-600 hover:bg-primary-50 dark:hover:bg-gray-600 transition-colors"
          >
            NYTimes
          </a>
        </div>
      </div>

      {/* 使用提示 */}
      <div className="space-y-2 mb-8 text-left text-sm">
        <div className="flex items-start gap-2">
          <span className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center flex-shrink-0 text-xs text-primary-600">
            1
          </span>
          <span className="text-gray-600 dark:text-gray-400">
            点击页面上的
            <span className="px-1.5 py-0.5 mx-1 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 rounded text-xs">
              高亮单词
            </span>
            查看翻译
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center flex-shrink-0 text-xs text-primary-600">
            2
          </span>
          <span className="text-gray-600 dark:text-gray-400">
            标记
            <span className="px-1.5 py-0.5 mx-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 rounded text-xs">
              已知
            </span>
            或
            <span className="px-1.5 py-0.5 mx-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 rounded text-xs">
              生词
            </span>
            优化翻译
          </span>
        </div>
        <div className="flex items-start gap-2">
          <span className="w-5 h-5 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center flex-shrink-0 text-xs text-primary-600">
            3
          </span>
          <span className="text-gray-600 dark:text-gray-400">
            点击扩展图标查看学习统计
          </span>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors"
        >
          开始使用
        </button>
      </div>
    </div>
  );
}

// 检查是否首次使用（需要在设置页面导入使用）
export function shouldShowWelcomeModal(): boolean {
  const completed = localStorage.getItem('not_onboarding_completed');
  const skipped = localStorage.getItem('not_onboarding_skipped');
  return !completed && !skipped;
}

// 导出实验相关函数供其他组件使用
export { getExperimentGroup, trackExperimentProgress };
