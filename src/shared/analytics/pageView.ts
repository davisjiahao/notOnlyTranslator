/**
 * 页面访问追踪模块
 *
 * 用于追踪页面访问、浏览路径和用户停留时间
 *
 * @module analytics/pageView
 */

import { analytics } from './Analytics';
import { AnalyticsEvents } from './types';

/** 页面访问数据 */
export interface PageViewData {
  /** 页面 URL */
  url: string;
  /** 页面标题 */
  title: string;
  /** 来源页面 */
  referrer: string;
  /** 访问时间戳 */
  timestamp: number;
  /** 页面停留时间（毫秒） */
  duration?: number;
  /** 页面路径 */
  path: string;
  /** 查询参数 */
  searchParams?: Record<string, string>;
  /** 页面类型（如 content_script, popup, options） */
  pageType?: string;
}

/** 页面访问会话 */
export interface PageViewSession {
  /** 会话ID */
  sessionId: string;
  /** 用户ID */
  userId: string | null;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime?: number;
  /** 访问的页面列表 */
  pageViews: PageViewData[];
  /** 总页面数 */
  totalPageViews: number;
  /** 来源页面 */
  referrer?: string;
  /** 来源类型 */
  sourceType?: string;
}

/** 页面性能数据 */
export interface PagePerformanceData {
  /** 页面 URL */
  url: string;
  /** DNS 查询时间 */
  dnsTime: number;
  /** 连接时间 */
  connectTime: number;
  /** 响应时间 */
  responseTime: number;
  /** DOM 解析时间 */
  domParseTime: number;
  /** 页面完全加载时间 */
  loadTime: number;
  /** 首次内容绘制时间 */
  fcpTime?: number;
  /** 最大内容绘制时间 */
  lcpTime?: number;
}

// ========== 状态变量 ==========

/** 当前页面访问数据 */
let currentPageView: PageViewData | null = null;
/** 页面进入时间 */
let pageEnterTime = 0;
/** 是否正在追踪 */
let isTracking = false;
/** 监听器清理函数 */
let cleanupListeners: (() => void) | null = null;

// ========== 页面访问追踪函数 ==========

/**
 * 开始追踪页面访问
 * @param pageType - 页面类型（如 content_script, popup, options）
 * @returns 是否成功开始追踪
 */
export function startPageViewTracking(pageType?: string): boolean {
  if (isTracking) {
    return false;
  }

  isTracking = true;
  pageEnterTime = Date.now();

  // 创建页面访问数据
  currentPageView = createPageViewData(pageType);

  // 设置页面离开监听
  setupPageLeaveListeners();

  // 追踪页面访问事件
  trackPageViewEvent(currentPageView);

  return true;
}

/**
 * 停止页面访问追踪
 * @returns 最终的页面访问数据
 */
export function stopPageViewTracking(): PageViewData | null {
  if (!isTracking || !currentPageView) {
    return null;
  }

  const duration = Date.now() - pageEnterTime;
  currentPageView.duration = duration;

  // 追踪页面离开事件
  trackPageLeaveEvent(currentPageView);

  // 清理
  cleanup();

  const result = { ...currentPageView };
  return result;
}

/**
 * 获取当前页面访问数据
 * @returns 当前页面访问数据
 */
export function getCurrentPageView(): PageViewData | null {
  if (!currentPageView || !isTracking) {
    return null;
  }

  const duration = Date.now() - pageEnterTime;
  return {
    ...currentPageView,
    duration
  };
}

/**
 * 创建页面访问数据
 * @param pageType - 页面类型
 * @returns 页面访问数据
 */
function createPageViewData(pageType?: string): PageViewData {
  const url = typeof window !== 'undefined' ? window.location.href : '';
  const title = typeof document !== 'undefined' ? document.title : '';
  const referrer = typeof document !== 'undefined' ? document.referrer : '';
  const path = typeof window !== 'undefined' ? window.location.pathname : '';

  // 解析查询参数
  let searchParams: Record<string, string> | undefined;
  if (typeof window !== 'undefined') {
    const urlObj = new URL(url);
    searchParams = {};
    urlObj.searchParams.forEach((value, key) => {
      if (searchParams) {
        searchParams[key] = value;
      }
    });
  }

  return {
    url,
    title,
    referrer,
    timestamp: Date.now(),
    path,
    searchParams,
    pageType,
    duration: 0
  };
}

/**
 * 设置页面离开监听器
 */
