import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import TranslationStyleSettings from '@/options/components/TranslationStyleSettings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { TranslationStyleConfig, UserSettings } from '@/shared/types';

const defaults: TranslationStyleConfig = {
  highlightStyle: 'background',
  highlightOpacity: 80,
  translationLineOpacity: 60,
  translationLineIndent: 16,
  showOriginalAnnotation: true,
};

const settings: UserSettings = { ...DEFAULT_SETTINGS, translationStyle: undefined };

afterEach(cleanup);

describe('翻译样式设置', () => {
  it('旧配置使用默认样式与可访问的范围控件，不自动保存', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<TranslationStyleSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);

    expect(screen.getByRole('radio', { name: /背景高亮/ })).toBeChecked();
    expect(screen.getByRole('slider', { name: '高亮透明度' })).toHaveValue('80');
    expect(screen.getByRole('slider', { name: '译文行透明度' })).toHaveValue('60');
    expect(screen.getByRole('slider', { name: '译文行缩进' })).toHaveValue('16');
    expect(screen.getByRole('combobox', { name: '译文字体' })).toHaveValue('');
    expect(screen.getByRole('switch', { name: '显示原文标注' })).toBeChecked();
    expect(screen.getByText('(example: 示例)')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: '自定义 CSS' })).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ['背景高亮', 'background', 'bg-yellow-200'],
    ['下划线', 'underline', 'decoration-blue-500'],
    ['加粗', 'bold', 'font-bold'],
    ['虚线', 'dotted', 'decoration-dotted'],
  ] as const)('选择%s保存配置，并在收到更新后展示相应效果', (name, highlightStyle, previewClass) => {
    const onUpdate = vi.fn(async () => undefined);
    const originalStyle = Object.freeze({ ...defaults, highlightOpacity: 40, customCss: '.word { color: blue; }' });
    const originalSettings = { ...settings, translationStyle: originalStyle };
    const view = render(<TranslationStyleSettings settings={originalSettings} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ translationStyle: { ...originalStyle, highlightStyle } });
    expect(originalStyle.highlightStyle).toBe('background');
    view.rerender(<TranslationStyleSettings settings={{
      ...settings, translationStyle: { ...originalStyle, highlightStyle },
    }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('radio', { name: new RegExp(name) })).toBeChecked();
    expect(screen.getByText('example', { exact: true })).toHaveClass(previewClass);
    expect(screen.getByText('example', { exact: true })).toHaveStyle({ opacity: '0.4' });
  });

  it.each([
    ['高亮透明度', 'highlightOpacity', 20],
    ['高亮透明度', 'highlightOpacity', 100],
    ['译文行透明度', 'translationLineOpacity', 0],
    ['译文行透明度', 'translationLineOpacity', 100],
    ['译文行缩进', 'translationLineIndent', 0],
    ['译文行缩进', 'translationLineIndent', 48],
  ] as const)('%s支持边界值 %s=%i，并保留其他设置', (label, field, value) => {
    const onUpdate = vi.fn(async () => undefined);
    render(<TranslationStyleSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.change(screen.getByRole('slider', { name: label }), { target: { value: String(value) } });

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ translationStyle: { ...defaults, [field]: value } });
  });

  it('选择字体后可以恢复跟随系统，清空时提交 undefined', () => {
    const onUpdate = vi.fn(async () => undefined);
    const view = render(<TranslationStyleSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: '译文字体' }), { target: { value: 'Georgia, serif' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ translationStyle: { ...defaults, translationFontFamily: 'Georgia, serif' } });

    view.rerender(<TranslationStyleSettings settings={{
      ...settings, translationStyle: { ...defaults, translationFontFamily: 'Georgia, serif' },
    }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('combobox', { name: '译文字体' })).toHaveValue('Georgia, serif');
    fireEvent.change(screen.getByRole('combobox', { name: '译文字体' }), { target: { value: '' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ translationStyle: { ...defaults, translationFontFamily: undefined } });
  });

  it.each([true, false])('原文标注为 %s 时可切换，并根据配置更新预览', showOriginalAnnotation => {
    const onUpdate = vi.fn(async () => undefined);
    const view = render(<TranslationStyleSettings settings={{
      ...settings, translationStyle: { ...defaults, showOriginalAnnotation },
    }} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('switch', { name: '显示原文标注' }));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      translationStyle: { ...defaults, showOriginalAnnotation: !showOriginalAnnotation },
    });

    view.rerender(<TranslationStyleSettings settings={{
      ...settings, translationStyle: { ...defaults, showOriginalAnnotation: !showOriginalAnnotation },
    }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('switch', { name: '显示原文标注' })).toHaveAttribute('aria-checked', String(!showOriginalAnnotation));
    expect(screen.queryByText('(example: 示例)') !== null).toBe(!showOriginalAnnotation);
  });

  it('展开和收起 CSS 不保存设置，编辑及清空时才提交新值', () => {
    const onUpdate = vi.fn(async () => undefined);
    const view = render(<TranslationStyleSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/错误的 CSS 可能导致显示异常/)).toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();

    const customCss = '.word::after { content: "学习 & <词汇>"; }';
    fireEvent.change(screen.getByRole('textbox', { name: '自定义 CSS' }), { target: { value: customCss } });
    expect(onUpdate).toHaveBeenLastCalledWith({ translationStyle: { ...defaults, customCss } });
    view.rerender(<TranslationStyleSettings settings={{
      ...settings, translationStyle: { ...defaults, customCss },
    }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.getByRole('textbox', { name: '自定义 CSS' })).toHaveValue(customCss);
    fireEvent.change(screen.getByRole('textbox', { name: '自定义 CSS' }), { target: { value: '' } });
    expect(onUpdate).toHaveBeenLastCalledWith({ translationStyle: { ...defaults, customCss: undefined } });

    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.getByRole('button', { name: '展开' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('重置默认样式恢复所有基础显示参数', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<TranslationStyleSettings settings={{
      ...settings,
      translationStyle: { highlightStyle: 'bold', highlightOpacity: 20, translationLineOpacity: 0, translationLineIndent: 48, showOriginalAnnotation: false },
    }} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('button', { name: '重置为默认样式' }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ translationStyle: defaults });
  });

  it('保存期间禁用所有可持久化控件，仍可查看 CSS 内容', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<TranslationStyleSettings settings={settings} onUpdate={onUpdate} isSaving />);
    fireEvent.click(screen.getByRole('button', { name: '展开' }));

    for (const role of ['radio', 'slider', 'switch', 'combobox', 'textbox']) {
      for (const control of screen.getAllByRole(role)) expect(control).toBeDisabled();
    }
    const reset = screen.getByRole('button', { name: '重置为默认样式' });
    expect(reset).toBeDisabled();
    fireEvent.click(reset);
    fireEvent.click(screen.getByRole('radio', { name: /虚线/ }));
    fireEvent.click(screen.getByRole('switch', { name: '显示原文标注' }));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
