import type {
  TrackEvent,
  UserTraits,
  Experiment,
  ExperimentGroup,
  UserExperimentAssignment,
} from './types'
import { AnalyticsEvents } from './types'

/**
 * Analytics 核心类
 * 负责事件追踪、用户识别、A/B 测试分配和数据持久化
 */
export class Analytics {
  private static instance: Analytics | null = null
  private userId: string | null = null
  private sessionId: string | null = null
  private userTraits: Partial<UserTraits> = {}
  private experimentAssignments: Map<string, UserExperimentAssignment> = new Map()
  private eventQueue: TrackEvent[] = []
  private isInitialized = false
  private flushInterval: number | null = null
  private readonly FLUSH_INTERVAL_MS = 30000 // 30秒刷新一次
  private readonly MAX_QUEUE_SIZE = 100

  /** 单例模式获取实例 */
  static getInstance(): Analytics {
    if (!Analytics.instance) {
      Analytics.instance = new Analytics()
    }
    return Analytics.instance
  }

  /** 重置单例（用于测试） */
  static resetInstance(): void {
    Analytics.instance = null
  }

  private constructor() {
    // 生成会话ID
    this.sessionId = this.generateSessionId()
  }

  /**
   * 初始化 Analytics
   * 从 Chrome Storage 恢复用户ID和实验分配
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return
    }

    try {
      // 从 Chrome Storage 读取用户数据
      const result = await chrome.storage.local.get([
        'analytics_userId',
        'analytics_traits',
        'analytics_experiments',
        'analytics_sessionId'
      ])

      // 恢复用户ID
      if (result.analytics_userId) {
        this.userId = result.analytics_userId
      } else {
        // 生成新的用户ID
        this.userId = this.generateUserId()
        await chrome.storage.local.set({ analytics_userId: this.userId })
      }

      // 恢复用户属性
      if (result.analytics_traits) {
        this.userTraits = result.analytics_traits
      }

      // 恢复实验分配
      if (result.analytics_experiments) {
        const experiments = result.analytics_experiments as UserExperimentAssignment[]
        experiments.forEach(exp => {
          this.experimentAssignments.set(exp.experimentId, exp)
        })
      }

      // 恢复或生成会话ID
      if (result.analytics_sessionId) {
        this.sessionId = result.analytics_sessionId
      } else {
        await chrome.storage.session.set({ analytics_sessionId: this.sessionId })
      }

      // 启动定时刷新
      this.startFlushInterval()

      this.isInitialized = true
      console.log('[Analytics] 初始化完成, userId:', this.userId)

      // 发送初始化事件
      await this.track(AnalyticsEvents.EXPERIMENT_ASSIGNED, {
        isNewUser: !result.analytics_userId
      })

    } catch (error) {
      console.error('[Analytics] 初始化失败:', error)
      // 使用内存模式继续运行
      this.isInitialized = true
    }
  }

  /**
   * 追踪事件
   * @param eventName 事件名称
   * @param properties 事件属性
   */
  async track(eventName: string, properties?: Record<string, any>): Promise<void> {
    const event: TrackEvent = {
      event: eventName,
      properties: {
        ...properties,
        _userId: this.userId,
        _sessionId: this.sessionId,
        _timestamp: Date.now()
      },
      timestamp: Date.now(),
      userId: this.userId || undefined,
      sessionId: this.sessionId || undefined
    }

    // 添加到队列
    this.eventQueue.push(event)

    // 如果队列已满，立即刷新
    if (this.eventQueue.length >= this.MAX_QUEUE_SIZE) {
      await this.flush()
    }

    // 开发模式下输出日志
    if (process.env.NODE_ENV === 'development') {
      console.log('[Analytics]', eventName, properties)
    }
  }

  /**
   * 识别用户
   * @param userId 用户ID
   * @param traits 用户属性
   */
  async identify(userId: string, traits?: Partial<UserTraits>): Promise<void> {
    const oldUserId = this.userId
    this.userId = userId

    if (traits) {
      this.userTraits = {
        ...this.userTraits,
        ...traits,
        userId
      }
    }

    // 持久化到 Chrome Storage
    try {
      await chrome.storage.local.set({
        analytics_userId: userId,
        analytics_traits: this.userTraits
      })
    } catch (error) {
      console.error('[Analytics] 保存用户数据失败:', error)
    }

    // 发送用户识别事件
    if (oldUserId !== userId) {
      await this.track('user_identified', {
        oldUserId,
        newUserId: userId,
        ...traits
      })
    }
  }

