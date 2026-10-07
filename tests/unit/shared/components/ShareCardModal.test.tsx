import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ShareCardModal } from '@/shared/components/ShareCardModal';
import { generateShareCardData, shareToPlatform } from '@/shared/analytics/achievements';
import type { ShareCardData, SharePlatform } from '@/shared/types/achievements';

vi.mock('@/shared/analytics/achievements', () => ({ generateShareCardData: vi.fn(), shareToPlatform: vi.fn() }));
const data: ShareCardData = {
  achievement: {
    id: 'first_word', name: '测试成就', description: '离线测试成就', icon: '🌱',
    tier: 'bronze', category: 'vocabulary', points: 10, unlockedAt: 1,
    condition: { type: 'words_marked_total', threshold: 1, description: '标记一个生词' },
  },
  userStats: { totalWords: 100, streakDays: 3, rank: '学习者' },
  shareUrl: 'https://example.com/share/offline', inviteCode: 'TEST-CODE',
};
const clipboard = { writeText: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateShareCardData).mockResolvedValue(data);
  vi.mocked(shareToPlatform).mockResolvedValue({ platform: 'copy', success: true });
  clipboard.writeText.mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { ...navigator, clipboard });
  vi.spyOn(window, 'open').mockImplementation(() => null);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  const onClose = vi.fn();
  render(<ShareCardModal achievementId="first_word" onClose={onClose} />);
  await screen.findByRole('dialog', { name: '分享成就' });
  return { onClose };
}

describe('成就分享弹窗的离线用户行为', () => {
  it('加载过程中显示加载对话框，完成后展示成就、邀请和统计', async () => {
    let resolve!: (value: ShareCardData | null) => void;
    vi.mocked(generateShareCardData).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    render(<ShareCardModal achievementId="first_word" onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: '加载分享卡片' })).toBeInTheDocument();
    await act(async () => { resolve(data); });
    expect(screen.getByText('TEST-CODE')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText(/学习者/)).toBeInTheDocument();
  });

  it.each(['空结果', '读取失败'])('%s 仍显示可关闭的错误对话框', async kind => {
    if (kind === '空结果') vi.mocked(generateShareCardData).mockResolvedValueOnce(null);
    else vi.mocked(generateShareCardData).mockRejectedValueOnce(new Error('读取失败'));
    const onClose = vi.fn();
    render(<ShareCardModal achievementId="missing" onClose={onClose} />);
    await screen.findByRole('dialog', { name: '分享卡片错误' });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('没有用户等级时不显示等级，关闭按钮调用回调', async () => {
    vi.mocked(generateShareCardData).mockResolvedValueOnce({ ...data, userStats: { totalWords: 0, streakDays: 0 } });
    const { onClose } = await open();
    expect(screen.queryByText(/学习者/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['Twitter', 'twitter'], ['微博', 'weibo'], ['微信', 'wechat'],
  ] as const)('%s 分享成功时按平台决定是否打开窗口', async (label, platform: SharePlatform) => {
    const url = 'https://example.com/offline-share';
    vi.mocked(shareToPlatform).mockResolvedValueOnce({ platform, success: true, url });
    await open();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await screen.findByText('分享成功！');
    expect(shareToPlatform).toHaveBeenCalledWith(platform, data);
    if (platform === 'wechat') expect(window.open).not.toHaveBeenCalled();
    else expect(window.open).toHaveBeenCalledWith(url, '_blank', 'width=600,height=400');
  });

  it.each([undefined, '本次分享不可用'])('分享失败显示服务返回错误或默认提示：%s', async error => {
    vi.mocked(shareToPlatform).mockResolvedValueOnce({ platform: 'twitter', success: false, error });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Twitter' }));
    await screen.findByText(error ?? '分享失败，请重试');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('成功但没有链接时不打开空窗口', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Twitter' }));
    await screen.findByText('分享成功！');
    expect(window.open).not.toHaveBeenCalled();
  });

  it('分享等待期间禁用平台按钮，失败后恢复可重试', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(shareToPlatform).mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Twitter' }));
    expect(screen.getByRole('button', { name: '微博' })).toBeDisabled();
    await act(async () => { reject(new Error('离线分享失败')); });
    expect(screen.getByRole('button', { name: '微博' })).toBeEnabled();
    expect(window.open).not.toHaveBeenCalled();
  });

  it.each(['复制', '复制链接'])('%s 只写入剪贴板，并展示暂时的已复制状态', async label => {
    vi.mocked(shareToPlatform).mockResolvedValueOnce({ platform: 'copy', success: true, url: 'https://example.com/ignored' });
    await open();
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: label, exact: true }));
    await act(async () => { await Promise.resolve(); });
    expect(clipboard.writeText).toHaveBeenCalledWith(data.shareUrl);
    expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument();
    expect(shareToPlatform).toHaveBeenCalledWith('copy', data);
    expect(window.open).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('button', { name: '复制', exact: true })).toBeInTheDocument();
  });

  it('剪贴板拒绝时不显示成功或发起分享，可重试', async () => {
    clipboard.writeText.mockRejectedValueOnce(new Error('剪贴板被拒绝'));
    await open();
    fireEvent.click(screen.getByRole('button', { name: '复制', exact: true }));
    await waitFor(() => expect(console.error).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument();
    expect(shareToPlatform).not.toHaveBeenCalled();
  });
});
