import type { TranslationMode, UserSettings } from '@/shared/types';
import { logger } from '@/shared/utils';

/**
 * FloatingButton - 页面浮动模式切换按钮
 *
 * 功能：
 * - 在页面右下角显示半透明浮动按钮
 * - 点击展开模式选择面板
 * - 可拖拽调整位置
 * - 支持最小化/收起
 * - 添加到黑名单的网站不显示
 */
export class FloatingButton {
  private container: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private isExpanded: boolean = false;
  private isMinimized: boolean = false;
  private currentMode: TranslationMode = 'inline-only';
  private onModeChange: (mode: TranslationMode) => void;

  /** 拖拽相关 */
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private initialLeft: number = 0;
  private initialTop: number = 0;

  /** 位置存储 */
  private readonly STORAGE_KEY = 'not-translator-floating-btn-pos';

  constructor(onModeChange: (mode: TranslationMode) => void) {
    this.onModeChange = onModeChange;
    this.loadPosition();
    this.createButton();
    logger.info('FloatingButton: 初始化完成');
  }

  /**
   * 创建浮动按钮
   */
  private createButton(): void {
    // 检查是否已存在
    if (document.getElementById('not-translator-floating-btn')) {
      return;
    }

    // 创建容器
    this.container = document.createElement('div');
    this.container.id = 'not-translator-floating-btn';
    this.container.className = 'not-translator-floating-btn';

    // 设置位置
    const position = this.getSavedPosition();
    this.container.style.left = `${position.left}px`;
    this.container.style.top = `${position.top}px`;

    // 创建按钮内容
    this.container.innerHTML = `
      <div class="not-translator-floating-btn-inner">
        <span class="not-translator-floating-btn-icon">🌐</span>
        <span class="not-translator-floating-btn-text">翻译</span>
      </div>
    `;

    // 创建模式选择面板
    this.createPanel();

    // 添加事件监听
    this.setupEventListeners();

    // 添加到页面
    document.body.appendChild(this.container);
  }

  /**
   * 创建模式选择面板
   */
  private createPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'not-translator-floating-panel';
    this.panel.style.display = 'none';

    const modes: { value: TranslationMode; label: string; icon: string; desc: string }[] = [
      { value: 'inline-only', label: '行内', icon: '📝', desc: '仅标注生词' },
      { value: 'bilingual', label: '对照', icon: '📖', desc: '双文对照显示' },
      { value: 'full-translate', label: '全文', icon: '🔤', desc: '全文翻译' },
    ];

    this.panel.innerHTML = `
      <div class="not-translator-floating-panel-header">
        <span>翻译模式</span>
        <button class="not-translator-floating-panel-close" title="收起">−</button>
      </div>
      <div class="not-translator-floating-panel-content">
        ${modes.map(mode => `
          <button class="not-translator-floating-mode-item ${mode.value === this.currentMode ? 'active' : ''}" data-mode="${mode.value}">
            <span class="not-translator-floating-mode-icon">${mode.icon}</span>
            <span class="not-translator-floating-mode-label">${mode.label}</span>
            <span class="not-translator-floating-mode-desc">${mode.desc}</span>
          </button>
        `).join('')}
      </div>
      <div class="not-translator-floating-panel-footer">
        <button class="not-translator-floating-minimize" title="最小化到角落">最小化</button>
      </div>
    `;

