import { useEffect, useState } from 'react';
import type { UserProfile, UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import { getCEFRLevelByVocabulary } from '@/shared/constants/mastery';
import { logger, useTheme } from '@/shared/utils';
import LevelSelector from './components/LevelSelector';
import QuickTest from './components/QuickTest';
import ApiSettings from './components/ApiSettings';
import GeneralSettings from './components/GeneralSettings';
import VocabularySettings from './components/VocabularySettings';
import MasteryOverview from './components/MasteryOverview';
import FlashcardReview from './components/FlashcardReview';
import LearningStatistics from './components/LearningStatistics';
import VocabularyRecommendation from './components/VocabularyRecommendation';
import WelcomeModalExperiment from '@/shared/components/WelcomeModalExperiment';
import { shouldShowWelcomeModal } from '@/shared/components/welcomeModalUtils';
import { AchievementGallery } from '@/shared/components/AchievementGallery';
import ErrorDashboard from './components/ErrorDashboard';
import TranslationHistory from './components/TranslationHistory';
import PromptSettings from './components/PromptSettings';
import DataManager from './components/DataManager';
import HybridTranslationSettings from './components/HybridTranslationSettings';
import ShortcutSettings from './components/ShortcutSettings';
import TranslationStyleSettings from './components/TranslationStyleSettings';

type Tab = 'level' | 'test' | 'api' | 'engine' | 'style' | 'shortcuts' | 'vocabulary' | 'mastery' | 'general' | 'review' | 'recommendation' | 'data' | 'statistics' | 'achievements' | 'errors' | 'history' | 'prompt';

/** Sidebar Tab 图标 */
const TabIcon = ({ id, active }: { id: Tab; active: boolean }) => {
  const sw = active ? 2.5 : 2;
  const cls = 'w-5 h-5 flex-shrink-0';

  switch (id) {
    case 'level':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      );
    case 'test':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case 'api':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case 'engine':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
      );
    case 'style':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      );
    case 'shortcuts':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      );
    case 'vocabulary':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      );
    case 'general':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      );
    case 'mastery':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      );
    case 'review':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      );
    case 'statistics':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      );
    case 'achievements':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
      );
    case 'errors':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      );
    case 'history':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'prompt':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
      );
    case 'recommendation':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
      );
    case 'data':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      );
  }
};

