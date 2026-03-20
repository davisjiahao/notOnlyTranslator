/**
 * KeyboardShortcutManager - 统一管理键盘快捷键
 *
 * 功能：
 * 1. 管理 Chrome 扩展命令快捷键
 * 2. 管理页面内快捷键
 * 3. 支持自定义快捷键
 * 4. 快捷键冲突检测
 */

import { logger } from '@/shared/utils';

/**
 * 快捷键动作类型
 */
export type ShortcutAction =
  | 'translate-paragraph'      // Alt+T: 快速翻译当前段落
  | 'toggle-translation'       // Alt+Shift+T: 切换翻译显示
  | 'close-tooltip'            // Esc: 关闭翻译/Tooltip
  | 'next-highlight'           // J/↓: 下一个高亮
  | 'prev-highlight'           // K/↑: 上一个高亮
  | 'pin-tooltip'              // P: 钉住 Tooltip
  | 'mark-known'               // M: 标记为已知
  | 'mark-unknown'             // U: 标记为未知
  | 'add-vocabulary';          // A: 添加到生词本

/**
 * 快捷键定义
 */
export interface ShortcutDefinition {
  /** 动作标识 */
  action: ShortcutAction;
  /** 默认快捷键组合 */
  defaultKey: string;
  /** 描述（中文） */
  description: string;
  /** 是否为 Chrome 命令（全局快捷键） */
  isCommand: boolean;
  /** 是否需要在输入框中忽略 */
  ignoreInInput: boolean;
}

/**
 * 用户自定义快捷键
 */
export interface UserShortcut {
  action: ShortcutAction;
  key: string;
  enabled: boolean;
}

/**
 * 快捷键回调
 */
export type ShortcutCallback = (action: ShortcutAction, event?: KeyboardEvent) => void;

/**
 * 预定义快捷键
 */
export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Chrome 命令快捷键（全局）
  {
    action: 'translate-paragraph',
    defaultKey: 'Alt+T',
    description: '快速翻译当前段落',
    isCommand: true,
    ignoreInInput: false,
  },
  {
    action: 'toggle-translation',
    defaultKey: 'Alt+Shift+T',
    description: '切换翻译显示',
    isCommand: true,
    ignoreInInput: false,
  },
  // 页面内快捷键
  {
    action: 'close-tooltip',
    defaultKey: 'Escape',
    description: '关闭翻译/Tooltip',
    isCommand: false,
    ignoreInInput: false,
  },
  {
    action: 'next-highlight',
    defaultKey: 'j',
    description: '下一个高亮词汇',
    isCommand: false,
    ignoreInInput: true,
  },
  {
    action: 'prev-highlight',
    defaultKey: 'k',
    description: '上一个高亮词汇',
    isCommand: false,
    ignoreInInput: true,
  },
  {
    action: 'pin-tooltip',
    defaultKey: 'p',
    description: '钉住/取消钉住 Tooltip',
    isCommand: false,
    ignoreInInput: true,
  },
  {
    action: 'mark-known',
    defaultKey: 'm',
    description: '标记当前词汇为已知',
    isCommand: false,
    ignoreInInput: true,
  },
  {
    action: 'mark-unknown',
    defaultKey: 'u',
    description: '标记当前词汇为未知',
    isCommand: false,
    ignoreInInput: true,
  },
  {
    action: 'add-vocabulary',
    defaultKey: 'a',
    description: '添加到生词本',
    isCommand: false,
    ignoreInInput: true,
  },
];

/**
 * 将事件键转换为快捷键字符串
 */
function eventToKeyString(e: KeyboardEvent): string {
  const parts: string[] = [];

  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');

  // 主键
  const key = e.key;
  if (key && !['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    // 标准化键名
    if (key === ' ') parts.push('Space');
    else if (key === 'ArrowUp') parts.push('↑');
    else if (key === 'ArrowDown') parts.push('↓');
    else if (key === 'ArrowLeft') parts.push('←');
    else if (key === 'ArrowRight') parts.push('→');
    else parts.push(key.length === 1 ? key.toLowerCase() : key);
  }

  return parts.join('+');
}

/**
 * 检查是否在输入元素中
 */
function isInInputElement(): boolean {
  const activeEl = document.activeElement;
  if (!activeEl) return false;

  const tagName = activeEl.tagName;
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    (activeEl as HTMLElement).isContentEditable
  );
}

/**
 * KeyboardShortcutManager 类
 */
export class KeyboardShortcutManager {
  private callbacks: Map<ShortcutAction, ShortcutCallback> = new Map();
  private userShortcuts: Map<ShortcutAction, UserShortcut> = new Map();
  private enabled: boolean = true;
  private boundHandler: (e: KeyboardEvent) => void;

  constructor() {
    this.boundHandler = this.handleKeyDown.bind(this);
    this.loadUserShortcuts();
  }

