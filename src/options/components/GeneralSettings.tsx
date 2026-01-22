import type { UserSettings, TranslationMode } from '@/shared/types';

interface GeneralSettingsProps {
  settings: UserSettings;
  onUpdate: (updates: Partial<UserSettings>) => Promise<void>;
  isSaving: boolean;
}

export default function GeneralSettings({
  settings,
  onUpdate,
  isSaving,
}: GeneralSettingsProps) {
  const translationModes: { value: TranslationMode; label: string; description: string }[] = [
    {
      value: 'inline-only',
      label: '行内翻译',
      description: '仅翻译生僻单词、短语、语法，译文高亮显示在原文后',
    },
    {
      value: 'bilingual',
      label: '双文对照',
      description: '译文显示在原文下方，生僻部分在原文和译文中一一对应高亮',
    },
    {
      value: 'full-translate',
      label: '全文翻译',
      description: '显示完整译文，生僻单词、短语、语法在原文中高亮',
    },
  ];

  const highlightColors = [
    { value: '#fef08a', label: '浅黄色', bg: 'bg-yellow-200' },
    { value: '#bfdbfe', label: '浅蓝色', bg: 'bg-blue-200' },
    { value: '#bbf7d0', label: '浅绿色', bg: 'bg-green-200' },
    { value: '#fecaca', label: '浅红色', bg: 'bg-red-200' },
    { value: '#e9d5ff', label: '浅紫色', bg: 'bg-purple-200' },
    { value: '#fed7aa', label: '浅橙色', bg: 'bg-orange-200' },
  ];

  return (
    <div className="space-y-6">
      {/* Enable/Disable */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-6">基础设置</h2>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-gray-900">启用翻译</div>
              <div className="text-sm text-gray-500">
                关闭后将停止自动翻译和高亮功能
              </div>
            </div>
            <button
              onClick={() => onUpdate({ enabled: !settings.enabled })}
              disabled={isSaving}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.enabled ? 'bg-primary-600' : 'bg-gray-300'
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              <div className="font-medium text-gray-900">自动高亮</div>
              <div className="text-sm text-gray-500">
                自动识别并高亮页面中的生词
              </div>
            </div>
            <button
              onClick={() => onUpdate({ autoHighlight: !settings.autoHighlight })}
              disabled={isSaving}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.autoHighlight ? 'bg-primary-600' : 'bg-gray-300'
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.autoHighlight ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className="flex items-center justify-between pt-4 border-t border-gray-200">
            <div>
              <div className="font-medium text-gray-900">显示难度等级</div>
              <div className="text-sm text-gray-500">
                在翻译结果中显示词汇难度标签
              </div>
            </div>
            <button
              onClick={() => onUpdate({ showDifficulty: !settings.showDifficulty })}
              disabled={isSaving}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
                settings.showDifficulty ? 'bg-primary-600' : 'bg-gray-300'
              } disabled:opacity-50`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  settings.showDifficulty ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Translation Mode */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">翻译模式</h2>
        <div className="space-y-3">
          {translationModes.map((mode) => (
            <button
              key={mode.value}
              onClick={() => onUpdate({ translationMode: mode.value })}
              disabled={isSaving}
              className={`w-full p-4 border rounded-lg text-left transition-colors ${
                settings.translationMode === mode.value
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-gray-200 hover:border-gray-300'
              } disabled:opacity-50`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-gray-900">{mode.label}</div>
                  <div className="text-sm text-gray-500">{mode.description}</div>
                </div>
                {settings.translationMode === mode.value && (
                  <div className="w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center">
                    <svg
                      className="w-3 h-3 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
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

      {/* Highlight Color */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">高亮颜色</h2>
        <div className="grid grid-cols-3 gap-3">
          {highlightColors.map((color) => (
            <button
              key={color.value}
              onClick={() => onUpdate({ highlightColor: color.value })}
              disabled={isSaving}
              className={`p-3 border rounded-lg transition-all ${
                settings.highlightColor === color.value
                  ? 'border-primary-500 ring-2 ring-primary-200'
                  : 'border-gray-200 hover:border-gray-300'
              } disabled:opacity-50`}
            >
              <div className={`h-8 ${color.bg} rounded mb-2`} />
              <div className="text-sm text-gray-700 text-center">
                {color.label}
              </div>
            </button>
          ))}
        </div>
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600">预览效果:</div>
          <div className="mt-2">
            <span
              className="px-2 py-1 rounded text-gray-900"
              style={{ backgroundColor: settings.highlightColor }}
            >
              highlighted word
            </span>
          </div>
        </div>
      </div>

      {/* Font Size */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">字体大小</h2>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="12"
            max="18"
            step="1"
            value={settings.fontSize}
            onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
            disabled={isSaving}
            className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600 disabled:opacity-50"
          />
          <div className="w-16 text-center">
            <span className="text-lg font-medium text-gray-900">
              {settings.fontSize}px
            </span>
          </div>
        </div>
        <div className="mt-4 p-3 bg-gray-50 rounded-lg">
          <div className="text-sm text-gray-600 mb-2">预览效果:</div>
          <div style={{ fontSize: `${settings.fontSize}px` }} className="text-gray-900">
            This is a sample text to preview font size. 这是预览字体大小的示例文本。
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">数据管理</h2>
        <div className="space-y-3">
          <button
            onClick={async () => {
              const data = await chrome.storage.local.get(null);
              const syncData = await chrome.storage.sync.get(null);
              const exportData = { local: data, sync: syncData };
              const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `not-translator-backup-${Date.now()}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="w-full py-3 px-4 border border-gray-200 text-gray-700 font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center justify-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              <span>导出数据</span>
            </div>
          </button>

          <button
            onClick={async () => {
              if (
                confirm(
                  '清除所有数据将删除您的学习记录、生词本和设置。此操作不可恢复，确定要继续吗？'
                )
              ) {
                await chrome.storage.local.clear();
                await chrome.storage.sync.clear();
                alert('数据已清除，请刷新页面');
                window.location.reload();
              }
            }}
            className="w-full py-3 px-4 border border-red-200 text-red-600 font-medium rounded-lg hover:bg-red-50 transition-colors"
          >
            <div className="flex items-center justify-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              <span>清除所有数据</span>
            </div>
          </button>
        </div>
      </div>

      {/* About */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">关于</h2>
        <div className="space-y-2 text-sm text-gray-600">
          <div className="flex justify-between">
            <span>版本</span>
            <span className="font-medium text-gray-900">0.1.0</span>
          </div>
          <div className="flex justify-between">
            <span>项目</span>
            <a
              href="https://github.com/yourusername/notOnlyTranslator"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:underline"
            >
              GitHub
            </a>
          </div>
          <div className="flex justify-between">
            <span>反馈</span>
            <a
              href="https://github.com/yourusername/notOnlyTranslator/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:underline"
            >
              提交问题
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
