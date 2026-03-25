import { useState } from 'react';
import type { UserSettings, ApiProvider } from '@/shared/types';
import { PROVIDER_CONFIGS } from '@/shared/constants';

interface WelcomeModalProps {
  settings: UserSettings | null;
  onComplete: () => void;
  onOpenSettings: () => void;
}

// 推荐的快速配置选项
const QUICK_PROVIDERS: Array<{ id: ApiProvider; name: string; description: string; region: string }> = [
  { id: 'openai', name: 'OpenAI', description: 'GPT-4o-mini，稳定可靠', region: 'international' },
  { id: 'anthropic', name: 'Anthropic', description: 'Claude 系列，翻译质量高', region: 'international' },
  { id: 'deepseek', name: 'DeepSeek', description: '国产之光，性价比高', region: 'domestic' },
];

export default function WelcomeModal({ settings, onComplete, onOpenSettings }: WelcomeModalProps) {
  const [step, setStep] = useState<'welcome' | 'quick-setup' | 'success'>('welcome');
  const [selectedProvider, setSelectedProvider] = useState<ApiProvider>('openai');
  const [apiKey, setApiKey] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  // 检查是否需要显示引导
  const needsSetup = !settings?.apiConfigs?.length ||
    !settings.apiConfigs.some(c => c.tested) ||
    !settings.activeApiConfigId;

  if (!needsSetup) {
    return null;
  }

  const handleQuickSetup = async () => {
    if (!apiKey.trim()) {
      setTestResult('error');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      // 创建新的 API 配置
      const configId = `${selectedProvider}-${Date.now()}`;
      const newConfig = {
        id: configId,
        name: PROVIDER_CONFIGS[selectedProvider]?.name || selectedProvider,
        provider: selectedProvider,
        apiKey: apiKey.trim(),
        tested: false,
        createdAt: Date.now(),
      };

      // 测试连接
      const response = await chrome.runtime.sendMessage({
        type: 'TEST_API_CONNECTION',
        payload: {
          provider: selectedProvider,
          apiKey: apiKey.trim(),
        },
      });

      if (response.success) {
        // 更新设置
        const updatedConfigs = [...(settings?.apiConfigs || []), { ...newConfig, tested: true, lastTestedAt: Date.now() }];

        await chrome.runtime.sendMessage({
          type: 'UPDATE_SETTINGS',
          payload: {
            ...settings,
            apiConfigs: updatedConfigs,
            activeApiConfigId: configId,
            apiProvider: selectedProvider,
          },
        });

        setTestResult('success');
        setTimeout(() => setStep('success'), 500);
      } else {
        setTestResult('error');
      }
    } catch {
      setTestResult('error');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSkip = () => {
    // 标记引导已完成，但未配置
    onComplete();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* 欢迎页 */}
        {step === 'welcome' && (
          <div className="p-6">
            <div className="flex justify-center mb-4">
              <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center text-white font-bold text-2xl">
                N
              </div>
            </div>
            <h2 className="text-xl font-bold text-center text-gray-900 dark:text-gray-100 mb-2">
              欢迎使用 NotOnlyTranslator
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-6">
              智能分级翻译助手，只翻译你不会的词
            </p>

            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">智能分级</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">根据你的水平翻译生词</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">生词本</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">收集并复习生词</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={() => setStep('quick-setup')}
                className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors"
              >
                开始配置
              </button>
              <button
                onClick={handleSkip}
                className="w-full py-2 px-4 text-gray-500 dark:text-gray-400 text-sm hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
              >
                稍后配置
              </button>
            </div>
          </div>
        )}

        {/* 快速配置页 */}
        {step === 'quick-setup' && (
          <div className="p-6">
            <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">
              快速配置 API
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              选择一个翻译服务商并输入 API Key
            </p>

            {/* 服务商选择 */}
            <div className="space-y-2 mb-4">
              {QUICK_PROVIDERS.map(provider => (
                <button
                  key={provider.id}
                  onClick={() => setSelectedProvider(provider.id)}
                  className={`w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                    selectedProvider === provider.id
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-bold ${
                      provider.region === 'domestic' ? 'bg-red-500' : 'bg-blue-500'
                    }`}>
                      {provider.name[0]}
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {provider.name}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {provider.description}
                      </div>
                    </div>
                  </div>
                  {selectedProvider === provider.id && (
                    <svg className="w-5 h-5 text-primary-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>

            {/* API Key 输入 */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={PROVIDER_CONFIGS[selectedProvider]?.apiKeyPlaceholder || '输入 API Key'}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              />
              {testResult === 'error' && (
                <p className="mt-1 text-xs text-red-500">连接测试失败，请检查 API Key</p>
              )}
              {testResult === 'success' && (
                <p className="mt-1 text-xs text-green-500">连接测试成功！</p>
              )}
            </div>

            {/* 按钮 */}
            <div className="flex gap-2">
              <button
                onClick={() => setStep('welcome')}
                className="flex-1 py-2 px-4 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                返回
              </button>
              <button
                onClick={handleQuickSetup}
                disabled={isTesting || !apiKey.trim()}
                className="flex-1 py-2 px-4 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-400 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {isTesting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    测试中...
                  </>
                ) : (
                  '完成配置'
                )}
              </button>
            </div>

            {/* 更多选项 */}
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={onOpenSettings}
                className="w-full text-center text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400"
              >
                需要更多配置选项？
              </button>
            </div>
          </div>
        )}

        {/* 成功页 */}
        {step === 'success' && (
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
              配置成功！
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              你可以开始使用翻译功能了。打开任意英文网页试试吧！
            </p>
            <button
              onClick={onComplete}
              className="w-full py-3 px-4 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors"
            >
              开始使用
            </button>
          </div>
        )}
      </div>
    </div>
  );
}