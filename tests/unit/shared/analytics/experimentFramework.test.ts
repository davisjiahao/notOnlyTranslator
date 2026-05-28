/**
 * ExperimentFramework 测试
 *
 * 覆盖实验注册、启动/停止、分组分配、转化报告、变体检查
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ExperimentFramework } from '@/shared/analytics/ExperimentFramework';
import type { Experiment, ExperimentGroup } from '@/shared/analytics/types';

const mockTrack = vi.fn();
const mockAssignExperiment = vi.fn();
const mockGetExperimentGroup = vi.fn();

vi.mock('@/shared/analytics/Analytics', () => ({
  analytics: {
    track: (...args: any[]) => mockTrack(...args),
    assignExperiment: (...args: any[]) => mockAssignExperiment(...args),
    getExperimentGroup: (...args: any[]) => mockGetExperimentGroup(...args),
  },
}));

function createMockExperiment(overrides: Partial<Experiment> = {}): Experiment {
  const now = new Date();
  const start = new Date(now.getTime() - 86400000);
  const end = new Date(now.getTime() + 86400000);

  return {
    id: 'exp-1',
    name: 'Test Experiment',
    description: 'A test experiment',
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    trafficAllocation: 100,
    groups: [
      { id: 'control', name: 'Control', weight: 50, variant: 'control', config: { enabled: false } },
      { id: 'treatment', name: 'Treatment', weight: 50, variant: 'treatment', config: { enabled: true } },
    ],
    primaryMetric: 'conversion',
    secondaryMetrics: ['engagement'],
    minimumSampleSize: 100,
    ...overrides,
  };
}

describe('ExperimentFramework', () => {
  let framework: ExperimentFramework;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重置单例
    (ExperimentFramework as any).instance = null;
    framework = ExperimentFramework.getInstance();
  });

  describe('getInstance', () => {
    it('返回单例实例', () => {
      const instance1 = ExperimentFramework.getInstance();
      const instance2 = ExperimentFramework.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('registerExperiment', () => {
    it('注册单个实验', () => {
      const exp = createMockExperiment();
      framework.registerExperiment(exp);

      expect(framework.getExperiment('exp-1')).toEqual(exp);
      expect(framework.getExperimentStatus('exp-1')).toBe('draft');
    });

    it('重复注册覆盖旧实验', () => {
      const exp1 = createMockExperiment({ id: 'exp-1', name: 'First' });
      const exp2 = createMockExperiment({ id: 'exp-1', name: 'Second' });

      framework.registerExperiment(exp1);
      framework.registerExperiment(exp2);

      expect(framework.getExperiment('exp-1')?.name).toBe('Second');
    });

    it('注册后状态默认为 draft', () => {
      framework.registerExperiment(createMockExperiment());
      expect(framework.getExperimentStatus('exp-1')).toBe('draft');
    });
  });

  describe('registerExperiments', () => {
    it('批量注册实验', () => {
      const exps = [
        createMockExperiment({ id: 'exp-a' }),
        createMockExperiment({ id: 'exp-b' }),
      ];

      framework.registerExperiments(exps);

      expect(framework.getAllExperiments()).toHaveLength(2);
      expect(framework.getExperiment('exp-a')).toBeTruthy();
      expect(framework.getExperiment('exp-b')).toBeTruthy();
    });
  });

  describe('startExperiment', () => {
    it('启动存在的实验', async () => {
      framework.registerExperiment(createMockExperiment());
      mockTrack.mockResolvedValue(undefined);

      const result = await framework.startExperiment('exp-1');

      expect(result).toBe(true);
      expect(framework.getExperimentStatus('exp-1')).toBe('running');
      expect(mockTrack).toHaveBeenCalledWith(
        'experiment_assigned',
        expect.objectContaining({ experimentId: 'exp-1', action: 'start' })
      );
    });

    it('启动不存在的实验返回 false', async () => {
      const result = await framework.startExperiment('nonexistent');
      expect(result).toBe(false);
    });

    it('实验未开始时间返回 false', async () => {
      const future = new Date(Date.now() + 86400000 * 7);
      const exp = createMockExperiment({ startDate: future.toISOString() });
      framework.registerExperiment(exp);

      const result = await framework.startExperiment('exp-1');

      expect(result).toBe(false);
      expect(framework.getExperimentStatus('exp-1')).toBe('draft');
    });

    it('实验已结束返回 false 并标记 completed', async () => {
      const past = new Date(Date.now() - 86400000 * 7);
      const exp = createMockExperiment({ endDate: past.toISOString() });
      framework.registerExperiment(exp);

      const result = await framework.startExperiment('exp-1');

      expect(result).toBe(false);
      expect(framework.getExperimentStatus('exp-1')).toBe('completed');
    });
  });

  describe('stopExperiment', () => {
    it('停止运行中的实验', () => {
      framework.registerExperiment(createMockExperiment());
      framework.stopExperiment('exp-1');

      expect(framework.getExperimentStatus('exp-1')).toBe('paused');
    });

    it('停止不存在的实验不报错', () => {
      expect(() => framework.stopExperiment('nonexistent')).not.toThrow();
    });
  });

  describe('getGroupForUser', () => {
    it('返回用户分组', async () => {
      const exp = createMockExperiment();
      framework.registerExperiment(exp);
      mockTrack.mockResolvedValue(undefined);

      const group: ExperimentGroup = { id: 'treatment', name: 'Treatment', weight: 50, variant: 'treatment' };
      mockAssignExperiment.mockResolvedValue(group);

      const result = await framework.getGroupForUser('exp-1');

      expect(result).toEqual(group);
      expect(mockAssignExperiment).toHaveBeenCalledWith('exp-1', exp);
    });

    it('实验不存在返回 null', async () => {
      const result = await framework.getGroupForUser('nonexistent');
      expect(result).toBeNull();
    });

    it('实验未运行先启动', async () => {
      framework.registerExperiment(createMockExperiment());
      mockTrack.mockResolvedValue(undefined);
      mockAssignExperiment.mockResolvedValue({ id: 'control', name: 'Control', weight: 50, variant: 'control' });

      await framework.getGroupForUser('exp-1');

      expect(framework.getExperimentStatus('exp-1')).toBe('running');
    });

    it('启动失败返回 null', async () => {
      const past = new Date(Date.now() - 86400000 * 7);
      framework.registerExperiment(createMockExperiment({ endDate: past.toISOString() }));

      const result = await framework.getGroupForUser('exp-1');

      expect(result).toBeNull();
    });
  });

  describe('getExperiment', () => {
    it('获取已注册实验', () => {
      const exp = createMockExperiment();
      framework.registerExperiment(exp);

      expect(framework.getExperiment('exp-1')).toEqual(exp);
    });

    it('获取未注册实验返回 null', () => {
      expect(framework.getExperiment('nonexistent')).toBeNull();
    });
  });

  describe('getAllExperiments', () => {
    it('返回所有实验', () => {
      framework.registerExperiment(createMockExperiment({ id: 'a' }));
      framework.registerExperiment(createMockExperiment({ id: 'b' }));

      expect(framework.getAllExperiments()).toHaveLength(2);
    });

    it('无实验返回空数组', () => {
      expect(framework.getAllExperiments()).toEqual([]);
    });
  });

  describe('getExperimentStatus', () => {
    it('返回已注册实验状态', () => {
      framework.registerExperiment(createMockExperiment());
      expect(framework.getExperimentStatus('exp-1')).toBe('draft');
    });

    it('未注册实验返回 draft', () => {
      expect(framework.getExperimentStatus('nonexistent')).toBe('draft');
    });
  });

  describe('reportConversion', () => {
    it('报告实验转化', async () => {
      framework.registerExperiment(createMockExperiment());
      mockGetExperimentGroup.mockReturnValue({
        experimentId: 'exp-1',
        groupId: 'treatment',
        variant: 'treatment',
        assignedAt: Date.now(),
      });
      mockTrack.mockResolvedValue(undefined);

      await framework.reportConversion('exp-1', 'purchase', 99.9);

      expect(mockTrack).toHaveBeenCalledWith(
        'experiment_converted',
        expect.objectContaining({
          experimentId: 'exp-1',
          groupId: 'treatment',
          variant: 'treatment',
          metricName: 'purchase',
          metricValue: 99.9,
        })
      );
    });

    it('用户未参与实验不记录', async () => {
      mockGetExperimentGroup.mockReturnValue(null);

      await framework.reportConversion('exp-1', 'purchase', 1);

      expect(mockTrack).not.toHaveBeenCalled();
    });
  });

  describe('isInVariant', () => {
    it('用户在指定变体中返回 true', () => {
      mockGetExperimentGroup.mockReturnValue({
        experimentId: 'exp-1',
        groupId: 'treatment',
        variant: 'treatment',
        assignedAt: Date.now(),
      });

      expect(framework.isInVariant('exp-1', 'treatment')).toBe(true);
    });

    it('用户不在指定变体中返回 false', () => {
      mockGetExperimentGroup.mockReturnValue({
        experimentId: 'exp-1',
        groupId: 'control',
        variant: 'control',
        assignedAt: Date.now(),
      });

      expect(framework.isInVariant('exp-1', 'treatment')).toBe(false);
    });

    it('用户未分配返回 false', () => {
      mockGetExperimentGroup.mockReturnValue(null);

      expect(framework.isInVariant('exp-1', 'treatment')).toBe(false);
    });
  });

  describe('getVariantConfig', () => {
    it('返回变体配置', () => {
      framework.registerExperiment(createMockExperiment());
      mockGetExperimentGroup.mockReturnValue({
        experimentId: 'exp-1',
        groupId: 'treatment',
        variant: 'treatment',
        assignedAt: Date.now(),
      });

      const config = framework.getVariantConfig('exp-1');

      expect(config).toEqual({ enabled: true });
    });

    it('用户未分配返回 null', () => {
      mockGetExperimentGroup.mockReturnValue(null);

      expect(framework.getVariantConfig('exp-1')).toBeNull();
    });

    it('分组无配置返回 null', () => {
      framework.registerExperiment(createMockExperiment({
        groups: [{ id: 'control', name: 'Control', weight: 100, variant: 'control' }],
      }));
      mockGetExperimentGroup.mockReturnValue({
        experimentId: 'exp-1',
        groupId: 'control',
        variant: 'control',
        assignedAt: Date.now(),
      });

      expect(framework.getVariantConfig('exp-1')).toBeNull();
    });
  });
});
