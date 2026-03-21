import { useState } from 'react';
import type { UserSettings, TranslationStyleConfig, HighlightStyleType } from '@/shared/types';

interface TranslationStyleSettingsProps {
  settings: UserSettings;
  onUpdate: (updates: Partial<UserSettings>) => Promise<void>;
  isSaving: boolean;
}

// 默认样式配置
const defaultStyleConfig: TranslationStyleConfig = {
  highlightStyle: 'background',
  highlightOpacity: 80,
  translationLineOpacity: 60,
  translationLineIndent: 16,
  showOriginalAnnotation: true,
};

// 高亮样式选项
const highlightStyleOptions: { value: HighlightStyleType; label: string; preview: string; description: string }[] = [
  {
    value: 'background',
    label: '背景高亮',
    preview: 'bg-yellow-200',
    description: '使用背景色高亮生词',
  },
  {
    value: 'underline',
    label: '下划线',
    preview: 'underline decoration-blue-500 decoration-2',
    description: '使用下划线标记生词',
  },
  {
    value: 'bold',
    label: '加粗',
    preview: 'font-bold',
    description: '使用加粗字体标记生词',
  },
  {
    value: 'dotted',
    label: '虚线',
    preview: 'underline decoration-dotted decoration-blue-400',
    description: '使用虚线标记生词',
  },
];

// 字体选项
const fontFamilyOptions = [
  { value: '', label: '跟随系统' },
  { value: 'system-ui, sans-serif', label: '系统字体' },
  { value: '"PingFang SC", "Microsoft YaHei", sans-serif', label: '苹方/微软雅黑' },
  { value: 'Georgia, serif', label: 'Georgia 衬线' },
  { value: '"Source Code Pro", monospace', label: '等宽字体' },
];

/**
 * 翻译样式设置组件
 *
 * 提供高亮样式、译文行样式、自定义 CSS 等配置
 */
