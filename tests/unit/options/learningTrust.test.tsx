import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatsCharts } from '@/options/components/StatsCharts';
import MasteryCard from '@/popup/components/MasteryCard';
import FlashcardReview from '@/options/components/FlashcardReview';

const word = { word: 'apple', translation: '苹果', context: 'An apple.', masteryLevel: 0.4, daysOverdue: 0 };
const result = { newMasteryLevel: 0.6, newConfidence: 0.5, nextReviewInterval: 2, levelUpgraded: false, newLevel: 'A1' };
function setup(failed = false) {
  const sendMessage = vi.fn(async ({ type }: { type: string }) => {
    if (type === 'GET_REVIEW_WORDS') return { success: true, data: [word] };
    if (type === 'GET_MASTERY_OVERVIEW') return { success: true, data: { profile: null, stats: { totalWords: 15, masteredWords: 12, dueForReview: 2 } } };
    if (type === 'GET_LEARNING_STATISTICS') return { success: true, data: null };
    return failed ? { success: false, error: '保存失败' } : { success: true, data: { masteryResult: result } };
  });
  const create = vi.fn();
  vi.stubGlobal('chrome', { runtime: { sendMessage, getURL: (path: string) => `chrome-extension://test/${path}` }, tabs: { create } });
  return { sendMessage, create };
}
afterEach(() => vi.unstubAllGlobals());

describe('学习数据可信度与评分保护', () => {
  it('英语水平只展示当前值，历史不足时不生成能力/增长图', () => {
    render(<StatsCharts vocabularySize={4500} knownCount={12} unknownCount={3} confidence={0.5} />);
    expect(screen.getByText('已标记认识')).toBeInTheDocument();
    expect(screen.getByText(/尚未记录历史词汇量/)).toBeInTheDocument();
    expect(screen.queryByText('能力模型')).not.toBeInTheDocument();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('popup 读取真实嵌套统计，开始复习直接进入复习页', async () => {
    const { create } = setup();
    render(<MasteryCard />);
    const start = await screen.findByRole('button', { name: '开始复习 (2)' });
    expect(screen.getByText('12')).toBeInTheDocument();
    fireEvent.click(start);
    expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://test/src/options/index.html?tab=review' });
  });

  it('评分确认前可以撤销，保存失败保留题目且不计完成', async () => {
    const { sendMessage } = setup(true);
    render(<FlashcardReview isSaving={false} />);
    fireEvent.click(await screen.findByRole('button', { name: '点击或按空格查看释义' }));
    fireEvent.click(screen.getByRole('button', { name: /5 -/ }));
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'MARK_WORD_KNOWN')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '撤销本题评分' }));
    expect(screen.queryByRole('button', { name: '确认保存评分' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /4 -/ }));
    fireEvent.click(screen.getByRole('button', { name: '确认保存评分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未确认保存');
    expect(screen.getByText('卡片 1 / 1')).toBeInTheDocument();
    expect(screen.queryByText('本轮已结束')).not.toBeInTheDocument();
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'MARK_WORD_KNOWN')).toHaveLength(1);
  });

  it('加载失败不是没有待复习词，重试成功后才显示题目', async () => {
    const { sendMessage } = setup();
    sendMessage.mockResolvedValueOnce({ success: false, error: '离线' });
    render(<FlashcardReview isSaving={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载复习单词失败');
    expect(screen.queryByText('没有需要复习的单词')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重试加载' }));
    await waitFor(() => expect(screen.getByText('卡片 1 / 1')).toBeInTheDocument());
  });
});
