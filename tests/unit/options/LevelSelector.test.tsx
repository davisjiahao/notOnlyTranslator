import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LevelSelector from '@/options/components/LevelSelector';
import { DEFAULT_USER_PROFILE } from '@/shared/constants';
import type { UserProfile } from '@/shared/types';

const profile: UserProfile = { ...DEFAULT_USER_PROFILE, unknownWords: [], examScore: 710 };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('英语水平设置', () => {
  it('区分当前学习估算和考试预览，展示真实快照而不伪造历史图表', () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={profile} onUpdate={onUpdate} isSaving={false} />);

    expect(screen.getByRole('radio', { name: /CET-4/ })).toBeChecked();
    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue('710');
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(710);
    expect(screen.getByLabelText('当前学习估算')).toHaveTextContent('4,500 词');
    expect(screen.getByLabelText('考试推算预览')).toHaveTextContent('4,500');
    expect(screen.getByRole('progressbar', { name: '预览词汇水平' })).toHaveAttribute('aria-valuetext', '4,500 词，尚未应用');
    expect(screen.getByText('当前学习估算置信度: 50%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '能力分析' })).toBeInTheDocument();
    expect(screen.getByText('已标记认识')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '词汇量历史：数据不足' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '能力模型' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: '词汇量增长趋势' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '用此预览替换当前学习估算' })).not.toBeChecked();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('缺少成绩时显示合法默认分数，普通保存不把预览替换为学习估算', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    const original = Object.freeze({ ...profile, examScore: undefined });
    render(<LevelSelector profile={original} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue('220');
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(220);
    expect(screen.getByLabelText('考试推算预览')).toHaveTextContent('2,700');
    expect(screen.getByLabelText('当前学习估算')).toHaveTextContent('4,500');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存考试信息' })); });

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ examType: 'cet4', examScore: 220 });
    expect(original.examScore).toBeUndefined();
    expect(original.estimatedVocabulary).toBe(4500);
  });

  it.each([
    ['CET-4', 'cet4', 465, 3600, 220, 710, 10],
    ['CET-6', 'cet6', 465, 4800, 220, 710, 10],
    ['TOEFL', 'toefl', 60, 6000, 0, 120, 1],
    ['IELTS', 'ielts', 5, 5444, 0, 9, 0.5],
    ['GRE', 'gre', 150, 9000, 130, 170, 1],
  ] as const)('切换到%s更新默认分数和边界，只有确认后才应用预览', async (name, examType, score, vocabulary, min, max, step) => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={{ ...profile, examType: 'custom' }} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));

    expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeChecked();
    const slider = screen.getByRole('slider', { name: '考试分数' });
    expect(slider).toHaveAttribute('min', String(min));
    expect(slider).toHaveAttribute('max', String(max));
    expect(slider).toHaveAttribute('step', String(step));
    expect(slider).toHaveValue(String(score));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(vocabulary));
    expect(screen.getByLabelText('当前学习估算')).toHaveTextContent('4,500');
    expect(onUpdate).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存考试信息' })); });
    expect(onUpdate).toHaveBeenNthCalledWith(1, { examType, examScore: score });
    fireEvent.click(screen.getByRole('checkbox', { name: '用此预览替换当前学习估算' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用预览并保存' })); });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { examType, examScore: score, estimatedVocabulary: vocabulary });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('重复选择当前考试保留用户输入，不重置为默认分数或自动保存', () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={profile} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: '考试分数数值' }), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('radio', { name: /CET-4/ }));
    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue('600');
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(600);
    expect(screen.getByLabelText('考试推算预览')).toHaveTextContent('4,096');
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['slider', '考试分数', 220, 2700],
    ['spinbutton', '考试分数数值', 600, 4096],
  ] as const)('通过%s修改%s为%i同步另一输入，只更新未应用的预览', async (role, label, score, vocabulary) => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={profile} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '用此预览替换当前学习估算' }));
    fireEvent.change(screen.getByRole(role, { name: label }), { target: { value: String(score) } });

    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue(String(score));
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(score);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(vocabulary));
    expect(screen.getByLabelText('当前学习估算')).toHaveTextContent('4,500');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存考试信息' })); });
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ examType: 'cet4', examScore: score });
  });

  it('雅思支持零分和半分，保留零分且应用预览需要明确确认', async () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={{ ...profile, examType: 'ielts', examScore: 0 }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(0);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3500');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存考试信息' })); });
    expect(onUpdate).toHaveBeenLastCalledWith({ examType: 'ielts', examScore: 0 });

    fireEvent.change(screen.getByRole('spinbutton', { name: '考试分数数值' }), { target: { value: '6.5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: '用此预览替换当前学习估算' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用预览并保存' })); });

    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue('6.5');
    expect(onUpdate).toHaveBeenLastCalledWith({ examType: 'ielts', examScore: 6.5, estimatedVocabulary: 6028 });
  });

  it.each([1000, 20000])('自定义词汇量%i仅显式确认后替换，不携带成绩或改变输入档案', async vocabulary => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    const original = Object.freeze({ ...profile });
    render(<LevelSelector profile={original} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('radio', { name: '自定义' }));
    expect(screen.queryByRole('slider', { name: '考试分数' })).not.toBeInTheDocument();
    expect(screen.queryByText(/基准:/)).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '估计词汇量' })).toHaveValue(4500);

    fireEvent.change(screen.getByRole('spinbutton', { name: '估计词汇量' }), { target: { value: String(vocabulary) } });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(vocabulary));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '保存水平信息' })); });
    expect(onUpdate).toHaveBeenNthCalledWith(1, { examType: 'custom', examScore: undefined });
    fireEvent.click(screen.getByRole('checkbox', { name: '用此预览替换当前学习估算' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '应用预览并保存' })); });

    expect(onUpdate).toHaveBeenNthCalledWith(2, { examType: 'custom', examScore: undefined, estimatedVocabulary: vocabulary });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(original).toEqual(profile);
  });

  it.each(['', '219', '711'])('空白或越界分数 %j 不能保存或确认替换估算', value => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={profile} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: '考试分数数值' }), { target: { value } });
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('220–710');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存考试信息' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存考试信息' }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each(['', '999', '20001', '1000.5'])('自定义词汇量 %j 不满足整数范围时拒绝保存', value => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={{ ...profile, examType: 'custom' }} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('spinbutton', { name: '估计词汇量' }), { target: { value } });
    expect(screen.getByRole('spinbutton')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('1000–20000 之间的整数');
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: '保存水平信息' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '保存水平信息' }));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('保存期间禁用保存和替换确认，不重复发送档案更新', () => {
    const onUpdate = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={{ ...profile, examType: 'custom' }} onUpdate={onUpdate} isSaving />);
    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '保存中...' }));

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
