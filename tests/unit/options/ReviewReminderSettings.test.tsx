import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewReminderSettings from '@/options/components/ReviewReminderSettings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { DEFAULT_REVIEW_REMINDER_CONFIG } from '@/shared/types';

const settings = {
  ...DEFAULT_SETTINGS,
  reviewReminder: { ...DEFAULT_REVIEW_REMINDER_CONFIG },
};

afterEach(cleanup);

describe('复习提醒设置', () => {
  it('关闭提醒后仍可保存关闭状态', async () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('checkbox', { name: '启用复习提醒' }));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      reviewReminder: { ...DEFAULT_REVIEW_REMINDER_CONFIG, enabled: false },
    }));
  });

  it('修改时间后关闭提醒仍保留草稿，保存期间不能重复提交关闭操作', async () => {
    let finish!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: '小时' }), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '启用复习提醒' }));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      reviewReminder: { ...settings.reviewReminder, enabled: false, reminderHour: 8 },
    });

    view.rerender(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving />);
    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存中...' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await act(async () => finish());

    expect(screen.getByRole('checkbox', { name: '启用复习提醒' })).not.toBeChecked();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('未配置提醒时展示默认时间和复习参数，不自动保存', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<ReviewReminderSettings settings={{ ...DEFAULT_SETTINGS, reviewReminder: undefined }} onUpdate={onUpdate} isSaving={false} />);

    expect(screen.getByRole('checkbox', { name: '启用复习提醒' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: '小时' })).toHaveValue('20');
    expect(screen.getByRole('combobox', { name: '分钟' })).toHaveValue('0');
    expect(screen.getByRole('spinbutton', { name: '每日复习上限' })).toHaveValue(20);
    expect(screen.getByRole('spinbutton', { name: '最小提醒词汇数' })).toHaveValue(5);
    expect(screen.getByRole('spinbutton', { name: '掌握阈值' })).toHaveValue(3);
    expect(screen.getByRole('checkbox', { name: '浏览器通知' })).toBeChecked();
    expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('从关闭状态启用后显示选项，明确保存才提交', async () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<ReviewReminderSettings settings={{
      ...settings, reviewReminder: { ...settings.reviewReminder, enabled: false },
    }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('checkbox', { name: '启用复习提醒' })).not.toBeChecked();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText(/系统使用 SM-2 算法/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: '启用复习提醒' }));
    expect(screen.getByRole('combobox', { name: '小时' })).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ reviewReminder: settings.reviewReminder });
  });

  it.each([[0, 15], [23, 45]])('编辑提醒时间 %i:%i 后一次保存完整配置', async (hour, minute) => {
    const onUpdate = vi.fn(async () => undefined);
    const original = Object.freeze({ ...settings.reviewReminder });
    render(<ReviewReminderSettings settings={{ ...settings, reviewReminder: original }} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.change(screen.getByRole('combobox', { name: '小时' }), { target: { value: String(hour) } });
    fireEvent.change(screen.getByRole('combobox', { name: '分钟' }), { target: { value: String(minute) } });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      reviewReminder: { ...original, reminderHour: hour, reminderMinute: minute },
    });
    expect(original.reminderHour).toBe(20);
    expect(original.reminderMinute).toBe(0);
  });

  it.each([
    ['每日复习上限', 'dailyReviewLimit', 5],
    ['每日复习上限', 'dailyReviewLimit', 100],
    ['最小提醒词汇数', 'minWordsForReminder', 1],
    ['最小提醒词汇数', 'minWordsForReminder', 20],
    ['掌握阈值', 'masteredThreshold', 2],
    ['掌握阈值', 'masteredThreshold', 10],
  ] as const)('%s支持边界值 %s=%i', async (label, field, value) => {
    const onUpdate = vi.fn(async () => undefined);
    render(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value: String(value) } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ reviewReminder: { ...settings.reviewReminder, [field]: value } });
  });

  it.each([
    ['每日复习上限', 'dailyReviewLimit', 20],
    ['最小提醒词汇数', 'minWordsForReminder', 5],
    ['掌握阈值', 'masteredThreshold', 3],
  ] as const)('清空%s时回退到有效默认值 %s=%i', async (label, field, value) => {
    const onUpdate = vi.fn(async () => undefined);
    render(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: label }), { target: { value: '' } });
    expect(screen.getByRole('spinbutton', { name: label })).toHaveValue(value);
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ reviewReminder: { ...settings.reviewReminder, [field]: value } });
  });

  it.each([true, false])('浏览器通知为 %s 时切换只修改通知字段', async enableNotifications => {
    const onUpdate = vi.fn(async () => undefined);
    render(<ReviewReminderSettings settings={{
      ...settings, reviewReminder: { ...settings.reviewReminder, enableNotifications },
    }} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '浏览器通知' }));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      reviewReminder: { ...settings.reviewReminder, enableNotifications: !enableNotifications },
    });
  });

  it('保存未完成时保留保存按钮，父级保存状态禁用重复提交', async () => {
    let finish!: () => void;
    const onUpdate = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const view = render(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: '分钟' }), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();

    view.rerender(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving />);
    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存中...' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('收到新的外部配置时更新控件并清除旧的保存提示', () => {
    const onUpdate = vi.fn(async () => undefined);
    const view = render(<ReviewReminderSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: '小时' }), { target: { value: '7' } });
    expect(screen.getByRole('button', { name: '保存设置' })).toBeInTheDocument();

    view.rerender(<ReviewReminderSettings settings={{
      ...settings, reviewReminder: { ...settings.reviewReminder, reminderHour: 22, enableNotifications: false },
    }} onUpdate={onUpdate} isSaving={false} />);

    expect(screen.getByRole('combobox', { name: '小时' })).toHaveValue('22');
    expect(screen.getByRole('checkbox', { name: '浏览器通知' })).not.toBeChecked();
    expect(screen.queryByRole('button', { name: '保存设置' })).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
