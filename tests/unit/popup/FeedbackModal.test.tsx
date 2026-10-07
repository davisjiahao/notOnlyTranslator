import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import FeedbackModal from '@/popup/components/Feedback/FeedbackModal';
import { submitFeedback, type FeedbackSubmitResult } from '@/shared/feedback';

vi.mock('@/shared/feedback', async importOriginal => ({
  ...await importOriginal<typeof import('@/shared/feedback')>(),
  submitFeedback: vi.fn(),
}));

const mockSubmitFeedback = vi.mocked(submitFeedback);
const title = '希望改进翻译结果';
const description = '在阅读英文文章时，希望保留完整上下文并改进翻译结果。';

function fillValidForm() {
  fireEvent.click(screen.getByRole('button', { name: '4星' }));
  fireEvent.change(screen.getByPlaceholderText('简要描述您的问题或建议'), {
    target: { value: title },
  });
  fireEvent.change(screen.getByPlaceholderText(/请描述Bug发生的具体步骤|这个功能会解决什么问题|请详细描述您的问题或建议/), {
    target: { value: description },
  });
}

beforeEach(() => {
  mockSubmitFeedback.mockReset();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('测试禁止访问网络')));
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FeedbackModal', () => {
  it('关闭时不渲染，打开后默认选择其他且未评分不能提交', () => {
    const onClose = vi.fn();
    const { rerender } = render(<FeedbackModal isOpen={false} onClose={onClose} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<FeedbackModal isOpen onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: '意见反馈' })).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('radio', { name: '其他' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: '提交反馈' })).toBeDisabled();
    expect(screen.getByText('0/2000')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('简要描述您的问题或建议')).toHaveAttribute('maxlength', '100');
  });

  it('使用指定类别，并在切换类别时更新提示和键盘入口', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} initialCategory="bug" />);
    const bug = screen.getByRole('radio', { name: 'Bug 反馈' });
    expect(bug).toHaveAttribute('aria-checked', 'true');
    expect(bug).toHaveAttribute('tabindex', '0');
    expect(screen.getByPlaceholderText(/请描述Bug发生的具体步骤/)).toHaveAttribute('maxlength', '2000');

    fireEvent.click(screen.getByRole('radio', { name: '功能建议' }));
    expect(screen.getByRole('radio', { name: '功能建议' })).toHaveAttribute('aria-checked', 'true');
    expect(bug).toHaveAttribute('tabindex', '-1');
    expect(screen.getByPlaceholderText(/这个功能会解决什么问题/)).toBeInTheDocument();
  });

  it.each([
    ['ArrowRight', '其他', 'Bug 反馈'],
    ['ArrowDown', 'Bug 反馈', '功能建议'],
    ['ArrowLeft', 'Bug 反馈', '其他'],
    ['ArrowUp', '功能建议', 'Bug 反馈'],
  ])('%s 在反馈类别间移动焦点并支持首尾循环', (key, start, target) => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    const startRadio = screen.getByRole('radio', { name: start });
    startRadio.focus();
    fireEvent.keyDown(startRadio, { key });
    expect(screen.getByRole('radio', { name: target })).toHaveFocus();
  });

  it.each([' ', 'Enter'])('用 %s 选择当前聚焦的反馈类别', key => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    const category = screen.getByRole('radio', { name: '性能问题' });
    category.focus();
    fireEvent.keyDown(category, { key });
    expect(category).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText(/问题发生在什么场景下/)).toBeInTheDocument();
  });

  it('无关按键不改变类别或焦点', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    const category = screen.getByRole('radio', { name: '其他' });
    category.focus();
    fireEvent.keyDown(category, { key: 'a' });
    expect(category).toHaveFocus();
    expect(category).toHaveAttribute('aria-checked', 'true');
  });

  it('真实校验器阻止空表单提交，修改内容后清除错误', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '1星' }));
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请填写反馈标题');
    expect(screen.getByRole('alert')).toHaveTextContent('请填写详细描述');
    expect(mockSubmitFeedback).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('简要描述您的问题或建议'), {
      target: { value: title },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('显示短文本及非法邮箱错误，不调用提交服务', () => {
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    fillValidForm();
    fireEvent.change(screen.getByPlaceholderText('简要描述您的问题或建议'), { target: { value: '短' } });
    fireEvent.change(screen.getByPlaceholderText(/请详细描述您的问题或建议/), { target: { value: '太短' } });
    fireEvent.change(screen.getByPlaceholderText('如需回复，请留下您的邮箱'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));
    expect(screen.getByRole('alert')).toHaveTextContent('标题至少需要 5 个字符');
    expect(screen.getByRole('alert')).toHaveTextContent('描述至少需要 10 个字符');
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的邮箱地址');
    expect(mockSubmitFeedback).not.toHaveBeenCalled();
  });

  it('提交中禁止重复提交和关闭，并按实际字段提交成功', async () => {
    let resolveSubmission!: (result: FeedbackSubmitResult) => void;
    mockSubmitFeedback.mockReturnValue(new Promise(resolve => { resolveSubmission = resolve; }));
    const onClose = vi.fn();
    render(<FeedbackModal isOpen onClose={onClose} initialCategory="feature" />);
    fillValidForm();
    fireEvent.change(screen.getByPlaceholderText('如需回复，请留下您的邮箱'), {
      target: { value: 'reader@example.com' },
    });
    expect(screen.getByText(`${description.length}/2000`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));

    expect(mockSubmitFeedback).toHaveBeenCalledExactlyOnceWith({
      category: 'feature', rating: 4, title, description, email: 'reader@example.com',
    });
    expect(screen.getByRole('button', { name: '提交中...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关闭' })).toBeDisabled();
    const backdrop = screen.getByRole('dialog').firstElementChild;
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    fireEvent.click(screen.getByRole('button', { name: '提交中...' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(1);

    await act(async () => { resolveSubmission({ success: true, feedbackId: 'local-feedback' }); });
    expect(screen.getByRole('status')).toHaveTextContent('提交成功！');
    expect(screen.getByRole('status')).toHaveTextContent('感谢您的反馈！');
    expect(screen.queryByRole('button', { name: '提交反馈' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeEnabled();
  });

  it('成功提示在三秒后关闭并重置表单', async () => {
    vi.useFakeTimers();
    mockSubmitFeedback.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const { rerender } = render(<FeedbackModal isOpen onClose={onClose} />);
    fillValidForm();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '提交反馈' })); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2999); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<FeedbackModal isOpen={false} onClose={onClose} />);
    rerender(<FeedbackModal isOpen onClose={onClose} />);
    expect(screen.getByPlaceholderText('简要描述您的问题或建议')).toHaveValue('');
    expect(screen.getByRole('button', { name: '提交反馈' })).toBeDisabled();
  });

  it('提前关闭成功提示后，旧计时器不应关闭重新打开的反馈草稿', async () => {
    vi.useFakeTimers();
    mockSubmitFeedback.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const { rerender } = render(<FeedbackModal isOpen onClose={onClose} />);
    fillValidForm();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '提交反馈' })); });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<FeedbackModal isOpen={false} onClose={onClose} />);
    rerender(<FeedbackModal isOpen onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('简要描述您的问题或建议'), {
      target: { value: '重新打开后输入的新反馈' },
    });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('简要描述您的问题或建议')).toHaveValue('重新打开后输入的新反馈');
  });

  it.each(['外部隐藏', '卸载'])('成功提示%s后取消自动关闭回调', async action => {
    vi.useFakeTimers();
    mockSubmitFeedback.mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const { rerender, unmount } = render(<FeedbackModal isOpen onClose={onClose} />);
    fillValidForm();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '提交反馈' })); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    if (action === '外部隐藏') {
      rerender(<FeedbackModal isOpen={false} onClose={onClose} />);
    } else {
      unmount();
    }
    act(() => { vi.advanceTimersByTime(3000); });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    [{ success: false, error: '本地存储空间不足' }, '本地存储空间不足'],
    [{ success: false }, '提交失败，请稍后重试'],
  ] satisfies [FeedbackSubmitResult, string][])('显示提交失败原因并允许修改后重试', async (result, message) => {
    mockSubmitFeedback.mockResolvedValue(result);
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: '提交反馈' })).toBeEnabled();
    expect(screen.getByPlaceholderText('简要描述您的问题或建议')).toHaveValue(title);

    fireEvent.change(screen.getByPlaceholderText('简要描述您的问题或建议'), {
      target: { value: `${title}，补充说明` },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    mockSubmitFeedback.mockResolvedValue({ success: true });
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));
    expect(await screen.findByRole('status')).toHaveTextContent('提交成功！');
    expect(mockSubmitFeedback).toHaveBeenCalledTimes(2);
  });

  it('捕获提交异常并恢复操作，不泄露底层异常信息', async () => {
    mockSubmitFeedback.mockRejectedValue(new Error('内部存储异常详情'));
    render(<FeedbackModal isOpen onClose={vi.fn()} />);
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: '提交反馈' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('提交过程中发生错误，请稍后重试');
    expect(screen.queryByText('内部存储异常详情')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
  });

  it.each(['关闭', '取消'])('通过%s关闭后，重新打开恢复初始类别和空白内容', buttonName => {
    const onClose = vi.fn();
    const { rerender } = render(<FeedbackModal isOpen onClose={onClose} initialCategory="bug" />);
    fillValidForm();
    fireEvent.click(screen.getByRole('radio', { name: '体验问题' }));
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<FeedbackModal isOpen={false} onClose={onClose} initialCategory="bug" />);
    rerender(<FeedbackModal isOpen onClose={onClose} initialCategory="bug" />);
    expect(screen.getByRole('radio', { name: 'Bug 反馈' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByPlaceholderText('简要描述您的问题或建议')).toHaveValue('');
    expect(within(screen.getByRole('group', { name: '评分' })).queryByRole('button', { pressed: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '提交反馈' })).toBeDisabled();
  });
});