    // 绑定模式切换事件
    this.panel.querySelectorAll('.not-translator-floating-mode-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const mode = target.dataset.mode as TranslationMode;
        this.switchMode(mode);
      });
    });

    // 绑定关闭按钮
    const closeBtn = this.panel.querySelector('.not-translator-floating-panel-close');
    closeBtn?.addEventListener('click', () => this.collapse());

    // 绑定最小化按钮
    const minimizeBtn = this.panel.querySelector('.not-translator-floating-minimize');
    minimizeBtn?.addEventListener('click', () => this.minimize());

    this.container?.appendChild(this.panel);
  }

  /**
   * 设置事件监听
   */
  private setupEventListeners(): void {
    if (!this.container) return;

    // 点击按钮展开/收起面板
    const btnInner = this.container.querySelector('.not-translator-floating-btn-inner');
    btnInner?.addEventListener('click', (e) => {
      if (!this.isDragging) {
        this.togglePanel();
      }
    });

    // 拖拽功能
    this.setupDrag();

    // 点击外部关闭面板
    document.addEventListener('click', (e) => {
      if (this.isExpanded &&
          this.container &&
          this.panel &&
          !this.container.contains(e.target as Node)) {
        this.collapse();
      }
    });
  }

  /**
   * 设置拖拽功能
   */
  private setupDrag(): void {
    if (!this.container) return;

    const btnInner = this.container.querySelector('.not-translator-floating-btn-inner');
    if (!btnInner) return;

    btnInner.addEventListener('mousedown', (e) => {
      this.isDragging = false;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;

      const rect = this.container!.getBoundingClientRect();
      this.initialLeft = rect.left;
      this.initialTop = rect.top;

      const handleMouseMove = (e: MouseEvent) => {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;

        // 如果移动超过5px，认为是拖拽
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
          this.isDragging = true;
        }

        const newLeft = this.initialLeft + dx;
        const newTop = this.initialTop + dy;

        // 限制在视口范围内
        const maxLeft = window.innerWidth - (this.container?.offsetWidth || 80);
        const maxTop = window.innerHeight - (this.container?.offsetHeight || 40);

        this.container!.style.left = `${Math.max(0, Math.min(newLeft, maxLeft))}px`;
        this.container!.style.top = `${Math.max(0, Math.min(newTop, maxTop))}px`;
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);

        if (this.isDragging) {
          this.savePosition();
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });
  }

  /**
   * 切换面板展开/收起
   */
  private togglePanel(): void {
    if (this.isExpanded) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  /**
   * 展开面板
   */
  private expand(): void {
    if (!this.panel || this.isMinimized) return;

    this.panel.style.display = 'block';
    this.isExpanded = true;

    // 调整面板位置，确保在视口内
    this.adjustPanelPosition();
  }

  /**
   * 收起面板
   */
  private collapse(): void {
    if (!this.panel) return;

    this.panel.style.display = 'none';
    this.isExpanded = false;
  }

  /**
   * 最小化按钮
   */
  private minimize(): void {
    this.isMinimized = true;
    this.collapse();

    // 显示最小化指示
    if (this.container) {
      this.container.classList.add('minimized');
      this.container.style.left = 'auto';
      this.container.style.right = '10px';
      this.container.style.top = 'auto';
      this.container.style.bottom = '10px';
    }

    // 3秒后恢复
    setTimeout(() => {
      this.restoreFromMinimize();
    }, 3000);
  }

  /**
   * 从最小化恢复
   */
  private restoreFromMinimize(): void {
    this.isMinimized = false;

    if (this.container) {
      this.container.classList.remove('minimized');
      const position = this.getSavedPosition();
      this.container.style.left = `${position.left}px`;
      this.container.style.top = `${position.top}px`;
      this.container.style.right = 'auto';
      this.container.style.bottom = 'auto';
    }
  }

  /**
   * 调整面板位置
   */
  private adjustPanelPosition(): void {
    if (!this.container || !this.panel) return;

    const btnRect = this.container.getBoundingClientRect();
    const panelRect = this.panel.getBoundingClientRect();

    // 默认显示在按钮上方
    let top = btnRect.top - panelRect.height - 10;
    let left = btnRect.left;

    // 如果上方空间不足，显示在下方
    if (top < 10) {
      top = btnRect.bottom + 10;
    }

    // 确保不超出右边界
    if (left + panelRect.width > window.innerWidth) {
      left = window.innerWidth - panelRect.width - 10;
    }

    this.panel.style.top = `${top + window.scrollY}px`;
    this.panel.style.left = `${left + window.scrollX}px`;
  }

  /**
   * 切换翻译模式
   */
  private switchMode(mode: TranslationMode): void {
    this.currentMode = mode;
    this.onModeChange(mode);

    // 更新 UI
    this.panel?.querySelectorAll('.not-translator-floating-mode-item').forEach(item => {
      item.classList.toggle('active', item.dataset.mode === mode);
    });

    // 收起面板
    setTimeout(() => this.collapse(), 300);
  }

  /**
   * 获取保存的位置
   */
  private getSavedPosition(): { left: number; top: number } {
    const defaultLeft = window.innerWidth - 120;
    const defaultTop = window.innerHeight - 80;

    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const pos = JSON.parse(saved);
        return {
          left: Math.max(10, Math.min(pos.left, window.innerWidth - 80)),
          top: Math.max(10, Math.min(pos.top, window.innerHeight - 40)),
        };
      }
    } catch {
      // 忽略错误
    }

    return { left: defaultLeft, top: defaultTop };
  }

  /**
   * 保存位置
   */
  private savePosition(): void {
    if (!this.container) return;

    const rect = this.container.getBoundingClientRect();
    const position = {
      left: rect.left,
      top: rect.top,
    };

    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(position));
    } catch {
      // 忽略错误
    }
  }

  /**
   * 加载位置
   */
  private loadPosition(): void {
    // 位置在 getSavedPosition 中加载
  }

  /**
   * 更新当前模式显示
   */
  updateMode(mode: TranslationMode): void {
    this.currentMode = mode;

    // 更新按钮文字
    const btnText = this.container?.querySelector('.not-translator-floating-btn-text');
    if (btnText) {
      const labels: Record<TranslationMode, string> = {
        'inline-only': '行内',
        'bilingual': '对照',
        'full-translate': '全文',
      };
      btnText.textContent = labels[mode] || '翻译';
    }

    // 更新面板选中状态
    this.panel?.querySelectorAll('.not-translator-floating-mode-item').forEach(item => {
      item.classList.toggle('active', item.dataset.mode === mode);
    });
  }

  /**
   * 显示按钮
   */
  show(): void {
    if (this.container) {
      this.container.style.display = 'block';
    }
  }

  /**
   * 隐藏按钮
   */
  hide(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
  }

  /**
   * 销毁按钮
   */
  destroy(): void {
    this.collapse();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.panel = null;
  }
}
