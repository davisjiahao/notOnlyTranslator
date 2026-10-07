import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from '@/content/tooltip';
import { readFileSync } from 'node:fs';

const styles = readFileSync('src/content/styles.css', 'utf8');

describe('翻译加载指示器', () => {
  let tooltip: Tooltip;
  let target: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    tooltip = new Tooltip({
      onMarkKnown: vi.fn(),
      onMarkUnknown: vi.fn(),
      onAddToVocabulary: vi.fn(),
      onUndoLastMark: vi.fn(),
    });
    target = document.createElement('span');
    target.textContent = 'hello';
    document.body.appendChild(target);
  });

  afterEach(() => {
    tooltip.destroy();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('浮窗重复加载时只保留一个实体圈和一个可访问状态', () => {
    tooltip.showLoading(target, 'hello');
    tooltip.showLoading(target, 'hello');

    const spinners = document.querySelectorAll('.not-translator-loading-spinner');
    expect(spinners).toHaveLength(1);
    expect(spinners[0].children).toHaveLength(0);
    expect(spinners[0].getAttribute('aria-hidden')).toBe('true');
    const statuses = document.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].getAttribute('aria-label')).toBe('正在翻译');
    expect(target.textContent).toBe('hello');
    expect(target.querySelector('.not-translator-loading-spinner')).toBeNull();
  });

  it('段落和浮窗不通过伪元素生成额外加载圈', () => {
    expect(styles).not.toContain('.not-translator-paragraph-loading::after');
    expect(styles).not.toContain('.not-translator-tooltip-loading::before');
  });

  it('翻译完成后移除浮窗加载状态，再次加载仍只有一个圈', () => {
    tooltip.showLoading(target, 'hello');
    tooltip.updateWithTranslation({ original: 'hello', translation: '你好', difficulty: 1 });

    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(document.querySelector('.not-translator-loading-spinner')).toBeNull();

    tooltip.showLoading(target, 'hello');
    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(1);
    expect(target.textContent).toBe('hello');
  });
});
