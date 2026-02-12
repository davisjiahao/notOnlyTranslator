import { useEffect, useState } from 'react';
import type { UserProfile, UserSettings } from '@/shared/types';
import { EXAM_DISPLAY_NAMES } from '@/shared/constants';
import { logger } from '@/shared/utils';
import ApiSwitcher from './components/ApiSwitcher';

interface Stats {
  estimatedVocabulary: number;
  knownWordsCount: number;
  unknownWordsCount: number;
  confidence: number;
  level: string;
}

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [currentHostname, setCurrentHostname] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    loadData();
    getCurrentTab();
  }, []);

  const getCurrentTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try {
        const url = new URL(tab.url);
        if (url.protocol.startsWith('http')) {
          setCurrentHostname(url.hostname);
        }
      } catch (_e) {
        // 忽略无效 URL
      }
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const profileRes = await chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE' });
      if (profileRes.success && profileRes.data) {
        setProfile(profileRes.data);

        const vocabSize = profileRes.data.estimatedVocabulary;
        let level = '初级';
        if (vocabSize >= 12000) level = '专家级';
        else if (vocabSize >= 8000) level = '高级';
        else if (vocabSize >= 5000) level = '中高级';
        else if (vocabSize >= 3000) level = '中级';

        setStats({
          estimatedVocabulary: vocabSize,
          knownWordsCount: profileRes.data.knownWords?.length || 0,
          unknownWordsCount: profileRes.data.unknownWords?.length || 0,
          confidence: profileRes.data.levelConfidence,
          level,
        });
      }

      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsRes.success && settingsRes.data) {
        setSettings(settingsRes.data);
      }
    } catch (error) {
      logger.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleGlobalEnabled = async () => {
    if (!settings) return;
    await updateSettings({ enabled: !settings.enabled });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ENABLED' });
    }
  };

  const toggleSiteTranslation = async () => {
    if (!settings || !currentHostname) return;

    const isBlacklisted = settings.blacklist?.includes(currentHostname);
    const newBlacklist = isBlacklisted
      ? settings.blacklist.filter(h => h !== currentHostname)
      : [...(settings.blacklist || []), currentHostname];

    await updateSettings({ blacklist: newBlacklist });

    // 显示刷新提示
    setIsRefreshing(true);

    // 延迟刷新，让用户看到提示
    setTimeout(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        chrome.tabs.reload(tab.id);
      }
    }, 800);
  };

  const updateSettings = async (newSettingsPart: Partial<UserSettings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...newSettingsPart };

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: newSettings,
    });
    setSettings(newSettings);
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const openVocabulary = () => {
    // 打开设置页面并跳转到生词本视图
    chrome.tabs.create({
      url: chrome.runtime.getURL('options.html?tab=vocabulary')
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center w-[360px] h-[300px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const isSiteTranslationEnabled = settings && (!settings.blacklist?.includes(currentHostname));
  const confidencePercent = Math.round((stats?.confidence || 0) * 100);

  return (
    <div className="bg-gray-50 w-[360px] max-h-[600px] flex flex-col font-sans text-gray-900 overflow-y-auto custom-scrollbar">
      {/* Header */}
      <header className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-100 shadow-sm z-10 sticky top-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary-600 rounded-md flex items-center justify-center text-white font-bold text-xs">
            N
          </div>
          <h1 className="font-semibold text-base">NotOnlyTranslator</h1>
        </div>

        <button
          onClick={toggleGlobalEnabled}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            settings?.enabled ? 'bg-primary-600' : 'bg-gray-300'
          }`}
          title={settings?.enabled ? '全局已启用' : '全局已暂停'}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
              settings?.enabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-3 flex flex-col gap-2">

        {/* 词汇量卡片（含统计） */}
        <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs text-gray-500 mb-0.5">词汇量估算</div>
              <div className="text-xl font-bold text-gray-800">
                {stats?.estimatedVocabulary.toLocaleString() || '---'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-primary-600 font-medium bg-primary-50 px-2 py-0.5 rounded-full inline-block mb-1">
                {stats?.level || '未评估'}
              </div>
              {profile && (
                <div className="text-xs text-gray-400">
                  {EXAM_DISPLAY_NAMES[profile.examType]}
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-gray-100 mb-2"></div>

          {/* 统计行 */}
          <div className="flex items-center gap-4 mb-2">
            <span className="text-xs text-green-600 font-medium">
              <svg className="w-3 h-3 inline-block mr-0.5 -mt-px" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
              </svg>
              {stats?.knownWordsCount || 0} 已掌握
            </span>
            <span className="text-xs text-orange-500 font-medium">
              <svg className="w-3 h-3 inline-block mr-0.5 -mt-px" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
              </svg>
              {stats?.unknownWordsCount || 0} 待学习
            </span>
          </div>

          {/* 置信度进度条 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 flex-shrink-0">置信度</span>
            <div className="flex-1 bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-primary-500 h-1.5 rounded-full transition-all"
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 font-medium flex-shrink-0">{confidencePercent}%</span>
          </div>
        </div>

        {/* 翻译模式 + API 切换 */}
        {settings && (
          <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 space-y-3">
            {/* 模式选择器 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500 font-medium">翻译模式</label>
              <div className="grid grid-cols-3 gap-1.5 bg-gray-50 p-1 rounded-lg">
                <button
                  onClick={() => updateSettings({ translationMode: 'inline-only' })}
                  className={`flex items-center justify-center gap-1 text-xs py-1.5 px-1 rounded-md transition-all ${
                    settings.translationMode === 'inline-only'
                      ? 'bg-white text-primary-600 shadow-sm font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 7h16M4 7v0M7 7V4h10v3" />
                    <path d="M6 17h12" strokeWidth="2.5" />
                  </svg>
                  生词高亮
                </button>
                <button
                  onClick={() => updateSettings({ translationMode: 'bilingual' })}
                  className={`flex items-center justify-center gap-1 text-xs py-1.5 px-1 rounded-md transition-all ${
                    settings.translationMode === 'bilingual'
                      ? 'bg-white text-primary-600 shadow-sm font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                  </svg>
                  双语对照
                </button>
                <button
                  onClick={() => updateSettings({ translationMode: 'full-translate' })}
                  className={`flex items-center justify-center gap-1 text-xs py-1.5 px-1 rounded-md transition-all ${
                    settings.translationMode === 'full-translate'
                      ? 'bg-white text-primary-600 shadow-sm font-medium'
                      : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 5h16v14H4z" />
                    <path d="M7 9h10M7 12h10M7 15h6" />
                  </svg>
                  全文翻译
                </button>
              </div>
            </div>

            <div className="h-px bg-gray-100"></div>

            <ApiSwitcher
              settings={settings}
              onUpdateSettings={updateSettings}
              onOpenOptions={openOptions}
            />
          </div>
        )}

        {/* 网站开关 */}
        {currentHostname ? (
          <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100">
            {isRefreshing ? (
              /* 刷新提示 */
              <div className="flex items-center justify-center gap-2 py-1">
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary-600 border-t-transparent"></div>
                <span className="text-sm text-primary-600 font-medium">页面即将刷新...</span>
              </div>
            ) : (
              /* 正常显示 */
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="text-sm font-medium text-gray-900 truncate" title={currentHostname}>
                    {currentHostname}
                  </div>
                  <div className="text-xs text-gray-500">
                    {isSiteTranslationEnabled ? '翻译已开启' : '翻译已禁用'}
                  </div>
                </div>
                <button
                  onClick={toggleSiteTranslation}
                  disabled={isRefreshing}
                  className={`flex-shrink-0 w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${
                    isSiteTranslationEnabled ? 'bg-green-500' : 'bg-gray-200'
                  } ${isRefreshing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                      isSiteTranslationEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-gray-100 rounded-lg p-3 text-center text-gray-500 text-xs">
            当前页面不支持翻译
          </div>
        )}

        {/* 底部快捷按钮 */}
        <div className="grid grid-cols-2 gap-2 mt-auto">
          <button
            onClick={openOptions}
            className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 p-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-primary-600 hover:border-primary-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            更多设置
          </button>
          <button
            onClick={openVocabulary}
            className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 p-2.5 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-primary-600 hover:border-primary-200 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            生词本 ({stats?.unknownWordsCount || 0})
          </button>
        </div>
      </main>
    </div>
  );
}
