import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import JevSettings from '@/options/components/JevSettings';
import { getJevEligibility, JEV_REASON_LABELS } from '@/shared/utils/jev';
import { logger } from '@/shared/utils';
import type { JevStatus, UserProfile, UserSettings } from '@/shared/types';

// 契约判定函数在组件层隔离：其内部 B1/服务商判定由 shared 的契约单测覆盖
vi.mock('@/shared/utils/jev', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils/jev')>();
  return { ...actual, getJevEligibility: vi.fn() };
});

const mockedGetJevEligibility = vi.mocked(getJevEligibility);

const baseProfile: UserProfile = {
  examType: 'cet4',
  estimatedVocabulary: 3000,
  knownWords: [],
  unknownWords: [],
  levelConfidence: 0.5,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const baseSettings: UserSettings = {
  enabled: true,
  autoHighlight: true,
  vocabHighlightEnabled: true,
  phraseTranslationEnabled: false,
  grammarTranslationEnabled: false,
  translationMode: 'inline-only',
  showDifficulty: true,
  highlightColor: 'yellow',
  fontSize: 14,
  apiProvider: 'openai',
  blacklist: [],
  apiConfigs: [],
  hoverDelay: 300,
  theme: 'system',
};

function setupChrome(options: {
  settings?: Partial<UserSettings>;
  status?: Partial<JevStatus>;
  permissionsGranted?: boolean;
  failTypes?: string[];
} = {}) {
  let settings: UserSettings = { ...baseSettings, ...options.settings };
  let status: JevStatus = {
    hasKey: false,
    model: 'jev-1.13.0',
    ...options.status,
  };
  const failTypes = new Set(options.failTypes ?? []);
  const sendMessage = vi.fn(async (message: { type: string; payload?: Partial<UserSettings> }) => {
    if (failTypes.has(message.type)) {
      return { success: false, error: 'mock failure' };
    }
    switch (message.type) {
      case 'GET_SETTINGS':
        return { success: true, data: { ...settings } };
      case 'GET_USER_PROFILE':
        return { success: true, data: baseProfile };
      case 'GET_JEV_STATUS':
        return { success: true, data: { ...status } };
      case 'UPDATE_SETTINGS': {
        settings = { ...settings, ...message.payload };
        return { success: true, data: { ...settings } };
      }
      case 'SET_JEV_API_KEY': {
        status = { ...status, hasKey: true };
        return { success: true };
      }
      case 'DELETE_JEV_API_KEY': {
        status = { ...status, hasKey: false };
        return { success: true };
      }
      case 'TEST_JEV_CONNECTION':
        return { success: true };
      default:
        return { success: false, error: 'unknown message' };
    }
  });
  const request = vi.fn(async () => options.permissionsGranted ?? true);
  const onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  // 用可写可配置属性注入，避免 stubGlobal 的只读描述符污染同 worker 的其他测试文件
  Object.defineProperty(globalThis, 'chrome', {
    value: { runtime: { sendMessage }, permissions: { request }, storage: { onChanged } },
    configurable: true,
    writable: true,
  });
  return { sendMessage, request, onChanged };
}

beforeEach(() => {
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
  mockedGetJevEligibility.mockReturnValue('disabled');
  setupChrome();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(globalThis, 'chrome');
});

describe('JevSettings 可配置服务', () => {
  const config = {
    provider: 'custom' as const, apiUrl: 'https://classifier.example/v2/systemone',
    model: 'jev-private', threshold: 0.5,
  };

  it('展示可编辑的供应商、完整地址、模型及阈值，并说明自定义模型未校准', async () => {
    setupChrome({ settings: { jevConfig: config } });
    render(<JevSettings />);
    expect(await screen.findByLabelText('识别供应商')).toHaveValue('custom');
    expect(screen.getByLabelText('识别 API URL')).toHaveValue(config.apiUrl);
    expect(screen.getByLabelText('识别模型')).toHaveValue(config.model);
    expect(screen.getByLabelText('识别阈值')).toHaveValue(0.5);
    expect(screen.getByText(/当前配置未经本项目校准/)).toBeInTheDocument();
  });

  it('保存完整配置后以实际地址申请权限并绑定密钥', async () => {
    const { sendMessage, request } = setupChrome();
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('识别供应商'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('识别 API URL'), { target: { value: config.apiUrl } });
    fireEvent.change(screen.getByLabelText('识别模型'), { target: { value: config.model } });
    fireEvent.change(screen.getByLabelText('识别阈值'), { target: { value: '0.5' } });
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存识别配置' }));
    await screen.findByText('识别配置已保存');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { jevConfig: config } });
    fireEvent.change(screen.getByLabelText('Jev API 密钥'), { target: { value: 'synthetic-custom-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));
    await screen.findByText('密钥已保存');
    expect(sendMessage).toHaveBeenCalledWith({ type: 'SET_JEV_API_KEY', payload: { apiKey: 'synthetic-custom-key', config } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await screen.findByText('连接测试成功');
    expect(request).toHaveBeenLastCalledWith({ origins: ['https://classifier.example/*'] });
  });

  it('拒绝含凭据或查询参数的地址，不更新设置也不申请权限', async () => {
    const { sendMessage, request } = setupChrome();
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('识别 API URL'), { target: { value: 'https://classifier.example/systemone?key=secret' } });
    fireEvent.click(screen.getByRole('button', { name: '保存识别配置' }));
    await screen.findByText(/配置无效/);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SETTINGS' }));
    expect(request).not.toHaveBeenCalled();
  });

  it('保存失败保留编辑值并阻止使用未保存地址测试', async () => {
    setupChrome({ failTypes: ['UPDATE_SETTINGS'] });
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('识别模型'), { target: { value: config.model } });
    fireEvent.click(screen.getByRole('button', { name: '保存识别配置' }));
    await screen.findByText('识别配置保存失败，保留之前的配置');
    expect(screen.getByLabelText('识别模型')).toHaveValue(config.model);
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
  });

  it('保存完成后丢弃先前发起的设置刷新', async () => {
    const { sendMessage } = setupChrome();
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('识别模型'), { target: { value: 'saved-new-model' } });
    const original = sendMessage.getMockImplementation()!;
    let release!: (value: { success: boolean; data: UserSettings }) => void;
    sendMessage.mockImplementation(async message => message.type === 'GET_SETTINGS'
      ? new Promise(resolve => { release = resolve; }) : original(message));
    fireEvent.focus(window);
    fireEvent.click(screen.getByRole('button', { name: '保存识别配置' }));
    await screen.findByText('识别配置已保存');
    await act(async () => { release({ success: true, data: baseSettings }); });
    expect(screen.getByLabelText('识别模型')).toHaveValue('saved-new-model');
  });

  it('外部配置切换地址时清空未保存密钥，不能将原服务密钥绑定新服务', async () => {
    const { sendMessage } = setupChrome();
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('Jev API 密钥'), { target: { value: 'only-for-old-service' } });
    await sendMessage({ type: 'UPDATE_SETTINGS', payload: { jevConfig: config } });
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByLabelText('识别 API URL')).toHaveValue(config.apiUrl));
    expect(screen.getByLabelText('Jev API 密钥')).toHaveValue('');
    expect(screen.getByRole('button', { name: '保存密钥' })).toBeDisabled();
  });

  it('开关响应带回另一服务配置时也清空原地址的密钥草稿', async () => {
    const { sendMessage } = setupChrome();
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('Jev API 密钥'), { target: { value: 'only-for-old-service' } });
    await sendMessage({ type: 'UPDATE_SETTINGS', payload: { jevConfig: config } });
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByLabelText('识别 API URL')).toHaveValue(config.apiUrl));
    expect(screen.getByLabelText('Jev API 密钥')).toHaveValue('');
    expect(screen.getByRole('button', { name: '保存密钥' })).toBeDisabled();
  });

  it('窗口刷新不覆盖尚未保存的表单草稿', async () => {
    const { sendMessage } = setupChrome();
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('识别模型'), { target: { value: 'my-unsaved-model' } });
    await sendMessage({ type: 'UPDATE_SETTINGS', payload: { jevConfig: config } });
    fireEvent.focus(window);
    await waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'GET_SETTINGS')).toHaveLength(2));
    expect(screen.getByLabelText('识别模型')).toHaveValue('my-unsaved-model');
    expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled();
  });

  it('切换到自定义预设时不沿用已校准阈值，恢复默认需显式保存', async () => {
    const { sendMessage } = setupChrome();
    render(<JevSettings />);
    fireEvent.change(await screen.findByLabelText('识别供应商'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('识别阈值')).toHaveValue(0.5);
    fireEvent.click(screen.getByRole('button', { name: '恢复 TypeSafe 预设' }));
    expect(screen.getByLabelText('识别 API URL')).toHaveValue('https://api.typesafe.ai/v1/systemone');
    expect(screen.getByLabelText('识别模型')).toHaveValue('jev-1.13.0');
    expect(screen.getByLabelText('识别阈值')).toHaveValue(0.26);
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'UPDATE_SETTINGS' }));
  });
});

