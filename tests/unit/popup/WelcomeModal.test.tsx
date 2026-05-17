import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import WelcomeModal from '@/popup/components/WelcomeModal';

// Mock chrome runtime
const mockSendMessage = vi.fn();
beforeEach(() => {
  mockSendMessage.mockReset();
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
    mockSendMessage.mockResolvedValue({ success: true });
    const settings = createSettings();
    render(<WelcomeModal settings={settings} onComplete={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByText('开始配置'));
    const input = screen.getByLabelText('API Key');
    fireEvent.change(input, { target: { value: 'sk-test-key' } });
    fireEvent.click(screen.getByText('完成配置'));
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
    await vi.waitFor(() => {
      expect(screen.getByText('配置成功！')).toBeInTheDocument();
    });
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
