/**
 * Analytics 初始化模块
 *
 * 提供简化的 Analytics 初始化和事件追踪接口
 * 供内容脚本和背景页直接使用
 *
 * @module analytics/init
 */

import { Analytics, analytics } from './Analytics';
import { AnalyticsEvents } from './types';
import { ExperimentFramework, experimentFramework } from './ExperimentFramework';
import { initializeUserProfile, trackUserEvent } from './userProfile';
import { initPeriodicFlush } from './eventQueue';

/** 初始化状态 */
let isInitialized = false;
let isInitializing = false;

/** 清理函数 */
let cleanupFn: (() => void) | null = null;

/**
 * 初始化 Analytics 系统
 * @param options - 初始化选项
 * @returns 是否成功初始化
 */
export async function initAnalytics(options: {
  installSource?: string;
  initialLevel?: string;
  apiProvider?: string;
  referrerId?: string;
} = {}): Promise<boolean> {
  // 防止重复初始化
  if (isInitialized) {
    return true;
  }

  // 防止并发初始化
  if (isInitializing) {
    // 等待初始化完成
    for (let i = 0; i < 50; i++) {
      if (isInitialized) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  isInitializing = true;

  try {
    // 1. 初始化 Analytics 核心
    await analytics.initialize();

    // 2. 初始化用户画像
    await initializeUserProfile({
      installSource: options.installSource,
      initialLevel: options.initialLevel,
      apiProvider: options.apiProvider,
      referrerId: options.referrerId,
    });

    // 3. 启动定期刷新
    cleanupFn = initPeriodicFlush();

    isInitialized = true;

    // 4. 追踪初始化完成事件
    await trackEvent('analytics_initialized', {
      userId: analytics.getUserId(),
    });

    console.log('[Analytics] 初始化完成');
    return true;
  } catch (error) {
    console.error('[Analytics] 初始化失败:', error);
    return false;
  } finally {
    isInitializing = false;
  }
}

/**
 * 追踪事件（简化接口）
 * @param eventName - 事件名称
 * @param properties - 事件属性
 */
export async function trackEvent(
  eventName: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  if (!isInitialized) {
    // 如果未初始化，先尝试初始化
    await initAnalytics();
  }

  await trackUserEvent(eventName, properties);
}

/**
 * 注册实验
 * @param experiment - 实验配置
 */
export function registerExperiment(experiment: {
  id: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  trafficAllocation: number;
  groups: Array<{
    id: string;
    name: string;
    weight: number;
    variant: string;
    config?: Record<string, unknown>;
  }>;
  primaryMetric: string;
  secondaryMetrics: string[];
  minimumSampleSize: number;
}): void {
  experimentFramework.registerExperiment(experiment);
}

/**
 * 获取用户的实验分组
 * @param experimentId - 实验ID
 * @returns 分组信息
 */
export async function getExperimentGroup(experimentId: string) {
  return experimentFramework.getGroupForUser(experimentId);
}

/**
 * 检查用户是否在指定变体中
 * @param experimentId - 实验ID
 * @param variant - 变体名称
 * @returns 是否在变体中
 */
export function isInVariant(experimentId: string, variant: string): boolean {
  return experimentFramework.isInVariant(experimentId, variant);
}

/**
 * 获取用户ID
 * @returns 用户ID
 */
export function getUserId(): string | null {
  return analytics.getUserId();
}

/**
 * 获取会话ID
 * @returns 会话ID
 */
export function getSessionId(): string | null {
  return analytics.getSessionId();
}

/**
 * 销毁 Analytics 实例（清理资源）
 */
export function destroyAnalytics(): void {
  if (cleanupFn) {
    cleanupFn();
    cleanupFn = null;
  }

  analytics.destroy();
  isInitialized = false;
}

// 重新导出常用事件名称
export { AnalyticsEvents } from './Analytics';

// 重新导出类型
export type {
  TrackEvent,
  UserAnalyticsProfile,
  ExperimentConfig,
  ExperimentGroup,
  ExperimentAssignment,
} from './types';
