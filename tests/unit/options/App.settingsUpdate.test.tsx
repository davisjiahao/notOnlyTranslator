import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '@/options/App';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';
import { StorageManager } from '@/background/storage';

vi.mock('@/options/components/LevelSelector', () => ({ default: () => null }));
vi.mock('@/options/components/GeneralSettings', () => ({
  default: ({ settings, onUpdate }: {
    settings: UserSettings;
    onUpdate: (updates: Partial<UserSettings>) => Promise<void>;
  }) => (
    <div>
      <span>主题：{settings.theme}；高亮：{String(settings.autoHighlight)}</span>
      <button onClick={() => void onUpdate({ theme: 'dark' })}>更改主题</button>
    </div>
  ),
}));
vi.mock('@/options/components/ApiSettings', () => ({
  default: ({ provider, apiConfigs, onFullApiConfigUpdate, onApiConfigsUpdate, onApiKeyUpdate }: {
    provider: UserSettings['apiProvider'];
    apiConfigs: UserSettings['apiConfigs'];
    onApiKeyUpdate: (key: string) => Promise<void>;
    onApiConfigsUpdate: (configs: UserSettings['apiConfigs'], activeId?: string, expectedApiConfigsRevision?: number) => Promise<void>;
    onFullApiConfigUpdate: (params: { configs: UserSettings['apiConfigs']; activeId?: string; provider: UserSettings['apiProvider']; apiKey?: string; expectedApiConfigsRevision?: number }) => Promise<void>;
  }) => (
    <div>
      <span>当前供应商：{provider}</span>
      <button onClick={() => void onFullApiConfigUpdate({ configs: [], activeId: undefined, provider: 'anthropic' }).catch(() => undefined)}>保存 API 配置</button>
      <button onClick={() => void onFullApiConfigUpdate({ configs: apiConfigs, activeId: 'existing', provider: 'anthropic' }).catch(() => undefined)}>切换 API 配置</button>
      <button onClick={() => void onApiConfigsUpdate([], undefined).catch(() => undefined)}>删除 API 配置</button>
      <button onClick={() => void onApiConfigsUpdate([], undefined, 3).catch(() => undefined)}>删除旧确认框</button>
      <button onClick={() => void onFullApiConfigUpdate({
        configs: [{ id: 'b', name: 'B', provider: 'anthropic', apiKey: 'KEY_B', tested: false, createdAt: 0 }],
        activeId: 'b', provider: 'anthropic', apiKey: 'KEY_B',
      }).catch(() => undefined)}>保存带密钥的配置</button>
      <button onClick={() => void onFullApiConfigUpdate({ configs: [], provider: 'openai', expectedApiConfigsRevision: 3 }).catch(() => undefined)}>提交旧草稿</button>
      <button onClick={() => void onApiKeyUpdate('KEY_B')}>旧版密钥入口</button>
    </div>
  ),
}));
vi.mock('@/shared/components/WelcomeModalExperiment', () => ({ default: () => null }));
vi.mock('@/shared/components/welcomeModalUtils', () => ({ shouldShowWelcomeModal: () => false }));
vi.mock('@/shared/utils', () => ({ useTheme: vi.fn(), logger: { error: vi.fn() } }));

