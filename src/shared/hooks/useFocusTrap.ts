import { useEffect, useRef, useCallback } from 'react';

/**
 * WCAG 2.4.3 Focus Order - Modal Focus Trap
 *
 * 确保焦点在 Modal 打开时被限制在 Modal 内，
 * 防止用户意外导航到 Modal 外的元素。
 *
 * 功能：
 * - Modal 打开时自动聚焦第一个可聚焦元素
 * - Tab/Shift+Tab 循环在 Modal 内部
 * - Modal 关闭时恢复焦点到触发元素
 */

// 可聚焦元素选择器
const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

interface UseFocusTrapOptions {
  /** 是否激活 focus trap（通常在 Modal 打开时为 true） */
  active: boolean;
  /** Modal 关闭后焦点恢复的目标元素 */
  restoreFocusTo?: HTMLElement | null;
  /** 初始焦点元素（默认为第一个可聚焦元素） */
  initialFocusRef?: React.RefObject<HTMLElement>;
}

/**
 * useFocusTrap - Modal 焦点限制 hook
 */
export function useFocusTrap<T extends HTMLElement>(
  options: UseFocusTrapOptions
): React.RefObject<T> {
  const containerRef = useRef<T>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // 获取容器内所有可聚焦元素
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter(el => el.offsetParent !== null); // 过滤隐藏元素
  }, []);

  // 处理 Tab 键导航
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !containerRef.current) return;

    const focusableElements = getFocusableElements();
    if (focusableElements.length === 0) return;

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Shift+Tab 在第一个元素上 -> 移到最后一个
    if (e.shiftKey && document.activeElement === firstElement) {
      e.preventDefault();
      lastElement.focus();
    }
    // Tab 在最后一个元素上 -> 移到第一个
    else if (!e.shiftKey && document.activeElement === lastElement) {
      e.preventDefault();
      firstElement.focus();
    }
  }, [getFocusableElements]);

  useEffect(() => {
    if (!options.active) return;

    // 保存当前焦点元素
    previousFocusRef.current = document.activeElement as HTMLElement;

    // 添加 Tab 键监听
    document.addEventListener('keydown', handleKeyDown);

    // 聚焦第一个可聚焦元素或指定元素
    const focusElement = () => {
      if (options.initialFocusRef?.current) {
        options.initialFocusRef.current.focus();
      } else {
        const focusableElements = getFocusableElements();
        if (focusableElements.length > 0) {
          focusableElements[0].focus();
        }
      }
    };

    // 延迟聚焦以确保 Modal DOM 已渲染
    requestAnimationFrame(focusElement);

    return () => {
      // 清理监听器
      document.removeEventListener('keydown', handleKeyDown);

      // 恢复焦点
      const restoreTarget = options.restoreFocusTo || previousFocusRef.current;
      if (restoreTarget && typeof restoreTarget.focus === 'function') {
        restoreTarget.focus();
      }
    };
  }, [options.active, options.restoreFocusTo, options.initialFocusRef, handleKeyDown, getFocusableElements]);

  return containerRef;
}

export default useFocusTrap;