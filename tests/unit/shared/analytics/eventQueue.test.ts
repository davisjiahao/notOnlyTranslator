import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueueEvent,
  enqueueEvents,
  flushEvents,
  getQueueStatus,
  clearQueue,
  initPeriodicFlush,
} from '@/shared/analytics/eventQueue';
import type { TrackEvent } from '@/shared/types/analytics';
import { ANALYTICS_CONFIG } from '@/shared/types/analytics';

// Mock chrome APIs
const mockStorage = {
  local: {
    get: vi.fn(),
    set: vi.fn(),
  },
};

const mockRuntime = {
  sendMessage: vi.fn(),
};

Object.defineProperty(global, 'chrome', {
  value: {
    storage: mockStorage,
    runtime: mockRuntime,
  },
  writable: true,
});

// Mock window events
const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();
Object.defineProperty(global, 'window', {
  value: {
    addEventListener: mockAddEventListener,
    removeEventListener: mockRemoveEventListener,
  },
  writable: true,
});

function createEvent(overrides?: Partial<TrackEvent>): TrackEvent {
  return {
    event: 'test_event',
    properties: {},
    timestamp: Date.now(),
    user_id: 'user-1',
    session_id: 'session-1',
    device_id: 'device-1',
    ...overrides,
  };
}

