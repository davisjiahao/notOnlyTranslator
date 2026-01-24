import { useState } from 'react';
import type { UserSettings } from '@/shared/types';

interface ApiSwitcherProps {
  settings: UserSettings;
  onUpdateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  onOpenOptions: () => void;
}

export default function ApiSwitcher({ settings, onUpdateSettings, onOpenOptions }: ApiSwitcherProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const activeConfig = settings.apiConfigs?.find(c => c.id === settings.activeApiConfigId)
    || settings.apiConfigs?.[0];

  const handleSelectConfig = async (configId: string) => {
    await onUpdateSettings({ activeApiConfigId: configId });
    setIsDropdownOpen(false);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-medium text-gray-500 uppercase tracking-wide">翻译服务</h2>
        <button
          onClick={onOpenOptions}
          className="text-xs text-primary-600 hover:text-primary-700 font-medium"
        >
          管理
        </button>
      </div>

      <div className="relative">
        <button
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className="w-full flex items-center justify-between bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-md px-3 py-2 transition-colors"
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${activeConfig?.tested ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="text-sm font-medium text-gray-900 truncate">
              {activeConfig?.name || '默认配置'}
            </span>
          </div>
          <svg
            className={`w-4 h-4 text-gray-500 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`}
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
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
              {settings.apiConfigs?.length > 0 ? (
                settings.apiConfigs.map((config) => (
                  <button
                    key={config.id}
                    onClick={() => handleSelectConfig(config.id)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between ${
                      config.id === settings.activeApiConfigId ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                    }`}
                  >
                    <span className="truncate">{config.name}</span>
                    {config.id === settings.activeApiConfigId && (
                      <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))
              ) : (
                <div className="px-3 py-2 text-sm text-gray-500 text-center">
                  暂无配置，请点击管理添加
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
