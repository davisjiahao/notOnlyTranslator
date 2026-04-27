import { useState, useRef, useEffect, useCallback } from 'react';
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
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeConfig = settings.apiConfigs?.find(c => c.id === settings.activeApiConfigId)
    || settings.apiConfigs?.[0];

  const handleSelectConfig = useCallback(async (configId: string) => {
    await onUpdateSettings({ activeApiConfigId: configId });
    setIsDropdownOpen(false);
    setFocusedIndex(-1);
    triggerRef.current?.focus();
  }, [onUpdateSettings]);

  // WCAG 2.1.1 / 2.4.3: 键盘导航支持 — ArrowDown/ArrowUp 遍历，Enter 选择，Escape 关闭
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isDropdownOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsDropdownOpen(true);
        setFocusedIndex(0);
      }
      return;
    }

    const configs = settings.apiConfigs || [];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex(prev => (prev + 1) % configs.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex(prev => (prev - 1 + configs.length) % configs.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < configs.length) {
          handleSelectConfig(configs[focusedIndex].id);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsDropdownOpen(false);
        setFocusedIndex(-1);
        triggerRef.current?.focus();
        break;
    }
  }, [isDropdownOpen, focusedIndex, settings.apiConfigs, handleSelectConfig]);

  // 自动聚焦当前高亮选项
  useEffect(() => {
    if (isDropdownOpen && focusedIndex >= 0) {
      const items = listRef.current?.querySelectorAll('[role="option"]');
      items?.[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex, isDropdownOpen]);

  // 点击外部关闭
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        listRef.current && !listRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
        setFocusedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDropdownOpen]);

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
        {/* WCAG 4.1.2: 下拉触发按钮 — 添加 aria-haspopup 和 aria-expanded */}
        <button
          ref={triggerRef}
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isDropdownOpen}
          aria-controls="api-config-listbox"
          aria-label="选择翻译服务配置"
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
            aria-hidden="true"
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
            <div
              className="fixed inset-0 z-10"
              onClick={() => setIsDropdownOpen(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsDropdownOpen(false);
                  setFocusedIndex(-1);
                  triggerRef.current?.focus();
                }
              }}
            />
            <div
              ref={listRef}
              id="api-config-listbox"
              role="listbox"
              aria-label="翻译服务配置列表"
              className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto"
            >
              {settings.apiConfigs?.length > 0 ? (
                settings.apiConfigs.map((config, index) => (
                  <button
                    key={config.id}
                    role="option"
                    aria-selected={config.id === settings.activeApiConfigId}
                    onClick={() => handleSelectConfig(config.id)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                      config.id === settings.activeApiConfigId
                        ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium'
                        : 'text-gray-700 dark:text-gray-300'
                    } ${
                      focusedIndex === index
                        ? 'bg-gray-100 dark:bg-gray-700 outline outline-2 outline-primary-500 outline-offset-[-2px]'
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700'
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
                      <svg aria-hidden="true" className="w-4 h-4 text-primary-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
