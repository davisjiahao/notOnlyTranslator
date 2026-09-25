import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import MasteryOverview from '@/options/components/MasteryOverview';
import { logger } from '@/shared/utils';
import type { LearningStatistics, MasteryTrend, ReviewReminder, WordMasteryStats } from '@/shared/types/mastery';

vi.mock('@/shared/utils', () => ({ logger: { error: vi.fn() } }));
vi.mock('recharts', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <svg>{children}</svg>;
  const Group = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Plot = () => null;
  return {
    ResponsiveContainer: Container, BarChart: Group, Bar: Group, AreaChart: Group,
    PieChart: Group, Pie: Group, CartesianGrid: Plot, XAxis: Plot,
    YAxis: Plot, Tooltip: Plot, Cell: Plot, Area: Plot,
  };
});

const stats: WordMasteryStats = {
  totalWords: 10, masteredWords: 4, learningWords: 5, strugglingWords: 1, dueForReview: 2,
  levelDistribution: { A1: 4, A2: 0, B1: 6, B2: 0, C1: 0, C2: 0 },
};
const trend: MasteryTrend = {
  last30Days: [{ date: '2026-09-24', masteredCount: 4, learningCount: 5, newWordsCount: 1, estimatedVocabulary: 2400 }],
  masteryChangeRate: 0.12, daysToNextLevel: 20,
};
const learning: LearningStatistics = {
  totalStudyDays: 12, currentStreak: 3, longestStreak: 6, weeklyStudyDays: 3,
  monthlyStudyDays: 12, averageDailyWords: 2, totalStudyMinutes: 30,
  heatmapData: [{ date: '2026-09-19', intensity: 2, count: 3, type: 'new' }], recentActivity: [],
};
const reviewWords: ReviewReminder[] = [
  { word: 'meticulous', translation: '一丝不苟的', context: 'a meticulous plan', masteryLevel: 0.35, daysOverdue: 2 },
  { word: 'resilient', translation: '有韧性', context: '', masteryLevel: 0.7, daysOverdue: 0 },
];

type Message = { type: string; payload?: { days?: number; limit?: number } };
const success = (data: unknown) => ({ success: true, data });
let sendMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sendMessage = vi.fn(async (message: Message) => {
    switch (message.type) {
      case 'GET_CEFR_LEVEL': return success({ level: 'B1', confidence: 0.82, vocabularyEstimate: 2400 });
      case 'GET_MASTERY_OVERVIEW': return success({ stats });
      case 'GET_REVIEW_WORDS': return success(reviewWords);
      case 'GET_MASTERY_TREND': return success(trend);
      case 'GET_LEARNING_STATISTICS': return success(learning);
      default: throw new Error(`Unexpected message: ${message.type}`);
    }
  });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const calls = (type: string) => sendMessage.mock.calls.filter(([message]: [Message]) => message.type === type);

async function load(): Promise<void> {
  render(<MasteryOverview isSaving={false} />);
  await screen.findByText('meticulous');
}

