import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

/** 内容脚本也可直接读取系统偏好，不创建新的用户设置。 */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
}

const subscribe = (notify: () => void): (() => void) => {
  const media = window.matchMedia?.(query);
  media?.addEventListener('change', notify);
  return () => media?.removeEventListener('change', notify);
};

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
