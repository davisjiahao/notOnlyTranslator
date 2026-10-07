import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';
import FeedbackButton from '@/popup/components/Feedback/FeedbackButton';

afterEach(cleanup);

describe('FeedbackButton', () => {
  it('默认按钮打开真实反馈弹窗，取消后关闭且再次打开没有旧内容', () => {
    render(<FeedbackButton />);
    const trigger = screen.getByRole('button', { name: '意见反馈' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: '意见反馈' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '其他' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.change(screen.getByPlaceholderText('简要描述您的问题或建议'), {
      target: { value: '未提交的反馈草稿' },
    });
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByPlaceholderText('简要描述您的问题或建议')).toHaveValue('');
  });

  it.each(['default', 'minimal', 'icon'] as const)('%s 变体向弹窗传递初始类别并允许关闭', variant => {
    render(<FeedbackButton variant={variant} initialCategory="performance" className="custom-feedback" />);
    const trigger = screen.getByRole('button', { name: '意见反馈' });
    expect(trigger).toHaveClass('custom-feedback');
    fireEvent.click(trigger);
    expect(screen.getByRole('radio', { name: '性能问题' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['default', 'minimal'] as const)('%s 变体使用自定义按钮文字', variant => {
    render(<FeedbackButton variant={variant} label="报告问题" size="lg" />);
    fireEvent.click(screen.getByRole('button', { name: '报告问题' }));
    expect(screen.getByRole('dialog', { name: '意见反馈' })).toBeInTheDocument();
  });

  it('图标变体保留可访问名称，不渲染自定义文字', () => {
    render(<FeedbackButton variant="icon" size="sm" label="不显示的文字" />);
    expect(screen.getByRole('button', { name: '意见反馈' })).toHaveAttribute('title', '意见反馈');
    expect(screen.queryByText('不显示的文字')).not.toBeInTheDocument();
  });

  it('最小变体的空标签回退为意见反馈', () => {
    render(<FeedbackButton variant="minimal" size="sm" label="" />);
    expect(screen.getByRole('button', { name: '意见反馈' })).toBeInTheDocument();
  });
});
