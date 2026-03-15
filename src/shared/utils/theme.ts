import type { ThemeMode } from '@/shared/types';
import { useEffect, useState, useCallback } from 'react';

/**
 * 获取实际应用的主题模式
 * 如果设置为 'system'，则根据系统偏好返回 'light' 或 'dark'
 */
export function getEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

/**
 * 主题管理 Hook
 *
 * 功能：
 * - 管理主题状态（light/dark/system）
 * - 监听系统主题变化
 * - 应用主题到 document.documentElement
 */
export function useTheme(initialTheme: ThemeMode = 'system') {
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>(
    getEffectiveTheme(initialTheme)
  );

  // 应用主题到 DOM
  const applyTheme = useCallback((mode: ThemeMode) => {
    const effective = getEffectiveTheme(mode);
    setEffectiveTheme(effective);

    const root = document.documentElement;
    if (effective === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, []);

  // 设置主题模式
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setTheme(mode);
    applyTheme(mode);
  }, [applyTheme]);

  // 初始化主题
  useEffect(() => {
    applyTheme(theme);
  }, [applyTheme, theme]);

  // 监听系统主题变化
  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      applyTheme('system');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  return {
    theme,
    effectiveTheme,
    setTheme: setThemeMode,
    isDark: effectiveTheme === 'dark',
  };
}

/**
 * 主题切换按钮组件使用的选项
 */
export const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: '亮色', icon: '☀️' },
  { value: 'dark', label: '暗色', icon: '🌙' },
  { value: 'system', label: '跟随系统', icon: '💻' },
];
