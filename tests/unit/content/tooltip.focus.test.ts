import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { Tooltip } from '@/content/tooltip';
import { CSS_CLASSES } from '@/shared/constants';

const data = { original: 'apple', translation: '苹果', difficulty: 1, position: [0, 5] as [number, number], isPhrase: false };
let tooltip: Tooltip;
let target: HTMLButtonElement;
const key = (element: Element, value: string, extra = {}) => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra }));
const button = (name: string) => tooltip.getElement()!.querySelector<HTMLButtonElement>('[aria-label="' + name + '"]')!;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<button id="word">apple</button><button id="outside">网页操作</button>';
  target = document.getElementById('word') as HTMLButtonElement;
  target.className = CSS_CLASSES.HIGHLIGHT;
  tooltip = new Tooltip({ onMarkKnown: vi.fn(), onMarkUnknown: vi.fn(), onAddToVocabulary: vi.fn(), onUndoLastMark: vi.fn() });
});
afterEach(() => { tooltip.destroy(); vi.useRealTimers(); document.body.innerHTML = ''; });

describe('词典浮层焦点生命周期', () => {
  it('是有名称的非模态对话框，悬停显示不抢焦点', () => {
    target.focus();
    tooltip.showWord(target, data);
    expect(tooltip.getElement()).toHaveAttribute('role', 'dialog');
    expect(tooltip.getElement()).toHaveAccessibleName(/apple/);
    expect(tooltip.getElement()).not.toHaveAttribute('aria-modal', 'true');
    expect(target).toHaveFocus();
    expect(tooltip.getElement()).not.toHaveAttribute('aria-live');
  });

  it('主动进入后 Escape 恢复触发元素，隐藏状态不再暴露交互控件', () => {
    target.focus();
    tooltip.showWord(target, data);
    tooltip.focus();
    expect(tooltip.getElement()).toHaveFocus();
    key(tooltip.getElement()!, 'Escape');
    expect(target).toHaveFocus();
    expect(tooltip.isVisible()).toBe(false);
    expect(tooltip.getElement()).toHaveAttribute('aria-hidden', 'true');
    expect(tooltip.getElement()!.inert).toBe(true);
  });

  it('焦点在网页操作时关闭不强行返回，隐形锚点也不会被聚焦', () => {
    target.focus();
    const anchor = document.createElement('span');
    anchor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(anchor);
    tooltip.showWord(anchor, data);
    tooltip.focus();
    key(tooltip.getElement()!, 'Escape');
    expect(target).toHaveFocus();
    tooltip.showWord(target, data);
    document.getElementById('outside')!.focus();
    tooltip.hide();
    expect(document.getElementById('outside')).toHaveFocus();
  });

  it('帮助面板支持焦点进入与分层 Escape，鼠标点击帮助不会关闭词典', () => {
    target.focus();
    tooltip.showWord(target, data);
    const help = button('快捷键帮助');
    help.focus();
    help.click();
    const close = document.querySelector<HTMLButtonElement>('.not-translator-help-close')!;
    expect(close).toHaveFocus();
    key(close, 'Escape');
    expect(tooltip.isVisible()).toBe(true);
    expect(help).toHaveFocus();
    help.click();
    close.click();
    expect(tooltip.isVisible()).toBe(true);
    expect(help).toHaveFocus();
  });

  it('帮助面板在显示后测量并限制在视口内', () => {
    tooltip.showWord(target, data);
    vi.spyOn(tooltip.getElement()!, 'getBoundingClientRect').mockReturnValue({ left: innerWidth - 40, right: innerWidth, top: innerHeight - 20 } as DOMRect);
    const panel = document.querySelector<HTMLElement>('.not-translator-help-panel')!;
    vi.spyOn(panel, 'getBoundingClientRect').mockImplementation(() => {
      expect(panel.style.display).toBe('block');
      return { width: 240, height: 400 } as DOMRect;
    });
    button('快捷键帮助').click();
    expect(parseFloat(panel.style.left) + 240).toBeLessThanOrEqual(innerWidth - 16);
    expect(parseFloat(panel.style.top) + 400).toBeLessThanOrEqual(innerHeight - 16);
  });

  it('滚动不打断正在操作的浮层，标记后焦点进入撤销', () => {
    tooltip.showWord(target, data);
    const known = button('标记 apple 为认识');
    known.focus();
    document.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(500);
    expect(tooltip.isVisible()).toBe(true);
    known.click();
    const undo = button('撤销对「apple」的标记');
    expect(undo).toHaveFocus();
    undo.click();
    expect(target).toHaveFocus();
  });

  it('焦点进入后鼠标悬停其他词不会替换当前操作，Tab 不被困住', () => {
    tooltip.showWord(target, data);
    button('关闭').focus();
    const other = document.getElementById('outside')!;
    tooltip.showWord(other, { ...data, original: 'other' });
    expect(tooltip.getCurrentWord()).toBe('apple');
    expect(key(button('关闭'), 'Tab')).toBe(true);
    other.focus();
    expect(tooltip.isVisible()).toBe(false);
  });

  it('撤销提示将特殊字符词条作为纯文本，不构造新 HTML', () => {
    const word = 'apple"><img src=x onerror=alert(1)>';
    tooltip.showWord(target, { ...data, original: word });
    tooltip.getElement()!.querySelector<HTMLButtonElement>('.known')!.click();
    expect(tooltip.getElement()!.querySelector('img')).toBeNull();
    expect(tooltip.getElement()!.querySelector('.not-translator-tooltip-undo-btn')).toHaveAttribute('aria-label', '撤销对「' + word + '」的标记');
  });

  it('迟到结果保留键盘焦点，关闭后 destroy 恢复可用焦点', () => {
    target.focus();
    tooltip.showLoading(target, 'apple');
    tooltip.focus();
    tooltip.showWord(target, data);
    expect(tooltip.getElement()).toHaveFocus();
    tooltip.destroy();
    expect(target).toHaveFocus();
  });
});
