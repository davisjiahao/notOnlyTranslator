import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import MasteryCard from '@/popup/components/MasteryCard';
import type { MessageResponse } from '@/shared/types';
import type { ReviewReminder, WordMasteryStats } from '@/shared/types/mastery';
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

type MasteryMessage = 'GET_MASTERY_OVERVIEW' | 'GET_REVIEW_WORDS';

function respondWith(overrides: Partial<Record<MasteryMessage, MessageResponse>> = {}) {
  const responses: Record<MasteryMessage, MessageResponse> = {
    GET_MASTERY_OVERVIEW: { success: true, data: { profile: null, stats: overview } },
    GET_REVIEW_WORDS: { success: true, data: reviews },
    ...overrides,
  };
  mockSendMessage.mockImplementation(async ({ type }: { type: MasteryMessage }) => responses[type]);
  return responses;
}

beforeEach(() => {
  mockSendMessage.mockReset();
  mockCreateTab.mockReset().mockResolvedValue(undefined);
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
  it.each(['GET_MASTERY_OVERVIEW', 'GET_REVIEW_WORDS'] as const)(
    '并行请求嵌套概览与五个复习词，%s 返回前保持加载状态', async delayedType => {
      const responses = respondWith();
      let resolveDelayed!: (value: MessageResponse) => void;
      mockSendMessage.mockImplementation(({ type }: { type: MasteryMessage }) => type === delayedType
        ? new Promise(resolve => { resolveDelayed = resolve; })
        : Promise.resolve(responses[type]));
      render(<MasteryCard />);
      expect(screen.getByRole('status', { name: '加载掌握度数据' })).toBeInTheDocument();
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_MASTERY_OVERVIEW' });
      expect(mockSendMessage).toHaveBeenCalledWith({ type: 'GET_REVIEW_WORDS', payload: { limit: 5 } });
      await act(async () => { await Promise.resolve(); });
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByText('12')).not.toBeInTheDocument();

      await act(async () => { resolveDelayed(responses[delayedType]); });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('heading', { name: '词汇掌握度估算' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '待复习单词：3 个' })).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('20')).toBeInTheDocument();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it('展开复习列表显示翻译、上下文回退和逾期天数，再次点击收起', async () => {
    render(<MasteryCard />);
    const toggle = await screen.findByRole('button', { name: '待复习单词：3 个' });
    expect(screen.queryByText('resilient')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const words = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(words).toHaveLength(3);
    expect(words[0]).toHaveTextContent('resilient · 有韧性的（逾期 2 天）');
    expect(words[0]).not.toHaveTextContent('A resilient community.');
    expect(words[1]).toHaveTextContent('nuance · A subtle nuance.');
    expect(words[2]).toHaveTextContent('serendipity');
    expect(words.filter(word => word.textContent?.includes('逾期'))).toHaveLength(1);
    expect(screen.getByRole('button', { name: '开始复习 (3)' })).toBeEnabled();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('resilient')).not.toBeInTheDocument();
  });

  it('开始复习直接打开复习页，不把展开预览伪装成开始复习', async () => {
    render(<MasteryCard />);
    fireEvent.click(await screen.findByRole('button', { name: '开始复习 (3)' }));
    expect(screen.getByRole('button', { name: '待复习单词：3 个' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(mockGetURL).toHaveBeenCalledExactlyOnceWith('src/options/index.html');
    expect(mockCreateTab).toHaveBeenCalledExactlyOnceWith({
      url: 'chrome-extension://test-extension/src/options/index.html?tab=review',
    });
  });

  it('仅展示掌握度快照及解释，不请求学习统计或推算连续天数与热力图', async () => {
    render(<MasteryCard />);
    await screen.findByRole('heading', { name: '词汇掌握度估算' });
    expect(screen.getByText('估算已掌握：标记与复习模型的掌握度 ≥ 80%，不等同于已标记认识。')).toBeInTheDocument();
    expect(screen.getByText('跟踪词汇')).toBeInTheDocument();
    expect(mockSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'GET_LEARNING_STATISTICS' }));
    expect(screen.queryByText('近7天学习')).not.toBeInTheDocument();
    expect(screen.queryByText(/连续.*天/)).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it.each([
    ['查看全部', 'vocabulary'], ['详情', 'mastery'],
  ])('%s 通过统一扩展入口打开对应选项页 %s', async (label, tab) => {
    render(<MasteryCard />);
    fireEvent.click(await screen.findByRole('button', { name: label }));
    expect(mockGetURL).toHaveBeenCalledExactlyOnceWith('src/options/index.html');
    expect(mockCreateTab).toHaveBeenCalledExactlyOnceWith({
      url: `chrome-extension://test-extension/src/options/index.html?tab=${tab}`,
    });
  });

  it.each([null, { ...overview, totalWords: 0, masteredWords: 0, dueForReview: 0 }])(
    '成功读取空档案或零统计 %j 时才显示零数量和手动复习指引', async stats => {
      respondWith({
        GET_MASTERY_OVERVIEW: { success: true, data: { profile: null, stats } },
        GET_REVIEW_WORDS: { success: true, data: [] },
      });
      render(<MasteryCard />);
      const toggle = await screen.findByRole('button', { name: '待复习单词：0 个' });
      expect(screen.getAllByText('0')).toHaveLength(3);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /开始复习/ })).not.toBeInTheDocument();
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('暂无到期待复习词，可从生词本手动开始。')).toBeInTheDocument();
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    },
  );

  it.each(['GET_MASTERY_OVERVIEW', 'GET_REVIEW_WORDS'] as const)(
    '%s 失败时不把部分响应伪装为零数量，重试成功后恢复完整快照', async failedType => {
      respondWith({ [failedType]: { success: false, error: '后台内部错误详情' } });
      render(<MasteryCard />);
      expect(await screen.findByRole('alert')).toHaveTextContent('掌握度加载失败，无法确认当前数量。');
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /待复习单词/ })).not.toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
      expect(screen.queryByText('12')).not.toBeInTheDocument();
      expect(screen.queryByText('resilient')).not.toBeInTheDocument();
      expect(screen.queryByText('后台内部错误详情')).not.toBeInTheDocument();

      respondWith();
      fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
      await screen.findByRole('button', { name: '待复习单词：3 个' });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(mockSendMessage).toHaveBeenCalledTimes(4);
      fireEvent.click(screen.getByRole('button', { name: '待复习单词：3 个' }));
      expect(screen.getByText('resilient')).toBeInTheDocument();
    },
  );

  it.each([
    ['GET_MASTERY_OVERVIEW', undefined], ['GET_REVIEW_WORDS', null], ['GET_REVIEW_WORDS', {}],
  ] as const)('%s 成功响应缺少合法数据 %j 时不能显示空成功状态', async (type, data) => {
    respondWith({ [type]: { success: true, data } });
    render(<MasteryCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法确认当前数量');
    expect(screen.queryByRole('button', { name: /待复习单词/ })).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试加载' })).toBeEnabled();
  });

  it('全部接口失败时明确提示未知数量，仍可导航到生词本或详情', async () => {
    mockSendMessage.mockResolvedValue({ success: false });
    render(<MasteryCard />);
    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: '词汇掌握度估算' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看全部' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '详情' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(mockCreateTab).toHaveBeenCalledWith({
      url: 'chrome-extension://test-extension/src/options/index.html?tab=mastery',
    });
  });

  it('消息拒绝时结束加载并记录异常，不向用户暴露错误详情或假装空记录', async () => {
    const error = new Error('扩展后台暂时不可用');
    const logError = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    mockSendMessage.mockRejectedValue(error);
    render(<MasteryCard />);
    expect(await screen.findByRole('alert')).toHaveTextContent('无法确认当前数量');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
    expect(logError).toHaveBeenCalledExactlyOnceWith('加载掌握度概览失败', error);
    expect(screen.getByRole('button', { name: '重试加载' })).toBeEnabled();
  });
});