  /**
   * 加载用户自定义快捷键
   */
  private async loadUserShortcuts(): Promise<void> {
    try {
      const result = await chrome.storage.sync.get('userShortcuts');
      if (result.userShortcuts) {
        const shortcuts = result.userShortcuts as UserShortcut[];
        shortcuts.forEach(s => this.userShortcuts.set(s.action, s));
      }
    } catch (error) {
      logger.warn('加载用户快捷键失败:', error);
    }
  }

  /**
   * 注册快捷键回调
   */
  on(action: ShortcutAction, callback: ShortcutCallback): void {
    this.callbacks.set(action, callback);
  }

  /**
   * 移除快捷键回调
   */
  off(action: ShortcutAction): void {
    this.callbacks.delete(action);
  }

  /**
   * 启用快捷键监听
   */
  start(): void {
    document.addEventListener('keydown', this.boundHandler);
    this.enabled = true;
    logger.info('KeyboardShortcutManager: 已启用');
  }

  /**
   * 停止快捷键监听
   */
  stop(): void {
    document.removeEventListener('keydown', this.boundHandler);
    this.enabled = false;
    logger.info('KeyboardShortcutManager: 已停止');
  }

  /**
   * 处理键盘事件
   */
  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;

    // 获取快捷键字符串
    const keyString = eventToKeyString(e);

    // 遍历所有快捷键定义
    for (const def of SHORTCUT_DEFINITIONS) {
      // 跳过 Chrome 命令快捷键（由 background 处理）
      if (def.isCommand) continue;

      // 获取当前快捷键（用户自定义或默认）
      const userShortcut = this.userShortcuts.get(def.action);
      const currentKey = userShortcut?.enabled ? (userShortcut.key || def.defaultKey) : def.defaultKey;

      // 检查是否匹配
      if (this.matchesKey(keyString, currentKey)) {
        // 检查是否需要在输入框中忽略
        if (def.ignoreInInput && isInInputElement()) {
          continue;
        }

        // 阻止默认行为
        e.preventDefault();
        e.stopPropagation();

        // 触发回调
        const callback = this.callbacks.get(def.action);
        if (callback) {
          callback(def.action, e);
        }

        logger.debug(`快捷键触发: ${def.action} (${currentKey})`);
        return;
      }
    }
  }

  /**
   * 检查快捷键是否匹配
   */
  private matchesKey(keyString: string, targetKey: string): boolean {
    // 标准化比较
    const normalize = (k: string) => k.toLowerCase().replace(/\s+/g, '');
    return normalize(keyString) === normalize(targetKey);
  }

  /**
   * 处理 Chrome 命令
   * 由 background script 调用
   */
  handleCommand(command: string): void {
    // 查找对应的动作
    const def = SHORTCUT_DEFINITIONS.find(d => d.action === command);
    if (!def) {
      logger.warn(`未知命令: ${command}`);
      return;
    }

    // 触发回调
    const callback = this.callbacks.get(def.action);
    if (callback) {
      callback(def.action);
    }

    logger.info(`命令触发: ${def.action}`);
  }

  /**
   * 更新用户快捷键
   */
  async updateUserShortcut(action: ShortcutAction, key: string, enabled: boolean): Promise<void> {
    const userShortcut: UserShortcut = { action, key, enabled };
    this.userShortcuts.set(action, userShortcut);

    // 保存到存储
    const shortcuts = Array.from(this.userShortcuts.values());
    await chrome.storage.sync.set({ userShortcuts: shortcuts });

    logger.info(`快捷键更新: ${action} -> ${key} (${enabled ? '启用' : '禁用'})`);
  }

  /**
   * 重置为默认快捷键
   */
  async resetToDefaults(): Promise<void> {
    this.userShortcuts.clear();
    await chrome.storage.sync.remove('userShortcuts');
    logger.info('快捷键已重置为默认');
  }

  /**
   * 获取当前快捷键配置
   */
  getShortcuts(): Array<ShortcutDefinition & { currentKey: string; enabled: boolean }> {
    return SHORTCUT_DEFINITIONS.map(def => {
      const userShortcut = this.userShortcuts.get(def.action);
      return {
        ...def,
        currentKey: userShortcut?.key || def.defaultKey,
        enabled: userShortcut?.enabled ?? true,
      };
    });
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.stop();
    this.callbacks.clear();
  }
}

/**
 * 获取 Chrome 命令配置（用于 manifest.json）
 */
export function getChromeCommandsConfig(): Record<string, { suggested_key: Record<string, string>; description: string }> {
  const commands: Record<string, { suggested_key: Record<string, string>; description: string }> = {};

  SHORTCUT_DEFINITIONS
    .filter(def => def.isCommand)
    .forEach(def => {
      // 转换键名格式 (Alt+T -> Alt+T)
      const key = def.defaultKey;

      commands[def.action] = {
        suggested_key: {
          default: key,
          mac: key,
        },
        description: def.description,
      };
    });

  return commands;
}

// 单例实例
let instance: KeyboardShortcutManager | null = null;

/**
 * 获取全局实例
 */
export function getKeyboardShortcutManager(): KeyboardShortcutManager {
  if (!instance) {
    instance = new KeyboardShortcutManager();
  }
  return instance;
}