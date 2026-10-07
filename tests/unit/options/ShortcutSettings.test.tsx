import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ShortcutSettings from '@/options/components/ShortcutSettings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

const settings = (shortcuts?: UserSettings['shortcuts']): UserSettings => ({ ...DEFAULT_SETTINGS, shortcuts });
const renderSettings = (onUpdate = vi.fn(async () => {}), saved?: UserSettings['shortcuts'], isSaving = false) =>
  render(<ShortcutSettings settings={settings(saved)} onUpdate={onUpdate} isSaving={isSaving} />);

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('快捷键设置', () => {
  it('合并已有设置，未配置项目沿用默认，并可重置全部', async () => {
    const onUpdate = vi.fn(async () => {});
    renderSettings(onUpdate, [{ action: 'next-highlight', key: 'Ctrl+N', enabled: false }]);
    expect(await screen.findByRole('switch', { name: '下一个高亮词汇 — 已禁用' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ctrl+N' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'K' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重置为默认' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: '下一个高亮词汇 — 已启用' })).toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledWith({ shortcuts: expect.arrayContaining([expect.objectContaining({ action: 'next-highlight', key: 'J', enabled: true })]) });
  });

  it('按键组合保存到完整列表，Escape 取消，单独修饰键不保存', async () => {
    const onUpdate = vi.fn(async () => {});
    renderSettings(onUpdate);
    await screen.findByRole('button', { name: 'J' });
    fireEvent.click(screen.getByRole('button', { name: 'J' }));
    fireEvent.keyDown(window, { key: 'Control', ctrlKey: true });
    fireEvent.keyUp(window, { key: 'Control', ctrlKey: true });
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'ArrowDown', ctrlKey: true });
    fireEvent.keyUp(window, { key: 'ArrowDown', ctrlKey: true });
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ shortcuts: expect.arrayContaining([expect.objectContaining({ action: 'next-highlight', key: 'Ctrl+↓' })]) }));
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+↓' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyUp(window, { key: 'Escape' });
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('切换保存失败时保持原有设置，并提示失败以便重试', async () => {
    const onUpdate = vi.fn().mockRejectedValueOnce(new Error('磁盘不可用')).mockResolvedValue(undefined);
    renderSettings(onUpdate);
    const enabled = await screen.findByRole('switch', { name: '下一个高亮词汇 — 已启用' });
    fireEvent.click(enabled);
    expect(await screen.findByRole('alert')).toHaveTextContent('保存快捷键失败');
    expect(screen.getByRole('switch', { name: '下一个高亮词汇 — 已启用' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch', { name: '下一个高亮词汇 — 已启用' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: '下一个高亮词汇 — 已禁用' })).toBeInTheDocument());
  });

  it('保存中禁用编辑/开关/重置，但允许打开浏览器全局快捷键设置', async () => {
    const create = vi.fn();
    vi.stubGlobal('chrome', { tabs: { create } });
    renderSettings(vi.fn(async () => {}), undefined, true);
    const button = await screen.findByRole('button', { name: 'J' });
    expect(button).toBeDisabled();
    expect(screen.getByRole('switch', { name: '下一个高亮词汇 — 已启用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '重置为默认' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Alt+T' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '配置全局快捷键' }));
    expect(create).toHaveBeenCalledWith({ url: 'chrome://extensions/shortcuts' });
  });

  it('外部保存设置更新后同步显示新按键', async () => {
    const { rerender } = renderSettings();
    await screen.findByRole('button', { name: 'J' });
    await act(async () => rerender(<ShortcutSettings settings={settings([{ action: 'next-highlight', key: 'N', enabled: true }])} onUpdate={vi.fn(async () => {})} isSaving={false} />));
    expect(screen.getByRole('button', { name: 'N' })).toBeInTheDocument();
  });
});
