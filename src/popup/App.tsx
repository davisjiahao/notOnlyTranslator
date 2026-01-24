import { useEffect, useState } from 'react';
import type { UserProfile, UserSettings } from '@/shared/types';
import { EXAM_DISPLAY_NAMES } from '@/shared/constants';
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

  useEffect(() => {
    loadData();
    getCurrentTab();
  }, []);

  const getCurrentTab = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      try {
        const url = new URL(tab.url);
        // 忽略 chrome:// 等内部页面
        if (url.protocol.startsWith('http')) {
          setCurrentHostname(url.hostname);
        }
      } catch (e) {
        // Ignore invalid URLs
      }
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load profile
      const profileRes = await chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE' });
      if (profileRes.success && profileRes.data) {
        setProfile(profileRes.data);

        // Calculate stats
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

      // Load settings
      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsRes.success && settingsRes.data) {
        setSettings(settingsRes.data);
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleGlobalEnabled = async () => {
    if (!settings) return;
    await updateSettings({ enabled: !settings.enabled });

    // Notify content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ENABLED' });
    }
  };

  const toggleSiteTranslation = async () => {
    if (!settings || !currentHostname) return;

    const isBlacklisted = settings.blacklist?.includes(currentHostname);
    let newBlacklist: string[];

    if (isBlacklisted) {
      // 移除出黑名单（开启翻译）
      newBlacklist = settings.blacklist.filter(h => h !== currentHostname);
    } else {
      // 加入黑名单（关闭翻译）
      newBlacklist = [...(settings.blacklist || []), currentHostname];
    }

    await updateSettings({ blacklist: newBlacklist });

    // Reload page to apply changes
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.reload(tab.id);
    }
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center w-[320px] h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const isSiteTranslationEnabled = settings && (!settings.blacklist?.includes(currentHostname));

  return (
    <div className="bg-gray-50 w-[320px] h-[450px] flex flex-col font-sans text-gray-900">
      {/* Header with Global Toggle */}
      <header className="bg-white px-4 py-3 flex items-center justify-between border-b border-gray-100 shadow-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary-600 rounded-md flex items-center justify-center text-white font-bold text-xs">
            N
          </div>
          <h1 className="font-semibold text-base">NotOnlyTranslator</h1>
        </div>

        <button
          onClick={toggleGlobalEnabled}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            settings?.enabled ? 'bg-primary-600' : 'bg-gray-300'
          }`}
          title={settings?.enabled ? "全局已启用" : "全局已暂停"}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              settings?.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-3 flex flex-col gap-3 overflow-hidden">

        {/* Status Card */}
        <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 flex items-center justify-between">
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

        {/* API Switcher */}
        {settings && (
          <ApiSwitcher
            settings={settings}
            onUpdateSettings={updateSettings}
            onOpenOptions={openOptions}
          />
        )}

        {/* Site Toggle */}
        {currentHostname ? (
          <div className="bg-white rounded-lg p-3 shadow-sm border border-gray-100 flex items-center justify-between">
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
              className={`flex-shrink-0 w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${
                isSiteTranslationEnabled ? 'bg-green-500' : 'bg-gray-200'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                  isSiteTranslationEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        ) : (
          <div className="bg-gray-100 rounded-lg p-3 text-center text-gray-500 text-xs">
            当前页面不支持翻译
          </div>
        )}

        {/* Bottom Quick Links */}
        <div className="grid grid-cols-2 gap-2 mt-auto">
           <button
             onClick={openOptions}
             className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 p-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-primary-600 transition-colors"
           >
             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
             </svg>
             更多设置
           </button>
           <button
             onClick={() => {
                // 生词本功能现在作为快捷方式打开选项页面的对应Tab，或者未来可以做个独立页
                chrome.runtime.openOptionsPage();
             }}
             className="flex items-center justify-center gap-1.5 bg-white border border-gray-200 p-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-primary-600 transition-colors"
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
