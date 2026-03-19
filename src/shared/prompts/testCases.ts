/**
 * 提示词测试用例管理
 *
 * 提供标准测试文本集，支持不同难度和领域的测试用例
 */

import type { ExamType } from '../types';

/**
 * 测试用例难度级别
 */
export type TestCaseDifficulty = 'easy' | 'medium' | 'hard' | 'expert';

/**
 * 测试用例领域
 */
export type TestCaseDomain =
  | 'general'
  | 'technology'
  | 'science'
  | 'business'
  | 'literature'
  | 'academic'
  | 'news'
  | 'daily';

/**
 * 期望的识别结果
 */
export interface ExpectedWord {
  /** 单词原文 */
  original: string;
  /** 期望翻译 */
  expectedTranslation: string;
  /** 期望难度级别 */
  expectedDifficulty: number;
  /** 是否为短语 */
  isPhrase: boolean;
  /** 对于不同用户水平的期望：是否应被识别 */
  shouldIdentifyForLevel: Record<string, boolean>;
}

/**
 * 单个测试用例
 */
export interface PromptTestCase {
  /** 测试用例ID */
  id: string;
  /** 测试用例名称 */
  name: string;
  /** 测试文本 */
  text: string;
  /** 上下文 */
  context?: string;
  /** 难度级别 */
  difficulty: TestCaseDifficulty;
  /** 领域 */
  domain: TestCaseDomain;
  /** 期望识别的单词列表（用于计算准确率和召回率） */
  expectedWords: ExpectedWord[];
  /** 期望识别的复杂句子（用于语法测试） */
  expectedSentences?: string[];
  /** 适用的用户水平（哪些水平的用户应该能看懂） */
  targetLevels: ExamType[];
  /** 标签 */
  tags: string[];
}

/**
 * 测试套件
 */
