import { useState, useEffect, useCallback } from 'react';
import type { ApiConfig, ApiProvider, ModelInfo } from '@/shared/types';
import {
  PROVIDER_CONFIGS,
  PROVIDER_GROUPS,
  getProviderConfig,
  requiresSecondaryKey,
} from '@/shared/constants/providers';
import { getModels, testConnection } from '@/shared/services/modelService';

/** API 配置完整更新参数 */
interface ApiConfigUpdateParams {
  configs: ApiConfig[];
  activeId?: string;
  provider?: ApiProvider;
  apiKey?: string;
  customApiUrl?: string;
  customModelName?: string;
  secondaryApiKey?: string;
}

interface ApiSettingsProps {
  apiKey: string;
  provider: ApiProvider;
  customApiUrl?: string;
  customModelName?: string;
  secondaryApiKey?: string;
  apiConfigs: ApiConfig[];
  activeApiConfigId?: string;
  onApiKeyUpdate: (key: string) => Promise<void>;
  onProviderUpdate: (provider: ApiProvider) => void;
  onCustomSettingsUpdate: (url: string, model: string, secondaryKey?: string) => void;
  onApiConfigsUpdate: (configs: ApiConfig[], activeId?: string) => void;
  /** 一次性保存所有 API 相关配置（避免状态竞争） */
  onFullApiConfigUpdate?: (params: ApiConfigUpdateParams) => Promise<void>;
  isSaving: boolean;
}

