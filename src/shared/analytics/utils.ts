/**
 * 分析模块工具函数库
 *
 * 提供各种通用的工具函数，用于分析模块的各个组件
 *
 * @module analytics/utils
 */

/**
 * 生成唯一ID
 * @returns 唯一标识符
 */
export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}`;
}

/**
 * 获取或创建会话ID
 * 优先从 sessionStorage 获取，如不存在则创建新的
 * @returns 会话ID
 */
export function getOrCreateSessionId(): string {
  const SESSION_ID_KEY = 'analytics_session_id';

  try {
    // 尝试从 sessionStorage 获取
    const existingId = sessionStorage.getItem(SESSION_ID_KEY);
    if (existingId) {
      return existingId;
    }

    // 创建新会话ID
    const newId = generateId();
    sessionStorage.setItem(SESSION_ID_KEY, newId);
    return newId;
  } catch {
    // sessionStorage 不可用，返回临时ID
    return generateId();
  }
}

/**
 * 获取或创建设备ID
 * 优先从 localStorage 获取，如不存在则创建新的
 * @returns 设备ID
 */
export function getOrCreateDeviceId(): string {
  const DEVICE_ID_KEY = 'analytics_device_id';

  try {
    // 尝试从 localStorage 获取
    const existingId = localStorage.getItem(DEVICE_ID_KEY);
    if (existingId) {
      return existingId;
    }

    // 创建设备ID（格式: device-{timestamp}-{random}）
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 11);
    const newId = `device-${timestamp}-${random}`;

    localStorage.setItem(DEVICE_ID_KEY, newId);
    return newId;
  } catch {
    // localStorage 不可用，返回临时ID
    return `device-${generateId()}`;
  }
}

/**
 * 深度克隆对象
 * 支持基本类型、对象、数组、日期和正则表达式
 * @param obj 要克隆的对象
 * @returns 克隆后的对象
 */
export function deepClone<T>(obj: T): T {
  // 处理 null 或 undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // 处理日期
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }

  // 处理正则表达式
  if (obj instanceof RegExp) {
    return new RegExp(obj.source, obj.flags) as unknown as T;
  }

  // 处理数组
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }

  // 处理对象
  if (typeof obj === 'object') {
    const cloned = {} as Record<string, unknown>;
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = deepClone(obj[key]);
      }
    }
    return cloned as T;
  }

  // 基本类型直接返回
  return obj;
}

/**
 * 安全获取嵌套对象的属性值
 * @param obj 源对象
 * @param path 属性路径，如 'user.profile.name'
 * @param defaultValue 默认值，当路径不存在时返回
 * @returns 属性值或默认值
 */
export function getNestedValue<T>(
  obj: Record<string, unknown> | undefined | null,
  path: string,
  defaultValue?: T
): T | undefined {
  if (!obj || typeof obj !== 'object') {
    return defaultValue;
  }

  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return defaultValue;
    }

    if (typeof current !== 'object') {
      return defaultValue;
    }

    current = (current as Record<string, unknown>)[key];
  }

  return (current === undefined ? defaultValue : current) as T | undefined;
}

/**
 * 防抖函数
 * 延迟执行函数，如果在延迟期间再次调用则重置延迟
 * @param func 要执行的函数
 * @param wait 延迟时间（毫秒）
 * @returns 防抖后的函数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (this: unknown, ...args: Parameters<T>): void {
    const context = this;

    if (timeout) {
      clearTimeout(timeout);
    }

    timeout = setTimeout(() => {
      func.apply(context, args as unknown[]);
    }, wait);
  };
}

/**
 * 节流函数
 * 限制函数执行频率，在指定时间内最多执行一次
 * @param func 要执行的函数
 * @param limit 时间限制（毫秒）
 * @returns 节流后的函数
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function (this: unknown, ...args: Parameters<T>): void {
    const context = this;

    if (!inThrottle) {
      func.apply(context, args as unknown[]);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, limit);
    }
  };
}