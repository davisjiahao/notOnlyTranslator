import { useState, useCallback } from 'react';
import type { ApiProvider, ModelInfo } from '@/shared/types';
import {
  PROVIDER_CONFIGS,
  PROVIDER_GROUPS,
  getProviderConfig,
  requiresSecondaryKey,
} from '@/shared/constants/providers';
import { getModels, testConnection } from '@/shared/services/modelService';
import { logger } from '@/shared/utils';

interface ApiKeyWizardProps {
  onComplete: (config: {
    provider: ApiProvider;
    apiKey: string;
    apiUrl?: string;
    modelName?: string;
    secondaryApiKey?: string;
  }) => Promise<void>;
  onSkip?: () => void;
}

type WizardStep = 'welcome' | 'provider' | 'apikey' | 'testing' | 'model' | 'success';

export default function ApiKeyWizard({ onComplete, onSkip }: ApiKeyWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const [selectedProvider, setSelectedProvider] = useState<ApiProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [secondaryApiKey, setSecondaryApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [showSecondaryKey, setShowSecondaryKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [, setTestResult] = useState<'success' | 'error' | null>(null);
  const [, setTestError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);

  const currentProviderConfig = getProviderConfig(selectedProvider);

  const loadModels = useCallback(async () => {
    if (!apiKey) return;

    setIsLoadingModels(true);
    try {
      const fetchedModels = await getModels(
        selectedProvider,
        apiKey,
        apiUrl || undefined,
        secondaryApiKey || undefined
      );
      setModels(fetchedModels);

      // 自动选择推荐模型
      const recommended = fetchedModels.find(m => m.isRecommended) || fetchedModels[0];
      if (recommended && !modelName) {
        setModelName(recommended.id);
      }
    } catch (error) {
      logger.error('加载模型列表失败:', error);
      setModels(currentProviderConfig.defaultModels);
    } finally {
      setIsLoadingModels(false);
    }
  }, [apiKey, selectedProvider, apiUrl, secondaryApiKey, currentProviderConfig, modelName]);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);

    try {
      const result = await testConnection(
        selectedProvider,
        apiKey,
        modelName || undefined,
        apiUrl || undefined,
        secondaryApiKey || undefined
      );

      if (result.success) {
        setTestResult('success');
        // 加载模型列表
        await loadModels();
        setTimeout(() => setCurrentStep('model'), 500);
      } else {
        setTestResult('error');
        setTestError(result.error || '连接测试失败');
      }
    } catch (error) {
      setTestResult('error');
      setTestError(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onComplete({
        provider: selectedProvider,
        apiKey,
        apiUrl: apiUrl || undefined,
        modelName: modelName || undefined,
        secondaryApiKey: secondaryApiKey || undefined,
      });
      setCurrentStep('success');
    } catch (error) {
      logger.error('保存配置失败:', error);
      setTestResult('error');
      setTestError('保存配置失败，请重试');
    } finally {
      setIsSaving(false);
    }
  };

  const getProviderDisplayName = (providerId: ApiProvider): string => {
    return PROVIDER_CONFIGS[providerId]?.name || providerId;
  };

  const canProceedToTest = () => {
    if (!apiKey) return false;
    if (selectedProvider === 'custom' && !apiUrl) return false;
    if (requiresSecondaryKey(selectedProvider) && !secondaryApiKey) return false;
    return true;
  };

  // 步骤进度条
  const StepIndicator = () => {
    const steps = [
      { key: 'welcome', label: '欢迎' },
      { key: 'provider', label: '选择服务商' },
      { key: 'apikey', label: '输入密钥' },
      { key: 'model', label: '选择模型' },
    ];
    const currentIndex = steps.findIndex(s => s.key === currentStep);

    return (
      <div className="flex items-center justify-center gap-2 mb-8">
        {steps.map((step, index) => (
          <div key={step.key} className="flex items-center">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                index <= currentIndex
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
              }`}
            >
              {index + 1}
            </div>
            {index < steps.length - 1 && (
              <div
                className={`w-12 h-0.5 mx-2 transition-colors ${
                  index < currentIndex ? 'bg-primary-600' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            )}
          </div>
        ))}
      </div>
    );
  };

  // 欢迎步骤
  if (currentStep === 'welcome') {
    return (
      <div className="max-w-lg mx-auto">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-6 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
            <svg className="w-10 h-10 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
            设置 API 密钥
          </h2>
          <p className="text-gray-600 dark:text-gray-400 leading-relaxed">
            NotOnlyTranslator 需要调用 AI 翻译服务来提供智能翻译功能。
            <br />
            让我们一步步完成设置。
          </p>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-8">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-1">为什么需要 API 密钥？</p>
              <p className="opacity-90">
                我们使用 GPT-4o-mini 等 AI 模型来提供高质量的翻译服务。
                您的密钥仅存储在本地浏览器中，我们不会也无法访问。
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          {onSkip && (
            <button
              onClick={onSkip}
              className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              稍后再说
            </button>
          )}
          <button
            onClick={() => setCurrentStep('provider')}
            className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors shadow-sm hover:shadow-md"
          >
            开始设置
          </button>
        </div>
      </div>
    );
  }

  // 选择服务商步骤
  if (currentStep === 'provider') {
    return (
      <div className="max-w-lg mx-auto">
        <StepIndicator />

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">
          选择翻译服务商
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-center mb-8">
          选择您想要使用的 AI 翻译服务提供商
        </p>

        <div className="space-y-4 mb-8">
          {PROVIDER_GROUPS.map((group) => (
            <div key={group.label}>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 px-1">
                {group.label}
              </h3>
              <div className="space-y-2">
                {group.providers.map((providerId) => {
                  const config = PROVIDER_CONFIGS[providerId];
                  const isSelected = selectedProvider === providerId;

                  return (
                    <button
                      key={providerId}
                      onClick={() => setSelectedProvider(providerId)}
                      className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                        isSelected
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${
                            isSelected
                              ? 'border-primary-500 bg-primary-500'
                              : 'border-gray-300 dark:border-gray-600'
                          }`}
                        >
                          {isSelected && (
                            <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="font-medium text-gray-900 dark:text-white">
                            {config.name}
                          </div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                            {config.description}
                          </div>
                          {currentProviderConfig.docUrl && (
                            <div className="text-xs text-primary-600 dark:text-primary-400 mt-1.5">
                              获取密钥: {currentProviderConfig.docUrl}
                            </div>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setCurrentStep('welcome')}
            className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            上一步
          </button>
          <button
            onClick={() => setCurrentStep('apikey')}
            className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors"
          >
            下一步
          </button>
        </div>
      </div>
    );
  }

  // 输入 API Key 步骤
  if (currentStep === 'apikey') {
    return (
      <div className="max-w-lg mx-auto">
        <StepIndicator />

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">
          输入 API 密钥
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-center mb-8">
          输入您的 {currentProviderConfig.name} API 密钥
        </p>

        <div className="space-y-6 mb-8">
          {/* API Key 输入 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              API 密钥 <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTestResult(null);
                }}
                placeholder={currentProviderConfig.apiKeyPlaceholder}
                className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                {showKey ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
            {currentProviderConfig.docUrl && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                获取密钥:{' '}
                <a
                  href={currentProviderConfig.docUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-600 hover:underline"
                >
                  {currentProviderConfig.docUrl}
                </a>
              </p>
            )}
          </div>

          {/* Secondary Key (百度需要) */}
          {requiresSecondaryKey(selectedProvider) && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Secret Key <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  type={showSecondaryKey ? 'text' : 'password'}
                  value={secondaryApiKey}
                  onChange={(e) => {
                    setSecondaryApiKey(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="输入 Secret Key"
                  className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                />
                <button
                  type="button"
                  onClick={() => setShowSecondaryKey(!showSecondaryKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  {showSecondaryKey ? (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Custom API URL */}
          {selectedProvider === 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                API 端点 URL <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://your-api.com/v1/chat/completions"
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
              />
            </div>
          )}

          {/* 可选：自定义端点 */}
          {selectedProvider !== 'custom' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                自定义 API 端点 (可选)
              </label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder={`默认: ${currentProviderConfig.chatEndpoint}`}
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
              />
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                使用代理或自定义端点时填写
              </p>
            </div>
          )}

          {/* 安全提示 */}
          <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p>
              API 密钥将加密存储在您的浏览器中，我们不会也无法访问您的密钥。
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setCurrentStep('provider')}
            className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            上一步
          </button>
          <button
            onClick={handleTestConnection}
            disabled={!canProceedToTest() || isTesting}
            className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isTesting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                测试中...
              </span>
            ) : (
              '测试连接'
            )}
          </button>
        </div>
      </div>
    );
  }

  // 选择模型步骤
  if (currentStep === 'model') {
    return (
      <div className="max-w-lg mx-auto">
        <StepIndicator />

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">
          选择翻译模型
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-center mb-8">
          选择要使用的 AI 模型进行翻译
        </p>

        <div className="space-y-4 mb-8">
          {/* 自定义模型选项 */}
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
            <input
              type="checkbox"
              checked={useCustomModel}
              onChange={(e) => {
                setUseCustomModel(e.target.checked);
                if (!e.target.checked && models.length > 0) {
                  const recommended = models.find(m => m.isRecommended) || models[0];
                  setModelName(recommended?.id || '');
                }
              }}
              className="rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500"
            />
            使用自定义模型名称
          </label>

          {useCustomModel ? (
            <div>
              <input
                type="text"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="输入模型名称，如 gpt-4o-mini"
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
              />
            </div>
          ) : (
            <div className="space-y-2">
              {isLoadingModels ? (
                <div className="text-center py-8">
                  <svg className="w-8 h-8 mx-auto animate-spin text-primary-600" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <p className="text-gray-500 dark:text-gray-400 mt-2">加载模型列表...</p>
                </div>
              ) : (
                models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => setModelName(model.id)}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      modelName === model.id
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                          modelName === model.id
                            ? 'border-primary-500 bg-primary-500'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                      >
                        {modelName === model.id && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-white">
                            {model.name}
                          </span>
                          {model.isRecommended && (
                            <span className="px-2 py-0.5 text-xs bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 rounded-full">
                              推荐
                            </span>
                          )}
                        </div>
                        {model.description && (
                          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                            {model.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setCurrentStep('apikey')}
            className="flex-1 py-3 px-4 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 font-medium rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            上一步
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || (!useCustomModel && !modelName)}
            className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSaving ? '保存中...' : '完成设置'}
          </button>
        </div>
      </div>
    );
  }

  // 成功步骤
  if (currentStep === 'success') {
    return (
      <div className="max-w-lg mx-auto text-center">
        <div className="w-20 h-20 mx-auto mb-6 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
          设置完成！
        </h2>
        <p className="text-gray-600 dark:text-gray-400 mb-8">
          API 配置已成功保存。现在您可以开始使用 NotOnlyTranslator 进行智能翻译了。
        </p>

        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-8 text-left">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            配置摘要
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">服务商</span>
              <span className="text-gray-900 dark:text-white font-medium">
                {getProviderDisplayName(selectedProvider)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">模型</span>
              <span className="text-gray-900 dark:text-white font-medium">
                {modelName || '默认'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">API Key</span>
              <span className="text-gray-900 dark:text-white font-medium">
                {apiKey.slice(0, 8)}...{apiKey.slice(-4)}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => window.location.reload()}
          className="w-full py-3 px-4 bg-primary-600 text-white font-medium rounded-xl hover:bg-primary-700 transition-colors"
        >
          开始使用
        </button>
      </div>
    );
  }

  return null;
}
