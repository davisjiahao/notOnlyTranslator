import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CostDashboard from '@/options/components/CostDashboard';
import { getCostDashboardData, getCostTracker } from '@/shared/cost/tracker';
import { logger } from '@/shared/utils';
import userEvent from '@testing-library/user-event';
import { DEFAULT_COST_TRACKER_CONFIG } from '@/shared/cost/types';
import type { CostDashboardData, CostWarning } from '@/shared/cost/types';

vi.mock('@/shared/cost/tracker', () => ({
  getCostTracker: vi.fn(),
  getCostDashboardData: vi.fn(),
}));
vi.mock('@/shared/utils', () => ({ logger: { error: vi.fn() } }));

const warning: CostWarning = {
  id: 'warning-1',
  type: 'budget_warning',
  message: '本月预算即将用尽',
  timestamp: 1,
  acknowledged: false,
};

const dashboard: CostDashboardData = {
  generatedAt: 1,
  periodDays: 30,
  summary: {
    totalCost: 1.25,
    llmCost: 1,
    translationCost: 0.25,
    totalInputTokens: 1200,
    totalOutputTokens: 300,
    totalCharacters: 100,
    successRequests: 9,
    failedRequests: 1,
    periodStart: 0,
    periodEnd: 1,
  },
  budget: {
    monthlyBudget: 10,
    used: 1.25,
    remaining: 8.75,
    usagePercent: 12.5,
    isOverBudget: false,
    projectedEndOfMonth: 5,
  },
  providerDetails: [{
    provider: 'openai',
    displayName: 'OpenAI',
    category: 'llm',
    totalCost: 1.25,
    requestCount: 10,
    successCount: 9,
    avgCostPerRequest: 0.125,
    totalInputTokens: 1200,
    totalOutputTokens: 300,
  }],
  costTrend: [{ date: '2026-09-01', cost: 1.25, requestCount: 10 }],
  topExpensiveRequests: [{ provider: 'OpenAI', cost: 0.5, timestamp: 1, details: '一次请求' }],
};

const tracker = {
  getConfig: vi.fn(() => ({ monthlyBudget: 10 })),
  addListener: vi.fn((_listener: () => void) => vi.fn()),
  getActiveWarnings: vi.fn((): CostWarning[] => [warning]),
  updateConfig: vi.fn(),
  acknowledgeWarning: vi.fn(),
  clear: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', {
    storage: {
      sync: { get: vi.fn().mockImplementation(() => new Promise(() => {})), set: vi.fn().mockResolvedValue(undefined) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });
  tracker.updateConfig.mockImplementation(() => tracker.addListener.mock.calls.at(-1)?.[0]());
  tracker.acknowledgeWarning.mockImplementation(() => tracker.addListener.mock.calls.at(-1)?.[0]());
  tracker.clear.mockImplementation(() => tracker.addListener.mock.calls.at(-1)?.[0]());
  tracker.getConfig.mockReturnValue({ monthlyBudget: 10 });
  tracker.getActiveWarnings.mockReturnValue([warning]);
  vi.mocked(getCostTracker).mockReturnValue(tracker as unknown as ReturnType<typeof getCostTracker>);
  vi.mocked(getCostDashboardData).mockReturnValue(dashboard);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function allowBudgetRestore() {
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({});
}

async function waitForBudgetReady() {
  await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeEnabled());
}

