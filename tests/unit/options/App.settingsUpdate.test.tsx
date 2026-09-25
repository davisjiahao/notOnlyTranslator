import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '@/options/App';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

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
  default: ({ provider, apiConfigs, onFullApiConfigUpdate }: {
    provider: UserSettings['apiProvider'];
    apiConfigs: UserSettings['apiConfigs'];
    onFullApiConfigUpdate: (params: { configs: UserSettings['apiConfigs']; activeId?: string; provider: UserSettings['apiProvider'] }) => Promise<void>;
  }) => (
    <div>
      <span>当前供应商：{provider}</span>
      <button onClick={() => void onFullApiConfigUpdate({ configs: [], activeId: undefined, provider: 'anthropic' })}>保存 API 配置</button>
      <button onClick={() => void onFullApiConfigUpdate({ configs: apiConfigs, activeId: 'existing', provider: 'anthropic' })}>切换 API 配置</button>
    </div>
  ),
}));
vi.mock('@/shared/components/WelcomeModalExperiment', () => ({ default: () => null }));
vi.mock('@/shared/components/welcomeModalUtils', () => ({ shouldShowWelcomeModal: () => false }));
vi.mock('@/shared/utils', () => ({ useTheme: vi.fn(), logger: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('设置页增量保存', () => {
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
      type: 'UPDATE_SETTINGS',
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
