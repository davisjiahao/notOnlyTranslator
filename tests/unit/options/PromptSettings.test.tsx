import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import PromptSettings from '@/options/components/PromptSettings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import { PROMPT_VERSIONS } from '@/shared/prompts';

afterEach(cleanup);

describe('提示词版本设置', () => {
  it.each([undefined, ''])('未配置版本 %s 时使用稳定版本，并展示真实模板而不发起保存', promptVersion => {
    const onUpdate = vi.fn(async () => undefined);
    render(<PromptSettings settings={{ ...DEFAULT_SETTINGS, promptVersion }} onUpdate={onUpdate} isSaving={false} />);

    expect(screen.getByRole('radio', { name: /^v1\.0\.0/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^v2\.0\.0-beta/ })).not.toBeChecked();
    expect(screen.getByRole('heading', { name: '版本详情' })).toBeInTheDocument();
    expect(screen.getByText(PROMPT_VERSIONS['v1.0.0'].systemPrompt, { normalizer: value => value })).toBeInTheDocument();
    expect(screen.getByText(JSON.stringify(PROMPT_VERSIONS['v1.0.0'].outputSchema, null, 2), { normalizer: value => value })).toBeInTheDocument();
    expect(screen.getByText('JSON', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('0.95', { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('读取已保存的实验版本，点击稳定版本后提交并切换详情', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<PromptSettings settings={{ ...DEFAULT_SETTINGS, promptVersion: 'v2.0.0-beta' }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('radio', { name: /^v2\.0\.0-beta/ })).toBeChecked();
    expect(screen.getByText('0.9', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(PROMPT_VERSIONS['v2.0.0-beta'].systemPrompt, { normalizer: value => value })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /^v1\.0\.0/ }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ promptVersion: 'v1.0.0' });
    expect(screen.getByRole('radio', { name: /^v1\.0\.0/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /^v2\.0\.0-beta/ })).not.toBeChecked();
    expect(screen.getByText('0.95', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText(PROMPT_VERSIONS['v2.0.0-beta'].systemPrompt, { normalizer: value => value })).not.toBeInTheDocument();
  });

  it('未知历史版本不渲染无效详情，仍可选择可用版本恢复', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<PromptSettings settings={{ ...DEFAULT_SETTINGS, promptVersion: 'removed-version' }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.queryByRole('heading', { name: '版本详情' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '模型参数' })).not.toBeInTheDocument();
    expect(screen.queryByText('当前使用')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /^v2\.0\.0-beta/ }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ promptVersion: 'v2.0.0-beta' });
    expect(screen.getByRole('heading', { name: '版本详情' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '模型参数' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^v2\.0\.0-beta/ })).toBeChecked();
  });

  it('保存期间禁用所有版本，不提交额外请求', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<PromptSettings settings={{ ...DEFAULT_SETTINGS, promptVersion: 'v1.0.0' }} onUpdate={onUpdate} isSaving />);

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled();
      fireEvent.click(radio);
    }

    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /^v1\.0\.0/ })).toBeChecked();
  });
});
