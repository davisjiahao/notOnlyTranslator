import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';
import { captureFocusReturn } from '@/content/utils/focusReturn';

afterEach(() => { document.body.innerHTML = ''; });

describe('重绘后的阅读焦点恢复', () => {
  it('返回同一容器内同一个出现位置的新词条', () => {
    document.body.innerHTML = '<p><mark tabindex="0" data-word="apple">apple</mark> <mark tabindex="0" data-word="apple">apple</mark></p>';
    const target = document.querySelectorAll<HTMLElement>('mark')[1];
    const restore = captureFocusReturn(target);
    const replacement = target.cloneNode(true) as HTMLElement;
    target.replaceWith(replacement);
    restore();
    expect(replacement).toHaveFocus();
  });

  it('认识后不再高亮时返回原段落，不留下额外 Tab 入口', () => {
    document.body.innerHTML = '<p><mark tabindex="0" data-word="apple">apple</mark></p>';
    const target = document.querySelector<HTMLElement>('mark')!;
    const restore = captureFocusReturn(target);
    target.replaceWith(document.createTextNode('apple'));
    restore();
    expect(document.querySelector('p')).toHaveFocus();
    expect(document.querySelector('p')).not.toHaveAttribute('tabindex');
  });

  it('已移除的容器、隐藏或 inert 元素不恢复焦点', () => {
    const target = document.createElement('button');
    document.body.appendChild(target);
    const restore = captureFocusReturn(target);
    target.inert = true;
    target.setAttribute('inert', '');
    restore();
    expect(target).not.toHaveFocus();
    target.remove();
    restore();
    expect(document.body).toHaveFocus();
  });
});
