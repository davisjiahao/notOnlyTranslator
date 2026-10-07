import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import MasteryCard from '@/popup/components/MasteryCard';
import type { LearningStatistics, ReviewReminder, WordMasteryStats } from '@/shared/types/mastery';
import { logger } from '@/shared/utils';

const mockSendMessage = vi.fn();
const mockCreateTab = vi.fn();
const mockGetURL = vi.fn((path: string) => `chrome-extension://test-extension/${path}`);

const overview: WordMasteryStats = {
  totalWords: 20,
  masteredWords: 12,
  learningWords: 5,
  strugglingWords: 3,
  dueForReview: 3,
  levelDistribution: { A1: 8, A2: 6, B1: 3, B2: 2, C1: 1, C2: 0 },
};

const reviews: ReviewReminder[] = [
  { word: 'resilient', masteryLevel: 0.4, daysOverdue: 2, context: 'A resilient community.', translation: '有韧性的' },
  { word: 'nuance', masteryLevel: 0.2, daysOverdue: 0, context: 'A subtle nuance.', translation: '' },
  { word: 'serendipity', masteryLevel: 0.5, daysOverdue: -1, context: '', translation: '' },
];

const learning: LearningStatistics = {
  totalStudyDays: 10,
  currentStreak: 7,
  longestStreak: 8,
  weeklyStudyDays: 7,
  monthlyStudyDays: 10,
  averageDailyWords: 5,
  totalStudyMinutes: 100,
  heatmapData: Array.from({ length: 8 }, (_, index) => ({
    date: `2026-09-${20 + index}`,
    intensity: index % 5,
    count: index * 2,
    type: 'mixed' as const,
  })),
  recentActivity: [],
};

type MasteryMessage = 'GET_MASTERY_OVERVIEW' | 'GET_REVIEW_WORDS' | 'GET_LEARNING_STATISTICS';
type ResponseData = WordMasteryStats | ReviewReminder[] | LearningStatistics;
type MasteryResponse = { success: boolean; data?: ResponseData; error?: string };

function respondWith(overrides: Partial<Record<MasteryMessage, MasteryResponse>> = {}) {
  const responses: Record<MasteryMessage, MasteryResponse> = {
    GET_MASTERY_OVERVIEW: { success: true, data: overview },
    GET_REVIEW_WORDS: { success: true, data: reviews },
    GET_LEARNING_STATISTICS: { success: true, data: learning },
    ...overrides,
  };
  mockSendMessage.mockImplementation(async ({ type }: { type: MasteryMessage }) => responses[type]);
}

