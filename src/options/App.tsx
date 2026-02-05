import { useEffect, useState } from 'react';
import type { UserProfile, UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import { logger } from '@/shared/utils';
import LevelSelector from './components/LevelSelector';
import QuickTest from './components/QuickTest';
import ApiSettings from './components/ApiSettings';
import GeneralSettings from './components/GeneralSettings';

type Tab = 'level' | 'test' | 'api' | 'general';

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
      // Load profile
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

      // Load settings
      const settingsRes = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (settingsRes.success && settingsRes.data) {
        setSettings(settingsRes.data);
      }

      // Load API key
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
      // 构建完整的设置更新
      const settingsUpdates: Partial<UserSettings> = {
        apiConfigs: params.configs,
        activeApiConfigId: params.activeId,
      };

      // 如果提供了主设置，也一并更新
      if (params.provider !== undefined) {
        settingsUpdates.apiProvider = params.provider;
      }
      if (params.customApiUrl !== undefined) {
        settingsUpdates.customApiUrl = params.customApiUrl;
      }
      if (params.customModelName !== undefined) {
        settingsUpdates.customModelName = params.customModelName;
      }

      // 一次性更新所有设置
      const newSettings = { ...settings, ...settingsUpdates };
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: newSettings,
      });
      setSettings(newSettings);

      // 如果提供了 API key，也保存到旧的位置（兼容性）
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

  const tabs: { id: Tab; label: string }[] = [
    { id: 'level', label: '英语水平' },
    { id: 'test', label: '快速测评' },
    { id: 'api', label: 'API 设置' },
    { id: 'general', label: '通用设置' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <h1 className="text-2xl font-bold text-gray-900">NotOnlyTranslator</h1>
          <p className="text-sm text-gray-500 mt-1">根据您的英语水平智能翻译</p>
        </div>
      </header>

      {/* Save message */}
      {saveMessage && (
        <div className="fixed top-4 right-4 bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg z-50 animate-fade-in">
          {saveMessage}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex gap-8">
          {/* Sidebar */}
          <nav className="w-48 flex-shrink-0">
            <ul className="space-y-1">
              {tabs.map((tab) => (
                <li key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full text-left px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-primary-100 text-primary-700'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {tab.label}
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {/* Main content */}
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
