/**
 * WelcomeModal 工具函数
 * 分离辅助函数以避免 React Fast Refresh 警告
 */

// 实验分组类型
export type ExperimentGroup = 'A' | 'B' | 'C';
export type ExperimentStep = 'welcome' | 'level' | 'api' | 'demo' | 'complete';

/**
 * 获取或分配实验组
 */
export function getExperimentGroup(): ExperimentGroup {
  const stored = localStorage.getItem('not_onboarding_experiment_group');
  if (stored === 'A' || stored === 'B' || stored === 'C') {
    return stored;
  }

  // 随机分配
  const groups: ExperimentGroup[] = ['A', 'B', 'C'];
  const group = groups[Math.floor(Math.random() * groups.length)];
  localStorage.setItem('not_onboarding_experiment_group', group);

  return group;
}

/**
 * 记录实验进度
 */
export function trackExperimentProgress(
  group: ExperimentGroup,
  step: ExperimentStep,
  action: 'start' | 'complete' | 'skip',
  metadata?: Record<string, unknown>
) {
  // 这里可以添加实际的追踪逻辑
  // eslint-disable-next-line no-console
  console.log('[Experiment]', { experiment: 'EXP-001', group, step, action, ...metadata });
}

/**
 * 检查是否首次使用（需要在设置页面导入使用）
 */
export function shouldShowWelcomeModal(): boolean {
  const completed = localStorage.getItem('not_onboarding_completed');
  const skipped = localStorage.getItem('not_onboarding_skipped');
  return !completed && !skipped;
}