export default function ApiSettings({
  apiKey,
  provider,
  customApiUrl = '',
  customModelName = '',
  secondaryApiKey = '',
  apiConfigs = [],
  activeApiConfigId,
  onApiKeyUpdate,
  onProviderUpdate,
  onCustomSettingsUpdate,
  onApiConfigsUpdate,
  onFullApiConfigUpdate,
  isSaving,
}: ApiSettingsProps) {
  // 配置编辑模式
  const [editMode, setEditMode] = useState<'list' | 'add' | 'edit'>('list');
  const [editingConfig, setEditingConfig] = useState<ApiConfig | null>(null);

  // 新配置的表单
  const [configName, setConfigName] = useState('');
  const [configProvider, setConfigProvider] = useState<ApiProvider>('openai');
  const [configApiKey, setConfigApiKey] = useState('');
  const [configSecondaryKey, setConfigSecondaryKey] = useState('');
  const [configApiUrl, setConfigApiUrl] = useState('');
  const [configModelName, setConfigModelName] = useState('');
  const [showConfigKey, setShowConfigKey] = useState(false);
  const [showSecondaryKey, setShowSecondaryKey] = useState(false);
  const [isTestingConfig, setIsTestingConfig] = useState(false);
  const [configTestResult, setConfigTestResult] = useState<'success' | 'error' | null>(null);
  const [configTestError, setConfigTestError] = useState<string | null>(null);

  // 模型列表
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);

  // 获取当前供应商配置
  const currentProviderConfig = getProviderConfig(configProvider);

  // 加载模型列表
  const loadModels = useCallback(async () => {
    if (!configApiKey) {
      setModels(currentProviderConfig.defaultModels);
      return;
    }

    setIsLoadingModels(true);
    try {
      const fetchedModels = await getModels(
        configProvider,
        configApiKey,
        configApiUrl || undefined,
        configSecondaryKey || undefined
      );
      setModels(fetchedModels);

      // 如果当前模型不在列表中且不是自定义模式，设置为推荐模型
      if (!useCustomModel && fetchedModels.length > 0) {
        const currentModelExists = fetchedModels.some(m => m.id === configModelName);
        if (!currentModelExists) {
          const recommended = fetchedModels.find(m => m.isRecommended) || fetchedModels[0];
          setConfigModelName(recommended.id);
        }
      }
    } catch (error) {
      console.error('加载模型列表失败:', error);
      setModels(currentProviderConfig.defaultModels);
    } finally {
      setIsLoadingModels(false);
    }
  }, [configApiKey, configProvider, configApiUrl, configSecondaryKey, currentProviderConfig, configModelName, useCustomModel]);

  // 当供应商变化时重置模型列表
  useEffect(() => {
    setModels(currentProviderConfig.defaultModels);
    if (!useCustomModel) {
      setConfigModelName(currentProviderConfig.recommendedModel);
    }
  }, [configProvider, currentProviderConfig, useCustomModel]);

  // 测试新配置
  const testNewConfig = async () => {
    if (!configApiKey || (configProvider === 'custom' && !configApiUrl)) return;
    if (requiresSecondaryKey(configProvider) && !configSecondaryKey) return;

    setIsTestingConfig(true);
    setConfigTestResult(null);
    setConfigTestError(null);

    try {
      const result = await testConnection(
        configProvider,
        configApiKey,
        configModelName || undefined,
        configApiUrl || undefined,
        configSecondaryKey || undefined
      );

      if (result.success) {
        setConfigTestResult('success');
        // 测试成功后加载模型列表
        await loadModels();
      } else {
        setConfigTestResult('error');
        setConfigTestError(result.error || '连接测试失败');
      }
    } catch (error) {
      setConfigTestResult('error');
      setConfigTestError(error instanceof Error ? error.message : '连接测试失败');
    } finally {
      setIsTestingConfig(false);
    }
  };

  // 保存新配置
  const saveNewConfig = async () => {
    if (!configName.trim() || !configApiKey) return;
    if (configTestResult !== 'success') {
      alert('请先测试 API 连接');
      return;
    }

    const configId = editingConfig?.id || `config-${Date.now()}`;
    const newConfig: ApiConfig = {
      id: configId,
      name: configName.trim(),
      provider: configProvider,
      apiKey: configApiKey,
      apiUrl: configApiUrl || undefined,
      modelName: configModelName || undefined,
      secondaryApiKey: configSecondaryKey || undefined,
      tested: true,
      lastTestedAt: Date.now(),
      createdAt: editingConfig?.createdAt || Date.now(),
    };

    let newConfigs: ApiConfig[];
    let newActiveId: string | undefined;

    if (editingConfig) {
      // 编辑模式：保持原激活状态
      newConfigs = apiConfigs.map((c) => (c.id === editingConfig.id ? newConfig : c));
      newActiveId = activeApiConfigId;
    } else {
      // 新增模式：自动激活新配置
      newConfigs = [...apiConfigs, newConfig];
      newActiveId = configId;
    }

    // 使用一次性保存函数避免状态竞争
    if (onFullApiConfigUpdate) {
      const shouldUpdateMainSettings = !editingConfig || activeApiConfigId === editingConfig.id;
      await onFullApiConfigUpdate({
        configs: newConfigs,
        activeId: newActiveId,
        provider: shouldUpdateMainSettings ? configProvider : undefined,
        apiKey: shouldUpdateMainSettings ? configApiKey : undefined,
        customApiUrl: shouldUpdateMainSettings ? (configApiUrl || '') : undefined,
        customModelName: shouldUpdateMainSettings ? (configModelName || '') : undefined,
        secondaryApiKey: shouldUpdateMainSettings ? (configSecondaryKey || '') : undefined,
      });
    } else {
      // 回退到旧的方式（兼容性）
      if (!editingConfig || activeApiConfigId === editingConfig.id) {
        onProviderUpdate(configProvider);
        await onApiKeyUpdate(configApiKey);
        if (configApiUrl || configModelName || configSecondaryKey) {
          onCustomSettingsUpdate(configApiUrl || '', configModelName || '', configSecondaryKey || '');
        }
      }
      onApiConfigsUpdate(newConfigs, newActiveId);
    }

    resetConfigForm();
    setEditMode('list');
  };

  // 删除配置
  const deleteConfig = (configId: string) => {
    if (!confirm('确定要删除这个配置吗？')) return;

    const newConfigs = apiConfigs.filter((c) => c.id !== configId);
    const newActiveId = activeApiConfigId === configId ? undefined : activeApiConfigId;
    onApiConfigsUpdate(newConfigs, newActiveId);
  };

  // 选择配置作为当前使用
  const selectConfig = async (config: ApiConfig) => {
    if (onFullApiConfigUpdate) {
      await onFullApiConfigUpdate({
        configs: apiConfigs,
        activeId: config.id,
        provider: config.provider,
        apiKey: config.apiKey,
        customApiUrl: config.apiUrl || '',
        customModelName: config.modelName || '',
        secondaryApiKey: config.secondaryApiKey || '',
      });
    } else {
      await onApiKeyUpdate(config.apiKey);
      onProviderUpdate(config.provider);
      if (config.apiUrl || config.modelName || config.secondaryApiKey) {
        onCustomSettingsUpdate(config.apiUrl || '', config.modelName || '', config.secondaryApiKey || '');
      }
      onApiConfigsUpdate(apiConfigs, config.id);
    }
  };

  // 重置配置表单
  const resetConfigForm = () => {
    setConfigName('');
    setConfigProvider('openai');
    setConfigApiKey('');
    setConfigSecondaryKey('');
    setConfigApiUrl('');
    setConfigModelName('');
    setConfigTestResult(null);
    setConfigTestError(null);
    setEditingConfig(null);
    setShowConfigKey(false);
    setShowSecondaryKey(false);
    setUseCustomModel(false);
    setModels([]);
  };

  // 开始编辑配置
  const startEditConfig = (config: ApiConfig) => {
    setEditingConfig(config);
    setConfigName(config.name);
    setConfigProvider(config.provider);
    setConfigApiKey(config.apiKey);
    setConfigSecondaryKey(config.secondaryApiKey || '');
    setConfigApiUrl(config.apiUrl || '');
    setConfigModelName(config.modelName || '');
    setConfigTestResult(config.tested ? 'success' : null);
    setEditMode('edit');

    // 加载模型列表
    if (config.tested) {
      setIsLoadingModels(true);
      getModels(config.provider, config.apiKey, config.apiUrl, config.secondaryApiKey)
        .then(setModels)
        .catch(() => setModels(getProviderConfig(config.provider).defaultModels))
        .finally(() => setIsLoadingModels(false));
    }
  };

  // 获取供应商显示名称
  const getProviderDisplayName = (providerId: ApiProvider): string => {
    return PROVIDER_CONFIGS[providerId]?.name || providerId;
  };

  // 只显示测试通过的配置
  const testedConfigs = apiConfigs.filter((c) => c.tested);

  // 配置列表视图
  if (editMode === 'list') {
    return (
      <div className="space-y-6">
        {/* 快速选择已测试的配置 */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">API 配置</h2>
            <button
              onClick={() => {
                resetConfigForm();
                setEditMode('add');
              }}
              className="px-3 py-1.5 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
            >
              + 添加配置
            </button>
          </div>

          {testedConfigs.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-gray-500 mb-2">
                点击选择要使用的 API 配置（仅显示测试通过的配置）
              </p>
              {testedConfigs.map((config) => (
                <div
                  key={config.id}
                  className={`p-4 border rounded-lg transition-colors ${
                    activeApiConfigId === config.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => selectConfig(config)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{config.name}</span>
                        <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                          {getProviderDisplayName(config.provider)}
                        </span>
                        {activeApiConfigId === config.id && (
                          <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                            当前使用
                          </span>
                        )}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {config.apiUrl || PROVIDER_CONFIGS[config.provider]?.defaultEndpoint || '默认端点'}
                        {config.modelName && ` · ${config.modelName}`}
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEditConfig(config)}
                        className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
                        title="编辑"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => deleteConfig(config.id)}
                        className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                        title="删除"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <svg className="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <p className="text-gray-500 mb-4">还没有配置 API</p>
              <button
                onClick={() => {
                  resetConfigForm();
                  setEditMode('add');
                }}
                className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors"
              >
                添加第一个配置
              </button>
            </div>
          )}
        </div>

        {/* 当前使用的配置（兼容旧版） */}
        {!activeApiConfigId && apiKey && (
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">当前 API 设置</h2>
            <p className="text-sm text-gray-500 mb-4">
              您有一个未保存为配置的 API 设置。可以继续使用，或保存为配置以便快速切换。
            </p>

            <div className="p-4 border border-gray-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-medium text-gray-900">
                  {getProviderDisplayName(provider)}
                </span>
                <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">
                  当前使用
                </span>
              </div>
              <div className="text-sm text-gray-500">
                API Key: {apiKey.slice(0, 8)}...{apiKey.slice(-4)}
              </div>
            </div>

            <button
              onClick={() => {
                setConfigName(getProviderDisplayName(provider));
                setConfigProvider(provider);
                setConfigApiKey(apiKey);
                setConfigApiUrl(customApiUrl);
                setConfigModelName(customModelName);
                setConfigSecondaryKey(secondaryApiKey);
                setConfigTestResult(null);
                setEditMode('add');
              }}
              className="mt-4 px-4 py-2 text-sm text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
            >
              保存为配置
            </button>
          </div>
        )}

        {/* 安全提示 */}
        <div className="p-4 bg-amber-50 rounded-lg">
          <div className="flex items-start gap-2 text-sm text-amber-700">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-medium">安全提示</p>
              <p className="mt-1">
                API 密钥将加密存储在您的浏览器中，不会传输到任何第三方服务器。请妥善保管您的密钥。
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 添加/编辑配置视图
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => {
            resetConfigForm();
            setEditMode('list');
          }}
          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-lg font-semibold text-gray-900">
          {editMode === 'edit' ? '编辑配置' : '添加新配置'}
        </h2>
      </div>

      {/* 配置名称 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          配置名称 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={configName}
          onChange={(e) => setConfigName(e.target.value)}
          placeholder="如：我的 OpenAI"
          className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 ${
            configTestResult === 'success' && !configName.trim()
              ? 'border-red-300 bg-red-50'
              : 'border-gray-200'
          }`}
        />
        {configTestResult === 'success' && !configName.trim() && (
          <p className="text-xs text-red-500 mt-1">请填写配置名称才能保存</p>
        )}
      </div>

      {/* Provider selection - 分组下拉框 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          选择 API 服务商
        </label>
        <div className="relative">
          <select
            value={configProvider}
            onChange={(e) => {
              setConfigProvider(e.target.value as ApiProvider);
              setConfigTestResult(null);
              setConfigTestError(null);
            }}
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 appearance-none bg-white"
          >
            {PROVIDER_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.providers.map((providerId) => {
                  const providerConfig = PROVIDER_CONFIGS[providerId];
                  return (
                    <option key={providerId} value={providerId}>
                      {providerConfig.name} - {providerConfig.description}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
          <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {currentProviderConfig.description}
        </p>
      </div>

      {/* Custom API URL */}
      {configProvider === 'custom' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            API 端点 URL <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={configApiUrl}
            onChange={(e) => setConfigApiUrl(e.target.value)}
            placeholder="https://your-api.com/v1/chat/completions"
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      )}

      {/* API URL for non-custom (optional) */}
      {configProvider !== 'custom' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            API 端点 URL (可选，覆盖默认)
          </label>
          <input
            type="text"
            value={configApiUrl}
            onChange={(e) => setConfigApiUrl(e.target.value)}
            placeholder={currentProviderConfig.chatEndpoint}
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            留空使用官方 API，填写则覆盖默认端点（如使用代理）
          </p>
        </div>
      )}

      {/* API Key input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          API 密钥 <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <input
            type={showConfigKey ? 'text' : 'password'}
            value={configApiKey}
            onChange={(e) => {
              setConfigApiKey(e.target.value);
              setConfigTestResult(null);
            }}
            placeholder={currentProviderConfig.apiKeyPlaceholder}
            className="w-full px-4 py-3 pr-20 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={() => setShowConfigKey(!showConfigKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
          >
            {showConfigKey ? (
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
          <p className="text-xs text-gray-500 mt-2">
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
      {requiresSecondaryKey(configProvider) && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Secret Key <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <input
              type={showSecondaryKey ? 'text' : 'password'}
              value={configSecondaryKey}
              onChange={(e) => {
                setConfigSecondaryKey(e.target.value);
                setConfigTestResult(null);
              }}
              placeholder="输入 Secret Key"
              className="w-full px-4 py-3 pr-20 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="button"
              onClick={() => setShowSecondaryKey(!showSecondaryKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
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
          <p className="text-xs text-gray-500 mt-1">
            百度文心需要同时提供 API Key 和 Secret Key
          </p>
        </div>
      )}

      {/* Model selection */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-gray-700">
            模型
          </label>
          <div className="flex items-center gap-2">
            {configTestResult === 'success' && currentProviderConfig.modelsSupported && (
              <button
                onClick={loadModels}
                disabled={isLoadingModels}
                className="text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50"
              >
                {isLoadingModels ? '加载中...' : '刷新列表'}
              </button>
            )}
            <label className="flex items-center gap-1 text-xs text-gray-500">
              <input
                type="checkbox"
                checked={useCustomModel}
                onChange={(e) => {
                  setUseCustomModel(e.target.checked);
                  if (!e.target.checked && models.length > 0) {
                    const recommended = models.find(m => m.isRecommended) || models[0];
                    setConfigModelName(recommended.id);
                  }
                }}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              自定义模型
            </label>
          </div>
        </div>

        {useCustomModel ? (
          <input
            type="text"
            value={configModelName}
            onChange={(e) => setConfigModelName(e.target.value)}
            placeholder="输入模型名称"
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        ) : (
          <div className="relative">
            <select
              value={configModelName}
              onChange={(e) => setConfigModelName(e.target.value)}
              disabled={isLoadingModels}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 appearance-none bg-white disabled:opacity-50"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                  {model.isRecommended ? ' (推荐)' : ''}
                  {model.description ? ` - ${model.description}` : ''}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
              {isLoadingModels ? (
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              )}
            </div>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-1">
          {configTestResult === 'success'
            ? '测试成功后可获取最新模型列表'
            : '请先测试连接以获取模型列表'}
        </p>
      </div>

      {/* Test result */}
      {configTestResult && (
        <div className={`mb-6 p-4 rounded-lg ${
          configTestResult === 'success' ? 'bg-green-50' : 'bg-red-50'
        }`}>
          <div className={`flex items-center gap-2 text-sm ${
            configTestResult === 'success' ? 'text-green-700' : 'text-red-700'
          }`}>
            {configTestResult === 'success' ? (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>API 连接成功</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{configTestError || 'API 连接失败，请检查密钥和端点'}</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={testNewConfig}
          disabled={
            !configApiKey ||
            isTestingConfig ||
            (configProvider === 'custom' && !configApiUrl) ||
            (requiresSecondaryKey(configProvider) && !configSecondaryKey)
          }
          className="flex-1 py-3 px-4 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isTestingConfig ? '测试中...' : '测试连接'}
        </button>
        <button
          onClick={saveNewConfig}
          disabled={isSaving || !configName.trim() || !configApiKey || configTestResult !== 'success'}
          className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? '保存中...' : '保存配置'}
        </button>
      </div>

      {/* 保存按钮禁用原因提示 */}
      {configApiKey && (
        <p className="text-xs text-amber-600 mt-3 text-center">
          {configTestResult !== 'success'
            ? '请先测试 API 连接成功后才能保存配置'
            : !configName.trim()
            ? '请填写配置名称'
            : null}
        </p>
      )}
    </div>
  );
}
