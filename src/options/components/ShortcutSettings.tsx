import { useState, useEffect, useCallback } from 'react';
import type { UserSettings } from '@/shared/types';

interface ShortcutSettingsProps {
  settings: UserSettings;
  onUpdate: (updates: Partial<UserSettings>) => Promise<void>;
  isSaving: boolean;
}

interface ShortcutInfo {
  action: string;
  key: string;
  description: string;
  enabled: boolean;
}

// 默认快捷键配置（移到组件外部避免依赖问题）
const DEFAULT_SHORTCUTS: ShortcutInfo[] = [
  {
    action: 'translate-paragraph',
    key: 'Alt+T',
    description: '快速翻译当前段落',
    enabled: true,
  },
  {
    action: 'toggle-translation',
    key: 'Alt+Shift+T',
    description: '切换翻译显示',
    enabled: true,
  },
  {
    action: 'close-tooltip',
    key: 'Escape',
    description: '关闭翻译/Tooltip',
    enabled: true,
  },
  {
    action: 'next-highlight',
    key: 'J',
    description: '下一个高亮词汇',
    enabled: true,
  },
  {
    action: 'prev-highlight',
    key: 'K',
    description: '上一个高亮词汇',
    enabled: true,
  },
  {
    action: 'pin-tooltip',
    key: 'P',
    description: '钉住/取消钉住 Tooltip',
    enabled: true,
  },
  {
    action: 'mark-known',
    key: 'M',
    description: '标记当前词汇为已知',
    enabled: true,
  },
  {
    action: 'mark-unknown',
    key: 'U',
    description: '标记当前词汇为未知',
    enabled: true,
  },
  {
    action: 'add-vocabulary',
    key: 'A',
    description: '添加到生词本',
    enabled: true,
  },
];

/**
 * 快捷键设置组件
 *
 * 显示和配置所有快捷键
 */
