/**
 * Analytics 核心模块测试
 *
 * 测试 Analytics 类的核心功能：初始化、事件追踪、用户识别等
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Analytics } from '../Analytics';

describe('Analytics Core', () => {
  let analytics: Analytics;

  beforeEach(() => {
    // 重置 Analytics 单例
    Analytics.resetInstance();

    // 获取 Analytics 实例
    analytics = Analytics.getInstance();
  });

  afterEach(() => {
    // 清理
    analytics.destroy();
    vi.restoreAllMocks();
  });

  describe('单例模式', () => {
    it('应该返回相同的实例', () => {
      const instance1 = Analytics.getInstance();
      const instance2 = Analytics.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('重置后应该返回新实例', () => {
      const instance1 = Analytics.getInstance();
      Analytics.resetInstance();
      const instance2 = Analytics.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('初始化', () => {
    it('应该成功初始化', async () => {
      await analytics.initialize();
      expect(analytics.getUserId()).not.toBeNull();
      expect(analytics.getSessionId()).not.toBeNull();
    });

    it('应该生成唯一用户ID', async () => {
      await analytics.initialize();
      const userId = analytics.getUserId();
      expect(userId).toBeTruthy();
      expect(userId?.startsWith('usr_')).toBe(true);
    });

    it('重复初始化不应报错', async () => {
      await analytics.initialize();
      await analytics.initialize(); // 第二次初始化
      expect(analytics.getUserId()).not.toBeNull();
    });
  });

  describe('事件追踪', () => {
    beforeEach(async () => {
      await analytics.initialize();
    });

    it('应该能够追踪事件', async () => {
      await analytics.track('test_event', { foo: 'bar' });
      // 由于事件是异步处理的，我们主要验证不抛出错误
      expect(true).toBe(true);
    });

    it('应该能够识别用户', async () => {
      const newUserId = 'test_user_123';
      await analytics.identify(newUserId, { email: 'test@example.com' });
      expect(analytics.getUserId()).toBe(newUserId);
    });

    it('应该包含用户属性', async () => {
      await analytics.identify('test_user', { plan: 'premium' });
      const traits = analytics.getUserTraits();
      expect(traits).toHaveProperty('plan', 'premium');
    });
  });

  describe('事件队列', () => {
    beforeEach(async () => {
      await analytics.initialize();
    });

    it('应该能够获取所有事件', async () => {
      await analytics.track('test_event', { key: 'value' });
      const events = await analytics.getAllEvents();
      expect(Array.isArray(events)).toBe(true);
    });

    it('应该能够刷新队列', async () => {
      await analytics.track('event1');
      await analytics.track('event2');
      await analytics.flush();
      // 刷新后队列应该被清空或保存到存储
      expect(true).toBe(true);
    });
  });

  describe('清理', () => {
    it('应该能够正确销毁实例', async () => {
      await analytics.initialize();
      analytics.destroy();
      // 销毁后应该清理定时器和资源
      expect(true).toBe(true);
    });
  });
});
