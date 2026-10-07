import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import { Tooltip } from '@/content/tooltip';

const data = { original: 'apple', translation: '苹果', difficulty: 1, position: [0, 5] as [number, number], isPhrase: false };
let tooltip: Tooltip;
afterEach(() => { tooltip?.destroy(); document.body.innerHTML = ''; });
const setup = (add: () => Promise<boolean>) => {
  document.body.innerHTML = '<span id="target">apple</span>';
  tooltip = new Tooltip({ onMarkKnown: vi.fn(), onMarkUnknown: vi.fn(), onAddToVocabulary: add, onUndoLastMark: vi.fn() });
  tooltip.showWord(document.getElementById('target')!, data);
  return tooltip.getElement()!.querySelector<HTMLButtonElement>('[data-action="add"]')!;
};
describe('收藏需要持久化确认', () => {
  it('等待时不显示成功且不重复提交，失败后可重试，成功才提供撤销', async () => {
    let finish!: (value: boolean) => void;
    const add = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
    const button = setup(add);
    button.click(); button.click();
    expect(add).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    expect(tooltip.getElement()!.textContent).not.toContain('已加入生词本');
    finish(false);
    await Promise.resolve(); await Promise.resolve();
    expect(tooltip.getElement()!.querySelector('[role="alert"]')).toHaveTextContent('加入生词本失败');
    expect(button).toBeEnabled();
    expect(tooltip.getElement()!.querySelector('.not-translator-undo-bar')).toBeNull();
    button.click(); finish(true);
    await Promise.resolve(); await Promise.resolve();
    expect(tooltip.getElement()!.textContent).toContain('已加入生词本');
  });
  it('关闭后的迟到成功不重开浮层或写入新目标', async () => {
    let finish!: (value: boolean) => void;
    const button = setup(() => new Promise(resolve => { finish = resolve; }));
    button.click(); tooltip.hide(); finish(true);
    await Promise.resolve(); await Promise.resolve();
    expect(tooltip.isVisible()).toBe(false);
    expect(tooltip.getElement()!.textContent).not.toContain('已加入生词本');
  });
  it('拒绝的保存 Promise 显示可恢复错误', async () => {
    const button = setup(() => Promise.reject(new Error('存储不可用')));
    button.click();
    await Promise.resolve(); await Promise.resolve();
    expect(tooltip.getElement()!.querySelector('[role="alert"]')).toHaveTextContent('加入生词本失败');
    expect(button).toBeEnabled();
  });
});
