import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlashcardReview from '@/options/components/FlashcardReview';

const words = [
  { word: 'serendipity', translation: '意外发现', context: 'A discovery.', masteryLevel: 0.6, daysOverdue: 0 },
  { word: 'ephemeral', translation: '短暂的', context: 'Fashions are ephemeral.', masteryLevel: 0.4, daysOverdue: 2 },
];
const result = { newMasteryLevel: 0.75, newConfidence: 0.8, nextReviewInterval: 3, levelUpgraded: false, newLevel: 'B2' };
let sendMessage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sendMessage = vi.fn(async ({ type }) => ({ success: true, data: type === 'GET_REVIEW_WORDS' ? words : { masteryResult: result } }));
  vi.stubGlobal('chrome', { runtime: { sendMessage, getURL: (path: string) => `chrome-extension://test/${path}` } });
});
afterEach(() => vi.unstubAllGlobals());
const mutations = () => sendMessage.mock.calls.filter(([message]) => message.type === 'MARK_WORD_KNOWN');
async function flip() { fireEvent.click(await screen.findByRole('button', { name: '点击或按空格查看释义' })); }
async function score(value = 5) {
  await flip();
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${value} -`) }));
  fireEvent.click(screen.getByRole('button', { name: '确认保存评分' }));
  await screen.findByText(/评分已保存/);
}

describe('闪卡复习的确认与保存生命周期', () => {
  it('待加载、空队列与读取失败是不同状态', async () => {
    let release!: (value: unknown) => void;
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    render(<FlashcardReview isSaving={false} />);
    expect(screen.getByRole('status')).toHaveTextContent('加载复习单词');
    await act(async () => release({ success: true, data: [] }));
    expect(screen.getByText('没有需要复习的单词')).toBeInTheDocument();
    expect(screen.getByText(/不代表全部词汇已掌握/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /确认保存/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重新检查' }));
    expect(await screen.findByText('卡片 1 / 2')).toBeInTheDocument();
  });
  it('卡片背面释义在揭示前不暴露给辅助技术，Enter 或空格可揭示', async () => {
    render(<FlashcardReview isSaving={false} />);
    const card = await screen.findByRole('button', { name: '点击或按空格查看释义' });
    expect(card).toHaveFocus();
    expect(screen.queryByText('意外发现')).not.toBeInTheDocument();
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(screen.getByText('意外发现')).toBeInTheDocument();
    expect(screen.getByText('A discovery.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  });
  it.each([1, 2, 3, 4, 5])('自评 %s 只有确认后才调用原有标词协议', async rating => {
    render(<FlashcardReview isSaving={false} />);
    await flip();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${rating} -`) }));
    expect(mutations()).toHaveLength(0);
    expect(screen.getByRole('button', { name: new RegExp(`^${rating} -`) })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '确认保存评分' }));
    await screen.findByText(/评分已保存/);
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0][0].payload).toEqual({ word: 'serendipity', context: 'A discovery.', translation: '意外发现', isKnown: rating >= 3, wordDifficulty: rating === 5 ? 3 : rating === 1 ? 8 : 6 - rating });
    expect(screen.getByText('卡片 1 / 2')).toBeInTheDocument();
    expect(screen.getByText(/3 天后/)).toBeInTheDocument();
  });
  it('更改与撤销仅修改未保存选择，跳过不会生成评分', async () => {
    render(<FlashcardReview isSaving={false} />);
    await flip();
    fireEvent.click(screen.getByRole('button', { name: /^5 -/ }));
    fireEvent.click(screen.getByRole('button', { name: /^1 -/ }));
    expect(screen.getByRole('button', { name: /^5 -/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '撤销本题评分' }));
    expect(screen.getByRole('button', { name: '查看释义' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '跳过（不保存）' }));
    expect(screen.getByText('已逾期 2 天')).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });
  it.each([false, true])('保存失败不推进，保留评分供重试；抛错 %s', async reject => {
    render(<FlashcardReview isSaving={false} />);
    await flip();
    fireEvent.click(screen.getByRole('button', { name: /^4 -/ }));
    if (reject) sendMessage.mockRejectedValueOnce(new Error('离线'));
    else sendMessage.mockResolvedValueOnce({ success: false });
    fireEvent.click(screen.getByRole('button', { name: '确认保存评分' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('未确认保存');
    expect(screen.getByText('卡片 1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^4 -/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '确认保存评分' }));
    expect(await screen.findByText(/评分已保存/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('慢保存禁止重复提交、离开和跳过；成功后显式继续且不会再次评分', async () => {
    render(<FlashcardReview isSaving={false} />);
    await flip();
    fireEvent.click(screen.getByRole('button', { name: /^5 -/ }));
    let release!: (response: unknown) => void;
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const button = screen.getByRole('button', { name: '确认保存评分' });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: '正在保存…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '返回生词本' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '跳过（不保存）' })).toBeDisabled();
    expect(mutations()).toHaveLength(1);
    await act(async () => release({ success: true, data: { masteryResult: result } }));
    expect(screen.getByRole('button', { name: '下一词' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('button', { name: '查看释义' }), { key: '5' });
    expect(mutations()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '下一词' }));
    expect(screen.getByRole('button', { name: '点击或按空格查看释义' })).toHaveFocus();
  });
  it('慢保存完成后不夺回已移走的焦点', async () => {
    render(<><button>其他操作</button><FlashcardReview isSaving={false} /></>);
    await flip();
    fireEvent.click(screen.getByRole('button', { name: /^5 -/ }));
    let release!: (response: unknown) => void;
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '确认保存评分' }));
    screen.getByRole('button', { name: '其他操作' }).focus();
    await act(async () => release({ success: true }));
    expect(screen.getByRole('button', { name: '其他操作' })).toHaveFocus();
  });
  it('完整一轮分别统计保存和跳过，不把自评当正确率或全部掌握', async () => {
    render(<FlashcardReview isSaving={false} />);
    await score(4);
    fireEvent.click(screen.getByRole('button', { name: '下一词' }));
    fireEvent.click(screen.getByRole('button', { name: '跳过（不保存）' }));
    expect(screen.getByText('本轮已结束')).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('已保存 1 个评分，跳过 1 个');
    expect(screen.getByText('4.0 / 5')).toBeInTheDocument();
    expect(screen.queryByText('掌握率')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看卡片' })).not.toBeInTheDocument();
    sendMessage.mockResolvedValueOnce({ success: true, data: [] });
    fireEvent.click(screen.getByRole('button', { name: '检查剩余到期词' }));
    expect(await screen.findByText('没有需要复习的单词')).toBeInTheDocument();
  });
  it('全部跳过不会显示成功掌握或虚构平均评分', async () => {
    render(<FlashcardReview isSaving={false} />);
    fireEvent.click(await screen.findByRole('button', { name: '跳过（不保存）' }));
    fireEvent.click(screen.getByRole('button', { name: '跳过（不保存）' }));
    expect(screen.getByRole('status')).toHaveTextContent('已保存 0 个评分，跳过 2 个');
    expect(screen.queryByText('本轮平均自评分')).not.toBeInTheDocument();
  });
  it('快捷键只在本组件内工作，保护输入、组合键、原生按钮和按键重复', async () => {
    render(<><input aria-label="其他输入" /><FlashcardReview isSaving={false} /></>);
    const card = await screen.findByRole('button', { name: '点击或按空格查看释义' });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: ' ', code: 'Space' });
    expect(screen.queryByText('意外发现')).not.toBeInTheDocument();
    fireEvent.keyDown(card, { key: ' ' });
    for (const flags of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }]) fireEvent.keyDown(card, { key: '5', ...flags });
    fireEvent.keyDown(screen.getByRole('button', { name: '跳过（不保存）' }), { key: '5' });
    expect(screen.queryByRole('button', { name: '确认保存评分' })).not.toBeInTheDocument();
    fireEvent.keyDown(card, { key: '5' });
    expect(screen.getByRole('button', { name: '确认保存评分' })).toBeInTheDocument();
    expect(mutations()).toHaveLength(0);
  });
  it('手动队列无需伪造掌握度，空翻译与长词可用，并可返回', async () => {
    const exit = vi.fn();
    render(<FlashcardReview isSaving={false} initialWords={[{ word: 'longword'.repeat(30), translation: '', context: '', markedAt: 1, reviewCount: 0 }]} onExit={exit} />);
    await flip();
    expect(screen.getByText('暂无释义')).toBeInTheDocument();
    expect(screen.queryByText(/当前掌握度估算/)).not.toBeInTheDocument();
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回生词本' }));
    expect(exit).toHaveBeenCalledOnce();
  });
  it('外部保存期间评分与跳过禁用，恢复后可操作', async () => {
    const { rerender } = render(<FlashcardReview isSaving={true} />);
    await flip();
    expect(screen.getByRole('button', { name: /^5 -/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '跳过（不保存）' })).toBeDisabled();
    rerender(<FlashcardReview isSaving={false} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /^5 -/ })).toBeEnabled());
  });
});