beforeEach(() => {
  mockSendMessage.mockReset();
  mockCreateTab.mockReset();
  mockGetURL.mockClear();
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: mockSendMessage, getURL: mockGetURL },
    tabs: { create: mockCreateTab },
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('测试禁止访问网络')));
  respondWith();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('MasteryCard', () => {
  it('并行请求掌握度、五个复习词和三十天统计，全部返回前显示加载状态', async () => {
    let resolveReviews!: (value: MasteryResponse) => void;
    mockSendMessage.mockImplementation(({ type }: { type: MasteryMessage }) => {
      if (type === 'GET_REVIEW_WORDS') return new Promise(resolve => { resolveReviews = resolve; });
      return Promise.resolve({ success: true, data: type === 'GET_MASTERY_OVERVIEW' ? overview : learning });
    });
    render(<MasteryCard />);
    expect(screen.getByRole('status', { name: '加载掌握度数据' })).toBeInTheDocument();
    expect(mockSendMessage).toHaveBeenCalledTimes(3);
    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_MASTERY_OVERVIEW' });
    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_REVIEW_WORDS', payload: { limit: 5 } });
    expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_LEARNING_STATISTICS', payload: { days: 30 } });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status')).toBeInTheDocument();

    await act(async () => { resolveReviews({ success: true, data: reviews }); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '词汇掌握度' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '待复习单词：3 个' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('展开复习列表显示翻译、上下文回退和逾期天数，再次点击收起', async () => {
    render(<MasteryCard />);
    const toggle = await screen.findByRole('button', { name: '待复习单词：3 个' });
    expect(screen.queryByText('resilient')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('需要复习的单词')).toBeInTheDocument();
    expect(screen.getByText('resilient')).toBeInTheDocument();
    expect(screen.getByText('有韧性的')).toBeInTheDocument();
    expect(screen.queryByText('A resilient community.')).not.toBeInTheDocument();
    expect(screen.getByText('A subtle nuance.')).toBeInTheDocument();
    expect(screen.getByText('serendipity')).toBeInTheDocument();
    expect(screen.getAllByText(/逾期/)).toHaveLength(1);
    expect(screen.getByText('逾期 2 天')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '开始复习 (3)' })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('需要复习的单词')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始复习 (3)' })).toBeInTheDocument();
  });

  it('开始复习按钮展开待复习内容', async () => {
    render(<MasteryCard />);
    fireEvent.click(await screen.findByRole('button', { name: '开始复习 (3)' }));
    expect(screen.getByRole('button', { name: '待复习单词：3 个' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('resilient')).toBeInTheDocument();
    expect(mockCreateTab).not.toHaveBeenCalled();
  });

  it('热力图仅显示最近七天并区分全部五档强度', async () => {
    render(<MasteryCard />);
    await screen.findByText('近7天学习');
    expect(screen.getAllByRole('img')).toHaveLength(7);
    expect(screen.queryByRole('img', { name: '2026-09-20: 0 个单词' })).not.toBeInTheDocument();
    const colors = ['bg-gray-100', 'bg-green-200', 'bg-green-300', 'bg-green-400', 'bg-green-500'];
    for (const day of learning.heatmapData.slice(-7)) {
      const label = `${day.date}: ${day.count} 个单词`;
      const cell = screen.getByRole('img', { name: label });
      expect(cell).toHaveAttribute('title', label);
      expect(cell).toHaveClass(colors[day.intensity]);
    }
  });

  it.each([
    ['查看全部', 'vocabulary'], ['详情', 'mastery'],
  ])('%s 打开对应扩展选项页 %s', async (label, tab) => {
    render(<MasteryCard />);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    expect(mockGetURL).toHaveBeenCalledExactlyOnceWith(`options.html?tab=${tab}`);
    expect(mockCreateTab).toHaveBeenCalledExactlyOnceWith({
      url: `chrome-extension://test-extension/options.html?tab=${tab}`,
    });
  });

  it('零统计和空数据隐藏复习提醒、列表和热力图', async () => {
    respondWith({
      GET_MASTERY_OVERVIEW: { success: true, data: { ...overview, masteredWords: 0, dueForReview: 0 } },
      GET_REVIEW_WORDS: { success: true, data: [] },
      GET_LEARNING_STATISTICS: { success: true, data: { ...learning, currentStreak: 0, heatmapData: [] } },
    });
    render(<MasteryCard />);
    const toggle = await screen.findByRole('button', { name: '待复习单词：0 个' });
    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /开始复习/ })).not.toBeInTheDocument();
    expect(screen.queryByText('近7天学习')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('需要复习的单词')).not.toBeInTheDocument();
  });

  it('掌握度接口失败仅清空概览，不丢失已返回的复习词和学习统计', async () => {
    respondWith({ GET_MASTERY_OVERVIEW: { success: false, error: '概览读取失败' } });
    render(<MasteryCard />);
    fireEvent.click(await screen.findByRole('button', { name: '待复习单词：0 个' }));
    expect(screen.getByText('resilient')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText('12')).not.toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(7);
  });

  it('复习接口失败保留概览统计，展开后不显示伪造的复习词', async () => {
    respondWith({ GET_REVIEW_WORDS: { success: false, error: '复习列表读取失败' } });
    render(<MasteryCard />);
    fireEvent.click(await screen.findByRole('button', { name: '开始复习 (3)' }));
    expect(screen.getByRole('button', { name: '待复习单词：3 个' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.queryByText('需要复习的单词')).not.toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('近7天学习')).toBeInTheDocument();
  });

  it('学习统计接口失败时连续天数归零且隐藏热力图', async () => {
    respondWith({ GET_LEARNING_STATISTICS: { success: false, error: '统计读取失败' } });
    render(<MasteryCard />);
    await screen.findByRole('heading', { name: '词汇掌握度' });
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('近7天学习')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '详情' })).not.toBeInTheDocument();
  });

  it('全部接口返回失败时仍显示可用的空卡片', async () => {
    mockSendMessage.mockResolvedValue({ success: false });
    render(<MasteryCard />);
    await screen.findByRole('heading', { name: '词汇掌握度' });
    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看全部' })).toBeEnabled();
  });

  it('消息拒绝时结束加载并记录异常，不向用户暴露错误详情', async () => {
    const error = new Error('扩展后台暂时不可用');
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    mockSendMessage.mockRejectedValue(error);
    render(<MasteryCard />);
    await screen.findByRole('heading', { name: '词汇掌握度' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
    expect(logError).toHaveBeenCalledExactlyOnceWith('Failed to load mastery data:', error);
  });
});
