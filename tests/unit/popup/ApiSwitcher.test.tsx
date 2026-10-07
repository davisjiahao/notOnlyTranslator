import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ApiSwitcher from '@/popup/components/ApiSwitcher';
import { DEFAULT_SETTINGS } from '@/shared/constants';

const configs = [
  { id: 'one', name: '主配置', provider: 'openai' as const, apiKey: '', modelName: 'model-a', tested: true, createdAt: 1 },
  { id: 'two', name: '备用配置', provider: 'anthropic' as const, apiKey: '', tested: false, createdAt: 2 },
];
const settings = { ...DEFAULT_SETTINGS, apiConfigs: configs, activeApiConfigId: 'one' };

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe('翻译服务选择', () => {
  it('免费引擎显示实际服务而非旧 API 配置', () => {
    const manage = vi.fn();
    render(<ApiSwitcher settings={{ ...settings, apiProvider: 'free_google_translate' }} onUpdateSettings={vi.fn()} onOpenOptions={manage} />);
    expect(screen.getByText('Google 免费翻译')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('管理'));
    expect(manage).toHaveBeenCalledOnce();
  });

  it('键盘选择后保存配置并恢复触发器焦点', async () => {
    const update = vi.fn().mockResolvedValue(true);
    render(<ApiSwitcher settings={settings} onUpdateSettings={update} onOpenOptions={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    expect(update).toHaveBeenCalledWith({ activeApiConfigId: 'two' });
    expect(trigger).toHaveFocus();
  });

  it('向上循环、普通按键、Escape与外部点击可退出', () => {
    render(<ApiSwitcher settings={settings} onUpdateSettings={vi.fn()} onOpenOptions={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.keyDown(trigger, { key: 'x' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: ' ' });
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    fireEvent.keyDown(trigger, { key: 'x' });
    expect(screen.getByRole('option', { name: /备用配置/ })).toHaveClass('outline');
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('保存失败保留原配置供重试', async () => {
    const update = vi.fn().mockResolvedValue(false);
    render(<ApiSwitcher settings={settings} onUpdateSettings={update} onOpenOptions={vi.fn()} />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: /备用配置/ }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: /主配置/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('空配置给出管理入口', () => {
    const manage = vi.fn();
    render(<ApiSwitcher settings={DEFAULT_SETTINGS} onUpdateSettings={vi.fn()} onOpenOptions={manage} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(screen.getByText('立即配置'));
    expect(manage).toHaveBeenCalledOnce();
  });
});