function setupPageLeaveListeners(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const handleVisibilityChange = () => {
    if (document.hidden) {
      // 页面隐藏时，记录停留时间
      const duration = Date.now() - pageEnterTime;
      if (currentPageView) {
        currentPageView.duration = duration;
      }
    } else {
      // 页面重新可见时，重置计时
      pageEnterTime = Date.now();
    }
  };

  const handleBeforeUnload = () => {
    stopPageViewTracking();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('beforeunload', handleBeforeUnload);

  cleanupListeners = () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}

/**
 * 追踪页面访问事件
 * @param pageView - 页面访问数据
 */
async function trackPageViewEvent(pageView: PageViewData): Promise<void> {
  try {
    await analytics.track(AnalyticsEvents.PAGE_VIEW, {
      url: pageView.url,
      path: pageView.path,
      title: pageView.title,
      referrer: pageView.referrer,
      pageType: pageView.pageType,
      searchParams: pageView.searchParams,
      timestamp: pageView.timestamp
    });
  } catch (error) {
    console.error('[Analytics] 追踪页面访问事件失败:', error);
  }
}

/**
 * 追踪页面离开事件
 * @param pageView - 页面访问数据
 */
async function trackPageLeaveEvent(pageView: PageViewData): Promise<void> {
  try {
    await analytics.track('page_leave', {
      url: pageView.url,
      path: pageView.path,
      title: pageView.title,
      duration: pageView.duration,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('[Analytics] 追踪页面离开事件失败:', error);
  }
}

/**
 * 清理资源
 */
function cleanup(): void {
  if (cleanupListeners) {
    cleanupListeners();
    cleanupListeners = null;
  }

  currentPageView = null;
  isTracking = false;
}

// ========== 页面性能追踪 ==========

/**
 * 收集页面性能数据
 * @returns 页面性能数据
 */
export function collectPagePerformanceData(): PagePerformanceData | null {
  if (typeof window === 'undefined' || !window.performance) {
    return null;
  }

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  if (!navigation) {
    return null;
  }

  const paint = performance.getEntriesByType('paint');
  const fcp = paint.find(entry => entry.name === 'first-contentful-paint');

  return {
    url: window.location.href,
    dnsTime: navigation.domainLookupEnd - navigation.domainLookupStart,
    connectTime: navigation.connectEnd - navigation.connectStart,
    responseTime: navigation.responseEnd - navigation.responseStart,
    domParseTime: navigation.domContentLoadedEventEnd - navigation.responseEnd,
    loadTime: navigation.loadEventEnd - navigation.startTime,
    fcpTime: fcp ? fcp.startTime : undefined
  };
}

/**
 * 追踪页面性能数据
 */
export async function trackPagePerformance(): Promise<void> {
  const perfData = collectPagePerformanceData();
  if (!perfData) {
    return;
  }

  try {
    await analytics.track('page_performance', {
      url: perfData.url,
      dnsTime: perfData.dnsTime,
      connectTime: perfData.connectTime,
      responseTime: perfData.responseTime,
      domParseTime: perfData.domParseTime,
      loadTime: perfData.loadTime,
      fcpTime: perfData.fcpTime
    });
  } catch (error) {
    console.error('[Analytics] 追踪页面性能数据失败:', error);
  }
}

// ========== 会话追踪 ==========

/** 当前会话ID */
let currentSessionId: string | null = null;
/** 会话开始时间 */
let sessionStartTime = 0;

/**
 * 开始新的会话
 * @param sourceType - 来源类型
 * @param referrer - 来源页面
 */
export function startSession(sourceType?: string, referrer?: string): string {
  currentSessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  sessionStartTime = Date.now();

  // 追踪会话开始事件
  analytics.track(AnalyticsEvents.SESSION_START, {
    sessionId: currentSessionId,
    sourceType,
    referrer,
    timestamp: sessionStartTime
  }).catch((error: Error) => {
    console.error('[Analytics] 追踪会话开始事件失败:', error);
  });

  return currentSessionId;
}

/**
 * 结束当前会话
 */
export async function endSession(): Promise<void> {
  if (!currentSessionId) {
    return;
  }

  const duration = Date.now() - sessionStartTime;

  try {
    await analytics.track(AnalyticsEvents.SESSION_END, {
      sessionId: currentSessionId,
      duration,
      timestamp: Date.now()
    });

    currentSessionId = null;
    sessionStartTime = 0;
  } catch (error) {
    console.error('[Analytics] 追踪会话结束事件失败:', error);
  }
}

/**
 * 获取当前会话ID
 * @returns 会话ID
 */
export function getCurrentSessionId(): string | null {
  return currentSessionId;
}

// ========== 辅助函数 ==========

/**
 * 获取当前页面的 URL 信息
 * @returns URL 信息
 */
export function getCurrentUrlInfo(): {
  url: string;
  path: string;
  search: string;
  hash: string;
  hostname: string;
} {
  if (typeof window === 'undefined') {
    return {
      url: '',
      path: '',
      search: '',
      hash: '',
      hostname: ''
    };
  }

  return {
    url: window.location.href,
    path: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
    hostname: window.location.hostname
  };
}

/**
 * 解析来源信息
 * @param referrer - referrer URL
 * @returns 来源信息
 */
export function parseReferrer(referrer: string): {
  source: string;
  medium: string;
  campaign?: string;
} {
  if (!referrer) {
    return { source: 'direct', medium: 'none' };
  }

  try {
    const url = new URL(referrer);
    const hostname = url.hostname.toLowerCase();

    // 搜索引擎
    if (hostname.includes('google')) {
      return { source: 'google', medium: 'organic' };
    }
    if (hostname.includes('bing')) {
      return { source: 'bing', medium: 'organic' };
    }
    if (hostname.includes('baidu')) {
      return { source: 'baidu', medium: 'organic' };
    }

    // 社交媒体
    if (hostname.includes('twitter') || hostname.includes('x.com')) {
      return { source: 'twitter', medium: 'social' };
    }
    if (hostname.includes('facebook')) {
      return { source: 'facebook', medium: 'social' };
    }
    if (hostname.includes('linkedin')) {
      return { source: 'linkedin', medium: 'social' };
    }

    // 默认返回 hostname
    return { source: hostname, medium: 'referral' };
  } catch {
    return { source: 'unknown', medium: 'referral' };
  }
}
