import { useEffect, useState } from 'react';
import type { UserProfile, UserSettings, UnknownWordEntry } from '@/shared/types';
import { EXAM_DISPLAY_NAMES } from '@/shared/constants';
import VocabularyList from './components/VocabularyList';
import StatsCard from './components/StatsCard';
import QuickActions from './components/QuickActions';

interface Stats {
  estimatedVocabulary: number;
  knownWordsCount: number;
  unknownWordsCount: number;
  confidence: number;
  level: string;
}

type Tab = 'home' | 'vocabulary';

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [vocabulary, setVocabulary] = useState<UnknownWordEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('home');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // Load profile
      const profileRes = await chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE' });
      if (profileRes.success && profileRes.data) {
        setProfile(profileRes.data);
        setVocabulary(profileRes.data.unknownWords || []);

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

  const toggleEnabled = async () => {
    if (!settings) return;

    const newSettings = { ...settings, enabled: !settings.enabled };
    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: newSettings,
    });
    setSettings(newSettings);

    // Notify content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_ENABLED' });
    }
  };

  const openOptions = () => {
    chrome.runtime.openOptionsPage();
  };

  const removeFromVocabulary = async (word: string) => {
    await chrome.runtime.sendMessage({
      type: 'REMOVE_FROM_VOCABULARY',
      payload: { word },
    });
    setVocabulary((prev) => prev.filter((w) => w.word !== word));
    if (stats) {
      setStats({ ...stats, unknownWordsCount: stats.unknownWordsCount - 1 });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="bg-gray-50 min-h-[400px]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">NotOnlyTranslator</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleEnabled}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                settings?.enabled ? 'bg-primary-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings?.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <button
              onClick={openOptions}
              className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Level indicator */}
        {profile && (
          <div className="mt-2 text-sm text-gray-600">
            {EXAM_DISPLAY_NAMES[profile.examType]}
            {profile.examScore && ` - ${profile.examScore}分`}
          </div>
        )}
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white">
        <button
          onClick={() => setActiveTab('home')}
          className={`flex-1 py-2.5 text-sm font-medium text-center ${
            activeTab === 'home'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          概览
        </button>
        <button
          onClick={() => setActiveTab('vocabulary')}
          className={`flex-1 py-2.5 text-sm font-medium text-center ${
            activeTab === 'vocabulary'
              ? 'text-primary-600 border-b-2 border-primary-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          生词本 ({vocabulary.length})
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {activeTab === 'home' ? (
          <div className="space-y-4">
            {stats && <StatsCard stats={stats} />}
            <QuickActions onOpenOptions={openOptions} />

            {/* 黑名单按钮 */}
            <button
              onClick={async () => {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (!tab?.url || !settings) return;

                const url = new URL(tab.url);
                const hostname = url.hostname;

                if (confirm(`确定要将 ${hostname} 加入黑名单吗？\n加入后该网站将不再自动翻译。`)) {
                  const newBlacklist = [...(settings.blacklist || []), hostname];
                  const newSettings = { ...settings, blacklist: newBlacklist };

                  await chrome.runtime.sendMessage({
                    type: 'UPDATE_SETTINGS',
                    payload: newSettings,
                  });
                  setSettings(newSettings);

                  // 重新加载页面使设置生效
                  if (tab.id) {
                    chrome.tabs.reload(tab.id);
                  }
                }
              }}
              className="w-full mt-4 py-2 px-4 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              不再翻译此网站
            </button>
          </div>
        ) : (
          <VocabularyList
            words={vocabulary}
            onRemove={removeFromVocabulary}
          />
        )}
      </div>
    </div>
  );
}