describe('JevSettings', () => {
  it('先显示加载占位，数据就绪后渲染实验卡片标题与合成评估说明', async () => {
    render(<JevSettings />);
    expect(screen.getByText('正在加载设置…')).toBeInTheDocument();
    expect(await screen.findByText('Jev 词汇评估')).toBeInTheDocument();
    expect(screen.getByText('实验')).toBeInTheDocument();
    expect(
      screen.getByText(/合成评估数据校准，并非教师认证标签/)
    ).toBeInTheDocument();
  });

  it('任一加载消息失败时显示固定中文错误', async () => {
    setupChrome({ failTypes: ['GET_SETTINGS'] });
    render(<JevSettings />);
    expect(await screen.findByText('设置信息加载失败，请刷新重试')).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('默认 legacy 未启用：开关关闭并显示未启用原因', async () => {
    render(<JevSettings />);
    const toggle = await screen.findByRole('switch', { name: '启用 Jev 词汇评估' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(
      screen.getByText(`暂不满足生效条件：${JEV_REASON_LABELS.disabled}`)
    ).toBeInTheDocument();
  });

  it.each([
    'disabled',
    'enhancements-enabled',
    'unsupported-mode',
    'unsupported-level',
    'unsupported-provider',
  ] as const)('生效状态按契约 reason 显示中文标签：%s', async (reason) => {
    mockedGetJevEligibility.mockReturnValue(reason);
    setupChrome({ settings: { vocabularyAssessmentProvider: 'jev' } });
    render(<JevSettings />);
    expect(
      await screen.findByText(`暂不满足生效条件：${JEV_REASON_LABELS[reason]}`)
    ).toBeInTheDocument();
  });

  it('已启用且判定通过时只陈述条件满足，不宣称已生效', async () => {
    mockedGetJevEligibility.mockReturnValue(undefined);
    setupChrome({ settings: { vocabularyAssessmentProvider: 'jev' }, status: { hasKey: true } });
    render(<JevSettings />);
    const toggle = await screen.findByRole('switch', { name: '启用 Jev 词汇评估' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('满足生效条件，阅读时将尝试 Jev')).toBeInTheDocument();
    expect(screen.queryByText('当前已生效')).not.toBeInTheDocument();
  });

  it('使用真实资格函数且缺密钥时不声称可运行，说明数据发送边界', async () => {
    const actual = await vi.importActual<typeof import('@/shared/utils/jev')>('@/shared/utils/jev');
    mockedGetJevEligibility.mockImplementation(actual.getJevEligibility);
    setupChrome({ settings: { vocabularyAssessmentProvider: 'jev' } });
    render(<JevSettings />);
    expect(await screen.findByText('请先保存 Jev 密钥')).toBeInTheDocument();
    expect(screen.getByText(/句子.*TypeSafe/)).toBeInTheDocument();
    expect(screen.getByText(/密钥.*本机.*备份/)).toBeInTheDocument();
  });

  it('设置变化后重新读取适用状态，卸载时移除监听', async () => {
    const actual = await vi.importActual<typeof import('@/shared/utils/jev')>('@/shared/utils/jev');
    mockedGetJevEligibility.mockImplementation(actual.getJevEligibility);
    const { sendMessage, onChanged } = setupChrome({
      settings: { vocabularyAssessmentProvider: 'jev' }, status: { hasKey: true },
    });
    const { unmount } = render(<JevSettings />);
    expect(await screen.findByText('满足生效条件，阅读时将尝试 Jev')).toBeInTheDocument();
    expect(onChanged.addListener).toHaveBeenCalledTimes(1);
    const listener = onChanged.addListener.mock.calls[0][0];
    await sendMessage({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'deepl' } });
    listener({ settings: { newValue: {} } }, 'sync');
    expect(await screen.findByText(`暂不满足生效条件：${JEV_REASON_LABELS['unsupported-provider']}`)).toBeInTheDocument();
    unmount();
    expect(onChanged.removeListener).toHaveBeenCalledWith(listener);
  });

  it('回到设置窗口时刷新最近实际引擎，连接测试不会伪造运行记录', async () => {
    const { sendMessage } = setupChrome();
    const originalSendMessage = sendMessage.getMockImplementation()!;
    render(<JevSettings />);
    expect(await screen.findByText('最近运行：暂无记录')).toBeInTheDocument();
    sendMessage.mockImplementation(async (message) => message.type === 'GET_JEV_STATUS'
      ? { success: true, data: { hasKey: true, model: 'jev-1.13.0', lastAssessment: { provider: 'jev', at: 1700000000000 } } }
      : originalSendMessage(message));
    fireEvent.focus(window);
    expect(await screen.findByText(/最近运行：.*Jev 评估/)).toBeInTheDocument();
  });

  it('启用：用户点击内申请精确站点权限，获准后更新 vocabularyAssessmentProvider 为 jev', async () => {
    const { sendMessage, request } = setupChrome();
    render(<JevSettings />);
    const toggle = await screen.findByRole('switch', { name: '启用 Jev 词汇评估' });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(request).toHaveBeenCalledWith({ origins: ['https://api.typesafe.ai/*'] });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS',
      payload: { vocabularyAssessmentProvider: 'jev' },
    });
  });

  it('启用时权限被拒：不更新设置并显示权限拒绝原因', async () => {
    const { sendMessage, request } = setupChrome({ permissionsGranted: false });
    render(<JevSettings />);
    const toggle = await screen.findByRole('switch', { name: '启用 Jev 词汇评估' });
    fireEvent.click(toggle);
    expect(
      await screen.findByText('未获得所需站点权限，仍使用原有词汇评估')
    ).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'UPDATE_SETTINGS' })
    );
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('启用时设置保存失败：显示固定中文失败文案', async () => {
    setupChrome({ failTypes: ['UPDATE_SETTINGS'] });
    render(<JevSettings />);
    const toggle = await screen.findByRole('switch', { name: '启用 Jev 词汇评估' });
    fireEvent.click(toggle);
    expect(
      await screen.findByText('设置保存失败，保留之前的识别引擎')
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('关闭：直接更新为 legacy，不申请权限', async () => {
    const { sendMessage, request } = setupChrome({
      settings: { vocabularyAssessmentProvider: 'jev' },
    });
    render(<JevSettings />);
    const toggle = await screen.findByRole('switch', { name: '启用 Jev 词汇评估' });
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_SETTINGS',
      payload: { vocabularyAssessmentProvider: 'legacy' },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it('未配置密钥时显示未配置；已配置时只显示状态不回显密钥', async () => {
    const { unmount } = render(<JevSettings />);
    expect(await screen.findByText('未配置密钥')).toBeInTheDocument();
    unmount();

    setupChrome({ status: { hasKey: true } });
    render(<JevSettings />);
    expect(await screen.findByText('已保存密钥')).toBeInTheDocument();
    expect(screen.queryByLabelText('Jev API 密钥')).toHaveValue('');
  });

  it.each([
    [undefined, '最近运行：暂无记录'],
    [{ provider: 'jev' as const, at: 1700000000000 }, 'Jev 评估'],
    [{ provider: 'legacy' as const, reason: 'missing-key', at: 1700000000000 }, '未配置 Jev 密钥，已使用原识别流程'],
    [{ provider: 'legacy' as const, reason: 'untrusted-response', at: 1700000000000 }, 'Jev 暂不可用，已使用原识别流程'],
  ])('最近运行仅展示实际识别结果和固定白名单原因：%s', async (lastAssessment, text) => {
    setupChrome({ status: { lastAssessment } });
    render(<JevSettings />);
    expect(await screen.findByText(new RegExp(text))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('untrusted-response');
  });

  it('保存密钥：发送精确 payload，成功后清空输入并刷新状态', async () => {
    const { sendMessage } = setupChrome();
    render(<JevSettings />);
    const input = await screen.findByLabelText('Jev API 密钥');
    fireEvent.change(input, { target: { value: '  super-secret-key-123  ' } });
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));
    expect(await screen.findByText('密钥已保存')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'SET_JEV_API_KEY',
      payload: { apiKey: 'super-secret-key-123', config: {
        provider: 'typesafe', apiUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', threshold: 0.26,
      } },
    });
    expect(input).toHaveValue('');
    expect(await screen.findByText('已保存密钥')).toBeInTheDocument();
  });

  it('保存密钥后迟到的窗口刷新不得覆盖新状态', async () => {
    const { sendMessage } = setupChrome();
    const originalSendMessage = sendMessage.getMockImplementation()!;
    render(<JevSettings />);
    const input = await screen.findByLabelText('Jev API 密钥');
    let releaseProfile!: (value: { success: boolean; data: UserProfile }) => void;
    sendMessage.mockImplementation(async (message) => message.type === 'GET_USER_PROFILE'
      ? new Promise((resolve) => { releaseProfile = resolve; })
      : originalSendMessage(message));
    fireEvent.focus(window);
    fireEvent.change(input, { target: { value: 'synthetic-test-key-never-send' } });
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));
    expect(await screen.findByText('密钥已保存')).toBeInTheDocument();
    expect(await screen.findByText('已保存密钥')).toBeInTheDocument();
    await act(async () => { releaseProfile({ success: true, data: baseProfile }); });
    expect(screen.getByText('已保存密钥')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '清除密钥' })).toBeInTheDocument();
  });

  it('密钥为空时保存按钮禁用，不发送消息', async () => {
    const { sendMessage } = setupChrome();
    render(<JevSettings />);
    const saveButton = await screen.findByRole('button', { name: '保存密钥' });
    expect(saveButton).toBeDisabled();
    expect(sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SET_JEV_API_KEY' })
    );
  });

  it('保存密钥失败：显示固定中文，输入保留', async () => {
    setupChrome({ failTypes: ['SET_JEV_API_KEY'] });
    render(<JevSettings />);
    const input = await screen.findByLabelText('Jev API 密钥');
    fireEvent.change(input, { target: { value: 'super-secret-key-123' } });
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));
    expect(await screen.findByText('密钥保存失败，请稍后重试')).toBeInTheDocument();
    expect(input).toHaveValue('super-secret-key-123');
  });

  it('清除密钥：已配置时可点击，成功后回到未配置状态', async () => {
    const { sendMessage } = setupChrome({
      status: { hasKey: true },
    });
    render(<JevSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '清除密钥' }));
    expect(await screen.findByText('密钥已清除')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'DELETE_JEV_API_KEY' });
    expect(await screen.findByText('未配置密钥')).toBeInTheDocument();
  });

  it('测试连接成功：先申请权限再调用，显示成功文案', async () => {
    const { sendMessage, request } = setupChrome();
    render(<JevSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }));
    expect(await screen.findByText('连接测试成功')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith({ origins: ['https://api.typesafe.ai/*'] });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'TEST_JEV_CONNECTION' });
  });

  it('测试连接失败：显示固定中文，不回显服务端错误细节', async () => {
    setupChrome({ failTypes: ['TEST_JEV_CONNECTION'] });
    render(<JevSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }));
    expect(
      await screen.findByText('连接测试失败，请检查密钥与网络')
    ).toBeInTheDocument();
  });

  it('测试连接时权限被拒：不发送测试消息并显示原因', async () => {
    const { sendMessage } = setupChrome({ permissionsGranted: false });
    render(<JevSettings />);
    fireEvent.click(await screen.findByRole('button', { name: '测试连接' }));
    expect(
      await screen.findByText('未获得所需站点权限，无法测试连接')
    ).toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalledWith({ type: 'TEST_JEV_CONNECTION' });
  });

  it('密钥永不进入页面文本或日志，包括消息异常正文', async () => {
    const secret = 'synthetic-test-key-never-send';
    const loggerSpy = vi.mocked(logger.error);
    const { sendMessage } = setupChrome();
    const originalSendMessage = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation(async (message) => {
      if (message.type === 'SET_JEV_API_KEY') throw new Error(secret);
      return originalSendMessage(message);
    });
    render(<JevSettings />);
    const input = await screen.findByLabelText('Jev API 密钥');
    fireEvent.change(input, { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: '保存密钥' }));
    await screen.findByText('密钥保存失败，请稍后重试');
    expect(document.body.textContent).not.toContain(secret);
    for (const call of loggerSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(secret);
    }
  });
});
