import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WelcomeModalExperiment from '@/shared/components/WelcomeModalExperiment';
import { trackEvent } from '@/shared/analytics/init';
import { shouldShowWelcomeModal } from '@/shared/components/welcomeModalUtils';

vi.mock('@/shared/analytics/init', () => ({ trackEvent: vi.fn() }));

const sendMessage = vi.fn();
const progress = (group: string, step: string, action: string, metadata = {}) =>
  expect(trackEvent).toHaveBeenCalledWith('Onboarding_Progress', {
    experiment: 'EXP-001', group, step, action, ...metadata,
  });

function open(group: 'A' | 'B' | 'C') {
  localStorage.setItem('not_onboarding_experiment_group', group);
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const view = render(<WelcomeModalExperiment isOpen onClose={onClose} onComplete={onComplete} />);
  return { ...view, onClose, onComplete };
}

function next(button: string) {
  fireEvent.click(screen.getByRole('button', { name: button }));
  act(() => vi.advanceTimersByTime(300));
}

async function testConnection() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '测试并保存' }));
  });
}

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  });
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WelcomeModalExperiment', () => {
  it('关闭时不显示内容或上报开始；打开时沿用已分配的 A 组', () => {
    localStorage.setItem('not_onboarding_experiment_group', 'A');
    const onClose = vi.fn();
    const onComplete = vi.fn();
    const { rerender } = render(<WelcomeModalExperiment isOpen={false} onClose={onClose} onComplete={onComplete} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trackEvent).not.toHaveBeenCalled();

    rerender(<WelcomeModalExperiment isOpen onClose={onClose} onComplete={onComplete} />);
    expect(screen.getByRole('dialog', { name: '欢迎使用 NotOnlyTranslator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '欢迎使用 NotOnlyTranslator' })).toBeInTheDocument();
    progress('A', 'welcome', 'start');
    expect(localStorage.getItem('not_onboarding_experiment_group')).toBe('A');
  });

  it('未分组时分配并保留 C 组，直接进入演示并完成引导', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const onComplete = vi.fn();
    render(<WelcomeModalExperiment isOpen onClose={vi.fn()} onComplete={onComplete} />);
    expect(screen.getByRole('heading', { name: '只翻译你不会的词' })).toBeInTheDocument();
    expect(localStorage.getItem('not_onboarding_experiment_group')).toBe('C');
    next('开始设置');
    expect(screen.getByRole('heading', { name: '设置完成！' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '配置翻译服务' })).not.toBeInTheDocument();
    progress('C', 'welcome', 'complete', { nextStep: 'demo', selectedLevel: '', selectedProvider: 'openai' });
    progress('C', 'demo', 'start');
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    progress('C', 'complete', 'complete', { totalSteps: 2 });
    expect(localStorage.getItem('not_onboarding_completed')).toBe('true');
    expect(Number(localStorage.getItem('not_onboarding_completed_at'))).toBeGreaterThan(0);
    expect(shouldShowWelcomeModal()).toBe(false);
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('从 C 组演示返回时回到欢迎页而不是不存在的 API 步骤', () => {
    open('C');
    next('开始设置');
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('heading', { name: '只翻译你不会的词' })).toBeInTheDocument();
  });

  it('B 组跳过水平选择，API 页面可以返回欢迎页', () => {
    open('B');
    expect(screen.getByRole('heading', { name: '开启智能翻译之旅' })).toBeInTheDocument();
    next('开始设置');
    expect(screen.getByRole('heading', { name: '配置翻译服务' })).toBeInTheDocument();
    progress('B', 'welcome', 'complete', { nextStep: 'api', selectedLevel: '', selectedProvider: 'openai' });
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    expect(screen.getByRole('heading', { name: '开启智能翻译之旅' })).toBeInTheDocument();
  });

  it('A 组必须选择水平，选项及密钥不能为空，测试成功后保存配置并完成五步引导', async () => {
    sendMessage.mockResolvedValue({ success: true });
    const { onComplete } = open('A');
    next('开始设置');
    expect(screen.getByRole('heading', { name: '选择你的英语水平' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /中级/ }));
    expect(screen.getByRole('radio', { name: /中级/ })).toHaveAttribute('aria-checked', 'true');
    next('下一步');
    progress('A', 'level', 'complete', { nextStep: 'api', selectedLevel: 'intermediate', selectedProvider: 'openai' });
    expect(screen.getByRole('button', { name: '测试并保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: /Anthropic/ }));
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: '  secret-key  ' } });
    expect(screen.getByLabelText('API 密钥')).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '显示 API 密钥' }));
    expect(screen.getByLabelText('API 密钥')).toHaveAttribute('type', 'text');
    await testConnection();
    expect(screen.getByRole('status')).toHaveTextContent('连接成功');
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'TEST_API_CONNECTION', payload: { provider: 'anthropic', apiKey: 'secret-key' } });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'UPDATE_SETTINGS',
      payload: {
        apiConfigs: [expect.objectContaining({ provider: 'anthropic', apiKey: 'secret-key', tested: true })],
        activeApiConfigId: expect.any(String), apiProvider: 'anthropic',
      },
    });
    act(() => vi.advanceTimersByTime(800));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.getByRole('heading', { name: '设置完成！' })).toBeInTheDocument();
    progress('A', 'api', 'complete', { nextStep: 'demo', selectedLevel: 'intermediate', selectedProvider: 'anthropic' });
    fireEvent.click(screen.getByRole('button', { name: '开始使用' }));
    progress('A', 'complete', 'complete', { totalSteps: 5 });
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('跳过欢迎页时关闭、记录跳过，且下次不再显示引导', () => {
    const { onClose, onComplete } = open('A');
    fireEvent.click(screen.getByRole('button', { name: '稍后再说' }));
    progress('A', 'welcome', 'skip');
    expect(onClose).toHaveBeenCalledOnce();
    expect(onComplete).not.toHaveBeenCalled();
    expect(localStorage.getItem('not_onboarding_completed')).toBeNull();
    expect(shouldShowWelcomeModal()).toBe(false);
  });

  it('API 测试失败或网络异常时提示错误，不保存设置也不进入演示', async () => {
    sendMessage.mockResolvedValueOnce({ success: false }).mockRejectedValueOnce(new Error('offline'));
    open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'key' } });
    await testConnection();
    expect(screen.getByRole('alert')).toHaveTextContent('连接测试失败');
    await testConnection();
    expect(screen.getByRole('alert')).toHaveTextContent('连接测试失败');
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole('heading', { name: '配置翻译服务' })).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('not_onboarding_completed')).toBeNull();
  });

  it('自定义服务先校验 URL 和密钥，连接请求使用后台识别的 apiUrl', async () => {
    sendMessage.mockResolvedValue({ success: true });
    open('B');
    next('开始设置');
    fireEvent.click(screen.getByRole('radio', { name: /自定义/ }));
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: ' key ' } });
    expect(screen.getByRole('button', { name: '测试并保存' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/API 地址/), { target: { value: ' https://api.example.com/v1 ' } });
    await testConnection();
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      type: 'TEST_API_CONNECTION',
      payload: { provider: 'openai', apiKey: 'key', apiUrl: 'https://api.example.com/v1' },
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'UPDATE_SETTINGS',
      payload: expect.objectContaining({ apiConfigs: [expect.objectContaining({ provider: 'custom', apiUrl: 'https://api.example.com/v1' })] }),
    });
  });

  it('后台拒绝保存时不能显示成功或进入演示', async () => {
    sendMessage.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false });
    open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'key' } });
    await testConnection();
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole('heading', { name: '配置翻译服务' })).toBeInTheDocument();
    expect(localStorage.getItem('not_onboarding_completed')).toBeNull();
  });
});