export default function TranslationStyleSettings({
  settings,
  onUpdate,
  isSaving,
}: TranslationStyleSettingsProps) {
  const [showCustomCss, setShowCustomCss] = useState(false);

  // 获取当前样式配置
  const styleConfig: TranslationStyleConfig = {
    ...defaultStyleConfig,
    ...settings.translationStyle,
  };

  // 更新样式配置
  const updateStyleConfig = async (updates: Partial<TranslationStyleConfig>) => {
    await onUpdate({
      translationStyle: {
        ...styleConfig,
        ...updates,
      },
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">翻译样式</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          自定义翻译显示效果，打造个性化阅读体验
        </p>
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {/* 高亮样式 */}
        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            高亮样式
          </label>
          <div className="grid grid-cols-2 gap-3">
            {highlightStyleOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => updateStyleConfig({ highlightStyle: option.value })}
                disabled={isSaving}
                className={`p-4 border rounded-lg text-left transition-all ${
                  styleConfig.highlightStyle === option.value
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                    : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                } disabled:opacity-50`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-lg ${option.preview}`}>highlighted</span>
                  {styleConfig.highlightStyle === option.value && (
                    <svg className="w-5 h-5 text-primary-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
                <div className="font-medium text-gray-900 dark:text-white">{option.label}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">{option.description}</div>
              </button>
            ))}
          </div>
        </div>

        {/* 高亮透明度 */}
        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            高亮透明度
          </label>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            调整生词高亮的透明度，数值越低越透明
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="20"
              max="100"
              step="10"
              value={styleConfig.highlightOpacity}
              onChange={(e) => updateStyleConfig({ highlightOpacity: Number(e.target.value) })}
              disabled={isSaving}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600 disabled:opacity-50"
            />
            <div className="w-16 text-center">
              <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {styleConfig.highlightOpacity}%
              </span>
            </div>
          </div>
        </div>

        {/* 译文行透明度 */}
        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            译文行透明度
          </label>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            调整双语对照模式下译文行的背景透明度
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0"
              max="100"
              step="10"
              value={styleConfig.translationLineOpacity}
              onChange={(e) => updateStyleConfig({ translationLineOpacity: Number(e.target.value) })}
              disabled={isSaving}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600 disabled:opacity-50"
            />
            <div className="w-16 text-center">
              <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {styleConfig.translationLineOpacity}%
              </span>
            </div>
          </div>
        </div>

        {/* 译文行缩进 */}
        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            译文行缩进
          </label>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            双语对照模式下译文行的左侧缩进距离
          </p>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min="0"
              max="48"
              step="4"
              value={styleConfig.translationLineIndent}
              onChange={(e) => updateStyleConfig({ translationLineIndent: Number(e.target.value) })}
              disabled={isSaving}
              className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary-600 disabled:opacity-50"
            />
            <div className="w-20 text-center">
              <span className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {styleConfig.translationLineIndent}px
              </span>
            </div>
          </div>
        </div>

        {/* 译文字体 */}
        <div className="px-6 py-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            译文字体
          </label>
          <select
            value={styleConfig.translationFontFamily || ''}
            onChange={(e) => updateStyleConfig({ translationFontFamily: e.target.value || undefined })}
            disabled={isSaving}
            className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50"
          >
            {fontFamilyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* 显示原文标注 */}
        <div className="px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-900 dark:text-white">显示原文标注</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              在译文中显示生词对应的原文
            </div>
          </div>
          <button
            onClick={() => updateStyleConfig({ showOriginalAnnotation: !styleConfig.showOriginalAnnotation })}
            disabled={isSaving}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              styleConfig.showOriginalAnnotation ? 'bg-primary-600' : 'bg-gray-300'
            } disabled:opacity-50`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                styleConfig.showOriginalAnnotation ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* 自定义 CSS */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-medium text-gray-900 dark:text-white">自定义 CSS</div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                使用自定义 CSS 实现高级样式定制
              </div>
            </div>
            <button
              onClick={() => setShowCustomCss(!showCustomCss)}
              className="text-sm text-primary-600 hover:text-primary-700 dark:text-primary-400"
            >
              {showCustomCss ? '收起' : '展开'}
            </button>
          </div>

          {showCustomCss && (
            <div className="space-y-3">
              <textarea
                value={styleConfig.customCss || ''}
                onChange={(e) => updateStyleConfig({ customCss: e.target.value || undefined })}
                disabled={isSaving}
                placeholder={`/* 示例：修改高亮词样式 */
.not-translator-highlight {
  border-radius: 4px;
  padding: 2px 4px;
}

/* 修改译文行样式 */
.not-translator-translation-line {
  font-style: italic;
}`}
                rows={8}
                className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:bg-gray-700 dark:text-gray-100 disabled:opacity-50 resize-none"
              />
              <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p>
                  自定义 CSS 会覆盖默认样式。错误的 CSS 可能导致显示异常，请谨慎使用。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* 预览区域 */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900/50">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            效果预览
          </label>
          <div className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <div className="text-gray-800 dark:text-gray-200 leading-relaxed">
              <p className="mb-2">
                This is an{' '}
                <span
                  className={`not-translator-highlight-preview ${
                    styleConfig.highlightStyle === 'background' ? 'bg-yellow-200' :
                    styleConfig.highlightStyle === 'underline' ? 'underline decoration-blue-500 decoration-2' :
                    styleConfig.highlightStyle === 'bold' ? 'font-bold text-primary-600' :
                    'underline decoration-dotted decoration-blue-400'
                  }`}
                  style={{ opacity: styleConfig.highlightOpacity / 100 }}
                >
                  example
                </span>{' '}
                sentence with a highlighted word.
              </p>
              <div
                className="text-gray-500 dark:text-gray-400 text-sm mt-2 p-2 rounded"
                style={{
                  opacity: styleConfig.translationLineOpacity / 100 + 0.3,
                  paddingLeft: `${styleConfig.translationLineIndent}px`,
                  fontFamily: styleConfig.translationFontFamily || undefined,
                }}
              >
                这是一个带有高亮词汇的示例句子。
                {styleConfig.showOriginalAnnotation && (
                  <span className="text-xs text-gray-400 ml-1">(example: 示例)</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 重置按钮 */}
        <div className="px-6 py-4">
          <button
            onClick={() => updateStyleConfig(defaultStyleConfig)}
            disabled={isSaving}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            重置为默认样式
          </button>
        </div>
      </div>
    </div>
  );
}