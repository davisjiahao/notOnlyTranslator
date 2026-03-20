import type { TranslationMode } from '@/shared/types';
import { logger } from '@/shared/utils';

/**
 * 翻译引擎类型
 */
type DefaultEngine = 'llm' | 'traditional' | 'hybrid';

/**
 * FloatingButton - 页面浮动模式切换按钮
 *
 * 功能：
 * - 在页面右下角显示半透明浮动按钮
 * - 点击展开模式选择面板
 * - 可拖拽调整位置
 * - 支持最小化/收起
 * - 添加到黑名单的网站不显示
 * - 支持翻译引擎快速切换
 */
export class FloatingButton {
  private container: HTMLElement | null = null;
  private panel: HTMLElement | null = null;
  private isExpanded: boolean = false;
  private isMinimized: boolean = false;
  private currentMode: TranslationMode = 'inline-only';
  private currentEngine: DefaultEngine = 'hybrid';
  private onModeChange: (mode: TranslationMode) => void;
  private onEngineChange: ((engine: DefaultEngine) => void) | null = null;

  /** 拖拽相关 */
  private isDragging: boolean = false;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private initialLeft: number = 0;
  private initialTop: number = 0;

  /** 位置存储 */
  private readonly STORAGE_KEY = 'not-translator-floating-btn-pos';

  /** 保存事件监听器引用，用于清理 */
  private boundHandlers: {
    documentClick: (e: Event) => void;
    minimizeRestore: (e: MouseEvent) => void;
  } | null = null;

  constructor(
    onModeChange: (mode: TranslationMode) => void,
    onEngineChange?: (engine: DefaultEngine) => void
  ) {
    this.onModeChange = onModeChange;
    this.onEngineChange = onEngineChange || null;
    this.loadPosition();
    this.createButton();
    logger.info('FloatingButton: 初始化完成');
  }

  /**
   * 更新当前翻译引擎
   */
  setEngine(engine: DefaultEngine): void {
    this.currentEngine = engine;
    this.updateEngineButtons();
  }

  /**
   * 更新引擎按钮状态
   */
  private updateEngineButtons(): void {
    if (!this.panel) return;
    this.panel.querySelectorAll('.not-translator-floating-engine-item').forEach(item => {
      const el = item as HTMLElement;
      const engine = el.dataset.engine as DefaultEngine;
      if (engine === this.currentEngine) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
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

    const engines: { value: DefaultEngine; label: string; icon: string }[] = [
      { value: 'llm', label: 'AI', icon: '🤖' },
      { value: 'traditional', label: '传统', icon: '🌐' },
      { value: 'hybrid', label: '混合', icon: '⚡' },
    ];

    // 使用 DOM API 构建 HTML，避免 XSS 风险
    const header = document.createElement('div');
    header.className = 'not-translator-floating-panel-header';
    header.innerHTML = '<span>翻译模式</span><button class="not-translator-floating-panel-close" title="收起">−</button>';

    const modeContent = document.createElement('div');
    modeContent.className = 'not-translator-floating-panel-content';
    modes.forEach(mode => {
      const btn = document.createElement('button');
      btn.className = `not-translator-floating-mode-item ${mode.value === this.currentMode ? 'active' : ''}`;
      btn.dataset.mode = mode.value;
      btn.innerHTML = `<span class="not-translator-floating-mode-icon">${mode.icon}</span><span class="not-translator-floating-mode-label">${mode.label}</span><span class="not-translator-floating-mode-desc">${mode.desc}</span>`;
      modeContent.appendChild(btn);
    });

    const divider = document.createElement('div');
    divider.className = 'not-translator-floating-panel-divider';

    const engineHeader = document.createElement('div');
    engineHeader.className = 'not-translator-floating-panel-header';
    engineHeader.innerHTML = '<span>翻译引擎</span>';

    const engineContent = document.createElement('div');
    engineContent.className = 'not-translator-floating-panel-content not-translator-floating-engine-grid';
    engines.forEach(engine => {
      const btn = document.createElement('button');
      btn.className = `not-translator-floating-engine-item ${engine.value === this.currentEngine ? 'active' : ''}`;
      btn.dataset.engine = engine.value;
      btn.title = `${engine.label}翻译`;
      btn.innerHTML = `<span class="not-translator-floating-engine-icon">${engine.icon}</span><span class="not-translator-floating-engine-label">${engine.label}</span>`;
      engineContent.appendChild(btn);
    });

    const footer = document.createElement('div');
    footer.className = 'not-translator-floating-panel-footer';
    footer.innerHTML = '<button class="not-translator-floating-minimize" title="最小化到角落">最小化</button>';

    this.panel.appendChild(header);
    this.panel.appendChild(modeContent);
    this.panel.appendChild(divider);
    this.panel.appendChild(engineHeader);
    this.panel.appendChild(engineContent);
    this.panel.appendChild(footer);

    // 绑定模式切换事件
    this.panel.querySelectorAll('.not-translator-floating-mode-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const mode = target.dataset.mode as TranslationMode;
        this.switchMode(mode);
      });
    });

