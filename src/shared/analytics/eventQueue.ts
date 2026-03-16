/**
 * 事件队列管理器
 *
 * 管理事件的本地存储、批量发送和同步逻辑
 *
 * @module analytics/eventQueue
 */

import type { LocalEventQueue, TrackEvent } from '../types/analytics';
import { ANALYTICS_CONFIG } from '../types/analytics';

/** 存储键名 */
const STORAGE_KEY = 'analytics_event_queue';

/** 设备ID存储键 */
const DEVICE_ID_KEY = 'analytics_device_id';

/**
 * 生成唯一ID
 * @returns 唯一标识符
 */
function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 获取或创建设备ID
 * @returns 设备唯一标识
 */
async function getDeviceId(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(DEVICE_ID_KEY);
    if (result[DEVICE_ID_KEY]) {
      return result[DEVICE_ID_KEY] as string;
    }
  } catch {
    // 存储访问失败，生成临时ID
  }

  const deviceId = generateId();
  try {
    await chrome.storage.local.set({ [DEVICE_ID_KEY]: deviceId });
  } catch {
    // 忽略存储错误
  }
  return deviceId;
}

/**
 * 获取本地事件队列
 * @returns 本地事件队列数据
 */
async function getLocalQueue(): Promise<LocalEventQueue> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) {
      return result[STORAGE_KEY] as LocalEventQueue;
    }
  } catch {
    // 存储访问失败，返回空队列
  }

  const deviceId = await getDeviceId();
  return {
    events: [],
    lastSync: 0,
    deviceId,
  };
}

/**
 * 保存本地事件队列
 * @param queue - 队列数据
 */
async function saveLocalQueue(queue: LocalEventQueue): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: queue });
  } catch (error) {
    console.error('[Analytics] Failed to save event queue:', error);
  }
}

/**
 * 添加事件到队列
 * @param event - 追踪事件
 */
export async function enqueueEvent(event: TrackEvent): Promise<void> {
  const queue = await getLocalQueue();

  // 添加事件到队列
  queue.events.push(event);

  // 限制队列大小
  if (queue.events.length > ANALYTICS_CONFIG.MAX_LOCAL_EVENTS) {
    queue.events = queue.events.slice(-ANALYTICS_CONFIG.MAX_LOCAL_EVENTS);
  }

  await saveLocalQueue(queue);

  // 检查是否需要立即发送
  if (queue.events.length >= ANALYTICS_CONFIG.BATCH_SIZE) {
    await flushEvents();
  }
}

/**
 * 批量添加事件
 * @param events - 事件列表
 */
export async function enqueueEvents(events: TrackEvent[]): Promise<void> {
  const queue = await getLocalQueue();

  queue.events.push(...events);

  // 限制队列大小
  if (queue.events.length > ANALYTICS_CONFIG.MAX_LOCAL_EVENTS) {
    queue.events = queue.events.slice(-ANALYTICS_CONFIG.MAX_LOCAL_EVENTS);
  }

  await saveLocalQueue(queue);

  // 检查是否需要立即发送
  if (queue.events.length >= ANALYTICS_CONFIG.BATCH_SIZE) {
    await flushEvents();
  }
}

/**
 * 发送事件到服务器
 * @returns 是否发送成功
 */
export async function flushEvents(): Promise<boolean> {
  const queue = await getLocalQueue();

  if (queue.events.length === 0) {
    return true;
  }

  // 复制要发送的事件
  const eventsToSend = [...queue.events];

  // TODO: 实现实际的服务器发送逻辑
  // 目前仅模拟发送成功
  try {
    // 在实际实现中，这里会调用后端API
    // const response = await fetch('/api/analytics/events', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ events: eventsToSend, deviceId: queue.deviceId }),
    // });

    // 模拟发送成功
    await new Promise(resolve => setTimeout(resolve, 100));

    // 清除已发送的事件
    queue.events = queue.events.slice(eventsToSend.length);
    queue.lastSync = Date.now();
    await saveLocalQueue(queue);

    return true;
  } catch (error) {
    console.error('[Analytics] Failed to flush events:', error);
    return false;
  }
}

/**
 * 获取队列状态
 * @returns 队列状态信息
 */
export async function getQueueStatus(): Promise<{
  pendingCount: number;
  lastSync: number;
  deviceId: string;
}> {
  const queue = await getLocalQueue();
  return {
    pendingCount: queue.events.length,
    lastSync: queue.lastSync,
    deviceId: queue.deviceId,
  };
}

/**
 * 清空队列
 */
export async function clearQueue(): Promise<void> {
  const queue = await getLocalQueue();
  queue.events = [];
  await saveLocalQueue(queue);
}

/**
 * 初始化定期刷新定时器
 * @returns 清除定时器的函数
 */
export function initPeriodicFlush(): () => void {
  // 立即尝试刷新一次
  void flushEvents();

  // 设置定期刷新
  const intervalId = setInterval(() => {
    void flushEvents();
  }, ANALYTICS_CONFIG.FLUSH_INTERVAL);

  // 页面卸载前尝试刷新
  const handleBeforeUnload = (): void => {
    void flushEvents();
  };
  window.addEventListener('beforeunload', handleBeforeUnload);

  // 返回清理函数
  return () => {
    clearInterval(intervalId);
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}