  /**
   * 将用户加入实验
   * @param experimentId 实验ID
   * @param experiment 实验配置
   * @returns 分配的分组
   */
  async assignExperiment(experimentId: string, experiment: Experiment): Promise<ExperimentGroup | null> {
    // 检查实验是否已分配
    const existingAssignment = this.experimentAssignments.get(experimentId)
    if (existingAssignment) {
      const group = experiment.groups.find(g => g.id === existingAssignment.groupId)
      return group || null
    }

    // 检查实验是否在有效期内
    const now = new Date()
    const startDate = new Date(experiment.startDate)
    const endDate = new Date(experiment.endDate)

    if (now < startDate || now > endDate) {
      console.log(`[Analytics] 实验 ${experimentId} 不在有效期内`)
      return null
    }

    // 根据权重分配分组
    const group = this.weightedRandomSelection(experiment.groups)
    if (!group) {
      return null
    }

    // 记录分配
    const assignment: UserExperimentAssignment = {
      experimentId,
      groupId: group.id,
      variant: group.variant,
      assignedAt: Date.now()
    }

    this.experimentAssignments.set(experimentId, assignment)

    // 持久化
    try {
      const experiments = Array.from(this.experimentAssignments.values())
      await chrome.storage.local.set({ analytics_experiments: experiments })
    } catch (error) {
      console.error('[Analytics] 保存实验分配失败:', error)
    }

    // 发送实验分配事件
    await this.track(AnalyticsEvents.EXPERIMENT_ASSIGNED, {
      experimentId,
      groupId: group.id,
      variant: group.variant
    })

    return group
  }

  /**
   * 获取用户的实验分组
   * @param experimentId 实验ID
   * @returns 分组信息
   */
  getExperimentGroup(experimentId: string): { experimentId: string; groupId: string; variant: string; assignedAt: number } | null {
    return this.experimentAssignments.get(experimentId) || null
  }

  /**
   * 获取所有实验分配
   */
  getAllExperimentAssignments(): UserExperimentAssignment[] {
    return Array.from(this.experimentAssignments.values())
  }

  // ========== 私有方法 ==========

  private generateUserId(): string {
    return `usr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  private generateSessionId(): string {
    return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  private weightedRandomSelection<T extends { weight: number }>(items: T[]): T | null {
    if (!items || items.length === 0) {
      return null
    }

    const totalWeight = items.reduce((sum, item) => sum + item.weight, 0)
    let random = Math.random() * totalWeight

    for (const item of items) {
      random -= item.weight
      if (random <= 0) {
        return item
      }
    }

    return items[items.length - 1]
  }

  private startFlushInterval(): void {
    if (this.flushInterval !== null) {
      return
    }

    this.flushInterval = window.setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flush()
      }
    }, this.FLUSH_INTERVAL_MS) as unknown as number
  }

  private stopFlushInterval(): void {
    if (this.flushInterval !== null) {
      clearInterval(this.flushInterval)
      this.flushInterval = null
    }
  }

  /**
   * 刷新事件队列到存储
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) {
      return
    }

    const events = [...this.eventQueue]
    this.eventQueue = []

    try {
      // 读取现有事件
      const result = await chrome.storage.local.get('analytics_events')
      const existingEvents = (result.analytics_events as TrackEvent[]) || []

      // 合并并限制数量
      const allEvents = [...existingEvents, ...events]
      const trimmedEvents = allEvents.slice(-1000) // 只保留最近1000条

      // 保存
      await chrome.storage.local.set({ analytics_events: trimmedEvents })

      console.log(`[Analytics] 已刷新 ${events.length} 条事件`)
    } catch (error) {
      console.error('[Analytics] 刷新事件失败:', error)
      // 重新放入队列
      this.eventQueue.unshift(...events)
    }
  }

  /**
   * 获取用户ID
   */
  getUserId(): string | null {
    return this.userId
  }

  /**
   * 获取会话ID
   */
  getSessionId(): string | null {
    return this.sessionId
  }

  /**
   * 获取用户属性
   */
  getUserTraits(): Partial<UserTraits> {
    return { ...this.userTraits }
  }

  /**
   * 获取所有事件（用于导出）
   */
  async getAllEvents(): Promise<TrackEvent[]> {
    try {
      const result = await chrome.storage.local.get('analytics_events')
      return (result.analytics_events as TrackEvent[]) || []
    } catch (error) {
      console.error('[Analytics] 获取事件失败:', error)
      return []
    }
  }

  /**
   * 销毁实例
   */
  destroy(): void {
    this.stopFlushInterval()
    this.flush()
    Analytics.instance = null
  }
}

// 导出单例实例
export const analytics = Analytics.getInstance()
