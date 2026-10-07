import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MasteryOverview from '@/options/components/MasteryOverview';

const user = { estimatedVocabulary: 4500, levelConfidence: 0.65, knownWords: ['apple'], unknownWords: [] };
const stats = { totalWords: 10, masteredWords: 5, learningWords: 3, strugglingWords: 2, dueForReview: 7, levelDistribution: { A1: 6, A2: 4, B1: 0, B2: 0, C1: 0, C2: 0 } };
const setup = (response: (type: string) => unknown) => {
  const sendMessage = vi.fn(async ({ type }) => response(type));
  vi.stubGlobal('chrome', { runtime: { sendMessage, getURL: (path: string) => `chrome-extension://test/${path}` } });
  return sendMessage;
};
afterEach(() => vi.unstubAllGlobals());

describe('掌握度入口的快照口径', () => {
  it('按模型阈值展示互斥分类，到期数量单独呈现并直接链接复习', async () => {
    setup(type => ({ success: true, data: type === 'GET_USER_PROFILE' ? user : { profile: null, stats } }));
    render(<MasteryOverview isSaving={false} />);
    expect(await screen.findByRole('heading', { name: '当前词条难度分布' })).toBeInTheDocument();
    const section = screen.getByRole('heading', { name: '当前掌握度' }).closest('section')!;
    expect(within(section).getByText('10')).toBeInTheDocument();
    expect(within(section).getByText('5')).toBeInTheDocument();
    expect(within(section).getByText('3')).toBeInTheDocument();
    expect(within(section).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('到期待复习：7 词')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '开始到期复习' })).toHaveAttribute('href', 'chrome-extension://test/src/options/index.html?tab=review');
    expect(screen.getByText(/CEFR 词汇量参考：B2/)).toBeInTheDocument();
    expect(screen.getByText('6 词')).toBeInTheDocument();
    expect(screen.queryByText(/掌握度变化率/)).not.toBeInTheDocument();
  });
  it('无到期数据引导手动收藏复习，不展示假预测', async () => {
    setup(type => ({ success: true, data: type === 'GET_USER_PROFILE' ? user : { profile: null, stats: null } }));
    render(<MasteryOverview isSaving={false} />);
    expect(await screen.findByRole('link', { name: '前往生词本' })).toHaveAttribute('href', 'chrome-extension://test/src/options/index.html?tab=vocabulary');
    expect(screen.queryByText(/预计达到下一级/)).not.toBeInTheDocument();
  });
  it('卸载后的迟到请求不影响新页面快照；刷新可显示新的统计', async () => {
    let finish!: (response: unknown) => void;
    const pending = new Promise(resolve => { finish = resolve; });
    const send = setup(type => type === 'GET_USER_PROFILE' ? { success: true, data: user } : pending);
    const first = render(<MasteryOverview isSaving={false} />);
    first.unmount();
    send.mockImplementation(async ({ type }) => ({ success: true, data: type === 'GET_USER_PROFILE' ? user : { profile: null, stats } }));
    render(<MasteryOverview isSaving={false} />);
    await screen.findByText('跟踪词汇');
    await act(async () => finish({ success: false }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    send.mockImplementation(async ({ type }) => ({ success: true, data: type === 'GET_USER_PROFILE' ? user : { profile: null, stats: { ...stats, dueForReview: 0 } } }));
    fireEvent.click(screen.getByRole('button', { name: '刷新数据' }));
    expect(await screen.findByText('到期待复习：0 词')).toBeInTheDocument();
  });
});
