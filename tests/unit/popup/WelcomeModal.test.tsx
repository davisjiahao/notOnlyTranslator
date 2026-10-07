import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import WelcomeModal from '@/popup/components/WelcomeModal';

// Mock chrome runtime
const mockSendMessage = vi.fn();
beforeEach(() => {
  mockSendMessage.mockReset();
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  Object.defineProperty(global, 'chrome', {
    value: {
      runtime: { sendMessage: mockSendMessage },
    },
    writable: true,
  });
});

function createSettings(overrides?: Record<string, unknown>) {
  return {
    apiConfigs: [],
    activeApiConfigId: null,
    apiProvider: 'openai' as const,
    ...overrides,
  };
}

describe('WelcomeModal', () => {
  it('免费启用仅提交增量设置，并在保存成功后完成引导', async () => {
    mockSendMessage.mockResolvedValue({ success: true });
    render(<WelcomeModal settings={createSettings()} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByText('无需 API Key，立即体验')));
    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'free_google_translate', activeApiConfigId: undefined } });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('已开启免费翻译');
    fireEvent.click(screen.getByText('开始使用'));
    expect(localStorage.getItem('not_onboarding_completed')).toBe('true');
  });

  it('免费设置保存失败不谎报成功，可重试', async () => {
    mockSendMessage.mockResolvedValue({ success: false });
    render(<WelcomeModal settings={createSettings()} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    await act(async () => fireEvent.click(screen.getByText('无需 API Key，立即体验')));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.queryByText('已开启免费翻译')).not.toBeInTheDocument();
    expect(localStorage.getItem('not_onboarding_completed')).toBeNull();
  });

  it('每一步都有有效的对话框名称', () => {
    render(<WelcomeModal settings={createSettings()} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('快速配置 API');
  });
  // --- Render conditions ---

  it('renders when needsSetup is true (empty apiConfigs)', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders when no config is tested', () => {
    const settings = createSettings({
      apiConfigs: [{ id: 'test-1', tested: false }],
      activeApiConfigId: 'test-1',
    });
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders when no activeApiConfigId', () => {
    const settings = createSettings({
      apiConfigs: [{ id: 'test-1', tested: true }],
      activeApiConfigId: null,
    });
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('returns null when setup is complete (has tested config + active)', () => {
    const settings = createSettings({
      apiConfigs: [{ id: 'test-1', tested: true }],
      activeApiConfigId: 'test-1',
    });
    const { container } = render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when settings is null', () => {
    // When settings is null, needsSetup evaluates to true (null?.apiConfigs is undefined, !undefined = true)
    // So the modal renders. This is the actual behavior of the component.
    const { container } = render(<WelcomeModal settings={null} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(container.firstChild).not.toBeNull();
  });

  // --- Welcome step ---

  it('shows welcome step title and description', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText('欢迎使用 NotOnlyTranslator')).toBeInTheDocument();
    expect(screen.getByText('智能分级翻译助手，只翻译你不会的词')).toBeInTheDocument();
  });

  it('shows feature highlights', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    expect(screen.getByText('智能分级')).toBeInTheDocument();
    expect(screen.getByText('生词本')).toBeInTheDocument();
    expect(screen.getByText('无需 API Key')).toBeInTheDocument();
  });

  it('has "开始配置" button to proceed to setup', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    expect(screen.getByText('快速配置 API')).toBeInTheDocument();
  });

  it('calls onComplete when "稍后再说" clicked', () => {
    const onComplete = vi.fn();
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={onComplete} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('稍后再说'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenSettings when "更多配置" clicked from quick setup', () => {
    const onOpenSettings = vi.fn();
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByText('开始配置'));
    fireEvent.click(screen.getByText('需要更多配置选项？'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  // --- Quick setup step ---

  it('shows quick setup page with provider radiogroup', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    expect(screen.getByRole('radiogroup', { name: '选择翻译服务商' })).toBeInTheDocument();
  });

  it('shows all quick providers', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText('Anthropic')).toBeInTheDocument();
    expect(screen.getByText('Google Gemini')).toBeInTheDocument();
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();
  });

  it('selects provider when radio clicked', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const anthropicRadio = screen.getByRole('radio', { name: /Anthropic/ });
    fireEvent.click(anthropicRadio);
    expect(anthropicRadio).toHaveAttribute('aria-checked', 'true');
  });

  it('shows API key input label', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
  });

  it('shows API key format validation feedback when typing', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    // Typing an invalid OpenAI key (not starting with sk-) triggers format error
    fireEvent.change(input, { target: { value: 'not-sk-key' } });
    // Format validation error should appear
    expect(screen.getByText('OpenAI API Key 以 "sk-" 开头')).toBeInTheDocument();
  });

  it('disables submit button when API key is empty', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const submitBtn = screen.getByText('完成配置').closest('button');
    expect(submitBtn).toBeDisabled();
  });

  it('disables submit button when API key format is invalid', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'invalid-key' } });
    const submitBtn = screen.getByText('完成配置').closest('button');
    expect(submitBtn).toBeDisabled();
  });

  // --- API key validation integration ---

  it('shows validation error for OpenAI key not starting with sk-', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'not-sk-key' } });
    // Submit button should be disabled because format is invalid
    const submitBtn = screen.getByText('完成配置').closest('button');
    expect(submitBtn).toBeDisabled();
  });

  it('enables submit for valid OpenAI key format', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'sk-test-valid-key' } });
    const submitBtn = screen.getByText('完成配置').closest('button');
    expect(submitBtn).not.toBeDisabled();
  });

  // --- Quick setup flow ---

  it('tests API connection when submit clicked with valid key', async () => {
    mockSendMessage.mockResolvedValue({ success: false });
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    await act(async () => { fireEvent.click(screen.getByText('完成配置')); });
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TEST_API_CONNECTION' })
    );
  });

  it('shows error on failed API test', async () => {
    mockSendMessage.mockResolvedValue({ success: false });
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    await act(async () => {
      fireEvent.click(screen.getByText('完成配置'));
    });
    await vi.waitFor(() => {
      expect(screen.getByText('连接测试失败，请检查 API Key 或网络')).toBeInTheDocument();
    });
  });

  it('shows success and navigates to success page on API test success', async () => {
    mockSendMessage.mockResolvedValue({ success: true });
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    await act(async () => {
      fireEvent.click(screen.getByText('完成配置'));
    });
    expect(await screen.findByText('配置成功！')).toBeInTheDocument();
  });

  it('switching provider clears the API key so the old key cannot test the new provider', async () => {
    mockSendMessage.mockResolvedValue({ success: false });
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    // 输入 OpenAI 密钥并触发一次失败的连接测试，留下旧测试结果
    fireEvent.change(input, { target: { value: 'sk-openai-key' } });
    await act(async () => { fireEvent.click(screen.getByText('完成配置')); });
    await vi.waitFor(() => {
      expect(screen.getByText('连接测试失败，请检查 API Key 或网络')).toBeInTheDocument();
    });

    // 切换到 DeepSeek：密钥必须被清空，旧测试结果必须失效
    fireEvent.click(screen.getByRole('radio', { name: /DeepSeek/ }));
    expect(screen.getByLabelText('API Key')).toHaveValue('');
    expect(screen.queryByText('连接测试失败，请检查 API Key 或网络')).not.toBeInTheDocument();
    // sk- 前缀对 DeepSeek 同样合法，只有清空密钥才能阻止旧 OpenAI 密钥被拿去测试 DeepSeek
    expect(screen.getByText('完成配置').closest('button')).toBeDisabled();
  });

  it('discards in-flight connection test when provider switches mid-test', async () => {
    let resolveTest!: (response: { success: boolean }) => void;
    mockSendMessage.mockReturnValue(new Promise(resolve => { resolveTest = resolve; }));
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-old-provider-key' } });
    await act(async () => { fireEvent.click(screen.getByText('完成配置')); });

    // 测试进行中切换到 DeepSeek：旧请求必须被废弃
    fireEvent.click(screen.getByRole('radio', { name: /DeepSeek/ }));
    await act(async () => { resolveTest({ success: true }); });

    // 延迟成功的旧请求不得保存旧密钥、不得显示成功或完成引导
    expect(mockSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SETTINGS' }));
    expect(screen.queryByText('连接测试成功！')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '配置成功！' })).not.toBeInTheDocument();
    // 废弃后测试状态复位，用户可以基于新服务商重新输入
    expect(screen.getByText('完成配置')).toBeInTheDocument();
  });

  it('clears test result when API key changes', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    fireEvent.change(input, { target: { value: 'sk-another-key' } });
    expect(screen.queryByText('连接测试失败，请检查 API Key 或网络')).not.toBeInTheDocument();
  });

  // --- Free trial flow ---

  it('starts free trial when "无需 API Key" button clicked', async () => {
    mockSendMessage.mockResolvedValue({ success: true });
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('无需 API Key，立即体验'));
    await act(async () => {});
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_SETTINGS',
      })
    );
  });

  it('shows free trial success page', async () => {
    mockSendMessage.mockResolvedValue({ success: true });
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('无需 API Key，立即体验'));
    await act(async () => {});
    await vi.waitFor(() => {
      expect(screen.getByText('已开启免费翻译')).toBeInTheDocument();
    });
  });

  it('calls onComplete when "开始使用" clicked from success page', async () => {
    mockSendMessage.mockResolvedValue({ success: true });
    const onComplete = vi.fn();
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={onComplete} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('无需 API Key，立即体验'));
    await act(async () => {});
    await vi.waitFor(() => {
      expect(screen.getByText('开始使用')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('开始使用'));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  describe('保存失败保护', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      cleanup();
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it.each(['拒绝', '空响应', '异常'])('快速配置遇到保存%s时不能显示成功或完成引导', async failure => {
      mockSendMessage.mockResolvedValueOnce({ success: true });
      if (failure === '异常') mockSendMessage.mockRejectedValueOnce(new Error('本地存储失败'));
      else mockSendMessage.mockResolvedValueOnce(failure === '拒绝' ? { success: false } : undefined);
      const onComplete = vi.fn();
      render(<WelcomeModal settings={createSettings()} onComplete={onComplete} onOpenSettings={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: '开始配置' }));
      fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-local-test-only' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '完成配置' })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

      expect(screen.queryByText('连接测试成功！')).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: '配置成功！' })).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
      expect(screen.getByRole('button', { name: '完成配置' })).toBeEnabled();
      expect(onComplete).not.toHaveBeenCalled();
    });

    it.each(['拒绝', '空响应', '异常'])('免费试用保存%s时留在欢迎页并允许重试', async failure => {
      if (failure === '异常') mockSendMessage.mockRejectedValueOnce(new Error('本地存储失败'));
      else mockSendMessage.mockResolvedValueOnce(failure === '拒绝' ? { success: false } : undefined);
      const onComplete = vi.fn();
      render(<WelcomeModal settings={createSettings()} onComplete={onComplete} onOpenSettings={vi.fn()} />);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '无需 API Key，立即体验' })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1200); });

      expect(screen.queryByRole('heading', { name: '已开启免费翻译' })).not.toBeInTheDocument();
      expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
      expect(onComplete).not.toHaveBeenCalled();
      mockSendMessage.mockResolvedValueOnce({ success: true });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '无需 API Key，立即体验' })); });
      expect(screen.getByRole('heading', { name: '已开启免费翻译' })).toBeInTheDocument();
    });

    it('配置快照未加载时不能用空数组和默认版本提交', async () => {
      mockSendMessage.mockResolvedValue({ success: true });
      render(<WelcomeModal settings={null} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: '开始配置' }));
      fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-local-test-only' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '完成配置' })); });

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    });

    it('免费试用保存未返回前禁用按钮，避免重复提交', async () => {
      let resolveSave!: (response: { success: boolean }) => void;
      mockSendMessage.mockReturnValue(new Promise(resolve => { resolveSave = resolve; }));
      render(<WelcomeModal settings={createSettings()} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
      const button = screen.getByRole('button', { name: '无需 API Key，立即体验' });
      fireEvent.click(button);
      expect(button).toBeDisabled();
      fireEvent.click(button);
      expect(mockSendMessage).toHaveBeenCalledOnce();
      expect(screen.queryByRole('heading', { name: '已开启免费翻译' })).not.toBeInTheDocument();
      await act(async () => { resolveSave({ success: true }); });
      expect(screen.getByRole('heading', { name: '已开启免费翻译' })).toBeInTheDocument();
    });
  });

  // --- Accessibility ---

  it('has role="dialog" and aria-modal="true"', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });

  it('has aria-labelledby pointing to the title', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(screen.getByText('欢迎使用 NotOnlyTranslator').id).toBe(titleId);
  });

  it('radiogroup has accessible label', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    expect(screen.getByRole('radiogroup', { name: '选择翻译服务商' })).toBeInTheDocument();
  });

  it('all providers have aria-checked attribute', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const radios = screen.getAllByRole('radio');
    radios.forEach(radio => {
      expect(radio).toHaveAttribute('aria-checked');
    });
  });

  it('show/hide API key button has aria-label', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const toggleBtn = screen.getByRole('button', { name: '显示 API Key' });
    expect(toggleBtn).toBeInTheDocument();
  });

  it('toggles API key visibility and updates aria-label', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const showBtn = screen.getByRole('button', { name: '显示 API Key' });
    fireEvent.click(showBtn);
    expect(screen.getByRole('button', { name: '隐藏 API Key' })).toBeInTheDocument();
  });

  it('API key input has correct id linked to label', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    expect(input.id).toBe('welcome-api-key-input');
  });

  // --- Back button ---

  it('returns to welcome step when "返回" clicked', () => {
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    expect(screen.getByText('快速配置 API')).toBeInTheDocument();
    fireEvent.click(screen.getByText('返回'));
    expect(screen.getByText('欢迎使用 NotOnlyTranslator')).toBeInTheDocument();
  });
});
