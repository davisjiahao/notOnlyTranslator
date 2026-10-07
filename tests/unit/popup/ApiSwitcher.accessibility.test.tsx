import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ApiSwitcher from '@/popup/components/ApiSwitcher';
import { DEFAULT_SETTINGS } from '@/shared/constants';

const configs = [
  { id: 'one', name: '主配置', provider: 'openai' as const, apiKey: '', tested: true, createdAt: 1 },
  { id: 'two', name: '备用配置', provider: 'anthropic' as const, apiKey: '', tested: false, createdAt: 2 },
];
const settings = { ...DEFAULT_SETTINGS, apiConfigs: configs, activeApiConfigId: 'two' };
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

const activeOption = (trigger: HTMLElement) => document.getElementById(trigger.getAttribute('aria-activedescendant') || '');

describe('API 选择器无障碍协议', () => {
  it('打开定位已选项，真实焦点保留在触发器，选项不进入 Tab 顺序', () => {
    render(<ApiSwitcher settings={settings} onUpdateSettings={vi.fn()} onOpenOptions={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    expect(activeOption(trigger)).toBe(screen.getByRole('option', { name: /备用配置/ }));
    expect(activeOption(trigger)).toHaveAttribute('aria-selected', 'true');
    expect(trigger).toHaveFocus();
    screen.getAllByRole('option').forEach(option => expect(option).toHaveAttribute('tabindex', '-1'));
    fireEvent.keyDown(trigger, { key: 'Home' });
    expect(activeOption(trigger)).toBe(screen.getByRole('option', { name: /主配置/ }));
    fireEvent.keyDown(trigger, { key: 'End' });
    expect(activeOption(trigger)).toBe(screen.getByRole('option', { name: /备用配置/ }));
    fireEvent.keyDown(trigger, { key: 'Tab' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-activedescendant');
  });

  it('空配置直接提供可用操作，不生成包含按钮的空 listbox', () => {
    const manage = vi.fn();
    render(<ApiSwitcher settings={DEFAULT_SETTINGS} onUpdateSettings={vi.fn()} onOpenOptions={manage} />);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '立即配置' }));
    expect(manage).toHaveBeenCalledOnce();
  });

  it('配置被移除后活动项仍指向现有选项', () => {
    const props = { onUpdateSettings: vi.fn(), onOpenOptions: vi.fn() };
    const { rerender } = render(<ApiSwitcher settings={settings} {...props} />);
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);
    rerender(<ApiSwitcher settings={{ ...settings, apiConfigs: [configs[0]] }} {...props} />);
    expect(activeOption(trigger)).toBe(screen.getByRole('option', { name: /主配置/ }));
    expect(activeOption(trigger)).toHaveAttribute('aria-selected', 'true');
  });

  it('保存异常可重试，正在保存时不重复提交，退出后完成不抢焦点', async () => {
    let finish: (ok: boolean) => void = () => {};
    const update = vi.fn().mockRejectedValueOnce(new Error('离线')).mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    render(<><ApiSwitcher settings={settings} onUpdateSettings={update} onOpenOptions={vi.fn()} /><button>后续操作</button></>);
    const trigger = screen.getByRole('combobox');
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Home' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('切换失败'));
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(update).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(trigger, { key: 'Tab' });
    screen.getByRole('button', { name: '后续操作' }).focus();
    finish(true);
    await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'));
    expect(screen.getByRole('button', { name: '后续操作' })).toHaveFocus();
  });
});
