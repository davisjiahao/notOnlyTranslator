import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LearningStatistics from '@/options/components/LearningStatistics';
import MasteryOverview from '@/options/components/MasteryOverview';

const stats = { totalWords: 3, masteredWords: 1, learningWords: 1, strugglingWords: 1, dueForReview: 2, levelDistribution: { A1: 1, A2: 0, B1: 2, B2: 0, C1: 0, C2: 0 } };
const entries = { apple: { word: 'apple', markedAt: Date.now(), lastReviewAt: Date.now() } };
const respond = async ({ type }: { type: string }) => ({ success: true, data: type === 'GET_MASTERY_OVERVIEW' ? { profile: { wordMastery: entries }, stats } : { estimatedVocabulary: 4500, knownWords: ['one', 'two'], unknownWords: [], levelConfidence: 0.6 } });
let sendMessage: ReturnType<typeof vi.fn>;
beforeEach(() => { sendMessage = vi.fn(respond); vi.stubGlobal('chrome', { runtime: { sendMessage, getURL: (path: string) => `chrome-extension://test/${path}` } }); });
afterEach(() => vi.unstubAllGlobals());

describe.each([['学习统计', LearningStatistics], ['掌握度', MasteryOverview]] as const)('%s 的真实统计', (_name, Component) => {
  it('读取当前快照，不请求倒推趋势或伪学习时长，分清重叠到期集合', async () => {
    render(<Component isSaving={false} />);
    expect(await screen.findByText('跟踪词汇')).toBeInTheDocument();
    expect(screen.getByText('估算已掌握')).toBeInTheDocument();
    expect(screen.getByText(/不是完整学习历史/)).toBeInTheDocument();
    expect(screen.getByText(/到期待复习与上述分类重叠/)).toBeInTheDocument();
    expect(screen.getByText(/尚未记录历史词汇量/)).toBeInTheDocument();
    expect(sendMessage.mock.calls.map(([message]) => message.type).sort()).toEqual(['GET_MASTERY_OVERVIEW', 'GET_USER_PROFILE']);
    expect(screen.queryByText('学习时长')).not.toBeInTheDocument();
    expect(screen.queryByText(/预计.*天/)).not.toBeInTheDocument();
  });
  it('时间筛选仅过滤已有记录，不伪造每天的零值或增长', async () => {
    render(<Component isSaving={false} />);
    await screen.findByText('跟踪词汇');
    fireEvent.click(screen.getByRole('button', { name: '7天' }));
    expect(screen.getByRole('button', { name: '7天' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('table', { name: '可追溯词条记录' })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  it('空掌握度与空历史分别说明，不等同全部掌握', async () => {
    sendMessage.mockImplementation(async message => message.type === 'GET_MASTERY_OVERVIEW' ? { success: true, data: { profile: null, stats: null } } : respond(message));
    render(<Component isSaving={false} />);
    expect(await screen.findByText('暂无掌握度记录')).toBeInTheDocument();
    expect(screen.getByText('所选范围没有可追溯记录')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it.each([false, true])('请求失败不显示成功零值，支持重试；抛错 %s', async reject => {
    sendMessage.mockImplementation(async () => { if (reject) throw new Error('离线'); return { success: false }; });
    render(<Component isSaving={false} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载学习数据失败');
    expect(screen.queryByText('跟踪词汇')).not.toBeInTheDocument();
    sendMessage.mockImplementation(respond);
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    expect(await screen.findByText('跟踪词汇')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('保存期间禁用刷新，刷新失败不把旧数据当成最新', async () => {
    const { rerender } = render(<Component isSaving={true} />);
    await screen.findByText('跟踪词汇');
    expect(screen.getByRole('button', { name: '刷新数据' })).toBeDisabled();
    rerender(<Component isSaving={false} />);
    sendMessage.mockResolvedValue({ success: false });
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.queryByText('跟踪词汇')).not.toBeInTheDocument();
  });
});
