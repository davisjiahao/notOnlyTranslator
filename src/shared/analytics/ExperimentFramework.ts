/**
 * 实验框架类
 * 负责A/B测试的实验管理、分组分配和结果追踪
 */

import type {
  Experiment,
  ExperimentGroup,
  UserExperimentAssignment,
  ExperimentStatus,
} from './types'
import { analytics } from './Analytics'
import { AnalyticsEvents } from './types'

export class ExperimentFramework {
  private static instance: ExperimentFramework | null = null
  private experiments: Map<string, Experiment> = new Map()
  private status: Map<string, ExperimentStatus> = new Map()

  static getInstance(): ExperimentFramework {
    if (!ExperimentFramework.instance) {
      ExperimentFramework.instance = new ExperimentFramework()
    }
    return ExperimentFramework.instance
  }

  /**
   * 注册实验
   * @param experiment 实验配置
   */
  registerExperiment(experiment: Experiment): void {
    this.experiments.set(experiment.id, experiment)

    // 初始化状态
    if (!this.status.has(experiment.id)) {
      this.status.set(experiment.id, 'draft')
    }

    console.log(`[Experiment] 实验已注册: ${experiment.id}`)
  }

  /**
   * 批量注册实验
   * @param experiments 实验配置列表
   */
  registerExperiments(experiments: Experiment[]): void {
    experiments.forEach(exp => this.registerExperiment(exp))
  }

  /**
   * 启动实验
   * @param experimentId 实验ID
   */
  async startExperiment(experimentId: string): Promise<boolean> {
    const experiment = this.experiments.get(experimentId)
    if (!experiment) {
      console.error(`[Experiment] 实验不存在: ${experimentId}`)
      return false
    }

    // 检查实验时间
    const now = new Date()
    const startDate = new Date(experiment.startDate)
    const endDate = new Date(experiment.endDate)

    if (now < startDate) {
      console.log(`[Experiment] 实验 ${experimentId} 尚未到开始时间`)
      return false
    }

    if (now > endDate) {
      console.log(`[Experiment] 实验 ${experimentId} 已结束`)
      this.status.set(experimentId, 'completed')
      return false
    }

    this.status.set(experimentId, 'running')
    console.log(`[Experiment] 实验已启动: ${experimentId}`)

    // 记录实验启动事件
    await analytics.track(AnalyticsEvents.EXPERIMENT_ASSIGNED, {
      experimentId,
      action: 'start',
      experimentName: experiment.name
    })

    return true
  }

  /**
   * 停止实验
   * @param experimentId 实验ID
   */
  stopExperiment(experimentId: string): void {
    this.status.set(experimentId, 'paused')
    console.log(`[Experiment] 实验已停止: ${experimentId}`)
  }

  /**
   * 获取用户的实验分组
   * @param experimentId 实验ID
   * @returns 分组信息
   */
  async getGroupForUser(experimentId: string): Promise<ExperimentGroup | null> {
    const experiment = this.experiments.get(experimentId)
    if (!experiment) {
      return null
    }

    // 确保实验已启动
    const status = this.status.get(experimentId)
    if (status !== 'running') {
      const started = await this.startExperiment(experimentId)
      if (!started) {
        return null
      }
    }

    // 使用 analytics 的实验分配
    const group = await analytics.assignExperiment(experimentId, experiment)
    return group
  }

  /**
   * 获取实验配置
   * @param experimentId 实验ID
   */
  getExperiment(experimentId: string): Experiment | null {
    return this.experiments.get(experimentId) || null
  }

  /**
   * 获取所有实验
   */
  getAllExperiments(): Experiment[] {
    return Array.from(this.experiments.values())
  }

  /**
   * 获取实验状态
   * @param experimentId 实验ID
   */
  getExperimentStatus(experimentId: string): ExperimentStatus {
    return this.status.get(experimentId) || 'draft'
  }

  /**
   * 报告实验转化
   * @param experimentId 实验ID
   * @param metricName 指标名称
   * @param value 指标值
   */
  async reportConversion(
    experimentId: string,
    metricName: string,
    value: number
  ): Promise<void> {
    const assignment = analytics.getExperimentGroup(experimentId)

    if (!assignment) {
      console.warn(`[Experiment] 用户未参与实验 ${experimentId}`)
      return
    }

    await analytics.track(AnalyticsEvents.EXPERIMENT_CONVERTED, {
      experimentId,
      groupId: assignment.groupId,
      variant: assignment.variant,
      metricName,
      metricValue: value
    })

    console.log(`[Experiment] 转化已记录: ${experimentId} - ${metricName} = ${value}`)
  }

  /**
   * 检查用户是否在实验组中
   * @param experimentId 实验ID
   * @param variant 变体名称
   */
  isInVariant(experimentId: string, variant: string): boolean {
    const assignment = analytics.getExperimentGroup(experimentId)
    return assignment?.variant === variant
  }

  /**
   * 获取用户的变体配置
   * @param experimentId 实验ID
   * @returns 变体配置
   */
  getVariantConfig(experimentId: string): Record<string, any> | null {
    const assignment = analytics.getExperimentGroup(experimentId)
    if (!assignment) {
      return null
    }

    const experiment = this.experiments.get(experimentId)
    const group = experiment?.groups.find(g => g.id === assignment.groupId)

    return group?.config || null
  }
}

// 导出单例实例
export const experimentFramework = ExperimentFramework.getInstance()
