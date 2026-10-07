import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import LevelSelector from '@/options/components/LevelSelector';
import { DEFAULT_USER_PROFILE } from '@/shared/constants';
import type { UserProfile } from '@/shared/types';

const profile: UserProfile = { ...DEFAULT_USER_PROFILE, unknownWords: [], examScore: 710 };

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 300));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('英语水平设置', () => {
  it('根据档案显示考试、估算词汇量与置信度，不自动保存', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<LevelSelector profile={profile} onUpdate={onUpdate} isSaving={false} />);

    expect(screen.getByRole('radio', { name: /CET-4/ })).toBeChecked();
    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue('710');
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(710);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4500');
    expect(screen.getByText('当前水平置信度: 50%')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '能力分析' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '能力模型' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '词汇量增长趋势' })).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('未提供考试成绩时使用基准词汇量，保存仍保留未填写状态', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<LevelSelector profile={{ ...profile, examScore: undefined }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue('220');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4500');

    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ examType: 'cet4', examScore: undefined, estimatedVocabulary: 4500 });
  });

  it.each([
    ['CET-4', 'cet4', 465, 3600, 220, 710, 10],
    ['CET-6', 'cet6', 465, 4800, 220, 710, 10],
    ['TOEFL', 'toefl', 60, 6000, 0, 120, 1],
    ['IELTS', 'ielts', 5, 5444, 0, 9, 0.5],
    ['GRE', 'gre', 150, 9000, 130, 170, 1],
  ] as const)('选择%s后重置到对应默认分数，并更新边界和保存参数', (name, examType, score, vocabulary, min, max, step) => {
    const onUpdate = vi.fn(async () => undefined);
    render(<LevelSelector profile={profile} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));

    expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeChecked();
    const slider = screen.getByRole('slider', { name: '考试分数' });
    expect(slider).toHaveAttribute('min', String(min));
    expect(slider).toHaveAttribute('max', String(max));
    expect(slider).toHaveAttribute('step', String(step));
    expect(slider).toHaveValue(String(score));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(vocabulary));
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ examType, examScore: score, estimatedVocabulary: vocabulary });
  });

  it.each([
    ['slider', '考试分数', 220, 2700],
    ['spinbutton', '考试分数数值', 600, 4096],
  ] as const)('通过%s修改%s为%i时同步另一输入并重新估算词汇量', (role, label, score, vocabulary) => {
    const onUpdate = vi.fn(async () => undefined);
    render(<LevelSelector profile={profile} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.change(screen.getByRole(role, { name: label }), { target: { value: String(score) } });

    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue(String(score));
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(score);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(vocabulary));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ examType: 'cet4', examScore: score, estimatedVocabulary: vocabulary });
  });

  it('雅思支持半分与零分，不把零分替换成未填写成绩', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<LevelSelector profile={{ ...profile, examType: 'ielts', examScore: 0 }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('spinbutton', { name: '考试分数数值' })).toHaveValue(0);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3500');
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
    expect(onUpdate).toHaveBeenLastCalledWith({ examType: 'ielts', examScore: 0, estimatedVocabulary: 3500 });

    fireEvent.change(screen.getByRole('spinbutton', { name: '考试分数数值' }), { target: { value: '6.5' } });
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(screen.getByRole('slider', { name: '考试分数' })).toHaveValue('6.5');
    expect(onUpdate).toHaveBeenLastCalledWith({ examType: 'ielts', examScore: 6.5, estimatedVocabulary: 6028 });
  });

  it.each([1000, 20000])('自定义词汇量%i保存时不携带考试成绩，也不改变输入档案', vocabulary => {
    const onUpdate = vi.fn(async () => undefined);
    const original = Object.freeze({ ...profile });
    render(<LevelSelector profile={original} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('radio', { name: '自定义' }));
    expect(screen.queryByRole('slider', { name: '考试分数' })).not.toBeInTheDocument();
    expect(screen.queryByText(/基准:/)).not.toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: '估计词汇量' })).toHaveValue(4500);

    fireEvent.change(screen.getByRole('spinbutton', { name: '估计词汇量' }), { target: { value: String(vocabulary) } });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(vocabulary));
    fireEvent.click(screen.getByRole('button', { name: '保存设置' }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ examType: 'custom', examScore: undefined, estimatedVocabulary: vocabulary });
    expect(original.examType).toBe('cet4');
    expect(original.estimatedVocabulary).toBe(4500);
  });

  it('保存期间禁用保存按钮，不重复发送档案更新', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<LevelSelector profile={{ ...profile, examType: 'custom' }} onUpdate={onUpdate} isSaving />);
    expect(screen.getByRole('button', { name: '保存中...' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '保存中...' }));

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