export default function ShortcutSettings({
  settings,
  onUpdate,
  isSaving,
}: ShortcutSettingsProps) {
  const [shortcuts, setShortcuts] = useState<ShortcutInfo[]>([]);
  const [editingAction, setEditingAction] = useState<string | null>(null);
  const [pressedKeys, setPressedKeys] = useState<string[]>([]);

  useEffect(() => {
    // 加载用户自定义快捷键
    const savedShortcuts = settings.shortcuts as ShortcutInfo[] | undefined;
    if (savedShortcuts) {
      // 合并默认配置和用户配置
      const merged = DEFAULT_SHORTCUTS.map(def => {
        const saved = savedShortcuts.find(s => s.action === def.action);
        return saved ? { ...def, ...saved } : def;
      });
      setShortcuts(merged);
    } else {
      setShortcuts(DEFAULT_SHORTCUTS);
    }
  }, [settings.shortcuts]);

  // 更新快捷键
  const updateShortcut = useCallback(async (action: string, newKey: string) => {
    setShortcuts(prev => {
      const updated = prev.map(s =>
        s.action === action ? { ...s, key: newKey } : s
      );
      onUpdate({ shortcuts: updated });
      return updated;
    });
  }, [onUpdate]);

  // 处理按键捕获
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!editingAction) return;

    e.preventDefault();
    e.stopPropagation();

    const keys: string[] = [];
    if (e.ctrlKey) keys.push('Ctrl');
    if (e.altKey) keys.push('Alt');
    if (e.shiftKey) keys.push('Shift');
    if (e.metaKey) keys.push('Meta');

    // 主键
    const key = e.key;
    if (key && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      if (key === ' ') keys.push('Space');
      else if (key === 'Escape') keys.push('Escape');
      else if (key === 'ArrowUp') keys.push('↑');
      else if (key === 'ArrowDown') keys.push('↓');
      else if (key === 'ArrowLeft') keys.push('←');
      else if (key === 'ArrowRight') keys.push('→');
      else keys.push(key.length === 1 ? key.toUpperCase() : key);
    }

    setPressedKeys(keys);
  }, [editingAction]);

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (!editingAction) return;

    // 如果按下 Escape，取消编辑
    if (e.key === 'Escape') {
      setEditingAction(null);
      setPressedKeys([]);
      return;
    }

    // 如果有有效的快捷键组合，保存它
    setPressedKeys(prevKeys => {
      if (prevKeys.length > 0) {
        const newKey = prevKeys.join('+');
        updateShortcut(editingAction, newKey);
        setEditingAction(null);
      }
      return [];
    });
  }, [editingAction, updateShortcut]);

  useEffect(() => {
    if (editingAction) {
      window.addEventListener('keydown', handleKeyDown);
      window.addEventListener('keyup', handleKeyUp);
      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      };
    }
  }, [editingAction, handleKeyDown, handleKeyUp]);

  // 切换快捷键启用状态
  const toggleShortcut = async (action: string) => {
    const updated = shortcuts.map(s =>
      s.action === action ? { ...s, enabled: !s.enabled } : s
    );
    setShortcuts(updated);
    await onUpdate({ shortcuts: updated });
  };

  // 重置所有快捷键
  const resetAllShortcuts = async () => {
    setShortcuts(DEFAULT_SHORTCUTS);
    await onUpdate({ shortcuts: DEFAULT_SHORTCUTS });
  };

  // 打开 Chrome 扩展快捷键设置页面
  const openChromeShortcutSettings = () => {
    chrome.tabs.create({
      url: 'chrome://extensions/shortcuts',
    });
  };

  // 判断是否为 Chrome 命令快捷键
  const isChromeCommand = (action: string) => {
    return ['translate-paragraph', 'toggle-translation'].includes(action);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">快捷键设置</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          配置键盘快捷键，提升使用效率
        </p>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.action}
            className="px-6 py-4 flex items-center justify-between"
          >
            <div className="flex-1">
              <div className="font-medium text-gray-900 dark:text-white">
                {shortcut.description}
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {isChromeCommand(shortcut.action) ? (
                  <span className="text-blue-600 dark:text-blue-400">
                    全局快捷键（可在 Chrome 扩展设置中修改）
                  </span>
                ) : (
                  <span>页面内快捷键</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* 快捷键显示/编辑 */}
              {editingAction === shortcut.action ? (
                <div className="px-4 py-2 border-2 border-primary-500 rounded-lg bg-primary-50 dark:bg-primary-900/20 min-w-[120px] text-center">
                  <span className="text-primary-600 dark:text-primary-400 animate-pulse">
                    {pressedKeys.length > 0 ? pressedKeys.join('+') : '请按下快捷键...'}
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => !isChromeCommand(shortcut.action) && setEditingAction(shortcut.action)}
                  disabled={isSaving || isChromeCommand(shortcut.action)}
                  className={`px-4 py-2 border rounded-lg min-w-[120px] text-center ${
                    isChromeCommand(shortcut.action)
                      ? 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                      : 'border-gray-200 dark:border-gray-600 hover:border-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20'
                  } ${!shortcut.enabled ? 'opacity-50' : ''}`}
                >
                  <kbd className="font-mono">{shortcut.key}</kbd>
                </button>
              )}

              {/* 启用/禁用开关 */}
              <button
                onClick={() => toggleShortcut(shortcut.action)}
                disabled={isSaving}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                  shortcut.enabled ? 'bg-primary-600' : 'bg-gray-300'
                } disabled:opacity-50`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    shortcut.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 操作按钮 */}
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex flex-wrap gap-3">
        <button
          onClick={resetAllShortcuts}
          disabled={isSaving}
          className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          重置为默认
        </button>
        <button
          onClick={openChromeShortcutSettings}
          className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          配置全局快捷键
        </button>
      </div>

      {/* 说明信息 */}
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
            <p className="font-medium">快捷键使用说明</p>
            <ul className="mt-1 space-y-1 text-blue-600 dark:text-blue-300">
              <li>• <strong>全局快捷键</strong>：在任何页面都可用，需要在 Chrome 扩展设置中修改</li>
              <li>• <strong>页面内快捷键</strong>：仅在翻译页面可用，点击快捷键按钮后按下新的组合键即可修改</li>
              <li>• 按 <kbd className="px-1 bg-blue-100 dark:bg-blue-800 rounded">Esc</kbd> 取消编辑</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}