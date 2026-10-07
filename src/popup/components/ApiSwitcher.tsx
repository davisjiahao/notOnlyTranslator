import { useState, useRef, useEffect, useId } from 'react';
import type { UserSettings, ApiProvider } from '@/shared/types';
import { PROVIDER_CONFIGS } from '@/shared/constants/providers';

interface ApiSwitcherProps {
  settings: UserSettings;
  onUpdateSettings: (settings: Partial<UserSettings>) => Promise<boolean>;
  onOpenOptions: () => void;
}

const getProviderDisplayName = (provider: ApiProvider): string =>
  PROVIDER_CONFIGS[provider]?.name || provider;

export default function ApiSwitcher({ settings, onUpdateSettings, onOpenOptions }: ApiSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string>();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const pendingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const configs = settings.apiConfigs || [];
  const activeConfig = configs.find(config => config.id === settings.activeApiConfigId) || configs[0];
  // 配置删除或排序变化后，不保留失效的活动项引用。
  const focusedIndex = Math.max(0, configs.findIndex(config => config.id === (focusedId ?? activeConfig?.id)));
  const optionId = (index: number) => `${listId}-option-${index}`;

  const open = () => {
    setFocusedId(activeConfig?.id);
    setIsOpen(true);
  };

  const selectConfig = async (id: string) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsSaving(true);
    setError('');
    try {
      if (!await onUpdateSettings({ activeApiConfigId: id })) throw new Error('保存失败');
      setIsOpen(false);
      // 焦点始终保留在触发器；异步完成时不夺回用户已移走的焦点。
    } catch {
      setError('切换失败，原配置未更改，请重试。');
    } finally {
      pendingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        open();
      }
      return;
    }
    if (event.key === 'Tab') {
      setIsOpen(false);
      return; // 保留浏览器原生 Tab 顺序。
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (configs[focusedIndex]) void selectConfig(configs[focusedIndex].id);
      return;
    }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? configs.length - 1
      : event.key === 'ArrowDown' ? (focusedIndex + 1) % configs.length
      : event.key === 'ArrowUp' ? (focusedIndex - 1 + configs.length) % configs.length : -1;
    if (next >= 0 && configs[next]) {
      event.preventDefault();
      setFocusedId(configs[next].id);
    }
  };

  useEffect(() => {
    if (isOpen) document.getElementById(`${listId}-option-${focusedIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, focusedIndex, listId]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [isOpen]);

  if (settings.apiProvider === 'free_google_translate') {
    return (
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs text-gray-500 dark:text-gray-300">翻译服务</h2>
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Google 免费翻译</p>
          <p className="text-xs text-gray-500 dark:text-gray-300">无需 API Key · 联网翻译</p>
        </div>
        <button onClick={onOpenOptions} className="px-2 py-2 text-sm text-primary-700 dark:text-primary-300 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">管理</button>
      </div>
    );
  }

  if (configs.length === 0) {
    return (
      <div className="space-y-2">
        <h2 className="text-xs font-medium text-gray-500 dark:text-gray-300">翻译服务</h2>
        <p className="text-sm text-gray-700 dark:text-gray-300">还未配置翻译服务</p>
        <button onClick={onOpenOptions} className="px-3 py-2 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-500">立即配置</button>
      </div>
    );
  }

  return (
    <div ref={rootRef} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsOpen(false);
    }}>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-medium text-gray-500 dark:text-gray-300">翻译服务</h2>
        <button onClick={onOpenOptions} className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 font-medium focus-visible:ring-2 focus-visible:ring-primary-500 rounded">管理</button>
      </div>
      <div className="relative">
        <button
          ref={triggerRef}
          onClick={() => { if (isOpen) setIsOpen(false); else open(); }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-activedescendant={isOpen ? optionId(focusedIndex) : undefined}
          aria-label={`选择翻译服务配置，当前：${activeConfig.name}`}
          aria-describedby={error ? `${listId}-error` : undefined}
          className="w-full flex items-center justify-between bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600 rounded-md px-3 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          <span className="flex items-center gap-2 overflow-hidden">
            <span aria-hidden="true" className={`w-2 h-2 rounded-full flex-shrink-0 ${activeConfig.tested ? 'bg-green-500' : 'bg-gray-400'}`} />
            <span className="flex flex-col items-start min-w-0">
              <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate max-w-full">{activeConfig.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-300 truncate max-w-full">
                {getProviderDisplayName(activeConfig.provider)}{activeConfig.modelName && ` · ${activeConfig.modelName}`}
              </span>
            </span>
          </span>
          <svg aria-hidden="true" className={`w-4 h-4 text-gray-500 dark:text-gray-300 transition-transform flex-shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <div id={listId} role="listbox" aria-label="翻译服务配置列表" aria-busy={isSaving}
            className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
            {configs.map((config, index) => (
              <button key={config.id} id={optionId(index)} role="option" tabIndex={-1}
                aria-selected={config.id === activeConfig.id} aria-disabled={isSaving}
                onMouseDown={event => event.preventDefault()}
                onClick={() => { triggerRef.current?.focus(); setFocusedId(config.id); void selectConfig(config.id); }}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${config.id === activeConfig.id
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300'} ${focusedIndex === index
                  ? 'bg-gray-100 dark:bg-gray-700 outline outline-2 outline-primary-500 outline-offset-[-2px]'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                <span className="flex flex-col min-w-0">
                  <span className="truncate">{config.name}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-300 truncate">
                    {getProviderDisplayName(config.provider)}{config.modelName && ` · ${config.modelName}`}
                    {!config.tested && ' · 未测试'}
                  </span>
                </span>
                {config.id === activeConfig.id && <span aria-hidden="true" className="ml-2">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {isSaving && <p role="status" className="text-xs text-gray-600 dark:text-gray-300 mt-2">正在切换配置…</p>}
      {error && <p id={`${listId}-error`} role="alert" className="text-xs text-red-700 dark:text-red-300 mt-2">{error}</p>}
    </div>
  );
}