export interface TestSuite {
  /** 套件ID */
  id: string;
  /** 套件名称 */
  name: string;
  /** 套件描述 */
  description: string;
  /** 包含的测试用例ID列表 */
  testCaseIds: string[];
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 标准测试用例集
 */
export const STANDARD_TEST_CASES: PromptTestCase[] = [
  // ============ Easy Level - Daily/General ============
  {
    id: 'easy-001',
    name: '基础日常对话',
    text: 'Hello, how are you today? I am fine, thank you.',
    difficulty: 'easy',
    domain: 'daily',
    expectedWords: [],
    targetLevels: ['cet4', 'cet6', 'toefl', 'ielts', 'gre'],
    tags: ['basic', 'greeting'],
  },
  {
    id: 'easy-002',
    name: '简单购物场景',
    text: 'I would like to buy some apples and bananas. How much are they?',
    difficulty: 'easy',
    domain: 'daily',
    expectedWords: [],
    targetLevels: ['cet4', 'cet6', 'toefl', 'ielts', 'gre'],
    tags: ['shopping', 'basic'],
  },
  {
    id: 'easy-003',
    name: '基础科技概念',
    text: 'The new smartphone has a better camera and longer battery life.',
    difficulty: 'easy',
    domain: 'technology',
    expectedWords: [
      {
        original: 'battery life',
        expectedTranslation: '电池续航',
        expectedDifficulty: 4,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
    ],
    targetLevels: ['cet4', 'cet6'],
    tags: ['technology', 'simple'],
  },

  // ============ Medium Level - Technology ============
  {
    id: 'medium-001',
    name: 'AI技术介绍',
    text: 'Machine learning algorithms can analyze vast amounts of data to identify patterns and make predictions.',
    difficulty: 'medium',
    domain: 'technology',
    expectedWords: [
      {
        original: 'Machine learning',
        expectedTranslation: '机器学习',
        expectedDifficulty: 6,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'algorithms',
        expectedTranslation: '算法',
        expectedDifficulty: 6,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'analyze',
        expectedTranslation: '分析',
        expectedDifficulty: 5,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: false, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'vast amounts',
        expectedTranslation: '大量',
        expectedDifficulty: 5,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'patterns',
        expectedTranslation: '模式',
        expectedDifficulty: 5,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: false, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'predictions',
        expectedTranslation: '预测',
        expectedDifficulty: 6,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
    ],
    targetLevels: ['cet6', 'toefl'],
    tags: ['technology', 'AI', 'algorithms'],
  },
  {
    id: 'medium-002',
    name: '云计算概念',
    text: 'Cloud computing enables organizations to scale their infrastructure dynamically based on demand.',
    difficulty: 'medium',
    domain: 'technology',
    expectedWords: [
      {
        original: 'Cloud computing',
        expectedTranslation: '云计算',
        expectedDifficulty: 6,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: false, gre: false },
      },
      {
        original: 'organizations',
        expectedTranslation: '组织',
        expectedDifficulty: 6,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'scale',
        expectedTranslation: '扩展',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: false, gre: false },
      },
      {
        original: 'infrastructure',
        expectedTranslation: '基础设施',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
      {
        original: 'dynamically',
        expectedTranslation: '动态地',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: false, gre: false },
      },
    ],
    targetLevels: ['cet6', 'toefl', 'ielts'],
    tags: ['technology', 'cloud', 'business'],
  },

  // ============ Medium Level - Academic ============
  {
    id: 'medium-003',
    name: '学术研究方法',
    text: 'The hypothesis was substantiated through empirical evidence gathered from multiple controlled experiments.',
    difficulty: 'medium',
    domain: 'academic',
    expectedWords: [
      {
        original: 'hypothesis',
        expectedTranslation: '假设',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
      {
        original: 'substantiated',
        expectedTranslation: '证实',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'empirical evidence',
        expectedTranslation: '实证证据',
        expectedDifficulty: 8,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'controlled experiments',
        expectedTranslation: '对照实验',
        expectedDifficulty: 7,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
    ],
    expectedSentences: [
      'The hypothesis was substantiated through empirical evidence gathered from multiple controlled experiments.',
    ],
    targetLevels: ['cet6', 'toefl', 'ielts', 'gre'],
    tags: ['academic', 'research', 'methodology'],
  },

  // ============ Hard Level - Science ============
  {
    id: 'hard-001',
    name: '量子物理概念',
    text: 'Quantum entanglement occurs when pairs or groups of particles interact in ways such that the quantum state of each particle cannot be described independently.',
    difficulty: 'hard',
    domain: 'science',
    expectedWords: [
      {
        original: 'Quantum entanglement',
        expectedTranslation: '量子纠缠',
        expectedDifficulty: 9,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'particles',
        expectedTranslation: '粒子',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'interact',
        expectedTranslation: '相互作用',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'quantum state',
        expectedTranslation: '量子态',
        expectedDifficulty: 9,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'independently',
        expectedTranslation: '独立地',
        expectedDifficulty: 6,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: false, cet6: false, toefl: false, ielts: false, gre: false },
      },
    ],
    targetLevels: ['toefl', 'ielts', 'gre'],
    tags: ['science', 'physics', 'quantum'],
  },
  {
    id: 'hard-002',
    name: '生物技术进展',
    text: 'CRISPR-Cas9 technology has revolutionized genetic engineering by enabling precise modifications to DNA sequences with unprecedented accuracy.',
    difficulty: 'hard',
    domain: 'science',
    expectedWords: [
      {
        original: 'CRISPR-Cas9',
        expectedTranslation: '基因编辑技术',
        expectedDifficulty: 10,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'revolutionized',
        expectedTranslation: '彻底改变',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'genetic engineering',
        expectedTranslation: '基因工程',
        expectedDifficulty: 8,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
      {
        original: 'precise modifications',
        expectedTranslation: '精确修改',
        expectedDifficulty: 7,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'DNA sequences',
        expectedTranslation: 'DNA序列',
        expectedDifficulty: 8,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
      {
        original: 'unprecedented',
        expectedTranslation: '前所未有的',
        expectedDifficulty: 9,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
    ],
    targetLevels: ['ielts', 'gre'],
    tags: ['science', 'biology', 'genetics', 'technology'],
  },

  // ============ Hard Level - Business ============
  {
    id: 'hard-003',
    name: '商业战略分析',
    text: 'The company implemented a paradigm shift in its business model, pivoting from traditional retail to an omnichannel approach that leverages data-driven insights.',
    difficulty: 'hard',
    domain: 'business',
    expectedWords: [
      {
        original: 'paradigm shift',
        expectedTranslation: '范式转变',
        expectedDifficulty: 9,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'pivoting',
        expectedTranslation: '转型',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'traditional retail',
        expectedTranslation: '传统零售',
        expectedDifficulty: 6,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: false, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'omnichannel',
        expectedTranslation: '全渠道',
        expectedDifficulty: 9,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'leverages',
        expectedTranslation: '利用',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'data-driven insights',
        expectedTranslation: '数据驱动的洞察',
        expectedDifficulty: 8,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
    ],
    targetLevels: ['toefl', 'ielts', 'gre'],
    tags: ['business', 'strategy', 'retail', 'technology'],
  },

  // ============ Expert Level - Literature ============
  {
    id: 'expert-001',
    name: '文学性描述',
    text: 'The protagonist, characterized by a proclivity for existential rumination, found himself in a quagmire of moral ambiguity that defied facile categorization.',
    difficulty: 'expert',
    domain: 'literature',
    expectedWords: [
      {
        original: 'protagonist',
        expectedTranslation: '主人公',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'proclivity',
        expectedTranslation: '倾向',
        expectedDifficulty: 9,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'existential',
        expectedTranslation: '存在主义的',
        expectedDifficulty: 10,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'rumination',
        expectedTranslation: '沉思',
        expectedDifficulty: 9,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'quagmire',
        expectedTranslation: '困境',
        expectedDifficulty: 10,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'moral ambiguity',
        expectedTranslation: '道德模糊性',
        expectedDifficulty: 9,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'defied',
        expectedTranslation: '违抗',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'facile categorization',
        expectedTranslation: '简单的分类',
        expectedDifficulty: 9,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
    ],
    expectedSentences: [
      'The protagonist, characterized by a proclivity for existential rumination, found himself in a quagmire of moral ambiguity that defied facile categorization.',
    ],
    targetLevels: ['gre'],
    tags: ['literature', 'advanced', 'vocabulary'],
  },

  // ============ Grammar Test Cases ============
  {
    id: 'grammar-001',
    name: '虚拟语气',
    text: 'If I had known about the meeting, I would have attended it yesterday.',
    difficulty: 'medium',
    domain: 'academic',
    expectedWords: [
      {
        original: 'had known',
        expectedTranslation: '早知道',
        expectedDifficulty: 7,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
      {
        original: 'would have attended',
        expectedTranslation: '就会参加',
        expectedDifficulty: 7,
        isPhrase: true,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
    ],
    expectedSentences: [
      'If I had known about the meeting, I would have attended it yesterday.',
    ],
    targetLevels: ['cet6', 'toefl', 'ielts'],
    tags: ['grammar', 'subjunctive', 'conditional'],
  },
  {
    id: 'grammar-002',
    name: '倒装句',
    text: 'Never have I seen such a magnificent sunset over the horizon.',
    difficulty: 'hard',
    domain: 'literature',
    expectedWords: [
      {
        original: 'magnificent',
        expectedTranslation: '壮丽的',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'horizon',
        expectedTranslation: '地平线',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
    ],
    expectedSentences: [
      'Never have I seen such a magnificent sunset over the horizon.',
    ],
    targetLevels: ['toefl', 'ielts', 'gre'],
    tags: ['grammar', 'inversion', 'literature'],
  },

  // ============ Edge Cases ============
  {
    id: 'edge-001',
    name: '空文本',
    text: '',
    difficulty: 'easy',
    domain: 'general',
    expectedWords: [],
    targetLevels: ['cet4', 'cet6', 'toefl', 'ielts', 'gre'],
    tags: ['edge-case', 'empty'],
  },
  {
    id: 'edge-002',
    name: '极短文本',
    text: 'Hi.',
    difficulty: 'easy',
    domain: 'general',
    expectedWords: [],
    targetLevels: ['cet4', 'cet6', 'toefl', 'ielts', 'gre'],
    tags: ['edge-case', 'short'],
  },
  {
    id: 'edge-003',
    name: '特殊字符',
    text: 'Hello, world! @#$%^&*() 你好 123',
    difficulty: 'easy',
    domain: 'general',
    expectedWords: [],
    targetLevels: ['cet4', 'cet6', 'toefl', 'ielts', 'gre'],
    tags: ['edge-case', 'special-chars'],
  },
  {
    id: 'edge-004',
    name: '长段落',
    text: `Artificial intelligence has become one of the most transformative technologies of the 21st century, revolutionizing industries from healthcare to finance, from education to transportation. The rapid advancement of machine learning algorithms, particularly deep learning techniques, has enabled computers to perform tasks that were once thought to be exclusively human domains, such as recognizing speech, understanding natural language, and making complex decisions. However, this technological revolution also brings significant challenges, including concerns about privacy, security, job displacement, and the ethical implications of autonomous systems. As we continue to integrate AI into various aspects of our daily lives, it becomes increasingly important to establish robust frameworks for governance and regulation that can ensure these powerful technologies are developed and deployed in ways that benefit humanity while minimizing potential risks and negative consequences.`,
    difficulty: 'hard',
    domain: 'technology',
    expectedWords: [
      {
        original: 'transformative',
        expectedTranslation: '变革性的',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'revolutionizing',
        expectedTranslation: '彻底改变',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'advancement',
        expectedTranslation: '进步',
        expectedDifficulty: 7,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: false, toefl: false, ielts: false, gre: false },
      },
      {
        original: 'exclusively',
        expectedTranslation: '专门地',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'displacement',
        expectedTranslation: '替代',
        expectedDifficulty: 9,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'autonomous',
        expectedTranslation: '自主的',
        expectedDifficulty: 9,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
      {
        original: 'frameworks',
        expectedTranslation: '框架',
        expectedDifficulty: 8,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: false },
      },
      {
        original: 'governance',
        expectedTranslation: '治理',
        expectedDifficulty: 9,
        isPhrase: false,
        shouldIdentifyForLevel: { cet4: true, cet6: true, toefl: true, ielts: true, gre: true },
      },
    ],
    targetLevels: ['toefl', 'ielts', 'gre'],
    tags: ['edge-case', 'long-text', 'technology', 'AI'],
  },
];

/**
 * 预定义测试套件
 */
export const PREDEFINED_TEST_SUITES: TestSuite[] = [
  {
    id: 'suite-smoke',
    name: '冒烟测试',
    description: '快速验证基本功能',
    testCaseIds: ['easy-001', 'medium-001', 'hard-001'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'suite-regression',
    name: '回归测试',
    description: '全面验证所有功能',
    testCaseIds: STANDARD_TEST_CASES.map(tc => tc.id),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'suite-technology',
    name: '技术领域测试',
    description: '针对技术领域文本的测试',
    testCaseIds: STANDARD_TEST_CASES
      .filter(tc => tc.domain === 'technology')
      .map(tc => tc.id),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'suite-academic',
    name: '学术领域测试',
    description: '针对学术领域文本的测试',
    testCaseIds: STANDARD_TEST_CASES
      .filter(tc => tc.domain === 'academic' || tc.domain === 'science')
      .map(tc => tc.id),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
  {
    id: 'suite-edge-cases',
    name: '边界情况测试',
    description: '测试边界情况和异常输入',
    testCaseIds: ['edge-001', 'edge-002', 'edge-003', 'edge-004'],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
];

/**
 * 测试用例管理器
 */
export class TestCaseManager {
  private customTestCases: PromptTestCase[] = [];
  private customSuites: TestSuite[] = [];

  /**
   * 获取所有标准测试用例
   */
  getStandardTestCases(): PromptTestCase[] {
    return [...STANDARD_TEST_CASES];
  }

  /**
   * 根据ID获取测试用例
   */
  getTestCase(id: string): PromptTestCase | undefined {
    return [...STANDARD_TEST_CASES, ...this.customTestCases].find(tc => tc.id === id);
  }

  /**
   * 根据难度筛选测试用例
   */
  getTestCasesByDifficulty(difficulty: TestCaseDifficulty): PromptTestCase[] {
    return [...STANDARD_TEST_CASES, ...this.customTestCases].filter(
      tc => tc.difficulty === difficulty
    );
  }

  /**
   * 根据领域筛选测试用例
   */
  getTestCasesByDomain(domain: TestCaseDomain): PromptTestCase[] {
    return [...STANDARD_TEST_CASES, ...this.customTestCases].filter(tc => tc.domain === domain);
  }

  /**
   * 根据目标水平筛选测试用例
   */
  getTestCasesByTargetLevel(level: string): PromptTestCase[] {
    return [...STANDARD_TEST_CASES, ...this.customTestCases].filter(tc =>
      tc.targetLevels.includes(level as ExamType)
    );
  }

  /**
   * 添加自定义测试用例
   */
  addCustomTestCase(testCase: PromptTestCase): void {
    this.customTestCases.push(testCase);
  }

  /**
   * 获取预定义测试套件
   */
  getPredefinedSuites(): TestSuite[] {
    return [...PREDEFINED_TEST_SUITES, ...this.customSuites];
  }

  /**
   * 根据ID获取测试套件
   */
  getTestSuite(id: string): TestSuite | undefined {
    return [...PREDEFINED_TEST_SUITES, ...this.customSuites].find(s => s.id === id);
  }

  /**
   * 创建自定义测试套件
   */
  createTestSuite(name: string, description: string, testCaseIds: string[]): TestSuite {
    const suite: TestSuite = {
      id: `custom-${Date.now()}`,
      name,
      description,
      testCaseIds,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.customSuites.push(suite);
    return suite;
  }

  /**
   * 获取测试套件中的所有测试用例
   */
  getTestCasesForSuite(suiteId: string): PromptTestCase[] {
    const suite = this.getTestSuite(suiteId);
    if (!suite) return [];

    return suite.testCaseIds
      .map(id => this.getTestCase(id))
      .filter((tc): tc is PromptTestCase => tc !== undefined);
  }
}

/**
 * 测试用例管理器单例
 */
export const testCaseManager = new TestCaseManager();
