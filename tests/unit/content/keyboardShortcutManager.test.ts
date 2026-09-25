/**
 * KeyboardShortcutManager 测试
 *
 * 覆盖快捷键注册、事件处理、用户自定义、Chrome命令、输入框忽略
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  KeyboardShortcutManager,
  getChromeCommandsConfig,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
} from '@/content/keyboardShortcutManager';

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

function createKeyboardEvent(key: string, modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    ctrlKey: modifiers.ctrl || false,
    altKey: modifiers.alt || false,
    shiftKey: modifiers.shift || false,
    metaKey: modifiers.meta || false,
    bubbles: true,
    cancelable: true,
  });
}

describe('KeyboardShortcutManager', () => {
  let manager: KeyboardShortcutManager;

  beforeEach(() => {
    vi.clearAllMocks();
    (KeyboardShortcutManager as any).instance = null;
    // Mock Chrome storage API
    (global as any).chrome = {
      storage: {
        sync: {
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          get: vi.fn().mockResolvedValue({}),
        },
      },
    };
    manager = new KeyboardShortcutManager();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    manager.destroy();
    document.body.innerHTML = '';
  });

  describe('on / off', () => {
    it('注册快捷键回调', () => {
      const callback = vi.fn();
      manager.on('close-tooltip', callback);

      manager.start();
      const event = createKeyboardEvent('Escape');
      document.dispatchEvent(event);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('close-tooltip', expect.any(KeyboardEvent));
    });

    it('移除快捷键回调', () => {
      const callback = vi.fn();
      manager.on('close-tooltip', callback);
      manager.off('close-tooltip');

      manager.start();
      const event = createKeyboardEvent('Escape');
      document.dispatchEvent(event);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('start / stop', () => {
    it('start 添加键盘事件监听', () => {
      const addListenerSpy = vi.spyOn(document, 'addEventListener');
      manager.start();
      expect(addListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('stop 移除键盘事件监听', () => {
      const removeListenerSpy = vi.spyOn(document, 'removeEventListener');
      manager.start();
      manager.stop();
      expect(removeListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });

    it('stop 后不再响应快捷键', () => {
      const callback = vi.fn();
      manager.on('close-tooltip', callback);
      manager.start();
      manager.stop();

      const event = createKeyboardEvent('Escape');
      document.dispatchEvent(event);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('handleKeyDown - 基本匹配', () => {
    beforeEach(() => {
      manager.start();
    });

    it('Escape 触发 close-tooltip', () => {
      const callback = vi.fn();
      manager.on('close-tooltip', callback);

      document.dispatchEvent(createKeyboardEvent('Escape'));
      expect(callback).toHaveBeenCalledWith('close-tooltip', expect.any(KeyboardEvent));
    });

    it('j 触发 next-highlight', () => {
      const callback = vi.fn();
      manager.on('next-highlight', callback);

      document.dispatchEvent(createKeyboardEvent('j'));
      expect(callback).toHaveBeenCalledWith('next-highlight', expect.any(KeyboardEvent));
    });

    it('k 触发 prev-highlight', () => {
      const callback = vi.fn();
      manager.on('prev-highlight', callback);

      document.dispatchEvent(createKeyboardEvent('k'));
      expect(callback).toHaveBeenCalledWith('prev-highlight', expect.any(KeyboardEvent));
    });

    it('p 触发 pin-tooltip', () => {
      const callback = vi.fn();
      manager.on('pin-tooltip', callback);

      document.dispatchEvent(createKeyboardEvent('p'));
      expect(callback).toHaveBeenCalledWith('pin-tooltip', expect.any(KeyboardEvent));
    });

    it('m 触发 mark-known', () => {
      const callback = vi.fn();
      manager.on('mark-known', callback);

      document.dispatchEvent(createKeyboardEvent('m'));
      expect(callback).toHaveBeenCalledWith('mark-known', expect.any(KeyboardEvent));
    });

    it('u 触发 mark-unknown', () => {
      const callback = vi.fn();
      manager.on('mark-unknown', callback);

      document.dispatchEvent(createKeyboardEvent('u'));
      expect(callback).toHaveBeenCalledWith('mark-unknown', expect.any(KeyboardEvent));
    });

    it('a 触发 add-vocabulary', () => {
      const callback = vi.fn();
      manager.on('add-vocabulary', callback);

      document.dispatchEvent(createKeyboardEvent('a'));
      expect(callback).toHaveBeenCalledWith('add-vocabulary', expect.any(KeyboardEvent));
    });

    it('未注册回调不报错', () => {
      // 没有注册回调，直接发送事件
      document.dispatchEvent(createKeyboardEvent('Escape'));
      // 没有断言抛错就是通过了
    });
  });

  describe('handleKeyDown - 输入框忽略', () => {
    beforeEach(() => {
      manager.start();
    });

    it('在 input 元素中忽略字母快捷键', () => {
      const callback = vi.fn();
      manager.on('mark-known', callback);

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      document.dispatchEvent(createKeyboardEvent('m'));
      expect(callback).not.toHaveBeenCalled();
    });

    it('在 textarea 中忽略字母快捷键', () => {
      const callback = vi.fn();
      manager.on('add-vocabulary', callback);

      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);
      textarea.focus();

      document.dispatchEvent(createKeyboardEvent('a'));
      expect(callback).not.toHaveBeenCalled();
    });

    it('在 contentEditable 元素中忽略字母快捷键', () => {
      const callback = vi.fn();
      manager.on('next-highlight', callback);

      const div = document.createElement('div');
      document.body.appendChild(div);
      // jsdom 中 contentEditable 不自动设置 isContentEditable，需手动 mock
      Object.defineProperty(div, 'isContentEditable', { value: true });
      const spy = vi.spyOn(document, 'activeElement', 'get').mockReturnValue(div);

      document.dispatchEvent(createKeyboardEvent('j'));
      expect(callback).not.toHaveBeenCalled();

      spy.mockRestore();
    });

    it('Escape 在输入框中仍可触发', () => {
      const callback = vi.fn();
      manager.on('close-tooltip', callback);

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      document.dispatchEvent(createKeyboardEvent('Escape'));
      expect(callback).toHaveBeenCalled();
    });

    it('在非输入元素中正常触发', () => {
      const callback = vi.fn();
      manager.on('mark-known', callback);

      const div = document.createElement('div');
      document.body.appendChild(div);
      div.focus();

      document.dispatchEvent(createKeyboardEvent('m'));
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('handleKeyDown - Chrome 命令跳过', () => {
    beforeEach(() => {
      manager.start();
    });

    it('不处理 Chrome 命令快捷键', () => {
      // Chrome 命令快捷键如 Alt+T 不由页面内处理
      const callback = vi.fn();
      manager.on('translate-paragraph', callback);

      document.dispatchEvent(createKeyboardEvent('t', { alt: true }));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('handleKeyDown - 事件阻止', () => {
    beforeEach(() => {
      manager.start();
    });

    it('匹配快捷键时阻止默认行为和冒泡', () => {
      manager.on('close-tooltip', vi.fn());

      const event = createKeyboardEvent('Escape');
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');

      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });
  });

  describe('handleCommand', () => {
    it('处理已知命令', () => {
      const callback = vi.fn();
      manager.on('translate-paragraph', callback);

      manager.handleCommand('translate-paragraph');

      expect(callback).toHaveBeenCalledWith('translate-paragraph');
    });

    it('未知命令不触发回调', () => {
      const callback = vi.fn();
      manager.on('translate-paragraph', callback);

      manager.handleCommand('unknown-command');

      expect(callback).not.toHaveBeenCalled();
    });

    it('未注册回调不报错', () => {
      expect(() => manager.handleCommand('translate-paragraph')).not.toThrow();
    });
  });

  describe('updateUserShortcut', () => {
    it('更新用户快捷键', async () => {
      await manager.updateUserShortcut('close-tooltip', 'q', true);

      const shortcuts = manager.getShortcuts();
      const closeTooltip = shortcuts.find(s => s.action === 'close-tooltip');
      expect(closeTooltip?.currentKey).toBe('q');
      expect(closeTooltip?.enabled).toBe(true);
    });

    it('自定义快捷键覆盖默认值', async () => {
      await manager.updateUserShortcut('close-tooltip', 'q', true);
      manager.start();

      const callback = vi.fn();
      manager.on('close-tooltip', callback);

      // 旧快捷键不再触发
      document.dispatchEvent(createKeyboardEvent('Escape'));
      expect(callback).not.toHaveBeenCalled();

      // 新快捷键触发
      document.dispatchEvent(createKeyboardEvent('q'));
      expect(callback).toHaveBeenCalled();
    });

    it('禁用自定义快捷键后恢复默认', async () => {
      await manager.updateUserShortcut('close-tooltip', 'q', false);
      manager.start();

      const callback = vi.fn();
      manager.on('close-tooltip', callback);

      // 自定义键不触发
      document.dispatchEvent(createKeyboardEvent('q'));
      expect(callback).not.toHaveBeenCalled();

      // 默认键仍触发
      document.dispatchEvent(createKeyboardEvent('Escape'));
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('resetToDefaults', () => {
    it('重置为默认快捷键', async () => {
      await manager.updateUserShortcut('close-tooltip', 'q', true);
      await manager.resetToDefaults();

      const shortcuts = manager.getShortcuts();
      const closeTooltip = shortcuts.find(s => s.action === 'close-tooltip');
      expect(closeTooltip?.currentKey).toBe('Escape');
    });
  });

  describe('getShortcuts', () => {
    it('返回所有快捷键配置', () => {
      const shortcuts = manager.getShortcuts();

      expect(shortcuts).toHaveLength(SHORTCUT_DEFINITIONS.length);
      expect(shortcuts.every(s => s.currentKey !== undefined)).toBe(true);
      expect(shortcuts.every(s => s.enabled !== undefined)).toBe(true);
    });

    it('默认全部启用', () => {
      const shortcuts = manager.getShortcuts();
      expect(shortcuts.every(s => s.enabled)).toBe(true);
    });
  });

  describe('destroy', () => {
    it('清理所有状态', () => {
      const callback = vi.fn();
      manager.on('close-tooltip', callback);
      manager.start();
      manager.destroy();

      const event = createKeyboardEvent('Escape');
      document.dispatchEvent(event);

      expect(callback).not.toHaveBeenCalled();
    });
  });
});

describe('getChromeCommandsConfig', () => {
  it('返回 Chrome 命令配置', () => {
    const config = getChromeCommandsConfig();

    // 只包含 isCommand 为 true 的快捷键
    const commandDefs = SHORTCUT_DEFINITIONS.filter(d => d.isCommand);
    expect(Object.keys(config)).toHaveLength(commandDefs.length);

    // 验证结构
    for (const def of commandDefs) {
      expect(config[def.action]).toEqual({
        suggested_key: {
          default: def.defaultKey,
          mac: def.defaultKey,
        },
        description: def.description,
      });
    }
  });
});
