/**
 * GeneralSettings 组件测试
 *
 * 覆盖：核心开关、主题/翻译模式/颜色选择、字体/延迟滑块、黑名单管理
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants';

// 模拟组件使用的 Chrome API
vi.stubGlobal('chrome', {
  runtime: {
    getManifest: vi.fn(() => ({ manifest_version: 3, name: 'NotOnlyTranslator', version: '0.3.1' })),
  },
  tabs: {
    query: vi.fn((_q: unknown, cb: (tabs: unknown[]) => void) => cb([])),
  },
  storage: {
    local: { get: vi.fn(() => Promise.resolve({})) },
    sync: { get: vi.fn(() => Promise.resolve({})) },
  },
});

// Mock CacheStats child component (避免深入其内部)
vi.mock('@/options/components/CacheStats', () => ({
  default: () => <div data-testid="cache-stats">CacheStats</div>,
}));

import GeneralSettings from '@/options/components/GeneralSettings';

function makeSettings(overrides?: Partial<UserSettings>): UserSettings {
  return {
    ...DEFAULT_SETTINGS,
    blacklist: [],
    ...overrides,
  };
}

describe('GeneralSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('核心功能开关', () => {
    it('启用翻译开关切换调用 onUpdate', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ enabled: true })} onUpdate={onUpdate} isSaving={false} />);

      const toggle = screen.getByRole('switch', { name: '启用翻译' });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      fireEvent.click(toggle);
      expect(onUpdate).toHaveBeenCalledWith({ enabled: false });
    });

    it('自动高亮开关切换', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ autoHighlight: false })} onUpdate={onUpdate} isSaving={false} />);

      const toggle = screen.getByRole('switch', { name: '自动高亮' });
      expect(toggle).toHaveAttribute('aria-checked', 'false');
      fireEvent.click(toggle);
      expect(onUpdate).toHaveBeenCalledWith({ autoHighlight: true });
    });

    it('词组翻译开关切换', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings()} onUpdate={onUpdate} isSaving={false} />);
      fireEvent.click(screen.getByRole('switch', { name: '词组翻译' }));
      expect(onUpdate).toHaveBeenCalledWith({ phraseTranslationEnabled: false });
    });

    it('语法翻译开关切换', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings()} onUpdate={onUpdate} isSaving={false} />);
      fireEvent.click(screen.getByRole('switch', { name: '语法翻译' }));
      expect(onUpdate).toHaveBeenCalledWith({ grammarTranslationEnabled: false });
    });

    it('显示难度等级开关切换', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings()} onUpdate={onUpdate} isSaving={false} />);
      fireEvent.click(screen.getByRole('switch', { name: '显示难度等级' }));
      expect(onUpdate).toHaveBeenCalledWith({ showDifficulty: false });
    });

    it('isSaving 时禁用开关', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings()} onUpdate={onUpdate} isSaving={true} />);
      const toggle = screen.getByRole('switch', { name: '启用翻译' }) as HTMLButtonElement;
      expect(toggle.disabled).toBe(true);
    });
  });

  describe('主题模式', () => {
    it('渲染三个主题选项', () => {
      render(<GeneralSettings settings={makeSettings()} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByText('浅色')).toBeTruthy();
      expect(screen.getByText('深色')).toBeTruthy();
      expect(screen.getByText('跟随系统')).toBeTruthy();
    });

    it('点击切换主题', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ theme: 'system' })} onUpdate={onUpdate} isSaving={false} />);
      fireEvent.click(screen.getByText('深色'));
      expect(onUpdate).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('主题键盘左右方向键循环切换并把焦点移向目标', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ theme: 'light' })} onUpdate={onUpdate} isSaving={false} />);
      const light = screen.getByRole('radio', { name: /浅色/ });
      const dark = screen.getByRole('radio', { name: /深色/ });
      const system = screen.getByRole('radio', { name: /跟随系统/ });

      fireEvent.keyDown(light, { key: 'ArrowRight' });
      expect(onUpdate).toHaveBeenCalledWith({ theme: 'dark' });
      expect(dark).toHaveFocus();
      fireEvent.keyDown(light, { key: 'ArrowLeft' });
      expect(onUpdate).toHaveBeenCalledWith({ theme: 'system' });
      expect(system).toHaveFocus();
    });

    it('当前主题 aria-checked 为 true', () => {
      render(<GeneralSettings settings={makeSettings({ theme: 'dark' })} onUpdate={vi.fn()} isSaving={false} />);
      const radios = screen.getAllByRole('radio');
      const darkRadio = radios.find((r) => r.textContent?.includes('深色'))!;
      const lightRadio = radios.find((r) => r.textContent?.includes('浅色'))!;
      expect(darkRadio).toHaveAttribute('aria-checked', 'true');
      expect(lightRadio).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('翻译模式', () => {
    it('点击切换翻译模式', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ translationMode: 'inline-only' })} onUpdate={onUpdate} isSaving={false} />);
      fireEvent.click(screen.getByText('双文对照'));
      expect(onUpdate).toHaveBeenCalledWith({ translationMode: 'bilingual' });
    });
  });

  describe('高亮颜色', () => {
    it('点击选择颜色', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings()} onUpdate={onUpdate} isSaving={false} />);
      fireEvent.click(screen.getByText('浅蓝色'));
      expect(onUpdate).toHaveBeenCalledWith({ highlightColor: '#bfdbfe' });
    });

    it('预览使用当前颜色', () => {
      render(<GeneralSettings settings={makeSettings({ highlightColor: '#bbf7d0' })} onUpdate={vi.fn()} isSaving={false} />);
      const preview = screen.getByText('highlighted word');
      expect(preview.style.backgroundColor).toBeTruthy();
    });
  });

  describe('滑块', () => {
    it('字体大小滑块显示当前值', () => {
      render(<GeneralSettings settings={makeSettings({ fontSize: 16 })} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByText('16px')).toBeTruthy();
    });

    it('字体大小滑块变化调用 onUpdate', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ fontSize: 14 })} onUpdate={onUpdate} isSaving={false} />);
      const slider = screen.getByLabelText('字体大小');
      fireEvent.change(slider, { target: { value: '16' } });
      expect(onUpdate).toHaveBeenCalledWith({ fontSize: 16 });
    });

    it('悬停延迟滑块变化调用 onUpdate', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ hoverDelay: 500 })} onUpdate={onUpdate} isSaving={false} />);
      const slider = screen.getByLabelText('悬停触发延迟');
      fireEvent.change(slider, { target: { value: '300' } });
      expect(onUpdate).toHaveBeenCalledWith({ hoverDelay: 300 });
    });

    it('hoverDelay=0 时显示提示', () => {
      render(<GeneralSettings settings={makeSettings({ hoverDelay: 0 })} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByText(/悬停触发已关闭/)).toBeTruthy();
    });
  });

  describe('黑名单管理', () => {
    it.each([
      { blacklist: [], action: '加入黑名单', expected: ['learn.example.com'] },
      { blacklist: ['learn.example.com'], action: '从黑名单移除', expected: [] },
    ])('当前标签网页可直接$action', async ({ blacklist, action, expected }) => {
      vi.mocked(chrome.tabs.query).mockImplementationOnce(((_query: unknown, callback: (tabs: unknown[]) => void) => {
        callback([{ url: 'https://learn.example.com/article' }]);
      }) as typeof chrome.tabs.query);
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ blacklist })} onUpdate={onUpdate} isSaving={false} />);

      fireEvent.click(await screen.findByRole('button', { name: action }));
      expect(onUpdate).toHaveBeenCalledWith({ blacklist: expected });
    });

    it('无法解析当前标签 URL 时不显示快捷黑名单按钮', () => {
      vi.mocked(chrome.tabs.query).mockImplementationOnce(((_query: unknown, callback: (tabs: unknown[]) => void) => {
        callback([{ url: '不是 URL' }]);
      }) as typeof chrome.tabs.query);
      render(<GeneralSettings settings={makeSettings()} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.queryByRole('button', { name: '加入黑名单' })).not.toBeInTheDocument();
    });

    it('空黑名单显示提示', () => {
      render(<GeneralSettings settings={makeSettings({ blacklist: [] })} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByText('黑名单为空')).toBeTruthy();
    });

    it('渲染已有黑名单项', () => {
      render(<GeneralSettings settings={makeSettings({ blacklist: ['example.com', 'foo.com'] })} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByText('example.com')).toBeTruthy();
      expect(screen.getByText('foo.com')).toBeTruthy();
    });

    it('输入并点击添加按钮加入黑名单', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ blacklist: [] })} onUpdate={onUpdate} isSaving={false} />);

      const input = screen.getByPlaceholderText('输入域名，如 example.com');
      fireEvent.change(input, { target: { value: 'newsite.com' } });
      fireEvent.click(screen.getByText('添加'));

      expect(onUpdate).toHaveBeenCalledWith({ blacklist: ['newsite.com'] });
    });

    it('按 Enter 键添加', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ blacklist: [] })} onUpdate={onUpdate} isSaving={false} />);

      const input = screen.getByPlaceholderText('输入域名，如 example.com');
      fireEvent.change(input, { target: { value: 'key.com' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onUpdate).toHaveBeenCalledWith({ blacklist: ['key.com'] });
    });

    it('重复添加显示警告 toast', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ blacklist: ['dup.com'] })} onUpdate={onUpdate} isSaving={false} />);

      const input = screen.getByPlaceholderText('输入域名，如 example.com');
      fireEvent.change(input, { target: { value: 'dup.com' } });
      fireEvent.click(screen.getByText('添加'));

      expect(onUpdate).not.toHaveBeenCalled();
      expect(screen.getByText('该网站已在黑名单中')).toBeTruthy();
    });

    it('空输入不调用 onUpdate', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ blacklist: [] })} onUpdate={onUpdate} isSaving={false} />);

      const addBtn = screen.getByText('添加') as HTMLButtonElement;
      expect(addBtn.disabled).toBe(true);
    });

    it('输入去除空格并小写化', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ blacklist: [] })} onUpdate={onUpdate} isSaving={false} />);

      const input = screen.getByPlaceholderText('输入域名，如 example.com');
      fireEvent.change(input, { target: { value: '  UPPER.COM  ' } });
      fireEvent.click(screen.getByText('添加'));

      expect(onUpdate).toHaveBeenCalledWith({ blacklist: ['upper.com'] });
    });

    it('点击移除按钮删除黑名单项', () => {
      const onUpdate = vi.fn();
      render(<GeneralSettings settings={makeSettings({ blacklist: ['a.com', 'b.com'] })} onUpdate={onUpdate} isSaving={false} />);

      fireEvent.click(screen.getByLabelText('从黑名单移除：a.com'));
      expect(onUpdate).toHaveBeenCalledWith({ blacklist: ['b.com'] });
    });
  });

  describe('其他区块', () => {
    it.each(['0.3.1', '1.2.3'])('关于区域显示运行扩展版本 %s', (version) => {
      vi.mocked(chrome.runtime.getManifest).mockReturnValueOnce({
        manifest_version: 3,
        name: 'NotOnlyTranslator',
        version,
      });
      render(<GeneralSettings settings={makeSettings()} onUpdate={vi.fn()} isSaving={false} />);

      expect(screen.getByRole('heading', { name: '关于' })).toBeVisible();
      expect(screen.getByText('版本').parentElement).toHaveTextContent(`版本${version}`);
      expect(screen.queryByText('0.1.0')).not.toBeInTheDocument();
    });

    it('渲染 CacheStats 子组件', () => {
      render(<GeneralSettings settings={makeSettings()} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByTestId('cache-stats')).toBeTruthy();
    });

    it('渲染导出数据按钮', () => {
      render(<GeneralSettings settings={makeSettings()} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByText('导出数据')).toBeTruthy();
    });

    it('渲染危险区域', () => {
      render(<GeneralSettings settings={makeSettings()} onUpdate={vi.fn()} isSaving={false} />);
      expect(screen.getByText('危险区域')).toBeTruthy();
    });
  });
});