    // 绑定引擎切换事件
    this.panel.querySelectorAll('.not-translator-floating-engine-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const engine = target.dataset.engine as DefaultEngine;
        this.switchEngine(engine);
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
    btnInner?.addEventListener('click', () => {
      if (!this.isDragging) {
        this.togglePanel();
      }
    });

    // 拖拽功能
    this.setupDrag();

    // 点击外部关闭面板 - 保存引用以便清理
    this.boundHandlers = {
      documentClick: (e: Event) => {
        if (this.isExpanded &&
            this.container &&
            this.panel &&
            !this.container.contains(e.target as Node)) {
          this.collapse();
        }
      },
      minimizeRestore: () => {} // 占位，在 minimize() 时会被覆盖
    };
    document.addEventListener('click', this.boundHandlers!.documentClick);
  }

  /**
   * 设置拖拽功能
   */
  private setupDrag(): void {
    if (!this.container) return;

    const btnInner = this.container.querySelector('.not-translator-floating-btn-inner');
    if (!btnInner) return;

    // 根据设备类型设置拖拽阈值
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const DRAG_THRESHOLD = isTouchDevice ? 10 : 5;

    btnInner.addEventListener('mousedown', (e: Event) => {
      const mouseEvent = e as MouseEvent;
      this.isDragging = false;
      this.dragStartX = mouseEvent.clientX;
      this.dragStartY = mouseEvent.clientY;

      const rect = this.container!.getBoundingClientRect();
      this.initialLeft = rect.left;
      this.initialTop = rect.top;

      const handleMouseMove = (e: MouseEvent) => {
        const dx = e.clientX - this.dragStartX;
        const dy = e.clientY - this.dragStartY;

        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          this.isDragging = true;
        }

        const newLeft = this.initialLeft + dx;
        const newTop = this.initialTop + dy;

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
   * 最小化按钮 - 点击恢复
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

      // 添加点击恢复监听（使用 boundHandlers 保存引用以便清理）
      // 先移除可能存在的旧监听器，避免重复累积
      if (this.boundHandlers?.minimizeRestore && this.container) {
        this.container.removeEventListener('click', this.boundHandlers.minimizeRestore);
      }

      this.boundHandlers = {
        documentClick: this.boundHandlers?.documentClick || (() => {}),
        minimizeRestore: (e: MouseEvent) => {
          // 如果是拖拽操作，不触发恢复
          if (this.isDragging) return;
          e.stopPropagation();
          this.restoreFromMinimize();
          this.container?.removeEventListener('click', this.boundHandlers!.minimizeRestore);
        }
      };
      this.container.addEventListener('click', this.boundHandlers.minimizeRestore);
    }

    // 移除自动恢复的 setTimeout，用户点击后才会恢复
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
      const el = item as HTMLElement;
      el.classList.toggle('active', el.dataset.mode === mode);
    });

    // 收起面板
    setTimeout(() => this.collapse(), 300);
  }

  /**
   * 切换翻译引擎
   */
  private switchEngine(engine: DefaultEngine): void {
    this.currentEngine = engine;
    if (this.onEngineChange) {
      this.onEngineChange(engine);
    }

    // 更新 UI
    this.updateEngineButtons();

    // 显示切换提示
    const engineLabels: Record<DefaultEngine, string> = {
      'llm': 'AI 大模型',
      'traditional': '传统翻译',
      'hybrid': '智能混合'
    };
    logger.info(`FloatingButton: 切换到 ${engineLabels[engine]} 引擎`);
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
      const el = item as HTMLElement;
      el.classList.toggle('active', el.dataset.mode === mode);
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
    // 清理事件监听器
    if (this.boundHandlers) {
      document.removeEventListener('click', this.boundHandlers.documentClick);
      // 清理最小化恢复监听器
      if (this.container && this.boundHandlers.minimizeRestore) {
        this.container.removeEventListener('click', this.boundHandlers.minimizeRestore);
      }
      this.boundHandlers = null;
    }

    this.collapse();
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    this.panel = null;
  }
}
