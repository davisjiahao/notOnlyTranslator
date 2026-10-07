import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LevelSelector from '@/options/components/LevelSelector';
import { DEFAULT_USER_PROFILE } from '@/shared/constants';
import { calculateVocabularySize } from '@/shared/utils';

vi.mock('@/options/components/StatsCharts', () => ({ StatsCharts: () => null }));
const profile = { ...DEFAULT_USER_PROFILE, estimatedVocabulary: 4500 };

describe('英语水平估算保护', () => {
  it('明确区分当前估算和预览，普通保存不会覆盖当前估算', async () => {
    const update = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={profile} onUpdate={update} isSaving={false} />);
    expect(screen.getByLabelText('当前学习估算')).toHaveTextContent('4,500');
    expect(screen.getByLabelText('考试推算预览')).toHaveTextContent(calculateVocabularySize(profile.examType, profile.examScore).toLocaleString());
    fireEvent.click(screen.getByRole('button', { name: '保存考试信息' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update.mock.calls[0][0]).toEqual({ examType: profile.examType, examScore: profile.examScore });
  });

  it('明确确认才能应用预览，成功后解除确认；再次编辑也解除确认', async () => {
    const update = vi.fn().mockResolvedValue(true);
    render(<LevelSelector profile={profile} onUpdate={update} isSaving={false} />);
    const confirm = screen.getByRole('checkbox', { name: /用此预览替换当前学习估算/ });
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: '应用预览并保存' }));
    await waitFor(() => expect(confirm).not.toBeChecked());
    expect(update.mock.calls[0][0].estimatedVocabulary).toBe(calculateVocabularySize(profile.examType, profile.examScore));
    fireEvent.click(confirm);
    fireEvent.change(screen.getByRole('spinbutton', { name: '考试分数数值' }), { target: { value: '500' } });
    expect(confirm).not.toBeChecked();
  });

  it('失败保留输入和确认，外部估算更新会使旧确认失效', async () => {
    const update = vi.fn().mockResolvedValue(false);
    const { rerender } = render(<LevelSelector profile={profile} onUpdate={update} isSaving={false} />);
    const confirm = screen.getByRole('checkbox', { name: /用此预览替换当前学习估算/ });
    fireEvent.change(screen.getByRole('spinbutton', { name: '考试分数数值' }), { target: { value: '600' } });
    fireEvent.click(confirm);
    fireEvent.click(screen.getByRole('button', { name: '应用预览并保存' }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(confirm).toBeChecked();
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(600);
    rerender(<LevelSelector profile={{ ...profile, estimatedVocabulary: 4800 }} onUpdate={update} isSaving={false} />);
    expect(confirm).not.toBeChecked();
    expect(screen.getByLabelText('当前学习估算')).toHaveTextContent('4,800');
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(600);
  });

  it('空白或越界分数不可保存，零分和雅思小数可用', () => {
    render(<LevelSelector profile={{ ...profile, examType: 'ielts', examScore: 0 }} onUpdate={vi.fn()} isSaving={false} />);
    const score = screen.getByRole('spinbutton', { name: '考试分数数值' });
    const save = screen.getByRole('button', { name: '保存考试信息' });
    expect(score).toHaveValue(0);
    expect(save).toBeEnabled();
    fireEvent.change(score, { target: { value: '' } });
    expect(score).toHaveValue(null);
    expect(save).toBeDisabled();
    fireEvent.change(score, { target: { value: '10' } });
    expect(save).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('0–9');
    fireEvent.change(score, { target: { value: '6.5' } });
    expect(save).toBeEnabled();
  });

  it('自定义输入边界有效，进度条不会超过 aria 上限', () => {
    render(<LevelSelector profile={{ ...profile, examType: 'custom' }} onUpdate={vi.fn()} isSaving={false} />);
    const input = screen.getByRole('spinbutton', { name: '估计词汇量' });
    fireEvent.change(input, { target: { value: '999' } });
    expect(screen.getByRole('button', { name: '保存水平信息' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '20000' } });
    const progress = screen.getByRole('progressbar');
    expect(Number(progress.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(Number(progress.getAttribute('aria-valuemax')));
    expect(screen.getByLabelText('自定义词汇量预览')).toHaveTextContent('20,000');
  });
});
