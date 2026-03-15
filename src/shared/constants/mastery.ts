import type { CEFRLevel, CEFRRange } from '../types/mastery';

/**
 * CEFR 词汇量范围定义
 * 基于 Common European Framework of Reference for Languages
 */
export const CEFR_RANGES: CEFRRange[] = [
  { level: 'A1', minVocabulary: 0, maxVocabulary: 1500, description: '入门级 - 基础日常词汇' },
  { level: 'A2', minVocabulary: 1500, maxVocabulary: 2500, description: '初级 - 常见生活词汇' },
  { level: 'B1', minVocabulary: 2500, maxVocabulary: 4000, description: '中级 - 工作学习词汇' },
  { level: 'B2', minVocabulary: 4000, maxVocabulary: 6000, description: '中高级 - 专业讨论词汇' },
  { level: 'C1', minVocabulary: 6000, maxVocabulary: 9000, description: '高级 - 流利表达词汇' },
  { level: 'C2', minVocabulary: 9000, maxVocabulary: 20000, description: '精通级 - 学术专业词汇' },
];

/**
 * CEFR 等级排序（用于升级检测）
 */
export const CEFR_LEVEL_ORDER: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * CEFR 等级对应的难度范围（1-10）
 */
export const CEFR_DIFFICULTY_RANGES: Record<CEFRLevel, { min: number; max: number }> = {
  A1: { min: 1, max: 2 },
  A2: { min: 2, max: 4 },
  B1: { min: 4, max: 5.5 },
  B2: { min: 5.5, max: 7 },
  C1: { min: 7, max: 8.5 },
  C2: { min: 8.5, max: 10 },
};

/**
 * CEFR 等级显示名称
 */
export const CEFR_DISPLAY_NAMES: Record<CEFRLevel, string> = {
  A1: '入门级 (A1)',
  A2: '初级 (A2)',
  B1: '中级 (B1)',
  B2: '中高级 (B2)',
  C1: '高级 (C1)',
  C2: '精通级 (C2)',
};

/**
 * CEFR 等级颜色（用于可视化）
 */
export const CEFR_LEVEL_COLORS: Record<CEFRLevel, string> = {
  A1: '#22c55e', // green-500
  A2: '#84cc16', // lime-500
  B1: '#eab308', // yellow-500
  B2: '#f97316', // orange-500
  C1: '#ef4444', // red-500
  C2: '#a855f7', // purple-500
};

/**
 * 默认掌握度阈值
 */
export const MASTERY_THRESHOLDS = {
  /** 已掌握：掌握度 >= 0.8 */
  MASTERED: 0.8,
  /** 学习中：0.3 <= 掌握度 < 0.8 */
  LEARNING: 0.3,
  /** 困难：掌握度 < 0.3 */
  STRUGGLING: 0,
  /** 高置信度：置信度 >= 0.9 */
  HIGH_CONFIDENCE: 0.9,
  /** 中等置信度：置信度 >= 0.5 */
  MEDIUM_CONFIDENCE: 0.5,
} as const;

/**
 * 间隔重复默认配置
 */
export const SPACED_REPETITION_CONFIG = {
  /** 复习间隔天数：[第1次, 第2次, 第3次, 第4次, 第5次及以上] */
  intervals: [1, 3, 7, 14, 30],
  /** 最小复习间隔（小时）- 防止短时间内重复复习 */
  minIntervalHours: 4,
  /** 最大复习间隔（天） */
  maxIntervalDays: 365,
} as const;

/**
 * 贝叶斯更新默认参数
 */
export const BAYESIAN_PARAMS = {
  /** 先验掌握度（完全未知时的默认值） */
  defaultPriorMastery: 0.5,
  /** 先验置信度（完全未知时的默认值） */
  defaultPriorConfidence: 0.1,
  /** 最大置信度 */
  maxConfidence: 0.99,
  /** 每次标记的最小置信度增长 */
  minConfidenceIncrement: 0.05,
  /** 每次标记的最大置信度增长 */
  maxConfidenceIncrement: 0.15,
  /** 认识单词时的掌握度增益系数 */
  knownGainFactor: 0.8,
  /** 不认识单词时的掌握度衰减系数 */
  unknownDecayFactor: 0.6,
} as const;

/**
 * 掌握度计算权重
 */
export const MASTERY_WEIGHTS = {
  /** 认识次数权重 */
  knownWeight: 1.0,
  /** 不认识次数权重（负面影响更大） */
  unknownWeight: 1.5,
  /** 时间衰减因子（天） */
  timeDecayDays: 30,
} as const;

/**
 * 获取词汇量对应的 CEFR 等级
 */
export function getCEFRLevelByVocabulary(vocabularySize: number): CEFRLevel {
  for (const range of CEFR_RANGES) {
    if (vocabularySize >= range.minVocabulary && vocabularySize < range.maxVocabulary) {
      return range.level;
    }
  }
  // 超出最大范围返回 C2
  return 'C2';
}

/**
 * 获取难度对应的 CEFR 等级
 */
export function getCEFRLevelByDifficulty(difficulty: number): CEFRLevel {
  for (const level of CEFR_LEVEL_ORDER) {
    const range = CEFR_DIFFICULTY_RANGES[level];
    if (difficulty >= range.min && difficulty < range.max) {
      return level;
    }
  }
  // 默认返回 A1
  return 'A1';
}

/**
 * 获取 CEFR 等级的词汇量中位数
 */
export function getCEFRMedianVocabulary(level: CEFRLevel): number {
  const range = CEFR_RANGES.find(r => r.level === level);
  if (!range) return 3000;
  return Math.round((range.minVocabulary + range.maxVocabulary) / 2);
}

/**
 * 检查是否升级了 CEFR 等级
 * @returns 如果升级了返回 true，否则返回 false
 */
export function hasLevelUpgraded(currentLevel: CEFRLevel, newLevel: CEFRLevel): boolean {
  const currentIndex = CEFR_LEVEL_ORDER.indexOf(currentLevel);
  const newIndex = CEFR_LEVEL_ORDER.indexOf(newLevel);
  return newIndex > currentIndex;
}

/**
 * 获取下一个 CEFR 等级
 */
export function getNextCEFRLevel(currentLevel: CEFRLevel): CEFRLevel | null {
  const currentIndex = CEFR_LEVEL_ORDER.indexOf(currentLevel);
  if (currentIndex >= CEFR_LEVEL_ORDER.length - 1) return null;
  return CEFR_LEVEL_ORDER[currentIndex + 1];
}

/**
 * 计算达到下一级所需词汇量
 */
export function getVocabularyToNextLevel(currentLevel: CEFRLevel): number {
  const nextLevel = getNextCEFRLevel(currentLevel);
  if (!nextLevel) return 0;

  const currentRange = CEFR_RANGES.find(r => r.level === currentLevel);
  return currentRange ? currentRange.maxVocabulary : 0;
}
