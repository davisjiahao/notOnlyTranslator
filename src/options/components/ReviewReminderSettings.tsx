import { useState, useEffect } from 'react';
import type { UserSettings, ReviewReminderConfig } from '@/shared/types';
import { DEFAULT_REVIEW_REMINDER_CONFIG } from '@/shared/types';

interface ReviewReminderSettingsProps {
  settings: UserSettings;
  onUpdate: (updates: Partial<UserSettings>) => Promise<void>;
  isSaving: boolean;
}

/**
 * 复习提醒设置组件
 *
 * 配置生词复习提醒时间和行为
 */
export default function ReviewReminderSettings({
  settings,
  onUpdate,
  isSaving,
}: ReviewReminderSettingsProps) {
  // 获取当前配置
  const config: ReviewReminderConfig = settings.reviewReminder || DEFAULT_REVIEW_REMINDER_CONFIG;

  const [localConfig, setLocalConfig] = useState<ReviewReminderConfig>(config);
  const [hasChanges, setHasChanges] = useState(false);

  // 同步外部配置变化
  useEffect(() => {
    setLocalConfig(config);
    setHasChanges(false);
  }, [config]);

  // 更新本地状态
  const updateLocal = <K extends keyof ReviewReminderConfig>(
    key: K,
    value: ReviewReminderConfig[K]
  ) => {
    setLocalConfig(prev => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // 保存配置
  const saveConfig = async () => {
    await onUpdate({ reviewReminder: localConfig });
    setHasChanges(false);
  };

  // 时间选项
  const hourOptions = Array.from({ length: 24 }, (_, i) => i);
  const minuteOptions = [0, 15, 30, 45];

  return (
    <div className="space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">
            📚 复习提醒
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            基于间隔重复算法，在最佳时机提醒你复习生词
          </p>
        </div>
        {/* 启用开关 */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={localConfig.enabled}
            onChange={e => updateLocal('enabled', e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
        </label>
      </div>

      {localConfig.enabled && (
        <>
          {/* 提醒时间 */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              提醒时间
            </h4>
            <div className="flex items-center gap-2">
              <select
                value={localConfig.reminderHour}
                onChange={e => updateLocal('reminderHour', parseInt(e.target.value, 10))}
                className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {hourOptions.map(hour => (
                  <option key={hour} value={hour}>
                    {hour.toString().padStart(2, '0')}:00
                  </option>
                ))}
              </select>
              <span className="text-gray-500">:</span>
              <select
                value={localConfig.reminderMinute}
                onChange={e => updateLocal('reminderMinute', parseInt(e.target.value, 10))}
                className="px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                {minuteOptions.map(minute => (
                  <option key={minute} value={minute}>
                    {minute.toString().padStart(2, '0')}
                  </option>
                ))}
              </select>
              <span className="text-sm text-gray-500 dark:text-gray-400 ml-2">
                每天提醒
              </span>
            </div>
          </div>

          {/* 复习设置 */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-4">
            <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
              复习设置
            </h4>

            {/* 每日复习上限 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  每日复习上限
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  每次提醒最多显示的生词数量
                </p>
              </div>
              <input
                type="number"
                min={5}
                max={100}
                value={localConfig.dailyReviewLimit}
                onChange={e => updateLocal('dailyReviewLimit', parseInt(e.target.value, 10) || 20)}
                className="w-20 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 最小待复习词汇 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  最小提醒词汇数
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  待复习词汇达到此数量才发送提醒
                </p>
              </div>
              <input
                type="number"
                min={1}
                max={20}
                value={localConfig.minWordsForReminder}
                onChange={e => updateLocal('minWordsForReminder', parseInt(e.target.value, 10) || 5)}
                className="w-20 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>

            {/* 掌握阈值 */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  掌握阈值
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  连续正确多少次视为已掌握
                </p>
              </div>
              <input
                type="number"
                min={2}
                max={10}
                value={localConfig.masteredThreshold}
                onChange={e => updateLocal('masteredThreshold', parseInt(e.target.value, 10) || 3)}
                className="w-20 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* 通知设置 */}
          <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  浏览器通知
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  显示桌面通知提醒你复习
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localConfig.enableNotifications}
                  onChange={e => updateLocal('enableNotifications', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>

          {/* 保存按钮 */}
          {hasChanges && (
            <div className="flex justify-end">
              <button
                onClick={saveConfig}
                disabled={isSaving}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? '保存中...' : '保存设置'}
              </button>
            </div>
          )}
        </>
      )}

      {/* 说明信息 */}
      <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
        <h4 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
          💡 关于间隔重复
        </h4>
        <p className="text-xs text-blue-700 dark:text-blue-400">
          系统使用 SM-2 算法计算最佳复习时机。每次你正确识别一个单词，
          下次复习间隔会逐渐增加；如果答错，间隔会重置。
          这种方法比随机复习效率高 3-5 倍。
        </p>
      </div>
    </div>
  );
}