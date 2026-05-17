import { useCallback, useEffect, useState } from 'react';
import type { UserProfile, UserSettings } from '@/shared/types';
import { EXAM_DISPLAY_NAMES } from '@/shared/constants';
import { logger, useTheme } from '@/shared/utils';
import ApiSwitcher from './components/ApiSwitcher';
import RecruitmentBanner from './components/RecruitmentBanner';
import WelcomeModal from './components/WelcomeModal';
import { FeedbackButton } from './components/Feedback';
import MasteryCard from './components/MasteryCard';

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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  /** 网站刷新确认对话框 */
  const [showConfirmRefresh, setShowConfirmRefresh] = useState(false);
  /** 待确认的站点名（取消时用于回滚设置） */
  const [pendingHostname, setPendingHostname] = useState<string>('');
  /** 翻译模式切换视觉反馈 */
  const [showModeTransition, setShowModeTransition] = useState(false);

  // 初始化主题
  useTheme(settings?.theme ?? 'system');

  // 检测是否需要显示欢迎引导
  const checkWelcomeNeeded = useCallback(() => {
    if (!settings) return false;
    // 没有配置任何 API 或没有测试通过的配置
    return !settings.apiConfigs?.length ||
           !settings.apiConfigs.some(c => c.tested) ||
           !settings.activeApiConfigId;
  }, [settings]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    // 基于内容长度计算持续时间：每 10 字符 +0.5 秒，最少 2 秒，最多 6 秒
    const duration = Math.min(6000, Math.max(2000, 2000 + Math.ceil(message.length / 10) * 500));
    setToast({ message, type });
    setTimeout(() => setToast(null), duration);
  };

  useEffect(() => {
    loadData();
    getCurrentTab();
    checkBannerVisibility();
  }, []);

  // 数据加载完成后检查是否需要欢迎引导
  useEffect(() => {
    if (!isLoading && settings) {
      setShowWelcomeModal(checkWelcomeNeeded());
    }
  }, [isLoading, settings, checkWelcomeNeeded]);

  // 检查是否应该显示招募 Banner
  const checkBannerVisibility = async () => {
    try {
      const result = await chrome.storage.sync.get('recruitmentBannerDismissed');
      // 如果用户未关闭过 Banner，则显示
      if (!result.recruitmentBannerDismissed) {
        setShowBanner(true);
      }
    } catch (error) {
      logger.error('Failed to check banner visibility:', error);
    }
  };

  // 处理 Banner 关闭
  const handleBannerDismiss = () => {
    setShowBanner(false);
  };

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
    const newEnabled = !settings.enabled;
    await updateSettings({ enabled: newEnabled, autoHighlight: newEnabled });
    showToast(newEnabled ? '翻译已启用' : '翻译已暂停');

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

    // 弹出确认对话框，而不是自动刷新
    setPendingHostname(currentHostname);
    setShowConfirmRefresh(true);
  };

  /** 确认刷新页面 */
  const confirmPageReload = async () => {
    setShowConfirmRefresh(false);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.reload(tab.id);
    }
  };

  /** 取消刷新：回滚网站黑名单设置 */
  const cancelPageReload = async () => {
    setShowConfirmRefresh(false);
    if (!settings || !pendingHostname) return;

    const isCurrentlyBlacklisted = settings.blacklist?.includes(pendingHostname);
    const restoredBlacklist = isCurrentlyBlacklisted
      ? settings.blacklist.filter(h => h !== pendingHostname)
      : [...(settings.blacklist || []), pendingHostname];

    await updateSettings({ blacklist: restoredBlacklist });
  };

  const updateSettings = async (newSettingsPart: Partial<UserSettings>) => {
    if (!settings) return;
    const newSettings = { ...settings, ...newSettingsPart };

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: newSettings,
    });
    setSettings(newSettings);

    if (newSettingsPart.translationMode && newSettingsPart.translationMode !== settings.translationMode) {
      // 触发模式切换动画
      setShowModeTransition(true);
      // 短暂延迟后隐藏（0.5 秒）
      setTimeout(() => setShowModeTransition(false), 500);
    }

    if (newSettingsPart.translationMode) {
      const modeNames: Record<string, string> = {
        'inline-only': '生词高亮',
        'bilingual': '双语对照',
        'full-translate': '全文翻译',
      };
      showToast(`已切换到 ${modeNames[newSettingsPart.translationMode]} 模式`);
    }
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
      <div className="flex items-center justify-center w-[360px] h-[300px]" role="status" aria-label="加载中">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  const isSiteTranslationEnabled = settings && (!settings.blacklist?.includes(currentHostname));
  const confidencePercent = Math.round((stats?.confidence || 0) * 100);

  return (
    <div className="bg-gray-50 dark:bg-gray-900 w-[360px] max-h-[600px] flex flex-col font-sans text-gray-900 dark:text-gray-100 overflow-y-auto custom-scrollbar">
      {/* 欢迎引导弹窗 */}
      {showWelcomeModal && (
        <WelcomeModal
          settings={settings}
          onComplete={() => setShowWelcomeModal(false)}
          onOpenSettings={() => {
            setShowWelcomeModal(false);
            openOptions();
          }}
        />
      )}

      {/* Toast 提示 — WCAG 4.1.3: aria-live 让屏幕阅读器自动播报状态变更，手动可关闭 */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed top-3 left-1/2 -translate-x-1/2 px-4 py-2 pr-8 rounded-lg shadow-lg z-50 text-sm font-medium ${
            toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
          }`}
        >
          {toast.message}
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => setToast(null)}
            className="absolute top-1 right-1 p-0.5 opacity-70 hover:opacity-100 transition-opacity"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* 翻译模式切换视觉反馈 — 模式图标动画 */}
      {showModeTransition && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center"
        >
          <div className="animate-ping absolute w-32 h-32 bg-primary-500/10 dark:bg-primary-400/10 rounded-full" />
          <div className="relative bg-white dark:bg-gray-800 rounded-2xl p-4 shadow-xl border border-primary-200 dark:border-primary-700 animate-bounce">
            <svg className="w-8 h-8 text-primary-600 dark:text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
            </svg>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 px-4 py-3 flex items-center justify-between border-b border-gray-100 dark:border-gray-700 shadow-sm z-10 sticky top-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-primary-600 rounded-md flex items-center justify-center text-white font-bold text-xs">
            N
          </div>
          <h1 className="font-semibold text-base">NotOnlyTranslator</h1>
        </div>

        <button
          onClick={toggleGlobalEnabled}
          role="switch"
          aria-checked={settings?.enabled ? 'true' : 'false'}
          aria-label={settings?.enabled ? '全局翻译已启用' : '全局翻译已暂停'}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 ${
            settings?.enabled ? 'bg-primary-600' : 'bg-gray-300'
          }`}
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

        {/* 用户研究招募 Banner */}
        {showBanner && <RecruitmentBanner onDismiss={handleBannerDismiss} />}

        {/* 词汇量卡片（含统计） */}
        <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-300 mb-0.5">词汇量估算</div>
              <div className="text-xl font-bold text-gray-800 dark:text-gray-100">
                {stats?.estimatedVocabulary.toLocaleString() || '---'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-primary-600 font-medium bg-primary-50 dark:bg-primary-900/30 px-2 py-0.5 rounded-full inline-block mb-1">
                {stats?.level || '未评估'}
              </div>
              {profile && (
                <div className="text-xs text-gray-400 dark:text-gray-300">
                  {EXAM_DISPLAY_NAMES[profile.examType]}
                </div>
              )}
            </div>
          </div>

          <div className="h-px bg-gray-100 dark:bg-gray-700 mb-2"></div>

          {/* 统计行 */}
          <div className="flex items-center gap-4 mb-2">
            <span className="text-xs text-green-600 font-medium">
              <svg aria-hidden="true" className="w-3 h-3 inline-block mr-0.5 -mt-px" viewBox="0 0 16 16" fill="currentColor">
                <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
              </svg>
              {stats?.knownWordsCount || 0} 已掌握
            </span>
            <span className="text-xs text-orange-500 font-medium">
              <svg aria-hidden="true" className="w-3 h-3 inline-block mr-0.5 -mt-px" viewBox="0 0 16 16" fill="currentColor">
                <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
              </svg>
              {stats?.unknownWordsCount || 0} 待学习
            </span>
          </div>

          {/* 置信度进度条 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-300 flex-shrink-0">置信度</span>
            <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
              <div
                className="bg-primary-500 h-1.5 rounded-full transition-all"
                role="progressbar"
                aria-valuenow={confidencePercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="置信度"
                style={{ width: `${confidencePercent}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 dark:text-gray-300 font-medium flex-shrink-0">{confidencePercent}%</span>
            <span className="relative group flex-shrink-0">
              <button
                type="button"
                aria-label="置信度说明"
                className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1"
              >
                <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <div className="absolute bottom-full right-0 mb-1 w-64 p-2 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none transition-opacity z-50">
                置信度反映系统对你词汇量估算的可靠程度。标记的词汇越多越准确，建议达到 70% 以上。
                <div className="absolute top-full right-3 -mt-px w-3 h-3 bg-gray-900 dark:bg-gray-700 transform rotate-45" />
              </div>
            </span>
          </div>
        </div>

        {/* 词汇掌握度卡片 */}
        <MasteryCard />

        {/* 翻译模式 + API 切换 */}
        {settings && (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            {/* 模式选择器 */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-gray-500 dark:text-gray-300 font-medium">翻译模式</label>
              {/* WCAG 4.1.2: 翻译模式按钮组 — 使用 radiogroup 角色，让屏幕阅读器识别当前选中项 */}
              <div className="grid grid-cols-3 gap-1.5 bg-gray-50 dark:bg-gray-700/50 p-1 rounded-lg" role="radiogroup" aria-label="翻译模式">
                <button
                  onClick={() => updateSettings({ translationMode: 'inline-only' })}
                  role="radio"
                  aria-checked={settings.translationMode === 'inline-only'}
                  className={`flex items-center justify-center gap-1 text-xs py-1.5 px-1 rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                    settings.translationMode === 'inline-only'
                      ? 'bg-white dark:bg-gray-600 text-primary-600 dark:text-primary-400 shadow-sm font-medium'
                      : 'text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <svg aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  生词高亮
                </button>
                <button
                  onClick={() => updateSettings({ translationMode: 'bilingual' })}
                  role="radio"
                  aria-checked={settings.translationMode === 'bilingual'}
                  className={`flex items-center justify-center gap-1 text-xs py-1.5 px-1 rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                    settings.translationMode === 'bilingual'
                      ? 'bg-white dark:bg-gray-600 text-primary-600 dark:text-primary-400 shadow-sm font-medium'
                      : 'text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <svg aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M5 8l6 6" />
                    <path d="M4 14l6-6 2-3" />
                    <path d="M2 5h12" />
                    <path d="M7 2h1" />
                    <path d="M14 16l4-4" />
                    <path d="M14 12l4 4" />
                  </svg>
                  双语对照
                </button>
                <button
                  onClick={() => updateSettings({ translationMode: 'full-translate' })}
                  role="radio"
                  aria-checked={settings.translationMode === 'full-translate'}
                  className={`flex items-center justify-center gap-1 text-xs py-1.5 px-1 rounded-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 ${
                    settings.translationMode === 'full-translate'
                      ? 'bg-white dark:bg-gray-600 text-primary-600 dark:text-primary-400 shadow-sm font-medium'
                      : 'text-gray-500 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600'
                  }`}
                >
                  <svg aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M4 5h7" />
                    <path d="M9 3v2c0 4.418-2.239 8-5 8" />
                    <path d="M4 9c2.239 0 4-3.582 4-8" />
                    <path d="M14 9h6" />
                    <path d="M17 3v2c0 4.418-2.239 8-5 8" />
                    <path d="M14 9c2.239 0 4-3.582 4-8" />
                    <path d="M4 17h16" />
                    <path d="M4 21h16" />
                  </svg>
                  全文翻译
                </button>
              </div>
            </div>

            <div className="h-px bg-gray-100 dark:bg-gray-700"></div>

            <ApiSwitcher
              settings={settings}
              onUpdateSettings={updateSettings}
              onOpenOptions={openOptions}
            />
          </div>
        )}

        {/* 网站开关 */}
        {currentHostname ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-3 shadow-sm border border-gray-100 dark:border-gray-700">
            {showConfirmRefresh ? (
              /* 刷新确认对话框 */
              <div role="dialog" aria-label="刷新页面确认" className="py-2">
                <div className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1">
                  刷新页面以应用更改？
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-300 mb-3">
                  切换网站翻译设置后需要刷新页面才能生效
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={cancelPageReload}
                    className="flex-1 py-2 px-3 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    取消，下次生效
                  </button>
                  <button
                    onClick={confirmPageReload}
                    className="flex-1 py-2 px-3 text-sm font-medium rounded-lg bg-primary-600 hover:bg-primary-700 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                  >
                    确认刷新
                  </button>
                </div>
              </div>
            ) : (
              /* 正常显示 */
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate" title={currentHostname}>
                    {currentHostname}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-300">
                    {isSiteTranslationEnabled ? '翻译已开启' : '翻译已禁用'}
                  </div>
                </div>
                <button
                  onClick={toggleSiteTranslation}
                  role="switch"
                  aria-checked={isSiteTranslationEnabled ? 'true' : 'false'}
                  aria-label={`${currentHostname} 网站翻译`}
                  className={`flex-shrink-0 w-10 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${
                    isSiteTranslationEnabled ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-600'
                  }`}
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
          <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-center text-gray-500 dark:text-gray-300 text-xs">
            当前页面不支持翻译
          </div>
        )}

        {/* 底部快捷按钮 */}
        <div className="grid grid-cols-2 gap-2 mt-auto">
          <button
            onClick={openOptions}
            className="flex items-center justify-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 p-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-primary-600 hover:border-primary-200 dark:hover:border-primary-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            更多设置
          </button>
          <button
            onClick={openVocabulary}
            className="flex items-center justify-center gap-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 p-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-primary-600 hover:border-primary-200 dark:hover:border-primary-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            <svg aria-hidden="true" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            生词本 ({stats?.unknownWordsCount || 0})
          </button>
        </div>

        {/* 反馈按钮 */}
        <div className="flex justify-center">
          <FeedbackButton variant="minimal" size="sm" />
        </div>
      </main>

      </div>
  );
}
