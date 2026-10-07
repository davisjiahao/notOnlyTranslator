import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { AchievementGallery } from '@/shared/components/AchievementGallery';
import { getAchievementProgress, getUnlockedAchievements, loadAchievementState, markAchievementAsViewed } from '@/shared/analytics/achievements';
import type { Achievement, AchievementProgress } from '@/shared/types/achievements';

vi.mock('@/shared/analytics/achievements', () => ({
  getAchievementProgress: vi.fn(), getUnlockedAchievements: vi.fn(),
  loadAchievementState: vi.fn(), markAchievementAsViewed: vi.fn(),
}));
vi.mock('@/shared/components/ShareCardModal', () => ({
  ShareCardModal: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>关闭分享</button>,
}));

const unlocked: Achievement = {
  id: 'first_word', name: '已获成就', description: '已完成的学习目标', icon: '🌱',
  tier: 'bronze', category: 'vocabulary', points: 10, unlockedAt: 1000,
  condition: { type: 'words_marked_total', threshold: 1, description: '标记一个生词' },
};
const locked: Achievement = { ...unlocked, id: 'future', name: '未获成就', points: 100, unlockedAt: undefined };
const progress: AchievementProgress[] = [
  { achievementId: unlocked.id, currentValue: 1, targetValue: 1, percentage: 100, isUnlocked: true },
  { achievementId: locked.id, currentValue: 0, targetValue: 1, percentage: 0, isUnlocked: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUnlockedAchievements).mockResolvedValue([unlocked]);
  vi.mocked(loadAchievementState).mockResolvedValue({
    achievements: [unlocked, locked], totalPoints: 10, unlockedCount: 1, lastCheckedAt: 1,
  });
  vi.mocked(getAchievementProgress).mockResolvedValue(progress);
  vi.mocked(markAchievementAsViewed).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function open() {
  const onClose = vi.fn();
  render(<AchievementGallery onClose={onClose} />);
  await screen.findByRole('heading', { name: /我的成就/ });
  return { onClose };
}

describe('成就画廊的完整学习进度', () => {
  it('全部及未解锁筛选必须显示未获得的成就，而不只加载已解锁列表', async () => {
    await open();
    expect(screen.getByRole('button', { name: '未获成就，未解锁' })).toBeInTheDocument();
    expect(screen.getByText('已解锁 1/2 个成就 · 总积分 10')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: '未解锁', exact: true }));
    expect(screen.getByRole('button', { name: '未获成就，未解锁' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '已获成就，已解锁' })).not.toBeInTheDocument();
  });

  it('已解锁筛选排除未解锁卡片，关闭画廊只调用关闭回调', async () => {
    const { onClose } = await open();
    fireEvent.click(screen.getByRole('radio', { name: '已解锁', exact: true }));
    expect(screen.getByRole('button', { name: '已获成就，已解锁' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '未获成就，未解锁' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('筛选器支持方向键循环切换并移动焦点', async () => {
    await open();
    const all = screen.getByRole('radio', { name: '全部', exact: true });
    fireEvent.keyDown(all, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: '未解锁', exact: true })).toHaveFocus();
    expect(all).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(all, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: '已解锁', exact: true })).toHaveFocus();
  });

  it.each(['全部', '已解锁', '未解锁'])('没有进度时 %s 筛选显示对应空态', async filter => {
    vi.mocked(getAchievementProgress).mockResolvedValue([]);
    await open();
    fireEvent.click(screen.getByRole('radio', { name: filter, exact: true }));
    expect(screen.getByText(`暂无${filter === '全部' ? '' : filter}成就`)).toBeInTheDocument();
  });

  it('点击已查看卡片打开详情，关闭详情不会重复写入已查看状态', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: '已获成就，已解锁' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('已获成就');
    expect(markAchievementAsViewed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '知道了' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('新解锁成就详情会清除新标记，分享弹窗关闭后回到画廊', async () => {
    const newAchievement = { ...unlocked, isNew: true };
    vi.mocked(getUnlockedAchievements).mockResolvedValue([newAchievement]);
    vi.mocked(loadAchievementState).mockResolvedValueOnce({
      achievements: [newAchievement, locked], totalPoints: 10, unlockedCount: 1, lastCheckedAt: 1,
    });
    await open();
    expect(screen.getByText('NEW')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '已获成就，已解锁' }));
    await waitFor(() => expect(markAchievementAsViewed).toHaveBeenCalledWith(unlocked.id));
    await screen.findByRole('button', { name: '分享成就' });
    expect(screen.queryByText('NEW')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '分享成就' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭分享' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /我的成就/ })).toBeInTheDocument();
  });

  it('进度引用不存在的成就时不渲染错误卡片', async () => {
    vi.mocked(getAchievementProgress).mockResolvedValue([...progress, { ...progress[0], achievementId: 'missing' }]);
    await open();
    expect(screen.getAllByRole('button', { name: /成就，/ })).toHaveLength(2);
  });

  it('加载失败时仍能关闭画廊，不停留在加载状态', async () => {
    vi.mocked(getAchievementProgress).mockRejectedValueOnce(new Error('测试读取失败'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onClose = vi.fn();
    render(<AchievementGallery onClose={onClose} />);
    await screen.findByRole('heading', { name: /我的成就/ });
    expect(screen.getByText('暂无成就')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