describe('成本监控面板', () => {
  it('加载后展示汇总、预算、提供商、趋势和高成本请求，并在卸载时取消监听', () => {
    const unsubscribe = vi.fn();
    tracker.addListener.mockReturnValue(unsubscribe);
    const { unmount } = render(<CostDashboard />);

    expect(getCostDashboardData).toHaveBeenCalledWith(30);
    expect(screen.getByRole('heading', { name: '成本监控' })).toBeInTheDocument();
    expect(screen.getAllByText('$1.2500')).toHaveLength(2);
    expect(screen.getByText('12.5%')).toBeInTheDocument();
    expect(screen.getByText('1.5K')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /月度预算使用/ })).toHaveAttribute('aria-valuenow', '1.25');
    expect(screen.getByRole('cell', { name: 'OpenAI' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '成本趋势' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '高成本请求' })).toBeInTheDocument();
    expect(tracker.addListener).toHaveBeenCalledTimes(1);

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('切换时间范围重新获取对应天数的数据', () => {
    render(<CostDashboard />);
    fireEvent.change(screen.getByRole('combobox', { name: '时间范围' }), { target: { value: '7' } });
    expect(getCostDashboardData).toHaveBeenLastCalledWith(7);
    expect(tracker.addListener).toHaveBeenCalledTimes(2);
  });

  it('收到追踪器更新时刷新面板数据', () => {
    render(<CostDashboard />);
    vi.mocked(getCostDashboardData).mockReturnValue({
      ...dashboard,
      summary: { ...dashboard.summary, totalCost: 3 },
    });
    const listener = tracker.addListener.mock.calls[0][0];
    act(() => listener());
    expect(screen.getByText('$3.0000')).toBeInTheDocument();
  });

  it('加载失败时记录错误并显示空态，不呈现错误数据', () => {
    const error = new Error('读取失败');
    vi.mocked(getCostDashboardData).mockImplementation(() => { throw error; });
    render(<CostDashboard />);
    expect(logger.error).toHaveBeenCalledWith('加载成本数据失败:', error);
    expect(screen.getByRole('status')).toHaveTextContent('暂无成本数据');
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument();
  });

  it('加载失败时仍可切换时间范围恢复数据', () => {
    vi.mocked(getCostDashboardData).mockImplementationOnce(() => { throw new Error('暂时不可用'); });
    render(<CostDashboard />);
    expect(screen.getByRole('status')).toHaveTextContent('暂无成本数据');
    fireEvent.change(screen.getByRole('combobox', { name: '时间范围' }), { target: { value: '7' } });
    expect(getCostDashboardData).toHaveBeenLastCalledWith(7);
    expect(screen.getByText('12.5%')).toBeInTheDocument();
  });

  it('加载失败后可在原时间范围手动重试', () => {
    vi.mocked(getCostDashboardData).mockImplementationOnce(() => { throw new Error('暂时不可用'); });
    render(<CostDashboard />);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(getCostDashboardData).toHaveBeenCalledTimes(2);
    expect(screen.getByText('12.5%')).toBeInTheDocument();
  });

  it('切换时间范围加载失败时不继续显示上一个时间范围的成本', () => {
    render(<CostDashboard />);
    expect(screen.getAllByText('$1.2500')).toHaveLength(2);
    const error = new Error('读取失败');
    vi.mocked(getCostDashboardData).mockImplementation(() => { throw error; });
    fireEvent.change(screen.getByRole('combobox', { name: '时间范围' }), { target: { value: '7' } });
    expect(logger.error).toHaveBeenCalledWith('加载成本数据失败:', error);
    expect(screen.getByRole('status')).toHaveTextContent('暂无成本数据');
    expect(screen.queryByText('$1.2500')).not.toBeInTheDocument();
  });

  it('成功加载零记录时展示提供商空态，不展示警告、趋势及高成本列表', () => {
    vi.mocked(getCostDashboardData).mockReturnValue({
      ...dashboard,
      summary: { ...dashboard.summary, totalCost: 0 },
      providerDetails: [],
      costTrend: [{ date: '2026-09-01', cost: 0, requestCount: 0 }],
      topExpensiveRequests: [],
    });
    render(<CostDashboard />);
    expect(screen.getByText('暂无使用记录')).toBeInTheDocument();
    expect(screen.queryByText(warning.message)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '成本趋势' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '高成本请求' })).not.toBeInTheDocument();
    expect(tracker.getActiveWarnings).not.toHaveBeenCalled();
  });

  it('预算读取未完成时禁止编辑与保存，迟到的存储值不会覆盖输入草稿', async () => {
    const pending = deferred<Record<string, number>>();
    vi.mocked(chrome.storage.sync.get).mockReturnValueOnce(pending.promise);
    render(<CostDashboard />);
    const input = screen.getByRole('spinbutton', { name: '月度预算金额' });
    const save = screen.getByRole('button', { name: '保存' });
    expect(input).toBeDisabled();
    expect(save).toBeDisabled();
    await userEvent.setup().type(input, '77');
    expect(input).toHaveValue(10);
    fireEvent.click(save);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ costDashboardMonthlyBudget: 40 }));
    expect(input).toBeEnabled();
    expect(save).toBeEnabled();
    expect(input).toHaveValue(40);
    fireEvent.change(input, { target: { value: '55' } });
    expect(input).toHaveValue(55);
  });

  it('读取预算失败时只能重试读取，恢复已有预算后才允许编辑保存', async () => {
    vi.mocked(chrome.storage.sync.get).mockRejectedValueOnce(new Error('暂时失败'))
      .mockResolvedValueOnce({ costDashboardMonthlyBudget: 40 });
    render(<CostDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('读取预算失败');
    const input = screen.getByRole('spinbutton', { name: '月度预算金额' });
    const save = screen.getByRole('button', { name: '保存' });
    expect(input).toBeDisabled();
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /重置损坏预算/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新读取预算' }));
    await waitFor(() => expect(input).toHaveValue(40));
    expect(input).toBeEnabled();
    expect(save).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('存储的预算数据损坏时拒绝默认值覆盖，并可重新读取', async () => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValueOnce({ costDashboardMonthlyBudget: -1 })
      .mockResolvedValueOnce({ costDashboardMonthlyBudget: 40 });
    render(<CostDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('预算数据无效');
    expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重新读取预算' }));
    await waitForBudgetReady();
    expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toHaveValue(40);
  });

  it('预算存储持续损坏时允许明确重置默认值并恢复编辑', async () => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({ costDashboardMonthlyBudget: '损坏' });
    render(<CostDashboard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('预算数据无效');
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /重置损坏预算/ }));
    await waitForBudgetReady();
    expect(chrome.storage.sync.set).toHaveBeenCalledWith({
      costDashboardMonthlyBudget: DEFAULT_COST_TRACKER_CONFIG.monthlyBudget,
    });
    expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toHaveValue(DEFAULT_COST_TRACKER_CONFIG.monthlyBudget);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('保存失败后追踪器通知仍保留待保存金额，重试不覆盖旧预算', async () => {
    allowBudgetRestore();
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('写入失败'));
    render(<CostDashboard />);
    await waitForBudgetReady();
    const input = screen.getByRole('spinbutton', { name: '月度预算金额' });
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('预算保存失败');
    act(() => tracker.addListener.mock.calls[0][0]());
    expect(input).toHaveValue(25);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(chrome.storage.sync.set).toHaveBeenLastCalledWith({ costDashboardMonthlyBudget: 25 }));
    expect(tracker.updateConfig).toHaveBeenCalledWith({ monthlyBudget: 25 });
  });

  it('并发点击预算保存只发出一次写入，完成后新预算不会被旧写入覆盖', async () => {
    const firstWrite = deferred<void>();
    let persisted = 10;
    vi.mocked(chrome.storage.sync.set)
      .mockImplementationOnce(async (value) => {
        await firstWrite.promise;
        persisted = value.costDashboardMonthlyBudget as number;
      })
      .mockImplementation(async (value) => { persisted = value.costDashboardMonthlyBudget as number; });
    vi.mocked(chrome.storage.sync.get).mockImplementation(async () => ({ costDashboardMonthlyBudget: persisted }));
    render(<CostDashboard />);
    await waitForBudgetReady();
    const input = screen.getByRole('spinbutton', { name: '月度预算金额' });
    const save = screen.getByRole('button', { name: '保存' });
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.click(save);
    expect(input).toBeDisabled();
    expect(save).toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1));
    await act(async () => firstWrite.resolve());
    expect(save).toBeEnabled();
    fireEvent.change(input, { target: { value: '40' } });
    fireEvent.click(save);
    await waitFor(() => expect(persisted).toBe(40));
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(2);
  });

  it('其他选项页更新预算时，未编辑表单同步新值并在卸载时移除监听', async () => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValueOnce({ costDashboardMonthlyBudget: 10 });
    const { unmount } = render(<CostDashboard />);
    await waitForBudgetReady();
    const onChange = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
    act(() => onChange({ costDashboardMonthlyBudget: { oldValue: 10, newValue: 25 } }, 'local'));
    expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toHaveValue(10);
    act(() => onChange({ costDashboardMonthlyBudget: { oldValue: 10, newValue: 25 } }, 'sync'));
    expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toHaveValue(25);
    expect(tracker.updateConfig).toHaveBeenCalledWith({ monthlyBudget: 25 });
    unmount();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(onChange);
  });

  it('外部预算更新晚于初始读取请求时忽略迟到的旧读取结果', async () => {
    const pending = deferred<Record<string, number>>();
    vi.mocked(chrome.storage.sync.get).mockReturnValueOnce(pending.promise);
    render(<CostDashboard />);
    const onChange = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
    act(() => onChange({ costDashboardMonthlyBudget: { oldValue: 10, newValue: 25 } }, 'sync'));
    expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toHaveValue(25);
    await act(async () => pending.resolve({ costDashboardMonthlyBudget: 10 }));
    expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toHaveValue(25);
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled();
  });

  it('已有草稿不被外部通知覆盖，保存前识别过期预算并要求刷新', async () => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValueOnce({ costDashboardMonthlyBudget: 10 })
      .mockResolvedValue({ costDashboardMonthlyBudget: 25 });
    render(<CostDashboard />);
    await waitForBudgetReady();
    const input = screen.getByRole('spinbutton', { name: '月度预算金额' });
    fireEvent.change(input, { target: { value: '11' } });
    const onChange = vi.mocked(chrome.storage.onChanged.addListener).mock.calls[0][0];
    act(() => onChange({ costDashboardMonthlyBudget: { oldValue: 10, newValue: 25 } }, 'sync'));
    expect(input).toHaveValue(11);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('预算已在其他页面更新');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '刷新预算' }));
    await waitFor(() => expect(input).toHaveValue(25));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '26' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(chrome.storage.sync.set).toHaveBeenCalledWith({ costDashboardMonthlyBudget: 26 }));
  });

  it('即使外部存储通知未送达，保存前也拒绝用旧预算覆盖新值', async () => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValueOnce({ costDashboardMonthlyBudget: 10 })
      .mockResolvedValue({ costDashboardMonthlyBudget: 25 });
    render(<CostDashboard />);
    await waitForBudgetReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: '月度预算金额' }), { target: { value: '11' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('预算已在其他页面更新');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(tracker.updateConfig).not.toHaveBeenCalled();
  });

  it('保存预算后重新创建追踪器仍从扩展存储恢复配置', async () => {
    const { CostTracker } = await vi.importActual<typeof import('@/shared/cost/tracker')>('@/shared/cost/tracker');
    let stored: Record<string, number> = {};
    vi.stubGlobal('chrome', {
      storage: {
        sync: {
          get: vi.fn(async () => ({ ...stored })),
          set: vi.fn(async (value: Record<string, number>) => { stored = { ...stored, ...value }; }),
        },
        onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    });
    const first = new CostTracker();
    vi.mocked(getCostTracker).mockReturnValue(first);
    vi.mocked(getCostDashboardData).mockImplementation(days => vi.mocked(getCostTracker)().getDashboardData(days));
    const { unmount } = render(<CostDashboard />);
    await waitForBudgetReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: '月度预算金额' }), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(first.getConfig().monthlyBudget).toBe(25));
    unmount();

    const second = new CostTracker();
    vi.mocked(getCostTracker).mockReturnValue(second);
    render(<CostDashboard />);
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: '月度预算金额' })).toHaveValue(25));
    expect(second.getConfig().monthlyBudget).toBe(25);
  });

  it('扩展存储写入失败时不假装预算已保存，并允许重试', async () => {
    vi.mocked(chrome.storage.sync.set).mockRejectedValueOnce(new Error('存储不可用'));
    allowBudgetRestore();
    render(<CostDashboard />);
    await waitForBudgetReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: '月度预算金额' }), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('预算保存失败');
    expect(tracker.updateConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(tracker.updateConfig).toHaveBeenCalledWith({ monthlyBudget: 25 }));
  });

  it('无效的负数预算不写入扩展存储或追踪器', async () => {
    allowBudgetRestore();
    render(<CostDashboard />);
    await waitForBudgetReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: '月度预算金额' }), { target: { value: '-1' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的月度预算');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(tracker.updateConfig).not.toHaveBeenCalled();
  });

  it('已保存预算与现有配置相同不触发多余刷新', async () => {
    vi.mocked(chrome.storage.sync.get).mockResolvedValueOnce({ costDashboardMonthlyBudget: 10 });
    render(<CostDashboard />);
    await act(async () => {});
    expect(tracker.updateConfig).not.toHaveBeenCalled();
    expect(getCostDashboardData).toHaveBeenCalledTimes(1);
  });

  it('同步通知后保存预算仅刷新一次，不额外重复加载', async () => {
    allowBudgetRestore();
    render(<CostDashboard />);
    await waitForBudgetReady();
    fireEvent.change(screen.getByRole('spinbutton', { name: '月度预算金额' }), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(tracker.updateConfig).toHaveBeenCalledWith({ monthlyBudget: 25 }));
    expect(getCostDashboardData).toHaveBeenCalledTimes(2);
  });

  it('修改月度预算只在保存时提交并刷新数据', async () => {
    allowBudgetRestore();
    render(<CostDashboard />);
    await waitForBudgetReady();
    const input = screen.getByRole('spinbutton', { name: '月度预算金额' });
    expect(input).toHaveValue(10);
    fireEvent.change(input, { target: { value: '25' } });
    expect(tracker.updateConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(tracker.updateConfig).toHaveBeenCalledWith({ monthlyBudget: 25 }));
    expect(getCostDashboardData).toHaveBeenCalledTimes(2);
  });

  it('预算为零时展示未设置状态和允许保存零预算', async () => {
    allowBudgetRestore();
    tracker.getConfig.mockReturnValue({ monthlyBudget: 0 });
    vi.mocked(getCostDashboardData).mockReturnValue({
      ...dashboard,
      budget: { ...dashboard.budget, monthlyBudget: 0, usagePercent: 0 },
    });
    render(<CostDashboard />);
    await waitForBudgetReady();
    expect(screen.getByText('未设置')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(tracker.updateConfig).toHaveBeenCalledWith({ monthlyBudget: 0 }));
  });

  it('仅对有成本的活跃警告显示确认操作，确认后刷新', () => {
    render(<CostDashboard />);
    expect(screen.getByText(warning.message)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(tracker.acknowledgeWarning).toHaveBeenCalledExactlyOnceWith(warning.id);
    expect(getCostDashboardData).toHaveBeenCalledTimes(2);
  });

  it('没有活跃警告时不显示警告操作', () => {
    tracker.getActiveWarnings.mockReturnValue([]);
    render(<CostDashboard />);
    expect(screen.queryByRole('button', { name: '知道了' })).not.toBeInTheDocument();
  });

  it('超预算时显示超额警告、预计支出和百万级使用量', () => {
    tracker.getActiveWarnings.mockReturnValue([{ ...warning, type: 'budget_exceeded' }]);
    vi.mocked(getCostDashboardData).mockReturnValue({
      ...dashboard,
      summary: { ...dashboard.summary, totalInputTokens: 1_200_000, totalOutputTokens: 300_000 },
      budget: { ...dashboard.budget, used: 11, usagePercent: 110, isOverBudget: true, projectedEndOfMonth: 20 },
    });
    render(<CostDashboard />);
    expect(screen.getByText('110.0%')).toBeInTheDocument();
    expect(screen.getByText('1.5M')).toBeInTheDocument();
    expect(screen.getByText('按当前使用率，预计月底支出 $20.00')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: /月度预算使用/ })).toHaveAttribute('aria-valuenow', '11');
    expect(screen.getByRole('button', { name: '知道了' })).toBeInTheDocument();
  });

  it('预算接近阈值时仍显示使用进度及预计支出', () => {
    vi.mocked(getCostDashboardData).mockReturnValue({
      ...dashboard,
      budget: { ...dashboard.budget, used: 8.5, usagePercent: 85, projectedEndOfMonth: 15 },
    });
    render(<CostDashboard />);
    expect(screen.getByText('85.0%')).toBeInTheDocument();
    expect(screen.getByText('按当前使用率，预计月底支出 $15.00')).toBeInTheDocument();
  });

  it('极低金额和无请求提供商仍展示可读的成本及使用量', () => {
    tracker.getActiveWarnings.mockReturnValue([{ ...warning, type: 'high_cost_request' }]);
    vi.mocked(getCostDashboardData).mockReturnValue({
      ...dashboard,
      summary: { ...dashboard.summary, totalCost: 0.005, llmCost: 0.005, translationCost: 0 },
      providerDetails: [
        { ...dashboard.providerDetails[0], requestCount: 0, successCount: 0, totalCost: 0 },
        {
          provider: 'deepl', displayName: 'DeepL', category: 'translation', totalCost: 0.005,
          requestCount: 2, successCount: 2, avgCostPerRequest: 0.0025, totalCharacters: 2345,
        },
      ],
      topExpensiveRequests: [{ ...dashboard.topExpensiveRequests[0], cost: 0.005 }],
    });
    render(<CostDashboard />);
    expect(screen.getAllByText('$0.5000¢').length).toBeGreaterThan(1);
    expect(screen.getByRole('cell', { name: 'DeepL' })).toBeInTheDocument();
    expect(screen.getByText('2,345 字符')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'OpenAI' })).toBeInTheDocument();
  });

  it('清空记录前展示不可恢复提示，取消不删除数据', () => {
    render(<CostDashboard />);
    fireEvent.click(screen.getByRole('button', { name: '清空所有记录' }));
    expect(screen.getByRole('alert')).toHaveTextContent('此操作不可恢复');
    expect(tracker.clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(tracker.clear).not.toHaveBeenCalled();
  });

  it('确认清空后删除记录并关闭确认提示', () => {
    render(<CostDashboard />);
    fireEvent.click(screen.getByRole('button', { name: '清空所有记录' }));
    expect(tracker.clear).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    expect(tracker.clear).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(getCostDashboardData).toHaveBeenCalledTimes(2);
  });
});