beforeAll(async () => {
  // 提前解析被 mock 的懒加载模块，避免首个业务断言承担模块冷加载时间。
  await import('@/options/components/ApiSettings');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('设置页增量保存', () => {
  it('显式配置的密钥只随配置保存，不再镜像到无归属旧字段', async () => {
    let persisted: UserSettings = { ...DEFAULT_SETTINGS };
    const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<UserSettings> }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: persisted };
      if (message.type === 'UPDATE_SETTINGS') {
        persisted = { ...persisted, ...message.payload };
        return { success: true };
      }
      return { success: false };
    });
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})), set } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存带密钥的配置' }));

    expect(await screen.findByText('API 配置已保存')).toBeInTheDocument();
    expect(persisted.apiConfigs[0]).toMatchObject({ provider: 'anthropic', apiKey: 'KEY_B' });
    expect(set).not.toHaveBeenCalled();
  });

  it('旧版密钥入口必须经存储封装处理归属，不能直接写旧字段', async () => {
    const saveApiKey = vi.spyOn(StorageManager, 'saveApiKey').mockResolvedValue(undefined);
    const sendMessage = vi.fn(async (message: { type: string }) => ({
      success: true, data: message.type === 'GET_USER_PROFILE' ? DEFAULT_USER_PROFILE : DEFAULT_SETTINGS,
    }));
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})), set } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '旧版密钥入口' }));

    expect(await screen.findByText('API 密钥已保存')).toBeInTheDocument();
    expect(saveApiKey).toHaveBeenCalledExactlyOnceWith('KEY_B');
    expect(set).not.toHaveBeenCalled();
  });

  it('普通设置仅提交用户修改项，并展示后台合并的并行修改', async () => {
    let persisted: UserSettings = { ...DEFAULT_SETTINGS, theme: 'light' };
    const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<UserSettings> }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...persisted } };
      if (message.type === 'UPDATE_SETTINGS') {
        persisted = { ...persisted, ...message.payload };
        return { success: true };
      }
      return { success: false };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { sync: { get: vi.fn().mockResolvedValue({}) } },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: '通用设置' }));
    expect(await screen.findByText('主题：light；高亮：true')).toBeInTheDocument();
    persisted = { ...persisted, autoHighlight: false };
    fireEvent.click(screen.getByRole('button', { name: '更改主题' }));

    await waitFor(() => expect(screen.getByText('主题：dark；高亮：false')).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { theme: 'dark' } });
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SETTINGS')).toHaveLength(2);
  });

  it('API 配置仅提交配置相关字段，并展示后台最新供应商', async () => {
    let persisted: UserSettings = { ...DEFAULT_SETTINGS, theme: 'light' };
    const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<UserSettings> }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...persisted } };
      if (message.type === 'UPDATE_SETTINGS') {
        persisted = { ...persisted, ...message.payload, apiProvider: 'custom' };
        return { success: true };
      }
      return { success: false };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { sync: { get: vi.fn().mockResolvedValue({}) } },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    expect(await screen.findByText('当前供应商：openai')).toBeInTheDocument();
    persisted = { ...persisted, theme: 'dark' };
    fireEvent.click(screen.getByRole('button', { name: '保存 API 配置' }));

    await waitFor(() => expect(screen.getByText('当前供应商：custom')).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
      payload: { apiConfigs: [], apiProvider: 'anthropic' },
    });
    expect(persisted.theme).toBe('dark');
  });

  it('仅切换 API 时不回传旧配置列表，保留另一窗口新增的配置', async () => {
    let persisted: UserSettings = { ...DEFAULT_SETTINGS, apiConfigs: [] };
    const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<UserSettings> }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...persisted } };
      if (message.type === 'UPDATE_SETTINGS') {
        persisted = { ...persisted, ...message.payload };
        return { success: true };
      }
      return { success: false };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { sync: { get: vi.fn().mockResolvedValue({}) } },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    expect(await screen.findByText('当前供应商：openai')).toBeInTheDocument();
    const addedConfig = { id: 'existing', name: '新配置', provider: 'anthropic' as const, apiKey: 'test-key', tested: true, createdAt: 1 };
    persisted = { ...persisted, apiConfigs: [addedConfig] };
    fireEvent.click(screen.getByRole('button', { name: '切换 API 配置' }));

    await waitFor(() => expect(screen.getByText('当前供应商：anthropic')).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS',
      payload: { activeApiConfigId: 'existing', apiProvider: 'anthropic' },
    });
    expect(persisted.apiConfigs).toEqual([addedConfig]);
  });

  it('API 配置的激活项未变化时不覆盖另一窗口的激活项', async () => {
    let persisted: UserSettings = { ...DEFAULT_SETTINGS, activeApiConfigId: 'existing' };
    const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<UserSettings> }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...persisted } };
      if (message.type === 'UPDATE_SETTINGS') {
        persisted = { ...persisted, ...message.payload };
        return { success: true };
      }
      return { success: false };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { sync: { get: vi.fn().mockResolvedValue({}) } },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    expect(await screen.findByText('当前供应商：openai')).toBeInTheDocument();
    persisted = { ...persisted, activeApiConfigId: 'popup-selected' };
    fireEvent.click(screen.getByRole('button', { name: '切换 API 配置' }));

    await waitFor(() => expect(screen.getByText('当前供应商：anthropic')).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'anthropic' } });
    expect(persisted.activeApiConfigId).toBe('popup-selected');
  });

  it('删除与编辑配置均携带加载时的版本，不能用旧数组覆盖另一窗口', async () => {
    const config = { id: 'a', name: 'A', provider: 'openai' as const, apiKey: 'TEST_A', tested: true, createdAt: 1 };
    let persisted: UserSettings = { ...DEFAULT_SETTINGS, apiConfigs: [config], apiConfigsRevision: 7 };
    const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<UserSettings>; expectedApiConfigsRevision?: number }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: persisted };
      if (message.type === 'UPDATE_SETTINGS') {
        persisted = { ...persisted, ...message.payload, apiConfigsRevision: 8 };
        return { success: true, data: persisted };
      }
      return { success: false };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})) } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除 API 配置' }));
    await waitFor(() => expect(screen.getByText('设置已保存')).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 7,
      payload: { apiConfigs: [], activeApiConfigId: undefined },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存带密钥的配置' }));
    await waitFor(() => expect(screen.getByText('API 配置已保存')).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 8,
      payload: expect.objectContaining({ apiConfigs: [expect.objectContaining({ id: 'b' })] }),
    }));
  });

  it('编辑草稿的版本不随父组件设置快照更新而被提升', async () => {
    const sendMessage = vi.fn(async (message: { type: string; expectedApiConfigsRevision?: number }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...DEFAULT_SETTINGS, apiConfigsRevision: 7 } };
      if (message.type === 'UPDATE_SETTINGS') return { success: false, error: 'API 配置已变更或缺少版本，请刷新设置后重试' };
      return { success: false };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})) } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '提交旧草稿' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未保存'));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 3,
      payload: { apiConfigs: [] },
    });
    expect(screen.queryByText('API 配置已保存')).not.toBeInTheDocument();
  });

  it('旧删除确认框不借用父组件更新后的版本', async () => {
    const sendMessage = vi.fn(async (message: { type: string; expectedApiConfigsRevision?: number }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...DEFAULT_SETTINGS, apiConfigsRevision: 7 } };
      if (message.type === 'UPDATE_SETTINGS') return { success: false, error: 'API 配置已变更或缺少版本，请刷新设置后重试' };
      return { success: false };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})) } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除旧确认框' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未保存'));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 3,
      payload: { apiConfigs: [], activeApiConfigId: undefined },
    });
    expect(screen.queryByText('设置已保存')).not.toBeInTheDocument();
  });

  it('一笔成功后立即发生配置冲突时不保留前一笔成功提示', async () => {
    let calls = 0;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...DEFAULT_SETTINGS, apiConfigsRevision: 1 } };
      if (message.type === 'UPDATE_SETTINGS') {
        calls += 1;
        return calls === 1
          ? { success: true, data: { ...DEFAULT_SETTINGS, apiConfigsRevision: 2 } }
          : { success: false, error: 'API 配置已变更或缺少版本，请刷新设置后重试' };
      }
      return { success: false };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})) } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    fireEvent.click(screen.getByRole('button', { name: '保存带密钥的配置' }));
    expect(await screen.findByText('API 配置已保存')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存带密钥的配置' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未保存'));
    expect(screen.queryByText('API 配置已保存')).not.toBeInTheDocument();
  });

  it('配置冲突保留旧快照且提示重新加载，不显示保存成功', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...DEFAULT_SETTINGS, apiConfigsRevision: 3 } };
      return { success: false, error: 'API 配置已变更或缺少版本，请刷新设置后重试' };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})) } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: 'API 设置' }));
    fireEvent.click(screen.getByRole('button', { name: '保存带密钥的配置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未保存');
    expect(screen.getByRole('button', { name: '重新加载设置' })).toBeInTheDocument();
    expect(screen.queryByText('API 配置已保存')).not.toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 3,
    }));
  });

  it('保存后读取最新设置失败时不使用旧快照伪造成功', async () => {
    let reads = 0;
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') {
        reads += 1;
        return reads === 1
          ? { success: true, data: { ...DEFAULT_SETTINGS, theme: 'light' } }
          : { success: false };
      }
      return { success: true };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { sync: { get: vi.fn().mockResolvedValue({}) } },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: '通用设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '更改主题' }));

    await waitFor(() => expect(screen.getByText('保存失败')).toBeInTheDocument());
    expect(screen.getByText('主题：light；高亮：true')).toBeInTheDocument();
    expect(reads).toBe(2);
  });

  it('混合凭据冲突不伪报成功，保留明确保存的密钥草稿', async () => {
    const current = {
      ...DEFAULT_SETTINGS, hybridCredentialsRevision: 7,
      hybridTranslation: { ...DEFAULT_SETTINGS.hybridTranslation!, enabled: true, defaultEngine: 'traditional' as const, traditionalApiKey: 'OLD_KEY' },
    };
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: current };
      if (message.type === 'UPDATE_SETTINGS') return { success: false, error: '传统翻译凭据已变更，请刷新设置后重试' };
      return { success: false };
    });
    vi.stubGlobal('chrome', { runtime: { sendMessage }, storage: { sync: { get: vi.fn(async () => ({})) } } });
    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: '翻译引擎' }));
    const keyInput = await screen.findByLabelText('DeepL API 密钥');
    fireEvent.change(keyInput, { target: { value: 'NEW_KEY' } });
    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));

    await waitFor(() => expect(screen.getByText(/密钥未保存/)).toBeInTheDocument());
    expect(screen.getByLabelText('DeepL API 密钥')).toHaveValue('NEW_KEY');
    expect(screen.queryByText('设置已保存')).not.toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS', expectedHybridCredentialsRevision: 7,
      payload: { hybridTranslationPatch: { traditionalApiKey: 'NEW_KEY' } },
    });
  });

  it('后台拒绝保存时不显示成功，也不将未保存的设置写入界面', async () => {
    const sendMessage = vi.fn(async (message: { type: string }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: DEFAULT_USER_PROFILE };
      if (message.type === 'GET_SETTINGS') return { success: true, data: { ...DEFAULT_SETTINGS, theme: 'light' } };
      return { success: false, error: '保存失败' };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { sync: { get: vi.fn().mockResolvedValue({}) } },
    });

    render(<App />);
    fireEvent.click(await screen.findByRole('tab', { name: '通用设置' }));
    fireEvent.click(await screen.findByRole('button', { name: '更改主题' }));

    await waitFor(() => expect(screen.getByText('保存失败')).toBeInTheDocument());
    expect(screen.getByText('主题：light；高亮：true')).toBeInTheDocument();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SETTINGS')).toHaveLength(1);
  });
});
