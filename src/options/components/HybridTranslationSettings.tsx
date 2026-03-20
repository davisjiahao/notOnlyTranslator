import { useState } from 'react';
import type { UserSettings } from '@/shared/types';
import { PROVIDER_CONFIGS } from '@/shared/constants/providers';

interface HybridTranslationSettingsProps {
  settings: UserSettings;
  onUpdate: (updates: Partial<UserSettings>) => Promise<void>;
  isSaving: boolean;
}

type TraditionalProvider = 'deepl' | 'google_translate' | 'youdao';
type DefaultEngine = 'llm' | 'traditional' | 'hybrid';
type Priority = 'quality' | 'speed' | 'balanced';

export default function HybridTranslationSettings({
  settings,
  onUpdate,
  isSaving,
}: HybridTranslationSettingsProps) {
  const [showApiKey, setShowApiKey] = useState(false);

  // 获取当前混合翻译配置
  const hybridConfig = settings.hybridTranslation || {
    enabled: false,
    defaultEngine: 'hybrid' as DefaultEngine,
    traditionalProvider: 'deepl' as TraditionalProvider,
    simpleTextThreshold: 20,
    enableSmartRouting: true,
    priority: 'balanced' as Priority,
    traditionalApiKey: '',
  };

  // 更新混合翻译配置
  const updateHybridConfig = async (updates: Partial<typeof hybridConfig>) => {
    await onUpdate({
      hybridTranslation: {
        ...hybridConfig,
        ...updates,
      },
    });
  };

  // 翻译引擎选项
  const engineOptions: { value: DefaultEngine; label: string; description: string; icon: string }[] = [
    {
      value: 'llm',
      label: 'LLM 大模型',
      description: '使用 AI 大模型翻译，翻译质量高，支持上下文理解',
      icon: '🤖',
    },
    {
      value: 'traditional',
      label: '传统翻译',
      description: '使用 DeepL/Google/有道等专业翻译服务，速度快',
      icon: '🌐',
    },
    {
      value: 'hybrid',
      label: '智能混合',
      description: '根据文本特征自动选择最佳翻译引擎',
      icon: '⚡',
    },
  ];

  // 传统翻译提供商选项
  const providerOptions: { value: TraditionalProvider; label: string; description: string; features: string[] }[] = [
    {
      value: 'deepl',
      label: 'DeepL',
      description: '业界领先的机器翻译，翻译质量出色',
      features: ['翻译质量高', '支持 31 种语言', '免费版 50 万字符/月'],
    },
    {
      value: 'google_translate',
      label: 'Google Translate',
      description: 'Google 翻译 API，支持 100+ 语言',
      features: ['语言覆盖广', '响应速度快', '按使用量计费'],
    },
    {
      value: 'youdao',
      label: '有道翻译',
      description: '有道智云翻译，国内可直接访问',
      features: ['国内无障碍访问', '200 万字符/月免费', '中文翻译优化'],
    },
  ];

  // 优先级选项
  const priorityOptions: { value: Priority; label: string; description: string }[] = [
    { value: 'quality', label: '质量优先', description: '优先选择翻译质量最高的引擎' },
    { value: 'speed', label: '速度优先', description: '优先选择响应最快的引擎' },
    { value: 'balanced', label: '平衡模式', description: '综合考虑质量和速度' },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">混合翻译引擎</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          配置 LLM 和传统翻译引擎的混合使用策略
        </p>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {/* 启用混合翻译 */}
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-900 dark:text-white">启用混合翻译</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              开启后可选择使用传统翻译引擎或混合模式
            </div>
          </div>
          <button
            onClick={() => updateHybridConfig({ enabled: !hybridConfig.enabled })}
            disabled={isSaving}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              hybridConfig.enabled ? 'bg-primary-600' : 'bg-gray-300'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                hybridConfig.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 混合翻译配置（仅在启用时显示） */}
        {hybridConfig.enabled && (
          <>
            {/* 默认引擎选择 */}
            <div className="px-6 py-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                默认翻译引擎
              </label>
              <div className="space-y-3">
                {engineOptions.map((engine) => (
                  <button
                    key={engine.value}
                    onClick={() => updateHybridConfig({ defaultEngine: engine.value })}
                    disabled={isSaving}
                    className={`w-full p-4 border rounded-lg text-left transition-all ${
                      hybridConfig.defaultEngine === engine.value
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    } disabled:opacity-50`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{engine.icon}</span>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900 dark:text-white">{engine.label}</div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{engine.description}</div>
                      </div>
                      {hybridConfig.defaultEngine === engine.value && (
                        <div className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0">
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 传统翻译提供商（仅在需要时显示） */}
            {(hybridConfig.defaultEngine === 'traditional' || hybridConfig.defaultEngine === 'hybrid') && (
              <div className="px-6 py-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                  传统翻译服务
                </label>
                <div className="space-y-3">
                  {providerOptions.map((provider) => (
                    <button
                        key={provider.value}
                        onClick={() => updateHybridConfig({ traditionalProvider: provider.value })}
                        disabled={isSaving}
                        className={`w-full p-4 border rounded-lg text-left transition-all ${
                          hybridConfig.traditionalProvider === provider.value
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                        } disabled:opacity-50`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium text-gray-900 dark:text-white">{provider.label}</div>
                            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                              {provider.description}
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                              {provider.features.map((feature, idx) => (
                                <span
                                  key={idx}
                                  className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded"
                                >
                                  {feature}
                                </span>
                              ))}
                            </div>
                          </div>
                          {hybridConfig.traditionalProvider === provider.value && (
                            <div className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                              <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                                <path
                                  fillRule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                </div>

                {/* API Key 配置 */}
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {PROVIDER_CONFIGS[hybridConfig.traditionalProvider]?.name || '传统翻译'} API 密钥
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={hybridConfig.traditionalApiKey || ''}
                      onChange={(e) => updateHybridConfig({ traditionalApiKey: e.target.value })}
                      placeholder={PROVIDER_CONFIGS[hybridConfig.traditionalProvider]?.apiKeyPlaceholder || '输入 API Key'}
                      className="w-full px-4 py-3 pr-20 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-800 dark:text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      {showApiKey ? (
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
                  {PROVIDER_CONFIGS[hybridConfig.traditionalProvider]?.docUrl && (
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                      获取密钥:{' '}
                      <a
                        href={PROVIDER_CONFIGS[hybridConfig.traditionalProvider].docUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-600 hover:underline"
                      >
                        {PROVIDER_CONFIGS[hybridConfig.traditionalProvider].docUrl}
                      </a>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* 智能路由（仅混合模式） */}
            {hybridConfig.defaultEngine === 'hybrid' && (
              <>
                <div className="px-6 py-4 flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900 dark:text-white">智能路由</div>
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      根据文本特征自动选择最佳翻译引擎
                    </div>
                  </div>
                  <button
                    onClick={() => updateHybridConfig({ enableSmartRouting: !hybridConfig.enableSmartRouting })}
                    disabled={isSaving}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                      hybridConfig.enableSmartRouting ? 'bg-primary-600' : 'bg-gray-300'
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        hybridConfig.enableSmartRouting ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 简单文本阈值 */}
                <div className="px-6 py-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    简单文本阈值
                  </label>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                    词数低于此阈值的简单文本将使用传统翻译引擎，复杂文本使用 LLM
                  </p>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="5"
                      max="50"
                      step="5"
                      value={hybridConfig.simpleTextThreshold}
                      onChange={(e) => updateHybridConfig({ simpleTextThreshold: Number(e.target.value) })}
                      disabled={isSaving}
                      className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600 disabled:opacity-50"
                    />
                    <div className="w-20 text-center">
                      <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
                        {hybridConfig.simpleTextThreshold} 词
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-2">
                    <span>更倾向 LLM (5)</span>
                    <span>平衡 (20)</span>
                    <span>更倾向传统 (50)</span>
                  </div>
                </div>

                {/* 优先级 */}
                <div className="px-6 py-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                    翻译优先级
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {priorityOptions.map((priority) => (
                      <button
                        key={priority.value}
                        onClick={() => updateHybridConfig({ priority: priority.value })}
                        disabled={isSaving}
                        className={`p-3 border rounded-lg text-center transition-all ${
                          hybridConfig.priority === priority.value
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                        } disabled:opacity-50`}
                      >
                        <div className="font-medium text-gray-900 dark:text-white">{priority.label}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{priority.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {/* 说明信息 */}
      {hybridConfig.enabled && (
        <div className="px-6 py-4 bg-blue-50 dark:bg-blue-900/20 border-t border-blue-100 dark:border-blue-800">
          <div className="flex items-start gap-2 text-sm text-blue-700 dark:text-blue-400">
            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <div>
              <p className="font-medium">混合翻译引擎说明</p>
              <ul className="mt-1 space-y-1 text-blue-600 dark:text-blue-300">
                <li>• <strong>LLM</strong>: 适合复杂文本、需要上下文理解的场景</li>
                <li>• <strong>传统翻译</strong>: 适合简单文本、追求速度的场景</li>
                <li>• <strong>混合模式</strong>: 根据文本复杂度自动选择最佳引擎</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}