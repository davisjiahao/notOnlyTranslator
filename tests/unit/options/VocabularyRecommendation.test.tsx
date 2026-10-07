import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VocabularyRecommendation from '@/options/components/VocabularyRecommendation';

vi.mock('@/shared/utils', () => ({ logger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

const entry = { word: 'serendipity', translation: '意外发现', context: 'A happy serendipity', markedAt: Date.now() - 9 * 86400000, reviewCount: 2, lastReviewAt: Date.now() - 9 * 86400000 };
const profile = { knownWords: [], unknownWords: [entry] };
const sendMessage = vi.fn();

beforeEach(() => {
  sendMessage.mockReset();
  sendMessage.mockImplementation(({ type }: { type: string }) => type === 'GET_USER_PROFILE'
    ? Promise.resolve({ success: true, data: profile })
    : Promise.resolve({ success: false, error: `Unknown message type: ${type}` }));
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('词汇推荐', () => {
  it('通过后台支持的用户档案消息加载生词，点击推荐词回传所选单词', async () => {
    const onWordSelect = vi.fn();
    render(<VocabularyRecommendation userLevel="B1" onWordSelect={onWordSelect} />);
    expect(screen.getByRole('status')).toHaveTextContent('加载推荐词汇');
    const word = await screen.findByRole('button', { name: /serendipity/i });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'GET_USER_PROFILE' });
    fireEvent.click(word);
    expect(onWordSelect).toHaveBeenCalledWith('serendipity');
    expect(word).toHaveClass('border-blue-500');
  });

  it('词库为空时显示推荐空态；每日计划显示零词和零分钟', async () => {
    sendMessage.mockResolvedValue({ success: true, data: { knownWords: [], unknownWords: [] } });
    render(<VocabularyRecommendation userLevel="B1" />);
    expect(await screen.findByText(/暂无推荐词汇/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '今日计划' }));
    expect(await screen.findByText('新词 0 个 · 复习 0 个')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'GET_USER_PROFILE' });
  });

  it('今日计划区分新词和逾期复习词，点击卡片选择词汇', async () => {
    const onWordSelect = vi.fn();
    render(<VocabularyRecommendation userLevel="B1" onWordSelect={onWordSelect} />);
    await screen.findByRole('button', { name: /serendipity/i });
    fireEvent.click(screen.getByRole('tab', { name: '今日计划' }));
    expect(await screen.findByText('复习巩固')).toBeInTheDocument();
    expect(screen.getByText(/复习 1 个/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /serendipity/i })[1]);
    expect(onWordSelect).toHaveBeenCalledWith('serendipity');
  });

  it('切换推荐策略会重新查询档案，并保留在设置中的策略选择', async () => {
    render(<VocabularyRecommendation userLevel="B1" />);
    await screen.findByRole('button', { name: /serendipity/i });
    fireEvent.click(screen.getByRole('button', { name: '邻近难度' }));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('tab', { name: '推荐设置' }));
    expect(screen.getByLabelText('推荐策略')).toHaveValue('proximal');
    expect(screen.getByText('中级 (B1)')).toBeInTheDocument();
  });

  it('设置中选取间隔复习后返回推荐列表会应用该策略', async () => {
    render(<VocabularyRecommendation userLevel="B1" />);
    await screen.findByRole('button', { name: /serendipity/i });
    fireEvent.click(screen.getByRole('tab', { name: '推荐设置' }));
    fireEvent.change(screen.getByLabelText('推荐策略'), { target: { value: 'spaced_repetition' } });
    expect(screen.getByLabelText('推荐策略')).toHaveValue('spaced_repetition');
    fireEvent.click(screen.getByRole('tab', { name: '推荐词汇' }));
    expect(await screen.findByRole('button', { name: /serendipity/i })).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('每日计划读取失败显示错误，重试后显示复习计划', async () => {
    render(<VocabularyRecommendation userLevel="B1" />);
    await screen.findByRole('button', { name: /serendipity/i });
    sendMessage.mockRejectedValueOnce(new Error('断网'));
    fireEvent.click(screen.getByRole('tab', { name: '今日计划' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('加载今日计划失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('复习巩固')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('档案读取失败显示错误，并可在当前推荐视图重试', async () => {
    sendMessage.mockResolvedValueOnce({ success: false, error: '存储不可用' });
    render(<VocabularyRecommendation userLevel="B1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('加载推荐词汇失败');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: /serendipity/i })).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
});
