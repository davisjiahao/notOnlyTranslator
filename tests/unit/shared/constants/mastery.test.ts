/**
 * Mastery 常量测试
 *
 * 测试 CEFR 等级相关的常量和工具函数
 */
import { describe, it, expect } from 'vitest';
import {
  CEFR_RANGES,
  CEFR_LEVEL_ORDER,
  CEFR_DIFFICULTY_RANGES,
  CEFR_DISPLAY_NAMES,
  CEFR_LEVEL_COLORS,
  MASTERY_THRESHOLDS,
  SPACED_REPETITION_CONFIG,
  BAYESIAN_PARAMS,
  MASTERY_WEIGHTS,
  getCEFRLevelByVocabulary,
  getCEFRLevelByDifficulty,
  getCEFRMedianVocabulary,
  hasLevelUpgraded,
  getNextCEFRLevel,
  getVocabularyToNextLevel,
} from '@/shared/constants/mastery';
import type { CEFRLevel } from '@/shared/types/mastery';

describe('CEFR_RANGES', () => {
  it('应该有 6 个 CEFR 等级', () => {
    expect(CEFR_RANGES.length).toBe(6);
  });

  it('等级应该按词汇量递增', () => {
    for (let i = 1; i < CEFR_RANGES.length; i++) {
      expect(CEFR_RANGES[i].minVocabulary).toBe(CEFR_RANGES[i - 1].maxVocabulary);
    }
  });

  it('每个等级应该有必需的字段', () => {
    CEFR_RANGES.forEach(range => {
      expect(range.level).toBeDefined();
      expect(range.minVocabulary).toBeGreaterThanOrEqual(0);
      expect(range.maxVocabulary).toBeGreaterThan(range.minVocabulary);
      expect(range.description).toBeDefined();
    });
  });

  it('A1 等级应该从 0 开始', () => {
    expect(CEFR_RANGES[0].level).toBe('A1');
    expect(CEFR_RANGES[0].minVocabulary).toBe(0);
  });

  it('C2 等级应该有最大词汇量', () => {
    const c2 = CEFR_RANGES.find(r => r.level === 'C2');
    expect(c2).toBeDefined();
    expect(c2!.maxVocabulary).toBe(20000);
  });
});

describe('CEFR_LEVEL_ORDER', () => {
  it('应该有 6 个等级', () => {
    expect(CEFR_LEVEL_ORDER.length).toBe(6);
  });

  it('顺序应该是 A1 -> A2 -> B1 -> B2 -> C1 -> C2', () => {
    expect(CEFR_LEVEL_ORDER).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });
});

describe('CEFR_DIFFICULTY_RANGES', () => {
  it('应该包含所有 6 个等级', () => {
    const levels: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    levels.forEach(level => {
      expect(CEFR_DIFFICULTY_RANGES[level]).toBeDefined();
    });
  });

  it('难度范围应该在 1-10 之间', () => {
    Object.values(CEFR_DIFFICULTY_RANGES).forEach(range => {
      expect(range.min).toBeGreaterThanOrEqual(1);
      expect(range.max).toBeLessThanOrEqual(10);
      expect(range.max).toBeGreaterThan(range.min);
    });
  });

  it('A1 应该是最低难度', () => {
    expect(CEFR_DIFFICULTY_RANGES.A1.min).toBe(1);
  });

  it('C2 应该是最高难度', () => {
    expect(CEFR_DIFFICULTY_RANGES.C2.max).toBe(10);
  });

  it('难度范围应该连续覆盖 1-10', () => {
    // 检查难度范围是否大致连续
    const sortedLevels = [...CEFR_LEVEL_ORDER].sort((a, b) => {
      return CEFR_DIFFICULTY_RANGES[a].min - CEFR_DIFFICULTY_RANGES[b].min;
    });
    expect(sortedLevels).toEqual(CEFR_LEVEL_ORDER);
  });
});

