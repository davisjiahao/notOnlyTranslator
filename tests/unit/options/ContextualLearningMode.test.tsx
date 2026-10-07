import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContextualLearningMode from '@/options/components/ContextualLearningMode';
import { logger } from '@/shared/utils';

const words = [
  { word: 'resilient', translation: '有韧性的', contexts: [
    { sentence: 'A resilient learner keeps trying.', capturedAt: 1 },
  ] },
  { word: 'curious', translation: '好奇的', contexts: [
    { sentence: 'A curious learner asks questions.', capturedAt: 2 },
  ] },
];
const sendMessage = vi.fn();

async function openFlashcard() {
  render(<ContextualLearningMode />);
  fireEvent.click(await screen.findByRole('button', { name: /闪卡模式/ }));
  return screen.getByRole('button', { name: /resilient 点击查看释义/ });
}

beforeEach(() => {
  sendMessage.mockReset();
  sendMessage.mockResolvedValue({ success: true, data: [words[0]] });
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  vi.spyOn(logger, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('语境学习模式', () => {
  it('默认语境模式提供显示答案入口，无需切换到闪卡', async () => {
    render(<ContextualLearningMode />);
    await screen.findByText('进度: 1 / 1');

    expect(screen.queryByRole('button', { name: /不认识/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看.*(释义|答案)|显示答案/ }));

    expect(screen.getByText('有韧性的')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /查看.*(释义|答案)|显示答案/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '4 - 熟练：基本掌握' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'MARK_WORD_KNOWN', payload: { word: 'resilient', isKnown: true, wordDifficulty: 2 },
    });
  });

  it('语境模式进入下一词后重新隐藏评分，需要再次主动显示答案', async () => {
    sendMessage.mockResolvedValueOnce({ success: true, data: words });
    render(<ContextualLearningMode />);
    fireEvent.click(await screen.findByRole('button', { name: '显示答案' }));
    fireEvent.click(screen.getByRole('button', { name: '2 - 模糊：有点印象' }));

    await screen.findByText('进度: 2 / 2');
    expect(screen.getByRole('button', { name: /语境模式/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /模糊/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '显示答案' }));
    fireEvent.click(screen.getByRole('button', { name: '5 - 精通：完全掌握' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(screen.getByText('本次学习了 2 个词汇的语境用法')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('加载完成前展示状态，向后台请求限定数量的语境词汇', async () => {
    let finish!: (response: unknown) => void;
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<ContextualLearningMode />);
    expect(screen.getByRole('status')).toHaveTextContent('加载语境词汇...');
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ type: 'GET_CONTEXTUAL_WORDS', payload: { limit: 15 } });

    await act(async () => finish({ success: true, data: words }));

    expect(screen.getByText('进度: 1 / 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /语境模式/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /闪卡模式/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/在真实语境中学习单词用法/)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    { success: false },
    { success: true },
    { success: true, data: [] },
  ])('响应没有可用词汇时显示空态：%j', async response => {
    sendMessage.mockResolvedValueOnce(response);
    render(<ContextualLearningMode />);

    expect(await screen.findByRole('heading', { name: '暂无语境词汇' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('继续浏览英文内容');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('后台加载异常时结束加载并保留阅读指引', async () => {
    const error = new Error('本地后台未响应');
    sendMessage.mockRejectedValueOnce(error);
    render(<ContextualLearningMode />);

    await screen.findByRole('heading', { name: '暂无语境词汇' });
    expect(screen.queryByText('加载语境词汇...')).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledWith('Failed to load contextual words:', error);
  });

  it.each(['Enter', ' '])('闪卡支持 %s 键显示释义，重复翻面不会隐藏答案', async key => {
    const card = await openFlashcard();
    expect(screen.queryByText('有韧性的')).not.toBeInTheDocument();
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(screen.queryByText('有韧性的')).not.toBeInTheDocument();

    fireEvent.keyDown(card, { key });
    expect(screen.getByText('有韧性的')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeEnabled();
    fireEvent.click(card);
    expect(screen.getByText('有韧性的')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it.each([1, 2, 3, 4, 5])('闪卡评分 %i 按掌握边界发送消息并显示准确统计', async rating => {
    fireEvent.click(await openFlashcard());
    sendMessage.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: String(rating) }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'MARK_WORD_KNOWN',
      payload: { word: 'resilient', isKnown: rating >= 3, wordDifficulty: 6 - rating },
    });
    expect(screen.getByText('本次学习了 1 个词汇的语境用法')).toBeInTheDocument();
    expect(screen.getByText('熟练掌握').parentElement).toHaveTextContent(`${rating >= 4 ? 1 : 0}熟练掌握`);
    expect(screen.getByText(rating >= 4 ? '100%' : '0%')).toBeInTheDocument();
  });

  it('评分后进入下一张且隐藏答案，完成时统计本轮掌握率', async () => {
    sendMessage.mockResolvedValueOnce({ success: true, data: words });
    fireEvent.click(await openFlashcard());
    sendMessage.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: '2' }));

    await screen.findByText('进度: 2 / 2');
    expect(screen.queryByText('好奇的')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /curious 点击查看释义/ }));
    fireEvent.click(screen.getByRole('button', { name: '4' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(screen.getByText('本次学习了 2 个词汇的语境用法')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('熟练掌握').parentElement).toHaveTextContent('1熟练掌握');
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'MARK_WORD_KNOWN', payload: { word: 'curious', isKnown: true, wordDifficulty: 2 },
    });
  });

  it('闪卡提交期间禁用评分，等待后台成功后才完成', async () => {
    fireEvent.click(await openFlashcard());
    let finish!: (response: unknown) => void;
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: '4' }));

    for (const button of screen.getAllByRole('button', { name: /^[1-5]$/ })) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('语境学习完成！')).not.toBeInTheDocument();

    await act(async () => finish({ success: true }));
    expect(screen.getByRole('heading', { name: '语境学习完成！' })).toBeInTheDocument();
  });

  it('评分请求失败时保留当前答案并允许重试，不计入已学习数', async () => {
    fireEvent.click(await openFlashcard());
    const error = new Error('本地存储不可用');
    sendMessage.mockRejectedValueOnce(error);
    fireEvent.click(screen.getByRole('button', { name: '5' }));

    await waitFor(() => expect(screen.getByRole('button', { name: '5' })).toBeEnabled());
    expect(screen.getByText('进度: 1 / 1')).toBeInTheDocument();
    expect(screen.getByText('有韧性的')).toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledWith('Failed to rate word:', error);
    sendMessage.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: '5' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(screen.getByText('本次学习了 1 个词汇的语境用法')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it.each([
    { name: '业务失败', response: { success: false, error: '评分被拒绝' } },
    { name: '无响应', response: undefined },
    { name: '空响应', response: null },
    { name: '缺少成功标志', response: {} },
    { name: '字符串真值', response: { success: 'true' } },
    { name: '数字真值', response: { success: 1 } },
  ])('$name评分响应不切词、不隐藏答案、不累计统计，仍可重试', async ({ response }) => {
    sendMessage.mockResolvedValueOnce({ success: true, data: words });
    fireEvent.click(await openFlashcard());
    sendMessage.mockResolvedValueOnce(response);

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '5' })));

    expect(screen.getByText('进度: 1 / 2')).toBeInTheDocument();
    expect(screen.getByText('有韧性的')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: '语境学习完成！' })).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledWith('Failed to rate word:', expect.any(Error));

    sendMessage.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await screen.findByText('进度: 2 / 2');
    fireEvent.click(screen.getByRole('button', { name: /curious 点击查看释义/ }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(screen.getByText('本次学习了 2 个词汇的语境用法')).toBeInTheDocument();
    expect(screen.getByText('熟练掌握').parentElement).toHaveTextContent('1熟练掌握');
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });

  it('最后一个语境词评分被后台拒绝时不显示完成页，原评分按钮可继续重试', async () => {
    render(<ContextualLearningMode />);
    fireEvent.click(await screen.findByRole('button', { name: '显示答案' }));
    sendMessage.mockResolvedValueOnce({ success: false, error: '词汇更新未保存' });

    await act(async () => fireEvent.click(screen.getByRole('button', { name: '4 - 熟练：基本掌握' })));

    expect(screen.getByText('进度: 1 / 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '4 - 熟练：基本掌握' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: '显示答案' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '语境学习完成！' })).not.toBeInTheDocument();
    expect(logger.error).toHaveBeenCalledWith('Failed to rate word:', new Error('词汇更新未保存'));

    sendMessage.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: '2 - 模糊：有点印象' }));
    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(screen.getByText('本次学习了 1 个词汇的语境用法')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('翻面后可以切回语境模式，通过真实卡片评分', async () => {
    fireEvent.click(await openFlashcard());
    fireEvent.click(screen.getByRole('button', { name: /语境模式/ }));
    expect(screen.getByRole('button', { name: /语境模式/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /闪卡模式/ })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: '4 - 熟练：基本掌握' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(sendMessage).toHaveBeenLastCalledWith({
      type: 'MARK_WORD_KNOWN', payload: { word: 'resilient', isKnown: true, wordDifficulty: 2 },
    });
  });

  it('缺少翻译的单词仍可在闪卡翻面后评分', async () => {
    sendMessage.mockResolvedValueOnce({ success: true, data: [{ ...words[0], translation: undefined }] });
    fireEvent.click(await openFlashcard());
    expect(screen.queryByText('有韧性的')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(screen.getByText('本次学习了 1 个词汇的语境用法')).toBeInTheDocument();
  });

  it('再来一轮重新加载并清空统计，不继承上一轮的答案和掌握数', async () => {
    fireEvent.click(await openFlashcard());
    fireEvent.click(screen.getByRole('button', { name: '5' }));
    await screen.findByRole('heading', { name: '语境学习完成！' });
    fireEvent.click(screen.getByRole('button', { name: '再来一轮' }));

    await screen.findByText('进度: 1 / 1');
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'GET_CONTEXTUAL_WORDS', payload: { limit: 15 } });
    expect(screen.queryByText('有韧性的')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /resilient 点击查看释义/ }));
    fireEvent.click(screen.getByRole('button', { name: '1' }));

    await screen.findByRole('heading', { name: '语境学习完成！' });
    expect(screen.getByText('本次学习了 1 个词汇的语境用法')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    expect(screen.getByText('熟练掌握').parentElement).toHaveTextContent('0熟练掌握');
  });
});