describe('EventQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.local.get.mockResolvedValue({});
    mockStorage.local.set.mockResolvedValue(undefined);
    mockRuntime.sendMessage.mockResolvedValue({ success: true });
  });

  describe('enqueueEvent', () => {
    it('应该添加单个事件到队列', async () => {
      // 预存 deviceId，避免 getDeviceId 触发额外的 set 调用
      mockStorage.local.get.mockResolvedValue({
        analytics_device_id: 'test-device-id',
      });

      const event = createEvent();
      await enqueueEvent(event);

      expect(mockStorage.local.set).toHaveBeenCalled();
      const setCalls = mockStorage.local.set.mock.calls;
      const queueSetCall = setCalls.find((c) => c[0].analytics_event_queue);
      expect(queueSetCall).toBeDefined();
      expect(queueSetCall[0].analytics_event_queue.events).toHaveLength(1);
    });

    it('应该在事件数达到 BATCH_SIZE 时触发 flush', async () => {
      // 模拟队列中已有 49 个事件
      const existingEvents = Array.from({ length: 49 }, (_, i) =>
        createEvent({ event: `event_${i}` }),
      );
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events: existingEvents,
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      await enqueueEvent(createEvent({ event: 'event_50' }));

      // 应该触发了 flushEvents（sendMessage 被调用）
      expect(mockRuntime.sendMessage).toHaveBeenCalled();
    });

    it('应该限制队列最大大小为 MAX_LOCAL_EVENTS', async () => {
      const fullQueue = Array.from({ length: ANALYTICS_CONFIG.MAX_LOCAL_EVENTS }, (_, i) =>
        createEvent({ event: `event_${i}` }),
      );
      // 预存 deviceId + 队列数据，避免额外的 set 调用
      mockStorage.local.get.mockResolvedValue({
        analytics_device_id: 'test-device',
        analytics_event_queue: { events: fullQueue, lastSync: 0, deviceId: 'test-device' },
      });

      await enqueueEvent(createEvent({ event: 'new_event' }));

      const queueSetCall = mockStorage.local.set.mock.calls.find((c) => c[0].analytics_event_queue);
      expect(queueSetCall).toBeDefined();
      expect(queueSetCall[0].analytics_event_queue.events).toHaveLength(ANALYTICS_CONFIG.MAX_LOCAL_EVENTS);
    });
  });

  describe('enqueueEvents', () => {
    it('应该批量添加事件到队列', async () => {
      // 预存 deviceId，避免 getDeviceId 触发额外的 set 调用
      mockStorage.local.get.mockResolvedValue({
        analytics_device_id: 'test-device-id',
      });

      const events = [createEvent({ event: 'event_a' }), createEvent({ event: 'event_b' })];
      await enqueueEvents(events);

      expect(mockStorage.local.set).toHaveBeenCalled();
      const queueSetCall = mockStorage.local.set.mock.calls.find((c) => c[0].analytics_event_queue);
      expect(queueSetCall).toBeDefined();
      expect(queueSetCall[0].analytics_event_queue.events).toHaveLength(2);
    });

    it('应该在批量添加后超过 BATCH_SIZE 时触发 flush', async () => {
      const existingEvents = Array.from({ length: 48 }, (_, i) =>
        createEvent({ event: `existing_${i}` }),
      );
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events: existingEvents,
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      const newEvents = [createEvent(), createEvent(), createEvent()];
      await enqueueEvents(newEvents);

      expect(mockRuntime.sendMessage).toHaveBeenCalled();
    });
  });

  describe('flushEvents', () => {
    it('应该在队列为空时返回 true', async () => {
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events: [],
          lastSync: Date.now(),
          deviceId: 'test-device',
        },
      });

      const result = await flushEvents();
      expect(result).toBe(true);
    });

    it('应该通过 chrome.runtime.sendMessage 发送事件', async () => {
      const events = [createEvent({ event: 'flush_test' })];
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events,
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      await flushEvents();

      expect(mockRuntime.sendMessage).toHaveBeenCalledWith({
        type: 'FLUSH_ANALYTICS_EVENTS',
        payload: { events, deviceId: 'test-device' },
      });
    });

    it('应该在发送成功后清空队列并更新 lastSync', async () => {
      const events = [createEvent()];
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events,
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      mockRuntime.sendMessage.mockResolvedValue({ success: true });

      const result = await flushEvents();
      expect(result).toBe(true);

      const setCall = mockStorage.local.set.mock.calls[0][0];
      expect(setCall.analytics_event_queue.events).toHaveLength(0);
      expect(setCall.analytics_event_queue.lastSync).toBeGreaterThan(0);
    });

    it('应该在发送失败时保留队列事件', async () => {
      const events = [createEvent()];
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events,
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      mockRuntime.sendMessage.mockResolvedValue({ success: false });

      const result = await flushEvents();
      expect(result).toBe(false);
    });

    it('应该在 sendMessage 抛出异常时返回 false', async () => {
      const events = [createEvent()];
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events,
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      mockRuntime.sendMessage.mockRejectedValue(new Error('Network error'));

      const result = await flushEvents();
      expect(result).toBe(false);
    });
  });

  describe('getQueueStatus', () => {
    it('应该返回队列状态信息', async () => {
      const events = [createEvent(), createEvent(), createEvent()];
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events,
          lastSync: 1234567890,
          deviceId: 'status-device',
        },
      });

      const status = await getQueueStatus();

      expect(status.pendingCount).toBe(3);
      expect(status.lastSync).toBe(1234567890);
      expect(status.deviceId).toBe('status-device');
    });

    it('应该在队列为空时返回零计数', async () => {
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events: [],
          lastSync: 0,
          deviceId: 'empty-device',
        },
      });

      const status = await getQueueStatus();
      expect(status.pendingCount).toBe(0);
    });
  });

  describe('clearQueue', () => {
    it('应该清空队列中的所有事件', async () => {
      const events = [createEvent(), createEvent()];
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events,
          lastSync: Date.now(),
          deviceId: 'test-device',
        },
      });

      await clearQueue();

      const setCall = mockStorage.local.set.mock.calls[0][0];
      expect(setCall.analytics_event_queue.events).toHaveLength(0);
    });
  });

  describe('initPeriodicFlush', () => {
    it('应该立即调用一次 flushEvents', () => {
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events: [],
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      initPeriodicFlush();

      // initPeriodicFlush 内部会调用 flushEvents（通过 void flushEvents()）
      // 由于是异步，sendMessage 可能还没被调用，但 storage.get 应该被调用
      expect(mockStorage.local.get).toHaveBeenCalled();
    });

    it('应该注册 beforeunload 事件监听器', () => {
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events: [],
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      const cleanup = initPeriodicFlush();

      expect(mockAddEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));

      // 清理
      cleanup();
    });

    it('返回的清理函数应该清除定时器和事件监听器', () => {
      mockStorage.local.get.mockResolvedValue({
        analytics_event_queue: {
          events: [],
          lastSync: 0,
          deviceId: 'test-device',
        },
      });

      const cleanup = initPeriodicFlush();

      cleanup();

      expect(mockRemoveEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    });
  });
});
