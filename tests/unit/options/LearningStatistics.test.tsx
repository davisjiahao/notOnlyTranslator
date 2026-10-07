import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import LearningStatistics from '@/options/components/LearningStatistics';
import type { LearningStatistics as LearningData, MasteryTrend, WordMasteryStats } from '@/shared/types/mastery';

vi.mock('@/shared/utils', () => ({ logger: { error: vi.fn() } }));
vi.mock('recharts', () => {
  const Chart = ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) => <div data-testid="chart" data-points={JSON.stringify(data)}>{children}</div>;
  const Plot = () => null;
  return { ResponsiveContainer: Chart, AreaChart: Chart, ComposedChart: Chart, LineChart: Chart, Bar: Plot, XAxis: Plot, YAxis: Plot, CartesianGrid: Plot, Tooltip: Plot, Area: Plot, Line: Plot };
});

const stats: WordMasteryStats = { totalWords: 100, masteredWords: 40, learningWords: 50, strugglingWords: 10, dueForReview: 2, levelDistribution: { A1: 4, A2: 3, B1: 6, B2: 0, C1: 0, C2: 0 } };
const trend: MasteryTrend = { last30Days: [{ date: '2026-09-23', masteredCount: 40, learningCount: 50, newWordsCount: 3, estimatedVocabulary: 3500 }], masteryChangeRate: 0.1, daysToNextLevel: 10 };
const learning: LearningData = { totalStudyDays: 10, currentStreak: 3, longestStreak: 7, weeklyStudyDays: 3, monthlyStudyDays: 10, averageDailyWords: 4, totalStudyMinutes: 125, heatmapData: [], recentActivity: [{ date: '2026-09-23', newWords: 3, reviewWords: 2, knownCount: 2, unknownCount: 1, studyMinutes: 25, streakDays: 3 }] };
type Message = { type: string; payload?: { days: number } };
const ok = (data: unknown) => ({ success: true, data });
let sendMessage: ReturnType<typeof vi.fn>;
const respond = (message: Message) => {
  switch (message.type) {
    case 'GET_MASTERY_OVERVIEW': return Promise.resolve(ok({ stats }));
    case 'GET_MASTERY_TREND': return Promise.resolve(ok(trend));
    case 'GET_LEARNING_STATISTICS': return Promise.resolve(ok(learning));
    case 'GET_CEFR_LEVEL': return Promise.resolve(ok({ level: 'B1' }));
    default: throw new Error(`未知消息 ${message.type}`);
  }
};

beforeEach(() => { sendMessage = vi.fn(respond); vi.stubGlobal('chrome', { runtime: { sendMessage } }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const calls = (type: string) => sendMessage.mock.calls.filter(([message]: [Message]) => message.type === type);
async function load() { render(<LearningStatistics isSaving={false} />); await screen.findByText('2026-09-23'); }

describe('学习统计仪表盘', () => {
  it('按真实消息契约加载四类数据，呈现统计卡片、等级与每日记录', async () => {
    render(<LearningStatistics isSaving={false} />);
    expect(screen.getByRole('status', { name: '加载学习统计数据' })).toBeInTheDocument();
    expect(await screen.findByText('2026-09-23')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('2 小时 5 分钟')).toBeInTheDocument();
    expect(screen.getByText('3 天')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'CEFR 等级进度：B1 中级' })).toHaveAttribute('aria-valuenow', '3');
    expect(within(screen.getByRole('row', { name: /2026-09-23/ })).getByText('25 分钟')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(calls('GET_MASTERY_TREND')[0][0].payload).toEqual({ days: 30 });
    expect(calls('GET_LEARNING_STATISTICS')[0][0].payload).toEqual({ days: 30 });
  });

  it('时间筛选重查数据，标签切换显示实际趋势、活动及等级曲线', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    await screen.findByText('词汇量增长趋势（7天）');
    expect(calls('GET_MASTERY_TREND')[1][0].payload).toEqual({ days: 7 });
    expect(calls('GET_LEARNING_STATISTICS')[1][0].payload).toEqual({ days: 7 });
    fireEvent.click(screen.getByRole('tab', { name: '学习活动' }));
    expect(screen.getByText('每日学习活动（7天）')).toBeInTheDocument();
    expect(screen.getAllByTestId('chart')[1]).toHaveAttribute('data-points', expect.stringContaining('"newWords":3'));
    fireEvent.click(screen.getByRole('tab', { name: '等级进度' }));
    expect(screen.getByText('CEFR 等级变化曲线（7天）')).toBeInTheDocument();
    expect(screen.getAllByTestId('chart')[1]).toHaveAttribute('data-points', expect.stringContaining('"levelValue":3'));
  });

  it('后台返回空数据时显示零值、未知等级与图表空状态', async () => {
    sendMessage.mockResolvedValue(ok(null));
    render(<LearningStatistics isSaving={false} />);
    expect(await screen.findByText('暂无词汇趋势数据')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'CEFR 等级进度：未知' })).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('0 分钟')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '学习活动' }));
    expect(screen.getByText('暂无学习活动数据')).toBeInTheDocument();
  });

  it('刷新失败时不误显示旧范围数据为新范围，支持重试', async () => {
    await load();
    sendMessage.mockImplementation((message: Message) => message.payload?.days === 7 ? Promise.resolve({ success: false, error: '服务不可用' }) : respond(message));
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('加载学习统计失败');
    expect(screen.queryByText('2026-09-23')).toBeNull();
    sendMessage.mockImplementation(respond);
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    expect(await screen.findByText('2026-09-23')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('保存进行中禁用刷新，手动刷新重新发起四条请求', async () => {
    const { rerender } = render(<LearningStatistics isSaving={true} />);
    await screen.findByText('2026-09-23');
    expect(screen.getByRole('button', { name: '刷新数据' })).toBeDisabled();
    rerender(<LearningStatistics isSaving={false} />);
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(8));
  });
});
