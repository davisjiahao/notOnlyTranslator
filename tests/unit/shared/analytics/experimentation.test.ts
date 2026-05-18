import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  fnv1a,
  generateExperimentHash,
  assignGroupByWeight,
  assignUserToExperiment,
  isUserInExperimentTraffic,
  createExperimentConfig,
} from '@/shared/analytics/experimentation';
import type { ExperimentConfig, ExperimentGroup } from '@/shared/types/analytics';

describe('experimentation', () => {
  describe('fnv1a', () => {
    it('returns consistent hash for same input', () => {
      expect(fnv1a('hello')).toBe(fnv1a('hello'));
    });

    it('returns different hashes for different inputs', () => {
      expect(fnv1a('hello')).not.toBe(fnv1a('world'));
    });

    it('returns unsigned 32-bit integer', () => {
      const hash = fnv1a('test');
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xFFFFFFFF);
    });

    it('handles empty string', () => {
      expect(fnv1a('')).toBe(0x811c9dc5);
    });
  });

  describe('generateExperimentHash', () => {
    it('returns deterministic hash for same user+experiment', () => {
      const hash1 = generateExperimentHash('user-1', 'exp-1');
      const hash2 = generateExperimentHash('user-1', 'exp-1');
      expect(hash1).toBe(hash2);
    });

    it('returns different hashes for different users', () => {
      const h1 = generateExperimentHash('user-1', 'exp-1');
      const h2 = generateExperimentHash('user-2', 'exp-1');
      expect(h1).not.toBe(h2);
    });

    it('returns different hashes for different experiments', () => {
      const h1 = generateExperimentHash('user-1', 'exp-1');
      const h2 = generateExperimentHash('user-1', 'exp-2');
      expect(h1).not.toBe(h2);
    });

    it('returns value in 0-99 range', () => {
      for (let i = 0; i < 100; i++) {
        const hash = generateExperimentHash(`user-${i}`, 'exp-1');
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThan(100);
      }
    });
  });

  describe('assignGroupByWeight', () => {
    it('assigns to control group for low hash values (50/50 split)', () => {
      const groups: ExperimentGroup[] = [
        { id: 'control', name: 'Control', weight: 50, variant: 'A' },
        { id: 'treatment', name: 'Treatment', weight: 50, variant: 'B' },
      ];

      expect(assignGroupByWeight(0, groups)).toBe('control');
      expect(assignGroupByWeight(49, groups)).toBe('control');
    });

    it('assigns to treatment group for high hash values (50/50 split)', () => {
      const groups: ExperimentGroup[] = [
        { id: 'control', name: 'Control', weight: 50, variant: 'A' },
        { id: 'treatment', name: 'Treatment', weight: 50, variant: 'B' },
      ];

      expect(assignGroupByWeight(50, groups)).toBe('treatment');
      expect(assignGroupByWeight(99, groups)).toBe('treatment');
    });

    it('assigns based on uneven weights (25/75 split)', () => {
      const groups: ExperimentGroup[] = [
        { id: 'control', name: 'Control', weight: 25, variant: 'A' },
        { id: 'treatment', name: 'Treatment', weight: 75, variant: 'B' },
      ];

      expect(assignGroupByWeight(0, groups)).toBe('control');
      expect(assignGroupByWeight(24, groups)).toBe('control');
      expect(assignGroupByWeight(25, groups)).toBe('treatment');
    });

    it('assigns to first group when hash exceeds total weight', () => {
      const groups: ExperimentGroup[] = [
        { id: 'only', name: 'Only', weight: 100, variant: 'A' },
      ];

      expect(assignGroupByWeight(99, groups)).toBe('only');
    });

    it('returns control for empty groups (fallback)', () => {
      const groups: ExperimentGroup[] = [];
      expect(assignGroupByWeight(50, groups)).toBe('control');
    });
  });

  describe('assignUserToExperiment', () => {
    const createExp = (): ExperimentConfig => ({
      id: 'test-exp',
      name: 'Test Experiment',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      trafficAllocation: 100,
      groups: [
        { id: 'control', name: 'Control', weight: 50, variant: 'A' },
        { id: 'treatment', name: 'Treatment', weight: 50, variant: 'B' },
      ],
      metrics: { primary: 'conversion_rate', secondary: ['retention_rate'] },
      minimumSampleSize: 100,
    });

    it('returns assignment with experimentId', () => {
      const result = assignUserToExperiment('user-123', createExp());
      expect(result.experimentId).toBe('test-exp');
    });

    it('returns assignment with a valid groupId', () => {
      const result = assignUserToExperiment('user-123', createExp());
      expect(['control', 'treatment']).toContain(result.groupId);
    });

    it('returns assignment with assignedAt timestamp', () => {
      const before = Date.now() - 1000;
      const result = assignUserToExperiment('user-123', createExp());
      expect(result.assignedAt).toBeGreaterThanOrEqual(before);
    });

    it('is deterministic for same user', () => {
      const exp = createExp();
      const r1 = assignUserToExperiment('user-abc', exp);
      const r2 = assignUserToExperiment('user-abc', exp);
      expect(r1.groupId).toBe(r2.groupId);
    });
  });

  describe('isUserInExperimentTraffic', () => {
    it('returns true when trafficAllocation is 100', () => {
      const exp: ExperimentConfig = {
        id: 'full-traffic',
        name: 'Full Traffic',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        trafficAllocation: 100,
        groups: [
          { id: 'control', name: 'Control', weight: 50, variant: 'A' },
        ],
        metrics: { primary: 'conversion_rate', secondary: [] },
        minimumSampleSize: 100,
      };

      expect(isUserInExperimentTraffic('any-user', exp)).toBe(true);
    });

    it('returns false when trafficAllocation is 0', () => {
      const exp: ExperimentConfig = {
        id: 'no-traffic',
        name: 'No Traffic',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        trafficAllocation: 0,
        groups: [{ id: 'control', name: 'Control', weight: 100, variant: 'A' }],
        metrics: { primary: 'conversion_rate', secondary: [] },
        minimumSampleSize: 100,
      };

      expect(isUserInExperimentTraffic('any-user', exp)).toBe(false);
    });

    it('is deterministic for same user+experiment', () => {
      const exp: ExperimentConfig = {
        id: 'test',
        name: 'Test',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        trafficAllocation: 50,
        groups: [{ id: 'control', name: 'Control', weight: 100, variant: 'A' }],
        metrics: { primary: 'conversion_rate', secondary: [] },
        minimumSampleSize: 100,
      };

      const r1 = isUserInExperimentTraffic('user-x', exp);
      const r2 = isUserInExperimentTraffic('user-x', exp);
      expect(r1).toBe(r2);
    });
  });

  describe('createExperimentConfig', () => {
    it('creates config with required fields', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp');
      expect(config.id).toBe('exp-1');
      expect(config.name).toBe('Test Exp');
    });

    it('uses default groups (50/50 control/treatment)', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp');
      expect(config.groups).toHaveLength(2);
      expect(config.groups[0].id).toBe('control');
      expect(config.groups[1].id).toBe('treatment');
      expect(config.groups[0].weight).toBe(50);
      expect(config.groups[1].weight).toBe(50);
    });

    it('uses default start date (today)', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp');
      const today = new Date().toISOString().split('T')[0];
      expect(config.startDate).toBe(today);
    });

    it('uses default end date (14 days from now)', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp');
      const expectedEnd = new Date();
      expectedEnd.setDate(expectedEnd.getDate() + 14);
      expect(config.endDate).toBe(expectedEnd.toISOString().split('T')[0]);
    });

    it('uses default trafficAllocation of 100', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp');
      expect(config.trafficAllocation).toBe(100);
    });

    it('uses default metrics', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp');
      expect(config.metrics.primary).toBe('conversion_rate');
      expect(config.metrics.secondary).toContain('retention_rate');
    });

    it('uses default minimumSampleSize of 100', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp');
      expect(config.minimumSampleSize).toBe(100);
    });

    it('overrides options when provided', () => {
      const config = createExperimentConfig('exp-1', 'Test Exp', {
        startDate: '2026-06-01',
        endDate: '2026-07-01',
        trafficAllocation: 50,
        primaryMetric: 'engagement_rate',
        secondaryMetrics: ['click_rate'],
        minimumSampleSize: 500,
        groups: [
          { id: 'a', name: 'A', weight: 33, variant: 'A' },
          { id: 'b', name: 'B', weight: 33, variant: 'B' },
          { id: 'c', name: 'C', weight: 34, variant: 'C' },
        ],
      });

      expect(config.startDate).toBe('2026-06-01');
      expect(config.endDate).toBe('2026-07-01');
      expect(config.trafficAllocation).toBe(50);
      expect(config.metrics.primary).toBe('engagement_rate');
      expect(config.metrics.secondary).toEqual(['click_rate']);
      expect(config.minimumSampleSize).toBe(500);
      expect(config.groups).toHaveLength(3);
    });
  });
});
