import { useCallback, useEffect, useRef, useState } from 'react';
import type { UserProfile, UserSettings, JevStatus, JevConfig } from '@/shared/types';
import { DEFAULT_JEV_CONFIG, resolveJevConfig, getJevPermissionOrigin, isCalibratedJevConfig } from '@/shared/utils/jevConfig';
import { STORAGE_KEYS } from '@/shared/constants';
import { getJevEligibility, JEV_REASON_LABELS, JEV_RUNTIME_REASON_LABELS } from '@/shared/utils/jev';

const configInputClass = 'w-full min-w-0 px-3 py-2 text-base sm:text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50';

interface JevNotice {
  kind: 'success' | 'error';
  text: string;
}

/** 申请 Jev 站点权限；失败一律视为未授权 */
async function requestJevPermission(config: JevConfig): Promise<boolean> {
  try {
    return await chrome.permissions.request({ origins: [getJevPermissionOrigin(config)] });
  } catch {
    return false;
  }
}

/** 最近运行一行：仅用共享契约的 lastAssessment；reason 不原样上屏，回退显示固定通用提示 */
function lastRunText(status: JevStatus): string {
  const last = status.lastAssessment;
  if (!last) {
    return '最近运行：暂无记录';
  }
  const when = new Date(last.at).toLocaleString();
  const labels = { ...JEV_REASON_LABELS, ...JEV_RUNTIME_REASON_LABELS };
  const detail = last.reason && Object.prototype.hasOwnProperty.call(labels, last.reason)
    ? labels[last.reason as keyof typeof labels] : JEV_RUNTIME_REASON_LABELS.unavailable;
  const engine = last.provider === 'jev' ? 'Jev 评估' : `原有评估：${detail}`;
  return `最近运行：${when}，${engine}`;
}

