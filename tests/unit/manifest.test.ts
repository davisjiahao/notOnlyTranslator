import { describe, expect, it } from 'vitest';
import manifest from '../../public/manifest.json';

describe('扩展安装清单', () => {
  it('默认快捷键不超过 Chrome 允许的四个', () => {
    const shortcuts = Object.values(manifest.commands)
      .filter(command => 'suggested_key' in command);
    expect(shortcuts.length).toBeLessThanOrEqual(4);
  });

  it.each(['translate-paragraph', 'toggle-translation', 'translate-full-page', 'toggle-mode'] as const)('保留阅读操作 %s 的默认快捷键', command => {
    expect(manifest.commands[command].suggested_key.default).toBeTruthy();
  });

  it('仍保留可由用户绑定的扩展弹窗命令', () => {
    expect(manifest.commands._execute_action).toBeDefined();
  });
});