describe('设置页词汇掌握度概览', () => {
  it('首次加载真实后台响应，显示等级、统计、趋势、热力图与待复习单词', async () => {
    let finish!: (responses: { success: boolean; data: unknown }) => void;
    sendMessage.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<MasteryOverview isSaving={false} />);
    expect(screen.getByRole('status', { name: '加载掌握度数据' })).toBeInTheDocument();
    await act(async () => { finish(success({ level: 'B1', confidence: 0.82, vocabularyEstimate: 2400 })); });
    expect(await screen.findByText('meticulous')).toBeInTheDocument();
    expect(screen.getByText('B1 中级')).toBeInTheDocument();
    expect(screen.getByText('2,400')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '掌握度置信度' })).toHaveAttribute('aria-valuenow', '82');
    expect(screen.getByRole('progressbar', { name: 'CEFR 等级：B1 中级' })).toHaveAttribute('aria-valuenow', '3');
    expect(screen.getByText('待复习单词 (2 个)')).toBeInTheDocument();
    expect(screen.getByText('逾期 2 天')).toBeInTheDocument();
    expect(screen.getByText('今日')).toBeInTheDocument();
    expect(screen.getByText('一丝不苟的')).toBeInTheDocument();
    expect(screen.getByText('35%')).toBeInTheDocument();
    expect(screen.getByText('12.0%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /2026-09-19: 3 个单词/ })).toBeInTheDocument();
    expect(calls('GET_REVIEW_WORDS')[0][0]).toEqual({ type: 'GET_REVIEW_WORDS', payload: { limit: 10 } });
    expect(calls('GET_MASTERY_TREND')[0][0].payload).toEqual({ days: 30 });
    expect(calls('GET_LEARNING_STATISTICS')[0][0].payload).toEqual({ days: 30 });
    expect(sendMessage).toHaveBeenCalledTimes(5);
  });

  it('切换时间范围重新查询趋势与学习统计，并更新活跃度', async () => {
    await load();
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    await waitFor(() => expect(calls('GET_MASTERY_TREND')).toHaveLength(2));
    expect(calls('GET_MASTERY_TREND')[1][0].payload).toEqual({ days: 7 });
    expect(calls('GET_LEARNING_STATISTICS')[1][0].payload).toEqual({ days: 7 });
    expect(screen.getByRole('button', { name: '7天' })).toHaveAttribute('aria-pressed', 'true');
    await screen.findByText('7 天学习趋势');
    fireEvent.click(screen.getByRole('button', { name: '90天' }));
    await screen.findByText('90 天学习趋势');
    expect(calls('GET_MASTERY_TREND')[2][0].payload).toEqual({ days: 90 });
    expect(calls('GET_LEARNING_STATISTICS')[2][0].payload).toEqual({ days: 90 });
  });

  it('新范围响应延迟时继续使用旧范围标注既有趋势和学习天数，完成后才切换', async () => {
    await load();
    let finishTrend!: (value: unknown) => void;
    const respond = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation((message: Message) => {
      if (message.type === 'GET_MASTERY_TREND' && message.payload?.days === 7) {
        return new Promise((resolve) => { finishTrend = resolve; });
      }
      return respond(message);
    });
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    await waitFor(() => expect(finishTrend).toBeDefined());
    expect(screen.getByRole('button', { name: '7天' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('30 天学习趋势')).toBeInTheDocument();
    expect(screen.getByText('30天内')).toBeInTheDocument();
    expect(screen.queryByText('7 天学习趋势')).toBeNull();
    expect(screen.queryByText('7天内')).toBeNull();
    await act(async () => { finishTrend(success(trend)); });
    expect(screen.getByText('7 天学习趋势')).toBeInTheDocument();
    expect(screen.getByText('7天内')).toBeInTheDocument();
  });

  it('新范围失败时旧趋势与学习天数仍标原范围，重试成功后更新标注', async () => {
    await load();
    const respond = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation((message: Message) => {
      if (message.type === 'GET_MASTERY_TREND' && message.payload?.days === 7) {
        return Promise.resolve({ success: false, error: '不可用' });
      }
      if (message.type === 'GET_LEARNING_STATISTICS' && message.payload?.days === 7) {
        return Promise.resolve({ success: false, error: '不可用' });
      }
      return respond(message);
    });
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('加载掌握度数据失败');
    expect(screen.getByText('30 天学习趋势')).toBeInTheDocument();
    expect(screen.getByText('30天内')).toBeInTheDocument();
    expect(screen.queryByText('7 天学习趋势')).toBeNull();
    expect(screen.queryByText('7天内')).toBeNull();
    sendMessage.mockImplementation(respond);
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await screen.findByText('7 天学习趋势');
    expect(screen.getByText('7天内')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('新范围成功返回 null 时清除旧趋势与旧学习统计', async () => {
    await load();
    const respond = sendMessage.getMockImplementation()!;
    sendMessage.mockImplementation((message: Message) => {
      if (message.payload?.days === 7) return Promise.resolve(success(null));
      return respond(message);
    });
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    await waitFor(() => expect(screen.queryByText('30 天学习趋势')).toBeNull());
    expect(screen.queryByText('学习热力图')).toBeNull();
    expect(screen.queryByText('30天内')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('旧范围请求晚返回时不得覆盖新范围的等级与趋势', async () => {
    await load();
    let finishOld!: (value: unknown) => void;
    sendMessage.mockImplementation((message: Message) => {
      if (message.type === 'GET_CEFR_LEVEL' && calls('GET_CEFR_LEVEL').length === 2) {
        return new Promise((resolve) => { finishOld = resolve; });
      }
      if (message.type === 'GET_CEFR_LEVEL') return Promise.resolve(success({ level: 'C1', confidence: 0.9, vocabularyEstimate: 9000 }));
      if (message.type === 'GET_MASTERY_TREND') return Promise.resolve(success({ ...trend, masteryChangeRate: -0.25 }));
      if (message.type === 'GET_MASTERY_OVERVIEW') return Promise.resolve(success({ stats }));
      if (message.type === 'GET_REVIEW_WORDS') return Promise.resolve(success(reviewWords));
      return Promise.resolve(success(learning));
    });
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    await waitFor(() => expect(finishOld).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: '90天' }));
    await screen.findByText('C1 高级');
    expect(screen.getByText('-25.0%')).toBeInTheDocument();
    await act(async () => { finishOld(success({ level: 'A1', confidence: 0.1, vocabularyEstimate: 100 })); });
    expect(screen.getByText('C1 高级')).toBeInTheDocument();
    expect(screen.getByText('-25.0%')).toBeInTheDocument();
    expect(screen.getByText('90 天学习趋势')).toBeInTheDocument();
  });

  it('刷新获取最新数据，保存期间禁用刷新', async () => {
    const { rerender } = render(<MasteryOverview isSaving={true} />);
    await screen.findByText('meticulous');
    expect(screen.getByRole('button', { name: '刷新数据' })).toBeDisabled();
    rerender(<MasteryOverview isSaving={false} />);
    sendMessage.mockImplementation(async (message: Message) => {
      if (message.type === 'GET_CEFR_LEVEL') return success({ level: 'C2', confidence: 1, vocabularyEstimate: 12000 });
      if (message.type === 'GET_MASTERY_OVERVIEW') return success({ stats });
      if (message.type === 'GET_REVIEW_WORDS') return success(reviewWords);
      if (message.type === 'GET_MASTERY_TREND') return success(trend);
      return success(learning);
    });
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    expect(await screen.findByText('C2 专家')).toBeInTheDocument();
    expect(calls('GET_CEFR_LEVEL')).toHaveLength(2);
  });

  it('尚无掌握度档案时接受后台成功返回的 null，并展示基于词汇量估算的等级及分布空态', async () => {
    sendMessage.mockImplementation(async (message: Message) => {
      if (message.type === 'GET_CEFR_LEVEL') return success({ level: 'B1', confidence: 0.3, vocabularyEstimate: 3000 });
      if (message.type === 'GET_MASTERY_OVERVIEW') return success({ profile: null, stats: null });
      if (message.type === 'GET_REVIEW_WORDS') return success([]);
      return success(null);
    });
    render(<MasteryOverview isSaving={false} />);
    expect(await screen.findByText('B1 中级')).toBeInTheDocument();
    expect(screen.getByText('暂无等级分布数据')).toBeInTheDocument();
    expect(screen.getByText('暂无掌握度分布数据')).toBeInTheDocument();
    expect(screen.queryByText(/待复习单词 \(/)).toBeNull();
    expect(screen.queryByText('30 天学习趋势')).toBeNull();
    expect(screen.queryByText('学习热力图')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('零数据的统计响应显示 0% 与待复习空态', async () => {
    sendMessage.mockImplementation(async (message: Message) => {
      if (message.type === 'GET_MASTERY_OVERVIEW') return success({ stats: {
        ...stats, totalWords: 0, masteredWords: 0, learningWords: 0, strugglingWords: 0,
        dueForReview: 0, levelDistribution: { A1: 0, A2: 0, B1: 0, B2: 0, C1: 0, C2: 0 },
      } });
      if (message.type === 'GET_CEFR_LEVEL') return success({ level: 'A1', confidence: 0, vocabularyEstimate: 0 });
      if (message.type === 'GET_REVIEW_WORDS') return success([]);
      if (message.type === 'GET_MASTERY_TREND') return success({ ...trend, last30Days: [] });
      return success({ ...learning, heatmapData: [] });
    });
    render(<MasteryOverview isSaving={false} />);
    await screen.findByText('A1 初级');
    expect(screen.getByText('暂无待复习')).toBeInTheDocument();
    expect(screen.getByText('暂无等级分布数据')).toBeInTheDocument();
    expect(screen.getByText('暂无掌握度分布数据')).toBeInTheDocument();
    const group = screen.getByRole('group', { name: '时间范围' });
    expect(within(group).getByRole('button', { name: '30天' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('后台拒绝请求时呈现错误，可刷新恢复，不泄露后台错误详情', async () => {
    sendMessage.mockResolvedValueOnce({ success: false, error: '私有数据库路径' });
    render(<MasteryOverview isSaving={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载掌握度数据失败');
    expect(screen.getByRole('alert')).not.toHaveTextContent('私有数据库路径');
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await screen.findByText('meticulous');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('后台抛错时记录异常并提供可见重试', async () => {
    sendMessage.mockRejectedValueOnce(new Error('network disconnected'));
    render(<MasteryOverview isSaving={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载掌握度数据失败');
    expect(logger.error).toHaveBeenCalledWith('Failed to load mastery data:', expect.any(Error));
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await screen.findByText('meticulous');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
