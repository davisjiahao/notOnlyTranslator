import type { TranslationErrorInfo } from '@/shared/utils/translationErrors';
import { ERROR_ACTIONS } from '@/shared/utils/translationErrors';

/**
 * 错误提示组件
 * 在 Tooltip 中显示翻译错误信息
 */
export class ErrorNotification {
  private element: HTMLElement | null = null;
  private onRetry?: () => void;
  private onDismiss?: () => void;

  constructor(options?: { onRetry?: () => void; onDismiss?: () => void }) {
    this.onRetry = options?.onRetry;
    this.onDismiss = options?.onDismiss;
  }

  /**
   * 显示错误提示
   */
  show(error: TranslationErrorInfo, container: HTMLElement): void {
    this.hide();

    const el = document.createElement('div');
    el.className = 'not-translator-error-notification';
    el.innerHTML = `
      <div class="not-translator-error-header">
        <svg class="not-translator-error-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="10" stroke-width="2"/>
          <line x1="12" y1="8" x2="12" y2="12" stroke-width="2"/>
          <line x1="12" y1="16" x2="12.01" y2="16" stroke-width="2"/>
        </svg>
        <span class="not-translator-error-title">${this.escapeHtml(error.title)}</span>
      </div>
      <div class="not-translator-error-message">${this.escapeHtml(error.message)}</div>
      ${error.technicalDetails ? `
        <div class="not-translator-error-details">
          <details>
            <summary>技术详情</summary>
            <code>${this.escapeHtml(error.technicalDetails)}</code>
          </details>
        </div>
      ` : ''}
      <div class="not-translator-error-actions">
        ${error.retryable ? `
          <button class="not-translator-error-btn not-translator-error-btn-primary" data-action="retry">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="16" height="16">
              <path d="M23 4v6h-6M1 20v-6h6M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            重试
          </button>
        ` : ''}
        ${error.action && error.action !== 'retry' ? `
          <button class="not-translator-error-btn not-translator-error-btn-secondary" data-action="${error.action}">
            ${this.getActionLabel(error.action)}
          </button>
        ` : ''}
        <button class="not-translator-error-btn not-translator-error-btn-ghost" data-action="dismiss">
          关闭
        </button>
      </div>
    `;

    // 绑定事件
    el.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action;
        this.handleAction(action, error);
      });
    });

    container.appendChild(el);
    this.element = el;
  }

  /**
   * 隐藏错误提示
   */
  hide(): void {
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  /**
   * 处理操作按钮点击
   */
  private handleAction(action: string | undefined, _error: TranslationErrorInfo): void {
    switch (action) {
      case 'retry':
        this.onRetry?.();
        break;
      case 'dismiss':
        this.hide();
        this.onDismiss?.();
        break;
      default:
        if (action && ERROR_ACTIONS[action]) {
          ERROR_ACTIONS[action].handler();
        }
    }
  }

  /**
   * 获取操作按钮标签
   */
  private getActionLabel(action: string): string {
    return ERROR_ACTIONS[action]?.label || '操作';
  }

  /**
   * HTML 转义
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
