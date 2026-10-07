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
  sendMessage.mockReset().mockImplementation(async message => message.type === 'GET_SETTINGS'
    ? { success: true, data: { apiConfigs: [], apiConfigsRevision: 0 } }
    : { success: true });
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
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'GET_SETTINGS' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, { type: 'TEST_API_CONNECTION', payload: { provider: 'anthropic', apiKey: 'secret-key' } });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
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
    let testCalls = 0;
    sendMessage.mockImplementation(async message => {
      if (message.type === 'GET_SETTINGS') return { success: true, data: { apiConfigs: [], apiConfigsRevision: 0 } };
      testCalls += 1;
      return testCalls === 1 ? { success: false } : Promise.reject(new Error('offline'));
    });
    open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'key' } });
    await testConnection();
    expect(screen.getByRole('alert')).toHaveTextContent('连接测试失败');
    await testConnection();
    expect(screen.getByRole('alert')).toHaveTextContent('连接测试失败');
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole('heading', { name: '配置翻译服务' })).toBeInTheDocument();
    // 每次尝试 = 快照读取 + 连接测试，共 4 次调用且无保存
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SETTINGS' }));
    expect(localStorage.getItem('not_onboarding_completed')).toBeNull();
  });

  it('自定义服务先校验 URL 和密钥，连接请求使用后台识别的 apiUrl', async () => {
    open('B');
    next('开始设置');
    fireEvent.click(screen.getByRole('radio', { name: /自定义/ }));
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: ' key ' } });
    expect(screen.getByRole('button', { name: '测试并保存' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/API 地址/), { target: { value: ' https://api.example.com/v1 ' } });
    await testConnection();
    expect(sendMessage).toHaveBeenNthCalledWith(1, { type: 'GET_SETTINGS' });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      type: 'TEST_API_CONNECTION',
      payload: { provider: 'openai', apiKey: 'key', apiUrl: 'https://api.example.com/v1' },
    });
    expect(sendMessage).toHaveBeenNthCalledWith(3, {
      type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
      payload: expect.objectContaining({ apiConfigs: [expect.objectContaining({ provider: 'custom', apiUrl: 'https://api.example.com/v1' })] }),
    });
  });

  it.each(['拒绝', '空响应', '缺少数据', '异常'])('加载快照%s时不提交配置、不进入演示', async failure => {
    // 快照读取是操作的第一步，失败时甚至不应发起连接测试
    if (failure === '异常') sendMessage.mockRejectedValueOnce(new Error('无法读取设置'));
    else sendMessage.mockResolvedValueOnce(failure === '拒绝'
      ? { success: false, data: { apiConfigs: [], apiConfigsRevision: 0 } }
      : failure === '缺少数据' ? { success: true } : undefined);
    const { onComplete } = open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'key' } });
    await testConnection();
    act(() => vi.advanceTimersByTime(1200));

    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_SETTINGS' });
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'TEST_API_CONNECTION' }));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SETTINGS' }));
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    expect(screen.queryByRole('heading', { name: '设置完成！' })).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('后台拒绝保存时不能显示成功或进入演示', async () => {
    sendMessage.mockResolvedValueOnce({ success: true, data: { apiConfigs: [], apiConfigsRevision: 0 } })
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false });
    open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'key' } });
    await testConnection();
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.getByRole('heading', { name: '配置翻译服务' })).toBeInTheDocument();
    expect(localStorage.getItem('not_onboarding_completed')).toBeNull();
  });

  it('切换服务商时清空密钥并使旧测试结果失效，旧密钥不能测试新服务商', async () => {
    sendMessage.mockImplementation(async message => message.type === 'GET_SETTINGS'
      ? { success: true, data: { apiConfigs: [], apiConfigsRevision: 0 } }
      : { success: false });
    open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'sk-openai-key' } });
    await testConnection();
    expect(screen.getByRole('alert')).toHaveTextContent('连接测试失败');

    fireEvent.click(screen.getByRole('radio', { name: /DeepSeek/ }));
    expect(screen.getByLabelText('API 密钥')).toHaveValue('');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // sk- 前缀对 DeepSeek 同样合法，只有清空密钥才能阻止旧 OpenAI 密钥被拿去测试 DeepSeek
    expect(screen.getByRole('button', { name: '测试并保存' })).toBeDisabled();
  });

  it('离开自定义服务商时清空自定义端点，新密钥不能发送给旧代理', async () => {
    open('B');
    next('开始设置');
    fireEvent.click(screen.getByRole('radio', { name: /自定义/ }));
    fireEvent.change(screen.getByLabelText(/API 地址/), { target: { value: 'https://old-proxy.example.com/v1' } });
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'old-key' } });

    // 切到 DeepSeek 再切回自定义：旧代理地址必须被清空，不能让新密钥发往旧端点
    fireEvent.click(screen.getByRole('radio', { name: /DeepSeek/ }));
    fireEvent.click(screen.getByRole('radio', { name: /自定义/ }));
    expect(screen.getByLabelText(/API 地址/)).toHaveValue('');
    expect(screen.getByRole('button', { name: '测试并保存' })).toBeDisabled();
  });

  it('测试进行中切换服务商时废弃旧请求，不保存旧密钥也不进入演示', async () => {
    let resolveTest!: (response: { success: boolean }) => void;
    sendMessage.mockImplementation(async message => {
      if (message.type === 'TEST_API_CONNECTION') return new Promise(resolve => { resolveTest = resolve; });
      return { success: true, data: { apiConfigs: [], apiConfigsRevision: 0 } };
    });
    const { onComplete } = open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'old-provider-key' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '测试并保存' })); });

    // 连接测试挂起期间切换到 DeepSeek：旧请求必须被废弃
    fireEvent.click(screen.getByRole('radio', { name: /DeepSeek/ }));
    await act(async () => { resolveTest({ success: true }); });

    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SETTINGS' }));
    expect(screen.queryByText(/连接成功/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('heading', { name: '设置完成！' })).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
    // 废弃后测试状态复位，用户可以基于新服务商重新输入
    expect(screen.getByRole('button', { name: '测试并保存' })).toBeInTheDocument();
  });

  it('测试期间另一窗口变更配置版本时，不得借最新版本保存旧草稿密钥', async () => {
    // 场景：开始测试前版本 7；连接测试进行中另一窗口清空配置（版本推进到 8）；
    // 测试延迟成功后，必须用开始时固定的版本 7 提交，由后台版本检查拒绝，而不是重新读取版本 8 保存旧草稿。
    let currentRevision = 7;
    let getSettingsCalls = 0;
    sendMessage.mockImplementation(async message => {
      if (message.type === 'GET_SETTINGS') {
        getSettingsCalls += 1;
        return { success: true, data: { apiConfigs: [], apiConfigsRevision: currentRevision } };
      }
      if (message.type === 'UPDATE_SETTINGS') {
        return { success: message.expectedApiConfigsRevision === currentRevision };
      }
      // TEST_API_CONNECTION 返回前，另一窗口清空配置，版本 7 → 8
      currentRevision = 8;
      return { success: true };
    });
    const { onComplete } = open('B');
    next('开始设置');
    fireEvent.change(screen.getByLabelText('API 密钥'), { target: { value: 'stale-draft-key' } });
    await testConnection();

    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'UPDATE_SETTINGS',
      expectedApiConfigsRevision: 7,
    }));
    expect(getSettingsCalls).toBe(1);
    expect(screen.getByRole('alert')).toHaveTextContent('保存失败');
    act(() => vi.advanceTimersByTime(1200));
    expect(screen.queryByRole('heading', { name: '设置完成！' })).not.toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });
});
