/**
 * 主题工具测试
 *
 * 测试主题相关的核心功能
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { getEffectiveTheme, useTheme, THEME_OPTIONS } from '@/shared/utils/theme';
import type { ThemeMode } from '@/shared/types';

// Mock window.matchMedia
const createMatchMedia = (matches: boolean) => {
  const listeners: Array<(e: { matches: boolean }) => void> = [];
  return vi.fn((query: string) => ({
    matches,
    media: query,
    addEventListener: vi.fn((event: string, listener: (e: { matches: boolean }) => void) => {
      listeners.push(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: (e: { matches: boolean }) => void) => {
      const index = listeners.indexOf(listener);
      if (index > -1) listeners.splice(index, 1);
    }),
    // 用于触发变化
    _triggerChange: (newMatches: boolean) => {
      listeners.forEach(l => l({ matches: newMatches }));
    },
  }));
};

describe('getEffectiveTheme', () => {
  it('应该返回 light 当模式是 light', () => {
    expect(getEffectiveTheme('light')).toBe('light');
  });

  it('应该返回 dark 当模式是 dark', () => {
    expect(getEffectiveTheme('dark')).toBe('dark');
  });

  it('应该返回系统偏好当模式是 system', () => {
    // Mock 系统偏好为 dark
    const mockMatchMedia = createMatchMedia(true);
    vi.stubGlobal('matchMedia', mockMatchMedia);

    expect(getEffectiveTheme('system')).toBe('dark');

    vi.unstubAllGlobals();
  });

  it('应该返回 light 当系统偏好是亮色', () => {
    const mockMatchMedia = createMatchMedia(false);
    vi.stubGlobal('matchMedia', mockMatchMedia);

    expect(getEffectiveTheme('system')).toBe('light');

    vi.unstubAllGlobals();
  });
});

describe('useTheme', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', createMatchMedia(false));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('应该初始化为默认主题', () => {
    const { result } = renderHook(() => useTheme('light'));

    expect(result.current.theme).toBe('light');
    expect(result.current.effectiveTheme).toBe('light');
    expect(result.current.isDark).toBe(false);
  });

  it('应该切换主题', () => {
    const { result } = renderHook(() => useTheme('light'));

    act(() => {
      result.current.setTheme('dark');
    });

    expect(result.current.theme).toBe('dark');
    expect(result.current.effectiveTheme).toBe('dark');
    expect(result.current.isDark).toBe(true);
  });

  it('应该正确处理 system 主题', () => {
    const { result } = renderHook(() => useTheme('system'));

    expect(result.current.theme).toBe('system');
    // 系统偏好是 light (mock)
    expect(result.current.effectiveTheme).toBe('light');
  });
});

describe('THEME_OPTIONS', () => {
  it('应该包含三个选项', () => {
    expect(THEME_OPTIONS.length).toBe(3);
  });

  it('应该包含正确的选项值', () => {
    const values = THEME_OPTIONS.map(opt => opt.value);
    expect(values).toContain('light');
    expect(values).toContain('dark');
    expect(values).toContain('system');
  });

  it('每个选项应该有 label 和 icon', () => {
    THEME_OPTIONS.forEach(option => {
      expect(option.label).toBeDefined();
      expect(option.icon).toBeDefined();
    });
  });

  it('亮色主题应该有太阳图标', () => {
    const lightOption = THEME_OPTIONS.find(opt => opt.value === 'light');
    expect(lightOption!.icon).toBe('☀️');
  });

  it('暗色主题应该有月亮图标', () => {
    const darkOption = THEME_OPTIONS.find(opt => opt.value === 'dark');
    expect(darkOption!.icon).toBe('🌙');
  });

  it('跟随系统应该有电脑图标', () => {
    const systemOption = THEME_OPTIONS.find(opt => opt.value === 'system');
    expect(systemOption!.icon).toBe('💻');
  });
});