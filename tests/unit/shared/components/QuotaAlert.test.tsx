import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { QuotaAlertBanner, QuotaExhaustedModal, QuotaIndicator } from '@/shared/components/QuotaAlert';
import type { QuotaAlert } from '@/shared/types/quota';

afterEach(cleanup);

describe('QuotaAlertBanner', () => {
  it('无警告时不显示消息或操作按钮', () => {
    const alert: QuotaAlert = { level: 'none', message: '额度充足', remaining: 100, action: '配置 API' };
    const { container } = render(<QuotaAlertBanner alert={alert} onAction={vi.fn()} onDismiss={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it.each([
    ['low', 20, 'text-yellow-800', 'bg-yellow-600'],
    ['critical', 5, 'text-orange-800', 'bg-orange-600'],
    ['exhausted', 0, 'text-red-800', 'bg-red-600'],
  ] as const)('%s 警告显示消息和对应操作，点击操作不自动隐藏', (level, remaining, textClass, buttonClass) => {
    const onAction = vi.fn();
    render(<QuotaAlertBanner
      alert={{ level, remaining, message: `剩余 ${remaining} 次翻译`, action: '配置自己的 API' }}
      onAction={onAction}
    />);
    expect(screen.getByText(`剩余 ${remaining} 次翻译`)).toHaveClass(textClass);
    const action = screen.getByRole('button', { name: '配置自己的 API' });
    expect(action).toHaveClass(buttonClass);
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(action).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
  });

  it('关闭警告后隐藏内容并通知调用方一次', () => {
    const onDismiss = vi.fn();
    render(<QuotaAlertBanner
      alert={{ level: 'low', remaining: 10, message: '额度即将用完' }}
      onDismiss={onDismiss}
    />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByText('额度即将用完')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('没有可选操作及关闭回调时仅显示消息', () => {
    render(<QuotaAlertBanner alert={{ level: 'critical', remaining: 1, message: '仅剩一次翻译' }} />);
    expect(screen.getByText('仅剩一次翻译')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('QuotaIndicator', () => {
  it.each([
    [0, 100, 0, 'red'],
    [5, 100, 5, 'red'],
    [6, 100, 6, 'orange'],
    [20, 100, 20, 'orange'],
    [21, 100, 21, 'yellow'],
    [30, 100, 30, 'yellow'],
    [31, 100, 31, 'green'],
    [100, 100, 100, 'green'],
    [0, 0, 0, 'red'],
    [25, 80, 31, 'green'],
  ] as const)('剩余 %i/%i 时显示 %i%% 进度和 %s 状态色', (remaining, total, percentage, color) => {
    render(<QuotaIndicator remaining={remaining} total={total} />);
    const progress = screen.getByRole('progressbar', { name: `剩余额度：${remaining}/${total}` });
    expect(progress).toHaveAttribute('aria-valuenow', String(remaining));
    expect(progress).toHaveAttribute('aria-valuemin', '0');
    expect(progress).toHaveAttribute('aria-valuemax', String(total));
    expect(progress).toHaveStyle({ width: `${percentage}%` });
    expect(progress).toHaveClass(`bg-${color}-500`);
    expect(screen.getByText(String(remaining))).toHaveClass(`text-${color}-600`);
    expect(screen.getByText('剩余额度')).toBeInTheDocument();
  });

  it('紧凑模式隐藏标签但保留可访问的额度信息', () => {
    render(<QuotaIndicator remaining={40} total={100} showLabel={false} />);
    expect(screen.queryByText('剩余额度')).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '剩余额度：40/100' })).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });
});

describe('QuotaExhaustedModal', () => {
  it('关闭时隐藏，打开后说明额度耗尽和两个继续使用途径', () => {
    const props = { onClose: vi.fn(), onConfigureApi: vi.fn(), onInviteFriends: vi.fn() };
    const { rerender } = render(<QuotaExhaustedModal isOpen={false} {...props} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(<QuotaExhaustedModal isOpen {...props} />);
    expect(screen.getByRole('dialog', { name: '免费额度已用完' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/您可以配置自己的 API Key 继续使用/)).toBeInTheDocument();
    expect(screen.getByText('每成功邀请一位好友，双方各得 50 次额度')).toBeInTheDocument();
  });

  it.each([
    [/配置 API Key/, 'onConfigureApi'],
    [/邀请好友/, 'onInviteFriends'],
    [/稍后再说/, 'onClose'],
  ] as const)('点击 %s 只调用对应动作 %s', (name, callback) => {
    const props = { onClose: vi.fn(), onConfigureApi: vi.fn(), onInviteFriends: vi.fn() };
    render(<QuotaExhaustedModal isOpen {...props} />);
    fireEvent.click(screen.getByRole('button', { name }));
    for (const [key, action] of Object.entries(props)) {
      expect(action).toHaveBeenCalledTimes(key === callback ? 1 : 0);
    }
  });
});
