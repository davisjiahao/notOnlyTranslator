import { useEffect, useState } from 'react';
import type { UserProfile, UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import { logger } from '@/shared/utils';
import LevelSelector from './components/LevelSelector';
import QuickTest from './components/QuickTest';
import ApiSettings from './components/ApiSettings';
import GeneralSettings from './components/GeneralSettings';

type Tab = 'level' | 'test' | 'api' | 'general';

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
    case 'general':
      return (
        <svg className={cls} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={sw}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      );
  }
};

const tabs: { id: Tab; label: string }[] = [
  { id: 'level', label: '英语水平' },
  { id: 'test', label: '快速测评' },
  { id: 'api', label: 'API 设置' },
  { id: 'general', label: '通用设置' },
];

export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('level');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
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
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            N
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">NotOnlyTranslator</h1>
            <p className="text-xs text-gray-500">根据您的英语水平智能翻译</p>
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
                        ? 'bg-primary-100 text-primary-700 shadow-sm'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
    </div>
  );
}
