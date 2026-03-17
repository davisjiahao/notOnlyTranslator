/**
 * 转化漏斗分析模块
 *
 * 用于追踪和分析用户转化漏斗，支持 AARRR 模型
 *
 * @module analytics/funnel
 */

import { analytics } from './Analytics';
import { AnalyticsEvents } from './types';
import type { FunnelConfig } from './types';

// 重新导出类型
export type { FunnelStep, FunnelAnalysisResult } from './types';

/** 漏斗阶段（AARRR 模型） */
export type FunnelStage = 'acquisition' | 'activation' | 'retention' | 'referral' | 'revenue';

/** 转化事件 */
export interface ConversionEvent {
  /** 事件名称 */
  event: string;
  /** 用户ID */
  userId?: string;
  /** 会话ID */
  sessionId?: string;
  /** 漏斗阶段 */
  stage: FunnelStage;
  /** 事件属性 */
  properties: Record<string, unknown>;
  /** 时间戳 */
  timestamp: number;
}

/** 漏斗转化率数据 */
export interface FunnelConversionData {
  /** 漏斗名称 */
  funnelName: string;
  /** 步骤列表 */
  steps: Array<{
    /** 步骤名称 */
    name: string;
    /** 步骤事件 */
    event: string;
    /** 进入用户数 */
    users: number;
    /** 完成用户数 */
    completedUsers: number;
    /** 转化率（相对于上一步） */
    conversionRate: number;
    /** 流失率 */
    dropOffRate: number;
  }>;
  /** 总转化率 */
  totalConversionRate: number;
  /** 总用户数 */
  totalUsers: number;
  /** 完成总用户数 */
  totalCompletedUsers: number;
  /** 平均完成时间（毫秒） */
  averageCompletionTime?: number;
}

/** 预定义漏斗配置 */
export const PredefinedFunnels: Record<string, FunnelConfig> = {
  /** 用户获取漏斗 */
  userAcquisition: {
    id: 'user_acquisition',
    name: '用户获取漏斗',
    steps: [
      { name: '商店查看', event: AnalyticsEvents.STORE_VIEW },
      { name: '商店点击', event: AnalyticsEvents.STORE_CLICK },
      { name: '安装完成', event: AnalyticsEvents.INSTALL_COMPLETE },
    ],
  },
  /** 用户激活漏斗 */
  userActivation: {
    id: 'user_activation',
    name: '用户激活漏斗',
    steps: [
      { name: '开始引导', event: AnalyticsEvents.ONBOARDING_START },
      { name: '完成引导', event: AnalyticsEvents.ONBOARDING_COMPLETE },
      { name: '首次翻译', event: AnalyticsEvents.FIRST_TRANSLATION },
      { name: '标记首个单词', event: AnalyticsEvents.FIRST_WORD_MARKED },
    ],
  },
  /** 用户留存漏斗 */
  userRetention: {
    id: 'user_retention',
    name: '用户留存漏斗',
    steps: [
      { name: '翻译请求', event: AnalyticsEvents.TRANSLATION_REQUEST },
      { name: '单词标记', event: AnalyticsEvents.WORD_MARKED },
      { name: '词汇复习', event: AnalyticsEvents.VOCABULARY_REVIEW },
      { name: '闪卡练习', event: AnalyticsEvents.FLASHCARD_PRACTICE },
    ],
  },
  /** 用户推荐漏斗 */
  userReferral: {
    id: 'user_referral',
    name: '用户推荐漏斗',
    steps: [
      { name: '成就解锁', event: AnalyticsEvents.ACHIEVEMENT_UNLOCKED },
      { name: '点击分享', event: AnalyticsEvents.SHARE_CLICKED },
      { name: '完成分享', event: AnalyticsEvents.SHARE_COMPLETED },
      { name: '邀请安装', event: AnalyticsEvents.REFERRAL_INSTALL },
    ],
  },
};

// ========== 转化事件追踪 ==========

/**
 * 追踪转化事件
 * @param stage - 漏斗阶段
 * @param eventName - 事件名称
 * @param properties - 事件属性
 */
export async function trackConversion(
  stage: FunnelStage,
  eventName: string,
  properties: Record<string, unknown> = {}
): Promise<void> {
  const conversionEvent: ConversionEvent = {
    event: eventName,
    stage,
    properties: {
      ...properties,
      stage,
      timestamp: Date.now()
    },
    timestamp: Date.now()
  };

  try {
    await analytics.track(eventName, conversionEvent.properties);

    // 存储转化事件到本地存储，用于漏斗分析
    await storeConversionEvent(conversionEvent);
  } catch (error) {
    console.error('[Analytics] 追踪转化事件失败:', error);
  }
}