export default function JevSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [status, setStatus] = useState<JevStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [busy, setBusy] = useState<null | 'toggle' | 'save-key' | 'clear-key' | 'test' | 'config'>(null);
  const [draft, setDraft] = useState<JevConfig | null>(null);
  const [draftThreshold, setDraftThreshold] = useState<string | null>(null);
  const [notice, setNotice] = useState<JevNotice | null>(null);
  const statusGeneration = useRef(0);
  const settingsGeneration = useRef(0);
  const keyService = useRef('');
  const applySettings = useCallback((latest: UserSettings) => {
    const next = resolveJevConfig(latest.jevConfig);
    const service = JSON.stringify([next.provider, next.apiUrl]);
    if (keyService.current !== service) {
      setApiKeyInput('');
      setStatus(null);
      statusGeneration.current += 1;
    }
    keyService.current = service;
    setSettings(latest);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const current = ++settingsGeneration.current;
      const currentStatus = ++statusGeneration.current;
      try {
        const [settingsRes, profileRes, statusRes] = await Promise.all([
          chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }),
          chrome.runtime.sendMessage({ type: 'GET_USER_PROFILE' }),
          chrome.runtime.sendMessage({ type: 'GET_JEV_STATUS' }),
        ]);
        if (cancelled || current !== settingsGeneration.current) {
          return;
        }
        if (
          !settingsRes?.success ||
          !settingsRes.data ||
          !profileRes?.success ||
          !profileRes.data ||
          !statusRes?.success ||
          !statusRes.data
        ) {
          setLoadFailed(true);
          return;
        }
        const statusCurrent = currentStatus === statusGeneration.current;
        applySettings(settingsRes.data as UserSettings);
        setProfile(profileRes.data as UserProfile);
        if (statusCurrent) setStatus(statusRes.data as JevStatus);
        setLoadFailed(false);
      } catch {
        if (!cancelled && current === settingsGeneration.current) setLoadFailed(true);
      }
    };
    const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'sync' && (changes[STORAGE_KEYS.SYNC.SETTINGS] || changes[STORAGE_KEYS.SYNC.USER_PROFILE])) {
        void refresh();
      }
    };
    const onFocus = () => { void refresh(); };
    void refresh();
    chrome.storage.onChanged.addListener(onStorageChange);
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      settingsGeneration.current += 1;
      statusGeneration.current += 1;
      chrome.storage.onChanged.removeListener(onStorageChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [applySettings]);

  const enabled = settings?.vocabularyAssessmentProvider === 'jev';
  const savedConfig = resolveJevConfig(settings?.jevConfig);
  const config = draft ?? savedConfig;
  const thresholdInput = draftThreshold ?? String(config.threshold);
  const configDirty = JSON.stringify(config) !== JSON.stringify(savedConfig) || thresholdInput !== String(savedConfig.threshold);
  const changeConfig = (patch: Partial<JevConfig>) => {
    setDraft({ ...config, ...patch });
    setApiKeyInput('');
    setNotice(null);
  };
  const handleSaveConfig = async () => {
    if (busy) return;
    let next: JevConfig;
    try {
      next = resolveJevConfig({ ...config, threshold: thresholdInput.trim() ? Number(thresholdInput) : NaN });
    } catch {
      setNotice({ kind: 'error', text: '配置无效：请填写完整 HTTPS 接口地址、模型和 0 到 1 之间的阈值；地址不能含密钥或查询参数' });
      return;
    }
    setBusy('config');
    setNotice(null);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', payload: { jevConfig: next } });
      if (!response?.success) throw new Error('CONFIG_SAVE_FAILED');
      settingsGeneration.current += 1;
      statusGeneration.current += 1;
      if (settings) applySettings({ ...settings, jevConfig: next });
      setDraft(null);
      setDraftThreshold(null);
      setApiKeyInput('');
      setNotice({ kind: 'success', text: '识别配置已保存' });
      await refreshStatus();
    } catch {
      setNotice({ kind: 'error', text: '识别配置保存失败，保留之前的配置' });
    } finally { setBusy(null); }
  };
  // 契约：getJevEligibility 返回 reason 字符串或 undefined（通过）
  const reason = settings && profile ? getJevEligibility(settings, profile, settings.translationMode) : undefined;
  const statusText = !settings || !profile
    ? ''
    : reason
      ? `暂不满足生效条件：${JEV_REASON_LABELS[reason]}`
      : !status?.hasKey ? '请先保存 Jev 密钥' : '满足生效条件，阅读时将尝试 Jev';

  /** 刷新密钥状态（保存/清除后调用） */
  const refreshStatus = async () => {
    const current = ++statusGeneration.current;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_JEV_STATUS' });
      if (current !== statusGeneration.current) return;
      if (response?.success && response.data) {
        setStatus(response.data as JevStatus);
      } else {
        setNotice({ kind: 'error', text: '状态刷新失败，请刷新页面确认' });
      }
    } catch {
      if (current === statusGeneration.current) {
        setNotice({ kind: 'error', text: '状态刷新失败，请刷新页面确认' });
      }
    }
  };

  /** 切换评估提供方；失败时展示固定中文 */
  const updateAssessmentProvider = async (provider: 'legacy' | 'jev') => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { vocabularyAssessmentProvider: provider },
      });
      if (!response?.success) {
        setNotice({ kind: 'error', text: '设置保存失败，保留之前的识别引擎' });
        return;
      }
      // 保存成功后，之前发起的窗口刷新不再覆盖本次写入。
      settingsGeneration.current += 1;
      // 与 App 既有模式一致：优先使用响应内最新设置
      const latest = response.data ? response : await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (latest?.success && latest.data) {
        applySettings(latest.data as UserSettings);
        await refreshStatus();
      }
    } catch {
      setNotice({ kind: 'error', text: '设置保存失败，保留之前的识别引擎' });
    }
  };

  const handleToggle = async () => {
    if (!settings || busy) {
      return;
    }
    setNotice(null);
    setBusy('toggle');
    try {
      if (enabled) {
        await updateAssessmentProvider('legacy');
        return;
      }
      const granted = await requestJevPermission(savedConfig);
      if (!granted) {
        setNotice({ kind: 'error', text: '未获得所需站点权限，仍使用原有词汇评估' });
        return;
      }
      await updateAssessmentProvider('jev');
    } finally {
      setBusy(null);
    }
  };

  const handleSaveKey = async () => {
    const apiKey = apiKeyInput.trim();
    if (!apiKey || busy) {
      return;
    }
    setNotice(null);
    setBusy('save-key');
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SET_JEV_API_KEY',
        payload: { apiKey, config: savedConfig },
      });
      if (!response?.success) {
        setNotice({ kind: 'error', text: '密钥保存失败，请稍后重试' });
        return;
      }
      setApiKeyInput('');
      setNotice({ kind: 'success', text: '密钥已保存' });
      await refreshStatus();
    } catch {
      setNotice({ kind: 'error', text: '密钥保存失败，请稍后重试' });
    } finally {
      setBusy(null);
    }
  };

  const handleClearKey = async () => {
    if (busy) {
      return;
    }
    setNotice(null);
    setBusy('clear-key');
    try {
      const response = await chrome.runtime.sendMessage({ type: 'DELETE_JEV_API_KEY' });
      if (!response?.success) {
        setNotice({ kind: 'error', text: '密钥清除失败，请稍后重试' });
        return;
      }
      setNotice({ kind: 'success', text: '密钥已清除' });
      await refreshStatus();
    } catch {
      setNotice({ kind: 'error', text: '密钥清除失败，请稍后重试' });
    } finally {
      setBusy(null);
    }
  };

  const handleTestConnection = async () => {
    if (busy) {
      return;
    }
    setNotice(null);
    setBusy('test');
    try {
      const granted = await requestJevPermission(savedConfig);
      if (!granted) {
        setNotice({ kind: 'error', text: '未获得所需站点权限，无法测试连接' });
        return;
      }
      const response = await chrome.runtime.sendMessage({ type: 'TEST_JEV_CONNECTION' });
      setNotice(
        response?.success
          ? { kind: 'success', text: '连接测试成功' }
          : { kind: 'error', text: '连接测试失败，请检查密钥与网络' }
      );
    } catch {
      setNotice({ kind: 'error', text: '连接测试失败，请检查密钥与网络' });
    } finally {
      setBusy(null);
    }
  };

  if (loadFailed) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          设置信息加载失败，请刷新重试
        </p>
      </div>
    );
  }

  if (!settings || !profile || !status) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <p className="text-sm text-gray-500 dark:text-gray-300">正在加载设置…</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Jev 词汇评估</h2>
        <span className="px-2 py-0.5 text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded">
          实验
        </span>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-2">
        实验功能：词汇难度由合成评估数据校准，并非教师认证标签；不影响翻译服务商设置。
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        开启后，待判断的句子和目标词将发送至 {savedConfig.provider === 'typesafe' ? 'TypeSafe' : '自定义识别服务'}（{new URL(savedConfig.apiUrl).host}）；入选词由当前翻译服务补充释义。
        密钥仅保存在本机扩展内，不同步、不进入备份；清除全部数据也会删除密钥。
      </p>

      <fieldset disabled={busy !== null} className="my-4 space-y-3">
        <legend className="mb-2 font-medium text-gray-900 dark:text-white">识别服务配置</legend>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          <span className="mb-1 block">识别供应商</span>
          <select className={configInputClass} value={config.provider} onChange={event => {
            changeConfig({ provider: event.target.value as JevConfig['provider'], threshold: 0.5 });
            setDraftThreshold('0.5');
          }}>
            <option value="typesafe">TypeSafe</option>
            <option value="custom">自定义 Jev 兼容服务</option>
          </select>
        </label>
        <label className="block text-sm text-gray-700 dark:text-gray-200">
          <span className="mb-1 block">识别 API URL</span>
          <input type="url" autoComplete="off" spellCheck={false} className={configInputClass} value={config.apiUrl}
            onChange={event => changeConfig({ apiUrl: event.target.value })} />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            <span className="mb-1 block">识别模型</span>
            <input type="text" autoComplete="off" spellCheck={false} className={configInputClass} value={config.model}
              onChange={event => changeConfig({ model: event.target.value })} />
          </label>
          <label className="block text-sm text-gray-700 dark:text-gray-200">
            <span className="mb-1 block">识别阈值</span>
            <input type="number" min="0" max="1" step="0.01" className={configInputClass} value={thresholdInput}
              onChange={event => { setDraftThreshold(event.target.value); setNotice(null); }} />
          </label>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          填写提供方的完整接口地址；需兼容 Jev systemone / noul 协议，不能直接填写聊天接口。
          更换供应商或地址后需重新保存该服务的密钥。
        </p>
        {!isCalibratedJevConfig({ ...config, threshold: Number(thresholdInput) }) && <p className="text-sm text-amber-800 dark:text-amber-300">
          当前配置未经本项目校准；阈值越低，入选词越多。连接成功仅表示接口可用。
        </p>}
        {configDirty && <p className="text-sm text-gray-600 dark:text-gray-300">配置尚未保存，请先保存再启用或测试连接。</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleSaveConfig} disabled={!configDirty || busy !== null}
            className="px-4 py-2 text-sm bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-primary-500">
            {busy === 'config' ? '保存中…' : '保存识别配置'}
          </button>
          <button type="button" onClick={() => { setDraft({ ...DEFAULT_JEV_CONFIG }); setDraftThreshold(null); setApiKeyInput(''); setNotice(null); }}
            className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 focus-visible:ring-2 focus-visible:ring-primary-500">
            恢复 TypeSafe 预设
          </button>
        </div>
      </fieldset>

      <div className="flex items-center justify-between">
        <div className="font-medium text-gray-700 dark:text-gray-200">启用 Jev 词汇评估</div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="启用 Jev 词汇评估"
          onClick={handleToggle}
          disabled={busy !== null || configDirty}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            enabled ? 'bg-primary-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      <p
        className={`mt-2 text-sm ${
          reason || !status.hasKey ? 'text-gray-600 dark:text-gray-300' : 'text-green-700 dark:text-green-400'
        }`}
      >
        {statusText}
      </p>

      <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-gray-700 dark:text-gray-200">
            {status.hasKey ? '已保存密钥' : '未配置密钥'}
          </span>
          <span className="text-gray-600 dark:text-gray-300">{lastRunText(status)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            type="password"
            aria-label="Jev API 密钥"
            autoComplete="off"
            value={apiKeyInput}
            onChange={(event) => setApiKeyInput(event.target.value)}
            placeholder={status.hasKey ? '输入新密钥以替换' : '输入 API 密钥'}
            disabled={busy !== null}
            className="min-w-0 w-full sm:w-auto sm:flex-1 px-3 py-2 text-base sm:text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleSaveKey}
            disabled={!apiKeyInput.trim() || busy !== null || configDirty}
            className="px-4 py-2 text-sm bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
          >
            {busy === 'save-key' ? '保存中…' : '保存密钥'}
          </button>
          {status.hasKey && (
            <button
              type="button"
              onClick={handleClearKey}
              disabled={busy !== null}
              className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
            >
              {busy === 'clear-key' ? '清除中…' : '清除密钥'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={handleTestConnection}
          disabled={busy !== null || configDirty}
          className="w-full py-2 px-4 text-sm border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {busy === 'test' ? '测试中…' : '测试连接'}
        </button>
      </div>

      {notice && (
        <p
          role="status"
          className={`mt-3 text-sm ${
            notice.kind === 'success'
              ? 'text-green-600 dark:text-green-400'
              : 'text-red-600 dark:text-red-400'
          }`}
        >
          {notice.text}
        </p>
      )}
    </div>
  );
}
