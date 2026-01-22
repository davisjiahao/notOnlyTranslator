import { useState } from 'react';
import type { UserSettings } from '@/shared/types';

interface ApiSettingsProps {
  apiKey: string;
  provider: UserSettings['apiProvider'];
  customApiUrl?: string;
  customModelName?: string;
  onApiKeyUpdate: (key: string) => Promise<void>;
  onProviderUpdate: (provider: UserSettings['apiProvider']) => void;
  onCustomSettingsUpdate: (url: string, model: string) => void;
  isSaving: boolean;
}

export default function ApiSettings({
  apiKey,
  provider,
  customApiUrl = '',
  customModelName = '',
  onApiKeyUpdate,
  onProviderUpdate,
  onCustomSettingsUpdate,
  isSaving,
}: ApiSettingsProps) {
  const [inputKey, setInputKey] = useState(apiKey);
  const [inputUrl, setInputUrl] = useState(customApiUrl);
  const [inputModel, setInputModel] = useState(customModelName);
  const [showKey, setShowKey] = useState(false);
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);

  const handleSaveKey = async () => {
    await onApiKeyUpdate(inputKey);
    if (provider === 'custom') {
      onCustomSettingsUpdate(inputUrl, inputModel);
    }
  };

  const testApiKey = async () => {
    if (!inputKey) return;

    setIsTestingKey(true);
    setTestResult(null);

    try {
      let endpoint: string;
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (provider === 'openai') {
        endpoint = inputUrl || 'https://api.openai.com/v1/models';
        headers['Authorization'] = `Bearer ${inputKey}`;
      } else if (provider === 'anthropic') {
        endpoint = inputUrl || 'https://api.anthropic.com/v1/messages';
        headers['x-api-key'] = inputKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        // Custom API
        if (!inputUrl) {
          setTestResult('error');
          setIsTestingKey(false);
          return;
        }
        endpoint = inputUrl;
        headers['Authorization'] = `Bearer ${inputKey}`;
      }

      const response = await fetch(endpoint, {
        method: provider === 'openai' && !inputUrl ? 'GET' : 'POST',
        headers,
        body: provider !== 'openai' || inputUrl ? JSON.stringify({
          model: inputModel || (provider === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-3.5-turbo'),
          max_tokens: 10,
          messages: [{ role: 'user', content: 'test' }],
        }) : undefined,
      });

      setTestResult(response.ok ? 'success' : 'error');
    } catch {
      setTestResult('error');
    } finally {
      setIsTestingKey(false);
    }
  };

  const providers: { id: UserSettings['apiProvider']; name: string; description: string }[] = [
    {
      id: 'openai',
      name: 'OpenAI',
      description: '使用 GPT-4o-mini 模型，速度快，成本低',
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: '使用 Claude 3 Haiku 模型，翻译质量高',
    },
    {
      id: 'custom',
      name: '自定义 API',
      description: '使用兼容 OpenAI 格式的自定义 API 端点',
    },
  ];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-6">API 设置</h2>

      {/* Provider selection */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          选择 API 服务商
        </label>
        <div className="space-y-3">
          {providers.map((p) => (
            <button
              key={p.id}
              onClick={() => onProviderUpdate(p.id)}
              className={`w-full p-4 border rounded-lg text-left transition-colors ${
                provider === p.id
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">{p.name}</div>
                  <div className="text-sm text-gray-500">{p.description}</div>
                </div>
                {provider === p.id && (
                  <div className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                    <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom API URL (only for custom or when overriding) */}
      {(provider === 'custom' || inputUrl) && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            {provider === 'custom' ? 'API 端点 URL *' : 'API 端点 URL (可选，覆盖默认)'}
          </label>
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder={
              provider === 'openai'
                ? 'https://api.openai.com/v1/chat/completions'
                : provider === 'anthropic'
                ? 'https://api.anthropic.com/v1/messages'
                : 'https://your-api.com/v1/chat/completions'
            }
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            {provider === 'custom'
              ? '输入兼容 OpenAI 格式的 API 端点 URL'
              : '留空使用官方 API，填写则覆盖默认端点（如使用代理）'}
          </p>
        </div>
      )}

      {/* Toggle custom URL for non-custom providers */}
      {provider !== 'custom' && !inputUrl && (
        <div className="mb-6">
          <button
            onClick={() => setInputUrl(provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : 'https://api.anthropic.com/v1/messages')}
            className="text-sm text-primary-600 hover:text-primary-700 hover:underline"
          >
            + 自定义 API 端点（如使用代理）
          </button>
        </div>
      )}

      {/* Custom Model Name */}
      {(provider === 'custom' || inputUrl) && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            模型名称 (可选)
          </label>
          <input
            type="text"
            value={inputModel}
            onChange={(e) => setInputModel(e.target.value)}
            placeholder={
              provider === 'openai'
                ? 'gpt-4o-mini'
                : provider === 'anthropic'
                ? 'claude-3-haiku-20240307'
                : 'gpt-3.5-turbo'
            }
            className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            留空使用默认模型
          </p>
        </div>
      )}

      {/* API Key input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          API 密钥
        </label>
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={inputKey}
            onChange={(e) => setInputKey(e.target.value)}
            placeholder={`输入您的 ${provider === 'openai' ? 'OpenAI' : provider === 'anthropic' ? 'Anthropic' : ''} API 密钥`}
            className="w-full px-4 py-3 pr-20 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600"
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
        {provider !== 'custom' && (
          <p className="text-xs text-gray-500 mt-2">
            {provider === 'openai' ? (
              <>
                获取密钥: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">platform.openai.com</a>
              </>
            ) : (
              <>
                获取密钥: <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer" className="text-primary-600 hover:underline">console.anthropic.com</a>
              </>
            )}
          </p>
        )}
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`mb-6 p-4 rounded-lg ${
          testResult === 'success' ? 'bg-green-50' : 'bg-red-50'
        }`}>
          <div className={`flex items-center gap-2 text-sm ${
            testResult === 'success' ? 'text-green-700' : 'text-red-700'
          }`}>
            {testResult === 'success' ? (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>API 密钥有效</span>
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>API 密钥无效或网络错误</span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={testApiKey}
          disabled={!inputKey || isTestingKey || (provider === 'custom' && !inputUrl)}
          className="flex-1 py-3 px-4 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isTestingKey ? '测试中...' : '测试密钥'}
        </button>
        <button
          onClick={handleSaveKey}
          disabled={isSaving || !inputKey || (provider === 'custom' && !inputUrl)}
          className="flex-1 py-3 px-4 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {isSaving ? '保存中...' : '保存设置'}
        </button>
      </div>

      {/* Security note */}
      <div className="mt-6 p-4 bg-amber-50 rounded-lg">
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

      {/* Custom API usage examples */}
      {provider === 'custom' && (
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <div className="text-sm text-blue-700">
            <p className="font-medium mb-2">自定义 API 使用示例</p>
            <ul className="space-y-1 text-xs">
              <li>• OpenAI 兼容服务: https://api.your-service.com/v1/chat/completions</li>
              <li>• 本地部署模型: http://localhost:1234/v1/chat/completions</li>
              <li>• API 代理: https://your-proxy.com/v1/chat/completions</li>
            </ul>
            <p className="mt-2 text-xs">
              自定义 API 需要兼容 OpenAI 的请求/响应格式
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