/**
 * 存储转化事件
 * @param event - 转化事件
 */
async function storeConversionEvent(event: ConversionEvent): Promise<void> {
  try {
    const result = await chrome.storage.local.get('analytics_conversions');
    const conversions = (result.analytics_conversions as ConversionEvent[]) || [];

    conversions.push(event);

    // 限制存储数量，只保留最近 1000 条
    if (conversions.length > 1000) {
      conversions.shift();
    }

    await chrome.storage.local.set({ analytics_conversions: conversions });
  } catch (error) {
    console.error('[Analytics] 存储转化事件失败:', error);
  }
}

// ========== 漏斗分析 ==========

/**
 * 分析漏斗转化率
 * @param funnelConfig - 漏斗配置
 * @param timeRange - 时间范围（毫秒）
 * @returns 漏斗转化率数据
 */
export async function analyzeFunnel(
  funnelConfig: FunnelConfig,
  timeRange: number = 7 * 24 * 60 * 60 * 1000 // 默认7天
): Promise<FunnelConversionData> {
  try {
    const result = await chrome.storage.local.get('analytics_conversions');
    const conversions = (result.analytics_conversions as ConversionEvent[]) || [];

    // 过滤时间范围内的数据
    const now = Date.now();
    const filteredConversions = conversions.filter(
      c => c.timestamp >= now - timeRange
    );

    // 分析每个步骤
    const steps = funnelConfig.steps.map((step, index) => {
      const stepConversions = filteredConversions.filter(
        c => c.event === step.event
      );

      const uniqueUsers = new Set(stepConversions.map(c => c.userId)).size;

      // 计算转化率
      let conversionRate = 0;
      let dropOffRate = 0;

      if (index > 0) {
        const prevStep = steps[index - 1];
        if (prevStep) {
          conversionRate = prevStep.completedUsers > 0
            ? (uniqueUsers / prevStep.completedUsers) * 100
            : 0;
          dropOffRate = 100 - conversionRate;
        }
      } else {
        conversionRate = 100; // 第一步默认 100%
      }

      return {
        name: step.name,
        event: step.event,
        users: stepConversions.length,
        completedUsers: uniqueUsers,
        conversionRate,
        dropOffRate
      };
    });

    // 计算总转化率
    const totalUsers = steps[0]?.completedUsers || 0;
    const totalCompletedUsers = steps[steps.length - 1]?.completedUsers || 0;
    const totalConversionRate = totalUsers > 0
      ? (totalCompletedUsers / totalUsers) * 100
      : 0;

    return {
      funnelName: funnelConfig.name,
      steps,
      totalConversionRate,
      totalUsers,
      totalCompletedUsers
    };
  } catch (error) {
    console.error('[Analytics] 分析漏斗失败:', error);
    return {
      funnelName: funnelConfig.name,
      steps: [],
      totalConversionRate: 0,
      totalUsers: 0,
      totalCompletedUsers: 0
    };
  }
}

// ========== 便捷函数 ==========

/**
 * 追踪获客阶段事件
 * @param eventName - 事件名称
 * @param properties - 事件属性
 */
export function trackAcquisition(
  eventName: string,
  properties: Record<string, unknown> = {}
): void {
  trackConversion('acquisition', eventName, properties).catch((error: Error) => {
    console.error('[Analytics] 追踪获客事件失败:', error);
  });
}

/**
 * 追踪激活阶段事件
 * @param eventName - 事件名称
 * @param properties - 事件属性
 */
export function trackActivation(
  eventName: string,
  properties: Record<string, unknown> = {}
): void {
  trackConversion('activation', eventName, properties).catch((error: Error) => {
    console.error('[Analytics] 追踪激活事件失败:', error);
  });
}

/**
 * 追踪留存阶段事件
 * @param eventName - 事件名称
 * @param properties - 事件属性
 */
export function trackRetention(
  eventName: string,
  properties: Record<string, unknown> = {}
): void {
  trackConversion('retention', eventName, properties).catch((error: Error) => {
    console.error('[Analytics] 追踪留存事件失败:', error);
  });
}

/**
 * 追踪推荐阶段事件
 * @param eventName - 事件名称
 * @param properties - 事件属性
 */
export function trackReferral(
  eventName: string,
  properties: Record<string, unknown> = {}
): void {
  trackConversion('referral', eventName, properties).catch((error: Error) => {
    console.error('[Analytics] 追踪推荐事件失败:', error);
  });
}
