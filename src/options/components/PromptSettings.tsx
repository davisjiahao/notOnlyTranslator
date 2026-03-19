import { useState, useMemo } from 'react';
import type { UserSettings } from '@/shared/types';
import { PROMPT_VERSIONS, type PromptTemplate } from '@/shared/prompts';

interface PromptSettingsProps {
  settings: UserSettings;
  onUpdate: (updates: Partial<UserSettings>) => Promise<void>;
  isSaving: boolean;
}

/**
 * 提示词版本配置组件
 * 支持切换不同版本的提示词模板和自定义参数
 */
export default function PromptSettings({ settings, onUpdate, isSaving }: PromptSettingsProps) {
  const currentVersion = settings.promptVersion || 'v1.0.0';
  const [selectedVersion, setSelectedVersion] = useState(currentVersion);

  // 获取所有可用版本
  const availableVersions = useMemo(() => {
    return Object.entries(PROMPT_VERSIONS).map(([version, template]) => ({
      version,
      template,
    }));
  }, []);

  // 获取当前选中的模板
  const selectedTemplate: PromptTemplate | null = useMemo(() => {
    return PROMPT_VERSIONS[selectedVersion] || null;
  }, [selectedVersion]);

  // 处理版本切换
  const handleVersionChange = async (version: string) => {
    setSelectedVersion(version);
    await onUpdate({ promptVersion: version });
  };

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">提示词设置</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          管理翻译提示词版本和参数配置
        </p>
      </div>

      {/* 版本选择区域 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">提示词版本</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            选择适合您需求的提示词模板版本
          </p>
        </div>

        <div className="p-6 space-y-4">
          {availableVersions.map(({ version, template }) => (
            <button
              key={version}
              onClick={() => handleVersionChange(version)}
              disabled={isSaving}
              className={`w-full p-4 border rounded-lg text-left transition-colors ${
                selectedVersion === version
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              } disabled:opacity-50`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 dark:text-white">
                      {template.version}
                    </span>
                    {selectedVersion === version && (
                      <span className="px-2 py-0.5 text-xs bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-400 rounded-full">
                        当前使用
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                    {template.config.responseFormat === 'json' ? 'JSON 格式输出' : '文本格式输出'}
                    · Temperature: {template.config.temperature}
                    · Max Tokens: {template.config.maxTokens}
                  </p>
                </div>
                <div className="ml-4">
                  {selectedVersion === version ? (
                    <div className="w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 版本详情区域 */}
      {selectedTemplate && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">版本详情</h3>
          </div>

          <div className="p-6 space-y-6">
            {/* 系统提示词预览 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                系统提示词
              </label>
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                  {selectedTemplate.systemPrompt}
                </pre>
              </div>
            </div>

            {/* 输出 Schema */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                输出格式要求
              </label>
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                <pre className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
                  {JSON.stringify(selectedTemplate.outputSchema, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 参数配置区域 */}
      {selectedTemplate && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
            <h3 className="text-base font-semibold text-gray-900 dark:text-white">模型参数</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              当前版本的提示词配置参数（只读）
            </p>
          </div>

          <div className="p-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-xs text-gray-500 dark:text-gray-400">Temperature</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                  {selectedTemplate.config.temperature}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  控制输出的随机性
                </div>
              </div>

              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-xs text-gray-500 dark:text-gray-400">Max Tokens</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                  {selectedTemplate.config.maxTokens}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  最大输出长度
                </div>
              </div>

              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-xs text-gray-500 dark:text-gray-400">Top P</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                  {selectedTemplate.config.topP}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  核采样概率
                </div>
              </div>

              <div className="p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="text-xs text-gray-500 dark:text-gray-400">响应格式</div>
                <div className="text-lg font-semibold text-gray-900 dark:text-white mt-1">
                  {selectedTemplate.config.responseFormat === 'json' ? 'JSON' : 'Text'}
                </div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  输出格式类型
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 版本对比说明 */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <h4 className="text-sm font-medium text-blue-900 dark:text-blue-300">版本说明</h4>
            <div className="text-sm text-blue-800 dark:text-blue-400 mt-1 space-y-1">
              <p><strong>v1.0.0</strong> - 稳定版本，经过充分测试，适合日常使用</p>
              <p><strong>v2.0.0-beta</strong> - 实验版本，包含改进的提示词结构和更多输出字段</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
