/**
 * ApiSettings 组件测试
 *
 * 覆盖：配置列表视图、添加/编辑/删除/选择配置
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import type { ApiConfig } from '@/shared/types';
import { getModels, testConnection } from '@/shared/services/modelService';

vi.mock('@/shared/services/modelService', () => ({
  getModels: vi.fn(() => Promise.resolve([
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', isRecommended: true },
  ])),
  testConnection: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('@/shared/utils', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import ApiSettings from '@/options/components/ApiSettings';

function makeConfig(overrides?: Partial<ApiConfig>): ApiConfig {
  return {
    id: 'cfg-1',
    name: 'My OpenAI',
    provider: 'openai',
    apiKey: 'sk-test',
    tested: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

const defaultProps = {
  apiKey: '',
  provider: 'openai' as const,
  apiConfigs: [],
  isSaving: false,
  onApiKeyUpdate: vi.fn(() => Promise.resolve()),
  onProviderUpdate: vi.fn(),
  onCustomSettingsUpdate: vi.fn(),
  onApiConfigsUpdate: vi.fn(),
};

describe('ApiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getModels).mockResolvedValue([
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', isRecommended: true },
    ]);
    vi.mocked(testConnection).mockResolvedValue({ success: true });
  });

  describe('空配置列表', () => {
    it('显示空状态', () => {
      render(<ApiSettings {...defaultProps} />);
      expect(screen.getByText('还没有配置 API')).toBeTruthy();
      expect(screen.getByText('添加您的第一个 API 配置以开始使用')).toBeTruthy();
    });

    it('显示添加按钮', () => {
      render(<ApiSettings {...defaultProps} />);
      expect(screen.getByText('+ 添加配置')).toBeTruthy();
      expect(screen.getByText('添加第一个配置')).toBeTruthy();
    });

    it('点击添加按钮切换到添加模式', async () => {
      render(<ApiSettings {...defaultProps} />);
      fireEvent.click(screen.getByText('+ 添加配置'));
      await waitFor(() => {
        expect(screen.queryByText('还没有配置 API')).toBeNull();
      });
    });
  });

  describe('配置列表', () => {
    it('渲染已测试的配置', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.getByText('My OpenAI')).toBeTruthy();
    });

    it('不显示未测试的配置', () => {
      const configs = [makeConfig({ tested: false })];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.queryByText('My OpenAI')).toBeNull();
      expect(screen.getByText('还没有配置 API')).toBeTruthy();
    });

    it('显示供应商名称', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.getByText('My OpenAI')).toBeTruthy();
    });

    it('激活配置显示"使用中"标记', () => {
      const configs = [makeConfig()];
      render(
        <ApiSettings {...defaultProps} apiConfigs={configs} activeApiConfigId="cfg-1" />
      );
      expect(screen.getByText('使用中')).toBeTruthy();
    });

    it('非激活配置不显示"使用中"', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.queryByText('使用中')).toBeNull();
    });

    it('旧备份缺少名称但已测试的配置仍能进入编辑而不崩溃', async () => {
      const legacy = { ...makeConfig({ provider: 'ollama', apiKey: '' }), name: undefined } as unknown as ApiConfig;
      const user = userEvent.setup();
      render(<ApiSettings {...defaultProps} apiConfigs={[legacy]} />);

      await user.click(screen.getByRole('button', { name: /编辑配置/ }));

      expect(screen.getByLabelText(/配置名称/)).toHaveValue('Ollama');
      expect(screen.getByRole('button', { name: '保存配置' })).toBeInTheDocument();
    });

    it('多个配置全部渲染', () => {
      const configs = [
        makeConfig({ id: 'c1', name: 'Config A' }),
        makeConfig({ id: 'c2', name: 'Config B' }),
        makeConfig({ id: 'c3', name: 'Config C' }),
      ];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.getByText('Config A')).toBeTruthy();
      expect(screen.getByText('Config B')).toBeTruthy();
      expect(screen.getByText('Config C')).toBeTruthy();
    });
  });

  describe('选择配置', () => {
    it('点击配置调用 onFullApiConfigUpdate', async () => {
      const onFullApiConfigUpdate = vi.fn(() => Promise.resolve());
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onFullApiConfigUpdate={onFullApiConfigUpdate}
        />
      );

      fireEvent.click(screen.getByText('My OpenAI'));

      await waitFor(() => {
        expect(onFullApiConfigUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            activeId: 'cfg-1',
            provider: 'openai',
            apiKey: 'sk-test',
          })
        );
      });
    });

    it('无 onFullApiConfigUpdate 时使用兼容性回退', async () => {
      const onApiKeyUpdate = vi.fn(() => Promise.resolve());
      const onProviderUpdate = vi.fn();
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];

      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onApiKeyUpdate={onApiKeyUpdate}
          onProviderUpdate={onProviderUpdate}
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByText('My OpenAI'));

      await waitFor(() => {
        expect(onApiKeyUpdate).toHaveBeenCalledWith('sk-test');
        expect(onProviderUpdate).toHaveBeenCalledWith('openai');
        expect(onApiConfigsUpdate).toHaveBeenCalledWith(configs, 'cfg-1');
      });
    });
  });

  describe('删除配置', () => {
    it('确认框打开后配置版本变化，仍提交打开确认框时的版本', async () => {
      const config = makeConfig();
      const onApiConfigsUpdate = vi.fn().mockRejectedValue(new Error('配置冲突'));
      const { rerender } = render(
        <ApiSettings {...defaultProps} apiConfigs={[config]} apiConfigsRevision={3} onApiConfigsUpdate={onApiConfigsUpdate} />
      );
      fireEvent.click(screen.getByRole('button', { name: '删除配置：My OpenAI' }));
      rerender(
        <ApiSettings {...defaultProps} apiConfigs={[{ ...config, apiKey: 'NEW_KEY' }]} apiConfigsRevision={4} onApiConfigsUpdate={onApiConfigsUpdate} />
      );
      fireEvent.click(screen.getByRole('button', { name: '确定删除' }));

      await waitFor(() => expect(onApiConfigsUpdate).toHaveBeenCalledWith([], undefined, 3));
      expect(screen.getByText(/确定要删除配置/)).toBeInTheDocument();
    });

    it('点击删除按钮显示确认框', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);

      const deleteBtn = screen.getByLabelText('删除配置：My OpenAI');
      fireEvent.click(deleteBtn);

      expect(screen.getByText(/确定要删除配置/)).toBeTruthy();
      expect(screen.getByText('确定删除')).toBeTruthy();
      expect(screen.getByText('取消')).toBeTruthy();
    });

    it('确认删除调用 onApiConfigsUpdate 移除配置', async () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('确定删除'));

      expect(onApiConfigsUpdate).toHaveBeenCalledWith([], undefined);
      await waitFor(() => expect(screen.queryByText(/确定要删除配置/)).not.toBeInTheDocument());
    });

    it('删除激活配置时清除 activeId', async () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          activeApiConfigId="cfg-1"
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('确定删除'));

      expect(onApiConfigsUpdate).toHaveBeenCalledWith([], undefined);
      await waitFor(() => expect(screen.queryByText(/确定要删除配置/)).not.toBeInTheDocument());
    });

    it('删除非激活配置时保留 activeId', async () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [
        makeConfig({ id: 'cfg-1', name: 'Active' }),
        makeConfig({ id: 'cfg-2', name: 'ToDelete' }),
      ];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          activeApiConfigId="cfg-1"
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：ToDelete'));
      fireEvent.click(screen.getByText('确定删除'));

      expect(onApiConfigsUpdate).toHaveBeenCalledWith(
        [configs[0]],
        'cfg-1'
      );
      await waitFor(() => expect(screen.queryByText(/确定要删除配置/)).not.toBeInTheDocument());
    });

    it('删除尚未保存时保留确认框，不把待处理请求当成成功', async () => {
      let release!: () => void;
      const onApiConfigsUpdate = vi.fn(() => new Promise<void>(resolve => { release = resolve; }));
      render(<ApiSettings {...defaultProps} apiConfigs={[makeConfig()]} onApiConfigsUpdate={onApiConfigsUpdate} />);

      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('确定删除'));
      expect(onApiConfigsUpdate).toHaveBeenCalledOnce();
      expect(screen.getByText(/确定要删除配置/)).toBeInTheDocument();

      release();
      await waitFor(() => expect(screen.queryByText(/确定要删除配置/)).not.toBeInTheDocument());
    });

    it('删除冲突时保留确认框与配置，不产生未处理的拒绝', async () => {
      const onApiConfigsUpdate = vi.fn().mockRejectedValue(new Error('配置冲突'));
      render(<ApiSettings {...defaultProps} apiConfigs={[makeConfig()]} onApiConfigsUpdate={onApiConfigsUpdate} />);
      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('确定删除'));

      await waitFor(() => expect(onApiConfigsUpdate).toHaveBeenCalledOnce());
      expect(screen.getByText(/确定要删除配置/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '删除配置：My OpenAI' })).toBeInTheDocument();
    });

    it('取消删除不调用更新', () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('取消'));

      expect(onApiConfigsUpdate).not.toHaveBeenCalled();
      expect(screen.queryByText(/确定要删除配置/)).toBeNull();
    });
  });

  describe('编辑配置', () => {
    it('兼容保存回调同样携带编辑开始时的版本', async () => {
      const config = makeConfig();
      const onApiConfigsUpdate = vi.fn(async () => undefined);
      const { rerender } = render(<ApiSettings {...defaultProps} apiConfigs={[config]} apiConfigsRevision={3} onApiConfigsUpdate={onApiConfigsUpdate} />);
      fireEvent.click(screen.getByRole('button', { name: '编辑配置：My OpenAI' }));
      rerender(<ApiSettings {...defaultProps} apiConfigs={[config]} apiConfigsRevision={4} onApiConfigsUpdate={onApiConfigsUpdate} />);
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

      await waitFor(() => expect(onApiConfigsUpdate).toHaveBeenCalledWith(
        [expect.objectContaining({ id: config.id })], undefined, 3
      ));
    });

    it('编辑期间配置被另一窗口删除后，仍携带打开草稿时的版本并保留草稿', async () => {
      const config = makeConfig();
      const onFullApiConfigUpdate = vi.fn().mockRejectedValue(new Error('配置冲突'));
      const { rerender } = render(
        <ApiSettings {...defaultProps} apiConfigs={[config]} apiConfigsRevision={3} onFullApiConfigUpdate={onFullApiConfigUpdate} />
      );
      fireEvent.click(screen.getByRole('button', { name: '编辑配置：My OpenAI' }));
      fireEvent.change(screen.getByLabelText(/配置名称/), { target: { value: '旧草稿' } });
      rerender(
        <ApiSettings {...defaultProps} apiConfigs={[]} apiConfigsRevision={4} onFullApiConfigUpdate={onFullApiConfigUpdate} />
      );
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

      await waitFor(() => expect(onFullApiConfigUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ expectedApiConfigsRevision: 3 })
      ));
      expect(screen.getByDisplayValue('旧草稿')).toBeInTheDocument();
    });

    it('编辑保存冲突时保留草稿，且不产生未处理的拒绝', async () => {
      const onFullApiConfigUpdate = vi.fn().mockRejectedValue(new Error('配置冲突'));
      render(<ApiSettings {...defaultProps} apiConfigs={[makeConfig()]} onFullApiConfigUpdate={onFullApiConfigUpdate} />);
      fireEvent.click(screen.getByLabelText('编辑配置：My OpenAI'));
      fireEvent.change(screen.getByLabelText(/配置名称/), { target: { value: '草稿名称' } });
      fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

      await waitFor(() => expect(onFullApiConfigUpdate).toHaveBeenCalledOnce());
      expect(screen.getByDisplayValue('草稿名称')).toBeInTheDocument();
      expect(screen.getByText('编辑配置')).toBeInTheDocument();
    });

    it('点击编辑按钮进入编辑模式', async () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);

      fireEvent.click(screen.getByLabelText('编辑配置：My OpenAI'));

      await waitFor(() => {
        // 编辑模式下应显示表单
        expect(screen.queryByText('+ 添加配置')).toBeNull();
      });
    });
  });

  describe('服务商切换的凭据隔离', () => {
    let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

    beforeEach(async () => {
      // 保留真实模型服务，仅在网络边界拦截请求，所有凭据均为测试假值。
      const modelService = await vi.importActual<typeof import('@/shared/services/modelService')>(
        '@/shared/services/modelService'
      );
      vi.mocked(getModels).mockImplementation(modelService.getModels);
      vi.mocked(testConnection).mockImplementation(modelService.testConnection);
      fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => new Response(
        JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), { status: 200 }
      ));
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    async function editExistingConfig(overrides: Partial<ApiConfig> = {}) {
      const config = makeConfig({
        name: '已有配置',
        provider: 'deepl',
        apiKey: 'fake-deepl-key:fx',
        secondaryApiKey: 'fake-secondary-key',
        ...overrides,
      });
      const user = userEvent.setup();
      render(<ApiSettings {...defaultProps} apiConfigs={[config]} />);
      await user.click(screen.getByRole('button', { name: '编辑配置：已有配置' }));
      return { user, config };
    }

    it('DeepL 改为 Google 后直接测试不能发送旧密钥，重新输入后只发送新密钥', async () => {
      const { user, config } = await editExistingConfig();
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'google_translate');
      await user.click(screen.getByRole('button', { name: '测试连接' }));

      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByLabelText(/^API 密钥/)).toHaveValue('');
      expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();

      await user.type(screen.getByLabelText(/^API 密钥/), 'fake-google-key');
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      expect(await screen.findByText('API 连接成功')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        'https://translation.googleapis.com/language/translate/v2?key=fake-google-key',
        expect.objectContaining({ method: 'POST' })
      );
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(config.apiKey);
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(config.secondaryApiKey);
      expect(defaultProps.onApiConfigsUpdate).not.toHaveBeenCalled();
    });

    it('自定义端点切至 OpenAI 后不把新密钥发送给旧代理', async () => {
      const { user } = await editExistingConfig({
        provider: 'custom', apiKey: 'TEST_OLD_CUSTOM_KEY',
        apiUrl: 'https://old-proxy.invalid/v1/chat/completions',
      });
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'openai');
      expect(screen.getByLabelText('API 端点 URL (可选，覆盖默认)')).toHaveValue('');
      fetchMock.mockClear();

      await user.type(screen.getByLabelText(/^API 密钥/), 'TEST_NEW_OPENAI_KEY');
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      await screen.findByText('API 连接成功');

      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('old-proxy.invalid');
      expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith('https://api.openai.com/'))).toBe(true);
    });

    it('服务商变化立即清空主次密钥，切回原服务商也不恢复旧凭据', async () => {
      const { user } = await editExistingConfig();
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'baidu');

      expect(screen.getByLabelText(/^API 密钥/)).toHaveValue('');
      expect(screen.getByLabelText(/^Secret Key/)).toHaveValue('');
      expect(screen.queryByText('API 连接成功')).not.toBeInTheDocument();
      await user.type(screen.getByLabelText(/^API 密钥/), 'fake-baidu-key');
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();

      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'deepl');
      expect(screen.getByLabelText(/^API 密钥/)).toHaveValue('');
    });

    it('同一服务商编辑和重复选择保留原主次密钥及测试状态', async () => {
      const { user, config } = await editExistingConfig({
        provider: 'baidu', apiKey: 'fake-baidu-key', secondaryApiKey: 'fake-baidu-secret',
      });
      await user.type(screen.getByLabelText(/配置名称/), '改名');
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'baidu');

      expect(screen.getByLabelText(/^API 密钥/)).toHaveValue(config.apiKey);
      expect(screen.getByLabelText(/^Secret Key/)).toHaveValue(config.secondaryApiKey);
      expect(screen.getByText('API 连接成功')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      { fullUpdate: true, active: true },
      { fullUpdate: true, active: false },
      { fullUpdate: false, active: true },
      { fullUpdate: false, active: false },
    ])('同服务商保存保留主次凭据及原激活状态 %j', async ({ fullUpdate, active }) => {
      const config = Object.freeze(makeConfig({
        provider: 'baidu', apiKey: 'fake-baidu-key', secondaryApiKey: 'fake-baidu-secret',
        apiUrl: 'https://example.invalid/chat',
      }));
      const onFullApiConfigUpdate = fullUpdate ? vi.fn().mockResolvedValue(undefined) : undefined;
      const user = userEvent.setup();
      render(<ApiSettings {...defaultProps} apiConfigs={[config]}
        activeApiConfigId={active ? config.id : undefined}
        onFullApiConfigUpdate={onFullApiConfigUpdate} />);
      await user.click(screen.getByRole('button', { name: `编辑配置：${config.name}` }));
      await user.clear(screen.getByLabelText(/配置名称/));
      await user.type(screen.getByLabelText(/配置名称/), '仅改名称');
      await user.click(screen.getByRole('button', { name: '保存配置' }));

      const savedConfigs = [expect.objectContaining({
        id: config.id, name: '仅改名称', provider: config.provider,
        apiKey: config.apiKey, secondaryApiKey: config.secondaryApiKey,
      })];
      if (onFullApiConfigUpdate) {
        expect(onFullApiConfigUpdate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
          configs: savedConfigs,
          activeId: active ? config.id : undefined,
          provider: active ? config.provider : undefined,
          apiKey: active ? config.apiKey : undefined,
          secondaryApiKey: active ? config.secondaryApiKey : undefined,
        }));
      } else {
        expect(defaultProps.onApiConfigsUpdate).toHaveBeenCalledExactlyOnceWith(
          savedConfigs, active ? config.id : undefined
        );
        expect(defaultProps.onApiKeyUpdate).toHaveBeenCalledTimes(active ? 1 : 0);
      }
      expect(screen.getByRole('button', { name: '+ 添加配置' })).toBeInTheDocument();
      expect(config.name).toBe('My OpenAI');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(['认证失败', '网络失败'] as const)('当前连接%s正常提示，切换服务商清除旧错误', async (failure) => {
      const { user } = await editExistingConfig();
      if (failure === '网络失败') {
        fetchMock.mockRejectedValueOnce(new Error('模拟网络失败'));
      } else {
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: '模拟认证失败' }), { status: 401 }));
      }
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      expect(screen.getByRole('status')).toHaveTextContent(`模拟${failure}`);
      expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'google_translate');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('切到自定义服务商后仅使用新密钥和端点，仍可选择模型并保存', async () => {
      const user = userEvent.setup();
      const onFullApiConfigUpdate = vi.fn().mockResolvedValue(undefined);
      render(<ApiSettings {...defaultProps} onFullApiConfigUpdate={onFullApiConfigUpdate} />);
      await user.click(screen.getByRole('button', { name: '添加第一个配置' }));
      await user.type(screen.getByLabelText(/^API 密钥/), 'fake-old-openai-key');
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'custom');
      expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
      await user.type(screen.getByLabelText(/^API 密钥/), 'fake-custom-key');
      expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
      await user.click(screen.getByRole('button', { name: '显示 API 密钥' }));
      expect(screen.getByLabelText(/^API 密钥/)).toHaveAttribute('type', 'text');
      await user.click(screen.getByRole('button', { name: '隐藏 API 密钥' }));
      await user.type(screen.getByLabelText(/API 端点 URL/), 'https://example.invalid/v1/chat/completions');
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      expect(screen.getByText('API 连接成功')).toBeInTheDocument();
      expect(screen.getByLabelText('模型')).toHaveValue('gpt-4o-mini');
      expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
      await user.type(screen.getByLabelText(/配置名称/), '自定义配置');
      await user.click(screen.getByLabelText('自定义模型'));
      await user.clear(screen.getByLabelText('模型'));
      await user.type(screen.getByLabelText('模型'), 'custom-model');
      await user.click(screen.getByRole('button', { name: '刷新列表' }));
      expect(screen.getByLabelText('模型')).toHaveValue('custom-model');
      await user.click(screen.getByLabelText('自定义模型'));
      await user.selectOptions(screen.getByLabelText('模型'), 'gpt-3.5-turbo');
      await user.click(screen.getByRole('button', { name: '保存配置' }));

      expect(onFullApiConfigUpdate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        provider: 'custom', apiKey: 'fake-custom-key',
        customApiUrl: 'https://example.invalid/v1/chat/completions',
        customModelName: 'gpt-3.5-turbo', secondaryApiKey: '',
      }));
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('fake-old-openai-key');
    });

    it('换服务商后百度必须重新填写两把密钥，测试只使用新凭据', async () => {
      const { user } = await editExistingConfig();
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'baidu');
      await user.type(screen.getByLabelText(/API 端点 URL/), 'https://example.invalid/baidu');
      await user.type(screen.getByLabelText(/^API 密钥/), 'fake-new-baidu-key');
      await user.type(screen.getByLabelText(/^Secret Key/), 'fake-new-baidu-secret');
      await user.click(screen.getByRole('button', { name: '显示 Secret Key' }));
      expect(screen.getByLabelText(/^Secret Key/)).toHaveAttribute('type', 'text');
      await user.click(screen.getByRole('button', { name: '隐藏 Secret Key' }));
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ access_token: 'fake-token' })));
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      expect(screen.getByText('API 连接成功')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=fake-new-baidu-key&client_secret=fake-new-baidu-secret'
      );
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('fake-deepl-key');
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('fake-secondary-key');
    });

    it.each(['新增配置', '旧设置另存'] as const)('%s 也不能跨服务商沿用密钥', async (entry) => {
      const user = userEvent.setup();
      render(<ApiSettings {...defaultProps} provider="deepl" apiKey="fake-legacy-deepl-key" />);
      if (entry === '新增配置') {
        await user.click(screen.getByRole('button', { name: '+ 添加配置' }));
        await user.type(screen.getByLabelText(/^API 密钥/), 'fake-new-openai-key');
      } else {
        await user.click(screen.getByRole('button', { name: '保存为配置' }));
      }
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'google_translate');
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      expect(screen.getByLabelText(/^API 密钥/)).toHaveValue('');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('返回列表再编辑另一服务商时旧连接成功不能验证新配置', async () => {
      let resolveOld!: (result: { success: boolean }) => void;
      vi.mocked(testConnection).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
      const user = userEvent.setup();
      render(<ApiSettings {...defaultProps} apiConfigs={[
        makeConfig({ id: 'a', name: '配置 A', provider: 'openai', apiKey: 'fake-a-key' }),
        makeConfig({ id: 'b', name: '配置 B', provider: 'anthropic', apiKey: 'fake-b-key' }),
      ]} />);
      await user.click(screen.getByRole('button', { name: '编辑配置：配置 A' }));
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      await user.click(screen.getByRole('button', { name: '返回配置列表' }));
      await user.click(screen.getByRole('button', { name: '编辑配置：配置 B' }));
      await user.clear(screen.getByLabelText(/^API 密钥/));
      await user.type(screen.getByLabelText(/^API 密钥/), 'fake-new-b-key');
      expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();

      await act(async () => { resolveOld({ success: true }); });
      expect(screen.queryByText('API 连接成功')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
    });

    it.each(['成功', '失败'] as const)('切换服务商取消编辑时的模型加载，忽略旧请求%s结果', async (outcome) => {
      let resolve!: (response: Response) => void;
      let reject!: (error: Error) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>((res, rej) => {
        resolve = res;
        reject = rej;
      }));
      const { user } = await editExistingConfig({ provider: 'openai', apiKey: 'fake-openai-key' });
      expect(screen.getByLabelText('模型')).toBeDisabled();
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'google_translate');
      expect(screen.getByLabelText('模型')).toBeEnabled();

      await act(async () => {
        if (outcome === '成功') {
          resolve(new Response(JSON.stringify({ data: [{ id: 'old-provider-model' }] })));
        } else {
          reject(new Error('模拟旧模型请求失败'));
        }
      });
      const modelSelect = screen.getByLabelText('模型');
      expect(within(modelSelect).getAllByRole('option')).toHaveLength(1);
      expect(modelSelect).toHaveValue('google-translate');
      expect(modelSelect).toBeEnabled();
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('刷新模型过程中切换服务商，旧列表不能覆盖新服务商模型', async () => {
      const { user } = await editExistingConfig({ provider: 'openai', apiKey: 'fake-openai-key' });
      let resolve!: (response: Response) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>(res => { resolve = res; }));
      await user.click(screen.getByRole('button', { name: '刷新列表' }));
      expect(screen.getByLabelText('模型')).toBeDisabled();
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'google_translate');
      expect(screen.getByLabelText('模型')).toBeEnabled();

      await act(async () => {
        resolve(new Response(JSON.stringify({ data: [{ id: 'stale-refreshed-model' }] })));
      });
      expect(screen.getByLabelText('模型')).toHaveValue('google-translate');
      expect(within(screen.getByLabelText('模型')).getAllByRole('option')).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it.each([200, 401])('旧连接测试返回 %s 也不能恢复测试状态或追加模型请求', async (status) => {
      const { user } = await editExistingConfig({ provider: 'openai', apiKey: 'fake-openai-key' });
      let resolve!: (response: Response) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>(res => { resolve = res; }));
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'google_translate');

      await act(async () => {
        resolve(new Response(JSON.stringify({ error: { message: '旧服务商测试失败' } }), { status }));
      });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('切换后可立即测试新凭据，旧测试完成不能结束新测试的加载状态', async () => {
      const { user } = await editExistingConfig({ provider: 'openai', apiKey: 'fake-openai-key' });
      let resolveOld!: (response: Response) => void;
      let resolveNew!: (response: Response) => void;
      fetchMock.mockImplementationOnce(() => new Promise<Response>(res => { resolveOld = res; }));
      await user.click(screen.getByRole('button', { name: '测试连接' }));
      await user.selectOptions(screen.getByLabelText('选择 API 服务商'), 'google_translate');
      await user.type(screen.getByLabelText(/^API 密钥/), 'fake-google-key');
      fetchMock.mockImplementationOnce(() => new Promise<Response>(res => { resolveNew = res; }));
      await user.click(screen.getByRole('button', { name: '测试连接' }));

      await act(async () => { resolveOld(new Response('{}')); });
      expect(screen.getByRole('button', { name: '测试中...' })).toBeDisabled();
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await act(async () => { resolveNew(new Response('{}')); });
      expect(screen.getByText('API 连接成功')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled();
      expect(screen.getByLabelText('模型')).toHaveValue('google-translate');
    });
  });

  describe('旧版兼容显示', () => {
    it('无激活配置但有 apiKey 时显示当前设置', () => {
      render(<ApiSettings {...defaultProps} apiKey="sk-legacy" />);
      expect(screen.getByText('当前 API 设置')).toBeTruthy();
    });

    it('有激活配置时不显示旧版当前设置', () => {
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiKey="sk-legacy"
          apiConfigs={configs}
          activeApiConfigId="cfg-1"
        />
      );
      expect(screen.queryByText('当前 API 设置')).toBeNull();
    });
  });
});
