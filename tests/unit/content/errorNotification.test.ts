/**
 * ErrorNotification 测试
 *
 * 覆盖显示/隐藏错误提示、按钮交互、HTML转义、ARIA属性
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorNotification } from '@/content/ErrorNotification';
import { TranslationErrorType } from '@/shared/utils/translationErrors';

const mockActions = vi.hoisted(() => ({
  openSettingsHandler: vi.fn(),
  retryHandler: vi.fn(),
}));

vi.mock('@/shared/utils/translationErrors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils/translationErrors')>();
  return {
    ...actual,
    ERROR_ACTIONS: {
      open_settings: { label: '打开设置', handler: mockActions.openSettingsHandler },
      retry: { label: '重试', handler: mockActions.retryHandler },
    },
  };
});

function createErrorInfo(overrides: Partial<{
  title: string;
  message: string;
  retryable: boolean;
  action: string;
  technicalDetails: string;
}> = {}): import('@/shared/utils/translationErrors').TranslationErrorInfo {
  return {
    type: TranslationErrorType.UNKNOWN,
    title: '测试错误',
    message: '测试错误信息',
    retryable: false,
    ...overrides,
  };
}

describe('ErrorNotification', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('show', () => {
    it('在容器中创建错误提示元素', () => {
      const notification = new ErrorNotification();
      const error = createErrorInfo();

      notification.show(error, container);

      expect(container.querySelector('.not-translator-error-notification')).toBeTruthy();
    });

    it('设置 ARIA 属性', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo(), container);

      const el = container.querySelector('.not-translator-error-notification') as HTMLElement;
      expect(el.getAttribute('role')).toBe('alert');
      expect(el.getAttribute('aria-live')).toBe('assertive');
      expect(el.getAttribute('aria-atomic')).toBe('true');
    });

    it('显示错误标题和消息', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ title: '网络错误', message: '连接失败' }), container);

      expect(container.textContent).toContain('网络错误');
      expect(container.textContent).toContain('连接失败');
    });

    it('可重试时显示重试按钮', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ retryable: true }), container);

      const retryBtn = container.querySelector('[data-action="retry"]');
      expect(retryBtn).toBeTruthy();
      expect(retryBtn?.getAttribute('aria-label')).toBe('重试翻译');
    });

    it('不可重试时不显示重试按钮', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ retryable: false }), container);

      expect(container.querySelector('[data-action="retry"]')).toBeNull();
    });

    it('显示关闭按钮', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo(), container);

      const dismissBtn = container.querySelector('[data-action="dismiss"]');
      expect(dismissBtn).toBeTruthy();
      expect(dismissBtn?.getAttribute('aria-label')).toBe('关闭错误提示');
    });

    it('显示技术详情', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ technicalDetails: 'Stack trace here' }), container);

      expect(container.textContent).toContain('技术详情');
      expect(container.textContent).toContain('Stack trace here');
    });

    it('无技术详情时不显示详情区域', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ technicalDetails: undefined }), container);

      expect(container.textContent).not.toContain('技术详情');
    });

    it('显示自定义操作按钮', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ action: 'open_settings' }), container);

      const actionBtn = container.querySelector('[data-action="open_settings"]');
      expect(actionBtn).toBeTruthy();
      expect(actionBtn?.textContent).toContain('打开设置');
    });

    it('HTML内容被转义', () => {
      const notification = new ErrorNotification();
      notification.show(
        createErrorInfo({ title: '<script>alert(1)</script>', message: '正常消息' }),
        container
      );

      const el = container.querySelector('.not-translator-error-notification') as HTMLElement;
      expect(el.innerHTML).not.toContain('<script>');
      expect(el.innerHTML).toContain('&lt;script&gt;');
    });

    it('再次显示时先清除旧提示', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ title: '第一次' }), container);
      notification.show(createErrorInfo({ title: '第二次' }), container);

      const notifications = container.querySelectorAll('.not-translator-error-notification');
      expect(notifications).toHaveLength(1);
      expect(container.textContent).toContain('第二次');
    });
  });

  describe('hide', () => {
    it('移除错误提示元素', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo(), container);

      expect(container.querySelector('.not-translator-error-notification')).toBeTruthy();

      notification.hide();

      expect(container.querySelector('.not-translator-error-notification')).toBeNull();
    });

    it('无元素时不报错', () => {
      const notification = new ErrorNotification();
      expect(() => notification.hide()).not.toThrow();
    });
  });

  describe('按钮交互', () => {
    it('点击重试按钮触发 onRetry', () => {
      const onRetry = vi.fn();
      const notification = new ErrorNotification({ onRetry });
      notification.show(createErrorInfo({ retryable: true }), container);

      const retryBtn = container.querySelector('[data-action="retry"]') as HTMLElement;
      retryBtn.click();

      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('点击关闭按钮触发 onDismiss', () => {
      const onDismiss = vi.fn();
      const notification = new ErrorNotification({ onDismiss });
      notification.show(createErrorInfo(), container);

      const dismissBtn = container.querySelector('[data-action="dismiss"]') as HTMLElement;
      dismissBtn.click();

      expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('点击关闭按钮移除元素', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo(), container);

      const dismissBtn = container.querySelector('[data-action="dismiss"]') as HTMLElement;
      dismissBtn.click();

      expect(container.querySelector('.not-translator-error-notification')).toBeNull();
    });

    it('点击自定义操作按钮调用对应 handler', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ action: 'open_settings' }), container);

      const btn = container.querySelector('[data-action="open_settings"]') as HTMLElement;
      btn.click();

      expect(mockActions.openSettingsHandler).toHaveBeenCalledTimes(1);
    });

    it('无回调时不报错', () => {
      const notification = new ErrorNotification();
      notification.show(createErrorInfo({ retryable: true }), container);

      const retryBtn = container.querySelector('[data-action="retry"]') as HTMLElement;
      expect(() => retryBtn.click()).not.toThrow();
    });
  });
});