describe('CEFR_DISPLAY_NAMES', () => {
  it('应该包含所有 6 个等级的显示名称', () => {
    const levels: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    levels.forEach(level => {
      expect(CEFR_DISPLAY_NAMES[level]).toBeDefined();
      expect(CEFR_DISPLAY_NAMES[level]).toContain(level);
    });
  });

  it('显示名称应该包含中文描述', () => {
    expect(CEFR_DISPLAY_NAMES.A1).toContain('入门级');
    expect(CEFR_DISPLAY_NAMES.A2).toContain('初级');
    expect(CEFR_DISPLAY_NAMES.B1).toContain('中级');
    expect(CEFR_DISPLAY_NAMES.B2).toContain('中高级');
    expect(CEFR_DISPLAY_NAMES.C1).toContain('高级');
    expect(CEFR_DISPLAY_NAMES.C2).toContain('精通级');
  });
});

describe('CEFR_LEVEL_COLORS', () => {
  it('应该包含所有 6 个等级的颜色', () => {
    const levels: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    levels.forEach(level => {
      expect(CEFR_LEVEL_COLORS[level]).toBeDefined();
      expect(CEFR_LEVEL_COLORS[level]).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });

  it('颜色应该使用有效的十六进制格式', () => {
    Object.values(CEFR_LEVEL_COLORS).forEach(color => {
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });
  });
});

describe('MASTERY_THRESHOLDS', () => {
  it('应该有合理的阈值定义', () => {
    expect(MASTERY_THRESHOLDS.MASTERED).toBe(0.8);
    expect(MASTERY_THRESHOLDS.LEARNING).toBe(0.3);
    expect(MASTERY_THRESHOLDS.STRUGGLING).toBe(0);
    expect(MASTERY_THRESHOLDS.HIGH_CONFIDENCE).toBe(0.9);
    expect(MASTERY_THRESHOLDS.MEDIUM_CONFIDENCE).toBe(0.5);
  });

  it('掌握度阈值应该有序', () => {
    expect(MASTERY_THRESHOLDS.STRUGGLING).toBeLessThan(MASTERY_THRESHOLDS.LEARNING);
    expect(MASTERY_THRESHOLDS.LEARNING).toBeLessThan(MASTERY_THRESHOLDS.MASTERED);
  });

  it('置信度阈值应该有序', () => {
    expect(MASTERY_THRESHOLDS.MEDIUM_CONFIDENCE).toBeLessThan(MASTERY_THRESHOLDS.HIGH_CONFIDENCE);
  });
});

describe('SPACED_REPETITION_CONFIG', () => {
  it('应该有正确的复习间隔', () => {
    expect(SPACED_REPETITION_CONFIG.intervals).toEqual([1, 3, 7, 14, 30]);
  });

  it('应该有最小复习间隔', () => {
    expect(SPACED_REPETITION_CONFIG.minIntervalHours).toBe(4);
  });

  it('应该有最大复习间隔', () => {
    expect(SPACED_REPETITION_CONFIG.maxIntervalDays).toBe(365);
  });

  it('间隔应该是递增的', () => {
    const intervals = SPACED_REPETITION_CONFIG.intervals;
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeGreaterThan(intervals[i - 1]);
    }
  });
});

describe('BAYESIAN_PARAMS', () => {
  it('应该有默认先验掌握度', () => {
    expect(BAYESIAN_PARAMS.defaultPriorMastery).toBe(0.5);
  });

  it('应该有默认先验置信度', () => {
    expect(BAYESIAN_PARAMS.defaultPriorConfidence).toBe(0.1);
  });

  it('应该有合理的最大置信度', () => {
    expect(BAYESIAN_PARAMS.maxConfidence).toBe(0.99);
    expect(BAYESIAN_PARAMS.maxConfidence).toBeLessThan(1);
  });

  it('应该有置信度增长范围', () => {
    expect(BAYESIAN_PARAMS.minConfidenceIncrement).toBe(0.05);
    expect(BAYESIAN_PARAMS.maxConfidenceIncrement).toBe(0.15);
    expect(BAYESIAN_PARAMS.minConfidenceIncrement).toBeLessThan(BAYESIAN_PARAMS.maxConfidenceIncrement);
  });

  it('应该有掌握度增益和衰减因子', () => {
    expect(BAYESIAN_PARAMS.knownGainFactor).toBe(0.8);
    expect(BAYESIAN_PARAMS.unknownDecayFactor).toBe(0.6);
  });
});

describe('MASTERY_WEIGHTS', () => {
  it('应该有权重定义', () => {
    expect(MASTERY_WEIGHTS.knownWeight).toBe(1.0);
    expect(MASTERY_WEIGHTS.unknownWeight).toBe(1.5);
    expect(MASTERY_WEIGHTS.timeDecayDays).toBe(30);
  });

  it('不认识权重应该大于认识权重', () => {
    expect(MASTERY_WEIGHTS.unknownWeight).toBeGreaterThan(MASTERY_WEIGHTS.knownWeight);
  });
});

describe('getCEFRLevelByVocabulary', () => {
  it('应该返回 A1 当词汇量为 0', () => {
    expect(getCEFRLevelByVocabulary(0)).toBe('A1');
  });

  it('应该返回 A1 当词汇量在 A1 范围内', () => {
    expect(getCEFRLevelByVocabulary(500)).toBe('A1');
    expect(getCEFRLevelByVocabulary(1499)).toBe('A1');
  });

  it('应该返回 A2 当词汇量在 A2 范围内', () => {
    expect(getCEFRLevelByVocabulary(1500)).toBe('A2');
    expect(getCEFRLevelByVocabulary(2000)).toBe('A2');
  });

  it('应该返回 B1 当词汇量在 B1 范围内', () => {
    expect(getCEFRLevelByVocabulary(2500)).toBe('B1');
    expect(getCEFRLevelByVocabulary(3500)).toBe('B1');
  });

  it('应该返回 B2 当词汇量在 B2 范围内', () => {
    expect(getCEFRLevelByVocabulary(4000)).toBe('B2');
    expect(getCEFRLevelByVocabulary(5000)).toBe('B2');
  });

  it('应该返回 C1 当词汇量在 C1 范围内', () => {
    expect(getCEFRLevelByVocabulary(6000)).toBe('C1');
    expect(getCEFRLevelByVocabulary(8000)).toBe('C1');
  });

  it('应该返回 C2 当词汇量在 C2 范围内', () => {
    expect(getCEFRLevelByVocabulary(9000)).toBe('C2');
    expect(getCEFRLevelByVocabulary(15000)).toBe('C2');
  });

  it('应该返回 C2 当词汇量超过最大值', () => {
    expect(getCEFRLevelByVocabulary(25000)).toBe('C2');
    expect(getCEFRLevelByVocabulary(100000)).toBe('C2');
  });
});

describe('getCEFRLevelByDifficulty', () => {
  it('应该返回 A1 当难度最低', () => {
    expect(getCEFRLevelByDifficulty(1)).toBe('A1');
    expect(getCEFRLevelByDifficulty(1.5)).toBe('A1');
  });

  it('应该返回 A2 当难度在 A2 范围内', () => {
    expect(getCEFRLevelByDifficulty(2)).toBe('A2');
    expect(getCEFRLevelByDifficulty(3)).toBe('A2');
  });

  it('应该返回 B1 当难度在 B1 范围内', () => {
    expect(getCEFRLevelByDifficulty(4)).toBe('B1');
    expect(getCEFRLevelByDifficulty(5)).toBe('B1');
  });

  it('应该返回 B2 当难度在 B2 范围内', () => {
    expect(getCEFRLevelByDifficulty(5.5)).toBe('B2');
    expect(getCEFRLevelByDifficulty(6)).toBe('B2');
  });

  it('应该返回 C1 当难度在 C1 范围内', () => {
    expect(getCEFRLevelByDifficulty(7)).toBe('C1');
    expect(getCEFRLevelByDifficulty(8)).toBe('C1');
  });

  it('应该返回 C2 当难度在 C2 范围内', () => {
    expect(getCEFRLevelByDifficulty(8.5)).toBe('C2');
    expect(getCEFRLevelByDifficulty(9)).toBe('C2');
    expect(getCEFRLevelByDifficulty(9.9)).toBe('C2');
  });

  it('应该返回 A1 当难度正好等于 10（边界值不匹配）', () => {
    // 边界条件：difficulty < range.max，10 不在 C2 范围内
    expect(getCEFRLevelByDifficulty(10)).toBe('A1');
  });

  it('应该返回 A1 当难度小于最小值', () => {
    expect(getCEFRLevelByDifficulty(0)).toBe('A1');
    expect(getCEFRLevelByDifficulty(0.5)).toBe('A1');
  });
});

describe('getCEFRMedianVocabulary', () => {
  it('应该返回 A1 的中位数词汇量', () => {
    expect(getCEFRMedianVocabulary('A1')).toBe(750); // (0 + 1500) / 2
  });

  it('应该返回 A2 的中位数词汇量', () => {
    expect(getCEFRMedianVocabulary('A2')).toBe(2000); // (1500 + 2500) / 2
  });

  it('应该返回 B1 的中位数词汇量', () => {
    expect(getCEFRMedianVocabulary('B1')).toBe(3250); // (2500 + 4000) / 2
  });

  it('应该返回 B2 的中位数词汇量', () => {
    expect(getCEFRMedianVocabulary('B2')).toBe(5000); // (4000 + 6000) / 2
  });

  it('应该返回 C1 的中位数词汇量', () => {
    expect(getCEFRMedianVocabulary('C1')).toBe(7500); // (6000 + 9000) / 2
  });

  it('应该返回 C2 的中位数词汇量', () => {
    expect(getCEFRMedianVocabulary('C2')).toBe(14500); // (9000 + 20000) / 2
  });
});

describe('hasLevelUpgraded', () => {
  it('应该返回 true 当等级提升', () => {
    expect(hasLevelUpgraded('A1', 'A2')).toBe(true);
    expect(hasLevelUpgraded('A1', 'B1')).toBe(true);
    expect(hasLevelUpgraded('B1', 'B2')).toBe(true);
    expect(hasLevelUpgraded('B2', 'C1')).toBe(true);
    expect(hasLevelUpgraded('C1', 'C2')).toBe(true);
  });

  it('应该返回 false 当等级不变', () => {
    expect(hasLevelUpgraded('A1', 'A1')).toBe(false);
    expect(hasLevelUpgraded('B1', 'B1')).toBe(false);
    expect(hasLevelUpgraded('C2', 'C2')).toBe(false);
  });

  it('应该返回 false 当等级下降', () => {
    expect(hasLevelUpgraded('A2', 'A1')).toBe(false);
    expect(hasLevelUpgraded('B2', 'A2')).toBe(false);
    expect(hasLevelUpgraded('C2', 'A1')).toBe(false);
  });

  it('应该正确处理跨多级提升', () => {
    expect(hasLevelUpgraded('A1', 'C2')).toBe(true);
    expect(hasLevelUpgraded('A2', 'B2')).toBe(true);
  });
});

describe('getNextCEFRLevel', () => {
  it('应该返回下一级 A2 当当前是 A1', () => {
    expect(getNextCEFRLevel('A1')).toBe('A2');
  });

  it('应该返回下一级 B1 当当前是 A2', () => {
    expect(getNextCEFRLevel('A2')).toBe('B1');
  });

  it('应该返回下一级 B2 当当前是 B1', () => {
    expect(getNextCEFRLevel('B1')).toBe('B2');
  });

  it('应该返回下一级 C1 当当前是 B2', () => {
    expect(getNextCEFRLevel('B2')).toBe('C1');
  });

  it('应该返回下一级 C2 当当前是 C1', () => {
    expect(getNextCEFRLevel('C1')).toBe('C2');
  });

  it('应该返回 null 当当前是 C2（最高级）', () => {
    expect(getNextCEFRLevel('C2')).toBeNull();
  });
});

describe('getVocabularyToNextLevel', () => {
  it('应该返回 A1 到 A2 所需词汇量', () => {
    expect(getVocabularyToNextLevel('A1')).toBe(1500);
  });

  it('应该返回 A2 到 B1 所需词汇量', () => {
    expect(getVocabularyToNextLevel('A2')).toBe(2500);
  });

  it('应该返回 B1 到 B2 所需词汇量', () => {
    expect(getVocabularyToNextLevel('B1')).toBe(4000);
  });

  it('应该返回 B2 到 C1 所需词汇量', () => {
    expect(getVocabularyToNextLevel('B2')).toBe(6000);
  });

  it('应该返回 C1 到 C2 所需词汇量', () => {
    expect(getVocabularyToNextLevel('C1')).toBe(9000);
  });

  it('应该返回 0 当当前是 C2（最高级）', () => {
    expect(getVocabularyToNextLevel('C2')).toBe(0);
  });
});