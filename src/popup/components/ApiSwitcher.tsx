import { useState } from 'react';
import type { UserSettings, ApiProvider } from '@/shared/types';
import { PROVIDER_CONFIGS } from '@/shared/constants/providers';

interface ApiSwitcherProps {
  settings: UserSettings;
  onUpdateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  onOpenOptions: () => void;
}

// 获取 Provider 显示名称
const getProviderDisplayName = (provider?: ApiProvider): string => {
  if (!provider) return '未知';
  return PROVIDER_CONFIGS[provider]?.name || provider;
};

export default function ApiSwitcher({ settings, onUpdateSettings, onOpenOptions }: ApiSwitcherProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const activeConfig = settings.apiConfigs?.find(c => c.id === settings.activeApiConfigId)
    || settings.apiConfigs?.[0];

  const handleSelectConfig = async (configId: string) => {
    await onUpdateSettings({ activeApiConfigId: configId });
    setIsDropdownOpen(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-medium text-gray-500 dark:text-gray-400">翻译服务</h2>
        <button
          onClick={onOpenOptions}
          className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 font-medium"
        >
          管理
        </button>
      </div>

      <div className="relative">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="w-full flex items-center justify-between bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 rounded-md px-3 py-2 transition-colors"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${activeConfig?.tested ? 'bg-green-500' : 'bg-gray-400'}`} />
            <div className="flex flex-col items-start min-w-0">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {activeConfig?.name || '默认配置'}
              </span>
              {activeConfig && (
                <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                  {getProviderDisplayName(activeConfig.provider)}
                  {activeConfig.modelName && ` · ${activeConfig.modelName}`}
                </span>
              )}
            </div>
          </div>
          <svg
            className={`w-4 h-4 text-gray-500 dark:text-gray-400 transition-transform flex-shrink-0 ml-2 ${isDropdownOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isDropdownOpen && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsDropdownOpen(false)}
            />
            <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
              {settings.apiConfigs?.length > 0 ? (
                settings.apiConfigs.map((config) => (
                  <button
                    key={config.id}
                    onClick={() => handleSelectConfig(config.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-between ${
                      config.id === settings.activeApiConfigId ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400' : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="truncate">{config.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {getProviderDisplayName(config.provider)}
                        {config.modelName && ` · ${config.modelName}`}
                      </span>
                    </div>
                    {config.id === settings.activeApiConfigId && (
                      <svg className="w-4 h-4 text-primary-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))
              ) : (
                <div className="p-3 text-center">
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    还未配置翻译服务
                  </div>
                  <button
                    onClick={onOpenOptions}
                    className="text-xs px-3 py-1.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                  >
                    立即配置
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
