/**
 * 实验分组系统
 *
 * 实现 A/B 测试的用户分组逻辑，包括哈希算法、分组分配、实验管理等功能
 *
 * @module analytics/experimentation
 */

import type {
  ExperimentConfig,
  ExperimentGroup,
  ExperimentAssignment,
  UserAnalyticsProfile,
} from '../types/analytics';

/** 存储键名 */
const EXPERIMENTS_KEY = 'analytics_experiments';
const USER_ASSIGNMENTS_KEY = 'analytics_user_assignments';

/**
 * FNV-1a 哈希算法实现
 * 用于生成确定性的用户分组
 * @param str - 输入字符串
 * @returns 哈希值
 */
export function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

/**
 * 生成确定性哈希值（0-99范围）
 * @param userId - 用户ID
 * @param experimentId - 实验ID
 * @returns 0-99的哈希值
 */
export function generateExperimentHash(userId: string, experimentId: string): number {
  const hash = fnv1a(`${userId}:${experimentId}`);
  return Math.abs(hash) % 100;
}

/**
 * 根据权重分配实验组
 * @param hashValue - 哈希值（0-99）
 * @param groups - 实验组配置
 * @returns 分配的组ID
 */
export function assignGroupByWeight(hashValue: number, groups: ExperimentGroup[]): string {
  let cumulativeWeight = 0;

  for (const group of groups) {
    cumulativeWeight += group.weight;
    if (hashValue < cumulativeWeight) {
      return group.id;
    }
  }

  // 默认返回第一组
  return groups[0]?.id ?? 'control';
}

/**
 * 为用户分配实验组
 * @param userId - 用户ID
 * @param experiment - 实验配置
 * @returns 实验分配结果
 */
export function assignUserToExperiment(
  userId: string,
  experiment: ExperimentConfig
): ExperimentAssignment {
  const hashValue = generateExperimentHash(userId, experiment.id);
  const groupId = assignGroupByWeight(hashValue, experiment.groups);
  const group = experiment.groups.find(g => g.id === groupId);

  return {
    experimentId: experiment.id,
    groupId,
    variant: group?.variant ?? 'control',
    assignedAt: Date.now(),
  };
}

/**
 * 检查用户是否参与实验（基于流量分配）
 * @param userId - 用户ID
 * @param experiment - 实验配置
 * @returns 是否参与
 */
export function isUserInExperimentTraffic(
  userId: string,
  experiment: ExperimentConfig
): boolean {
  const hash = fnv1a(`${userId}:${experiment.id}:traffic`);
  const normalized = Math.abs(hash) % 100;
  return normalized < experiment.trafficAllocation;
}

/**
 * 加载实验配置（从本地存储）
 * @returns 实验配置列表
 */
export async function loadExperiments(): Promise<ExperimentConfig[]> {
  try {
    const result = await chrome.storage.local.get(EXPERIMENTS_KEY);
    return (result[EXPERIMENTS_KEY] as ExperimentConfig[]) ?? [];
  } catch {
    return [];
  }
}

/**
 * 保存实验配置到本地存储
 * @param experiments - 实验配置列表
 */
export async function saveExperiments(experiments: ExperimentConfig[]): Promise<void> {
  try {
    await chrome.storage.local.set({ [EXPERIMENTS_KEY]: experiments });
  } catch (error) {
    console.error('[Analytics] Failed to save experiments:', error);
  }
}

/**
 * 加载用户的实验分配记录
 * @param userId - 用户ID
 * @returns 实验分配映射
 */
export async function loadUserAssignments(
  userId: string
): Promise<Record<string, ExperimentAssignment>> {
  try {
    const key = `${USER_ASSIGNMENTS_KEY}:${userId}`;
    const result = await chrome.storage.local.get(key);
    return (result[key] as Record<string, ExperimentAssignment>) ?? {};
  } catch {
    return {};
  }
}

/**
 * 保存用户的实验分配记录
 * @param userId - 用户ID
 * @param assignments - 实验分配映射
 */
export async function saveUserAssignments(
  userId: string,
  assignments: Record<string, ExperimentAssignment>
): Promise<void> {
  try {
    const key = `${USER_ASSIGNMENTS_KEY}:${userId}`;
    await chrome.storage.local.set({ [key]: assignments });
  } catch (error) {
    console.error('[Analytics] Failed to save user assignments:', error);
  }
}

/**
 * 获取用户的实验组（带缓存）
 * @param userId - 用户ID
 * @param experiment - 实验配置
 * @returns 实验分配结果
 */
export async function getUserExperimentGroup(
  userId: string,
  experiment: ExperimentConfig
): Promise<ExperimentAssignment | null> {
  // 检查是否在实验流量中
  if (!isUserInExperimentTraffic(userId, experiment)) {
    return null;
  }

  // 检查是否已有分配记录
  const assignments = await loadUserAssignments(userId);
  const existingAssignment = assignments[experiment.id];

  if (existingAssignment) {
    return existingAssignment;
  }

  // 分配新组
  const newAssignment = assignUserToExperiment(userId, experiment);
  assignments[experiment.id] = newAssignment;
  await saveUserAssignments(userId, assignments);

  return newAssignment;
}

/**
 * 获取用户所有实验分组信息（用于用户画像）
 * @param userId - 用户ID
 * @returns 实验分组映射
 */
export async function getUserExperimentGroups(
  userId: string
): Promise<Record<string, string>> {
  const assignments = await loadUserAssignments(userId);
  const groups: Record<string, string> = {};

  for (const [experimentId, assignment] of Object.entries(assignments)) {
    groups[experimentId] = assignment.groupId;
  }

  return groups;
}

/**
 * 创建实验配置（工具函数）
 * @param id - 实验ID
 * @param name - 实验名称
 * @param options - 可选配置
 * @returns 实验配置
 */
export function createExperimentConfig(
  id: string,
  name: string,
  options: {
    startDate?: string;
    endDate?: string;
    trafficAllocation?: number;
    groups?: ExperimentGroup[];
    primaryMetric?: string;
    secondaryMetrics?: string[];
    minimumSampleSize?: number;
  } = {}
): ExperimentConfig {
  const now = new Date();
  const defaultEndDate = new Date(now);
  defaultEndDate.setDate(defaultEndDate.getDate() + 14); // 默认14天

  return {
    id,
    name,
    startDate: options.startDate ?? now.toISOString().split('T')[0],
    endDate: options.endDate ?? defaultEndDate.toISOString().split('T')[0],
    trafficAllocation: options.trafficAllocation ?? 100,
    groups: options.groups ?? [
      { id: 'control', name: '对照组', weight: 50, variant: 'A' },
      { id: 'treatment', name: '实验组', weight: 50, variant: 'B' },
    ],
    metrics: {
      primary: options.primaryMetric ?? 'conversion_rate',
      secondary: options.secondaryMetrics ?? ['retention_rate', 'engagement_rate'],
    },
    minimumSampleSize: options.minimumSampleSize ?? 100,
  };
}