const tabs: { id: Tab; label: string }[] = [
  { id: 'level', label: '英语水平' },
  { id: 'test', label: '快速测评' },
  { id: 'api', label: 'API 设置' },
  { id: 'engine', label: '翻译引擎' },
  { id: 'style', label: '翻译样式' },
  { id: 'shortcuts', label: '快捷键' },
  { id: 'vocabulary', label: '生词本' },
  { id: 'mastery', label: '掌握度' },
  { id: 'review', label: '闪卡复习' },
  { id: 'recommendation', label: '词汇推荐' },
  { id: 'statistics', label: '学习统计' },
  { id: 'achievements', label: '成就' },
  { id: 'history', label: '翻译历史' },
  { id: 'prompt', label: '提示词设置' },
  { id: 'data', label: '数据管理' },
  { id: 'general', label: '通用设置' },
  { id: 'errors', label: '错误追踪' },
];

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('level');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  // 初始化主题
  useTheme(settings.theme);

  useEffect(() => {
    loadData();
    // 检查是否需要显示欢迎弹窗
    if (shouldShowWelcomeModal()) {
      setShowWelcomeModal(true);
    }
    // 从 URL 参数读取要打开的标签页
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    if (tabParam && ['level', 'test', 'api', 'vocabulary', 'general', 'statistics', 'prompt'].includes(tabParam)) {
      setActiveTab(tabParam as Tab);
    }
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const profileRes = await chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE' });
      if (profileRes.success && profileRes.data) {
        setProfile(profileRes.data);
      } else {
        setProfile({
          ...DEFAULT_USER_PROFILE,
          knownWords: [],
          unknownWords: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }

      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsRes.success && settingsRes.data) {
        setSettings(settingsRes.data);
      }

      const data = await chrome.storage.sync.get('apiKey');
      if (data.apiKey) {
        setApiKey(data.apiKey);
      }
    } catch (error) {
      logger.error('Failed to load data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const showSaveMessage = (message: string) => {
    setSaveMessage(message);
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleProfileUpdate = async (updates: Partial<UserProfile>) => {
    if (!profile) return;

    setIsSaving(true);
    try {
      const newProfile = { ...profile, ...updates };
      await chrome.runtime.sendMessage({
        type: 'UPDATE_USER_PROFILE',
        payload: newProfile,
      });
      setProfile(newProfile);
      showSaveMessage('设置已保存');
    } catch (error) {
      logger.error('Failed to update profile:', error);
      showSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSettingsUpdate = async (updates: Partial<UserSettings>) => {
    setIsSaving(true);
    try {
      const newSettings = { ...settings, ...updates };
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: newSettings,
      });
      setSettings(newSettings);
      showSaveMessage('设置已保存');
    } catch (error) {
      logger.error('Failed to update settings:', error);
      showSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleApiKeyUpdate = async (key: string) => {
    setIsSaving(true);
    try {
      await chrome.storage.sync.set({ apiKey: key });
      setApiKey(key);
      showSaveMessage('API 密钥已保存');
    } catch (error) {
      logger.error('Failed to save API key:', error);
      showSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 一次性保存所有 API 配置相关设置（避免状态竞争）
  const handleFullApiConfigUpdate = async (params: {
    configs: import('@/shared/types').ApiConfig[];
    activeId?: string;
    provider?: UserSettings['apiProvider'];
    apiKey?: string;
    customApiUrl?: string;
    customModelName?: string;
  }) => {
    setIsSaving(true);
    try {
      const settingsUpdates: Partial<UserSettings> = {
        apiConfigs: params.configs,
        activeApiConfigId: params.activeId,
      };

      if (params.provider !== undefined) {
        settingsUpdates.apiProvider = params.provider;
      }
      if (params.customApiUrl !== undefined) {
        settingsUpdates.customApiUrl = params.customApiUrl;
      }
      if (params.customModelName !== undefined) {
        settingsUpdates.customModelName = params.customModelName;
      }

      const newSettings = { ...settings, ...settingsUpdates };
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: newSettings,
      });
      setSettings(newSettings);

      if (params.apiKey !== undefined) {
        await chrome.storage.sync.set({ apiKey: params.apiKey });
        setApiKey(params.apiKey);
      }

      showSaveMessage('API 配置已保存');
    } catch (error) {
      logger.error('Failed to save API config:', error);
      showSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestComplete = async (estimatedVocabulary: number) => {
    if (!profile) return;

    await handleProfileUpdate({
      estimatedVocabulary,
      levelConfidence: 0.8,
    });
    setActiveTab('level');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            N
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">NotOnlyTranslator</h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">根据您的英语水平智能翻译</p>
          </div>
        </div>
      </header>

      {/* 保存成功提示 */}
      {saveMessage && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in">
          {saveMessage}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex gap-6">
          {/* Sidebar */}
          <nav className="w-48 flex-shrink-0">
            <ul className="space-y-1">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center gap-2.5 ${
                      activeTab === tab.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400 shadow-sm'
                        : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-200'
                    }`}
                  >
                    <TabIcon id={tab.id} active={activeTab === tab.id} />
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* 主内容区 */}
          <main className="flex-1 min-w-0">
            {activeTab === 'level' && profile && (
              <LevelSelector
                profile={profile}
                onUpdate={handleProfileUpdate}
                isSaving={isSaving}
              />
            )}

            {activeTab === 'test' && (
              <QuickTest
                onComplete={handleTestComplete}
                onCancel={() => setActiveTab('level')}
              />
            )}

            {activeTab === 'api' && (
              <ApiSettings
                apiKey={apiKey}
                provider={settings.apiProvider}
                customApiUrl={settings.customApiUrl}
                customModelName={settings.customModelName}
                apiConfigs={settings.apiConfigs || []}
                activeApiConfigId={settings.activeApiConfigId}
                onApiKeyUpdate={handleApiKeyUpdate}
                onProviderUpdate={(provider) => handleSettingsUpdate({ apiProvider: provider })}
                onCustomSettingsUpdate={(url, model) =>
                  handleSettingsUpdate({ customApiUrl: url, customModelName: model })
                }
                onApiConfigsUpdate={(configs, activeId) =>
                  handleSettingsUpdate({ apiConfigs: configs, activeApiConfigId: activeId })
                }
                onFullApiConfigUpdate={handleFullApiConfigUpdate}
                isSaving={isSaving}
              />
            )}

            {activeTab === 'engine' && (
              <HybridTranslationSettings
                settings={settings}
                onUpdate={handleSettingsUpdate}
                isSaving={isSaving}
              />
            )}

            {activeTab === 'style' && (
              <TranslationStyleSettings
                settings={settings}
                onUpdate={handleSettingsUpdate}
                isSaving={isSaving}
              />
            )}

            {activeTab === 'shortcuts' && (
              <ShortcutSettings
                settings={settings}
                onUpdate={handleSettingsUpdate}
                isSaving={isSaving}
              />
            )}

            {activeTab === 'vocabulary' && (
              <VocabularySettings isSaving={isSaving} />
            )}

            {activeTab === 'mastery' && <MasteryOverview isSaving={isSaving} />}

            {activeTab === 'review' && <FlashcardReview isSaving={isSaving} />}

            {activeTab === 'recommendation' && profile && (
              <VocabularyRecommendation
                userLevel={getCEFRLevelByVocabulary(profile.estimatedVocabulary)}
              />
            )}

            {activeTab === 'statistics' && <LearningStatistics isSaving={isSaving} />}

            {activeTab === 'achievements' && <AchievementGallery onClose={() => setActiveTab('level')} />}

            {activeTab === 'errors' && <ErrorDashboard />}

            {activeTab === 'history' && <TranslationHistory />}

            {activeTab === 'prompt' && (
              <PromptSettings
                settings={settings}
                onUpdate={handleSettingsUpdate}
                isSaving={isSaving}
              />
            )}

            {activeTab === 'data' && <DataManager />}

            {activeTab === 'general' && (
              <GeneralSettings
                settings={settings}
                onUpdate={handleSettingsUpdate}
                isSaving={isSaving}
              />
            )}
          </main>
        </div>
      </div>

      {/* 欢迎弹窗实验 */}
      <WelcomeModalExperiment
        isOpen={showWelcomeModal}
        onClose={() => setShowWelcomeModal(false)}
        onComplete={() => {
          setShowWelcomeModal(false);
          // 引导完成后跳转到 API 设置页
          setActiveTab('api');
        }}
      />
    </div>
  );
}
