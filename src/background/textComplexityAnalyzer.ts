/**
 * 文本复杂度分析器
 * 用于分析句子复杂度，支持智能翻译路由决策
 */

import { logger } from '@/shared/utils';

/**
 * 复杂度分析结果
 */
export interface ComplexityAnalysis {
  /** 总分 (0-100) */
  score: number;
  /** 词数 */
  wordCount: number;
  /** 从句数量 */
  clauseCount: number;
  /** 平均词长 */
  avgWordLength: number;
  /** 专业术语数量 */
  technicalTermCount: number;
  /** 检测到的专业术语列表 */
  technicalTerms: string[];
  /** 可读性等级 (1-10) */
  readabilityLevel: number;
  /** 复杂度等级 */
  level: 'simple' | 'medium' | 'complex';
}

/**
 * 专业术语词典（按领域分类）
 */
const TECHNICAL_TERMS: Record<string, string[]> = {
  // 计算机/技术领域
  tech: [
    'algorithm', 'api', 'artificial intelligence', 'backend', 'bandwidth', 'blockchain',
    'cache', 'cloud', 'compiler', 'cryptography', 'database', 'debugging', 'devops',
    'encryption', 'firewall', 'framework', 'frontend', 'full-stack', 'git', 'github',
    'hardware', 'http', 'https', 'infrastructure', 'javascript', 'json', 'kubernetes',
    'latency', 'load balancing', 'machine learning', 'microservices', 'middleware',
    'neural network', 'node', 'nosql', 'oauth', 'object-oriented', 'open source',
    'programming', 'protocol', 'python', 'query', 'react', 'redis', 'refactor', 'rest api',
    'scalability', 'sdk', 'serverless', 'software', 'sql', 'ssl', 'tensorflow',
    'typescript', 'ui', 'ux', 'virtualization', 'webhook', 'websocket', 'xml',
    'gradient descent', 'backpropagation', 'convolutional', 'distributed', 'asynchronous',
    'event-driven', 'callback', 'indexing', 'optimization', 'performance', 'scalability',
  ],
  // 医学/健康领域
  medical: [
    'antibiotic', 'antibody', 'antigen', 'biopsy', 'cardiovascular', 'chemotherapy',
    'clinical', 'diagnosis', 'epidemiology', 'hematology', 'histology', 'immunology',
    'metabolism', 'neurology', 'oncology', 'pathology', 'pharmaceutical', 'physiology',
    'psychiatry', 'radiology', 'surgery', 'symptom', 'syndrome', 'therapy', 'vaccine',
    'vascular', 'virus', 'bacteria', 'inflammation', 'infection', 'chronic', 'acute',
  ],
  // 法律领域
  legal: [
    'arbitration', 'breach of contract', 'copyright', 'defendant', 'deposition',
    'injunction', 'jurisdiction', 'liability', 'litigation', 'negligence', 'plaintiff',
    'precedent', 'statute', 'subpoena', 'tort', 'trademark', 'warranty', 'affidavit',
  ],
  // 商业/金融
  business: [
    'acquisition', 'amortization', 'arbitrage', 'asset', 'balance sheet', 'bankruptcy',
    'cash flow', 'collateral', 'commodity', 'derivative', 'dividend', 'equity',
    'fiscal', 'hedging', 'inflation', 'liquidity', 'merger', 'mortgage', 'portfolio',
    'recession', 'revenue', 'securities', 'stakeholder', 'valuation', 'venture capital',
    'yield', 'bonds', 'stocks', 'shares', 'etf', 'cryptocurrency', 'blockchain',
  ],
  // 学术/科学
  academic: [
    'abstract', 'bibliography', 'citation', 'dissertation', 'empirical', 'hypothesis',
    'literature review', 'methodology', 'peer review', 'qualitative', 'quantitative',
    'thesis', 'variable', 'correlation', 'regression', 'statistical significance',
  ],
};

/**
 * 常见从句连接词和标点符号
 */
const CLAUSE_INDICATORS = [
  // 从属连词
  'although', 'because', 'since', 'though', 'while', 'whereas',
  'unless', 'if', 'when', 'whenever', 'after', 'before', 'until',
  'as', 'even though', 'provided that', 'so that', 'in order that',
  // 关系代词
  'who', 'whom', 'whose', 'which', 'that', 'what', 'whatever',
  'whoever', 'whomever', 'where', 'wherever',
];

/**
 * 复杂连接词（表示更复杂的句子结构）
 */
const COMPLEX_CONNECTORS = [
  'furthermore', 'moreover', 'nevertheless', 'nonetheless', 'however',
  'therefore', 'consequently', 'as a result', 'in addition', 'in contrast',
  'on the other hand', 'in other words', 'that is to say', 'for instance',
  'for example', 'in particular', 'specifically', 'in conclusion', 'to sum up',
  'meanwhile', 'subsequently', 'previously', 'simultaneously', 'alternatively',
];

/**
 * 文本复杂度分析器类
 */
export class TextComplexityAnalyzer {
  /**
   * 分析文本复杂度
   * @param text 要分析的文本
   * @returns 复杂度分析结果
   */
  static analyze(text: string): ComplexityAnalysis {
    const normalizedText = text.toLowerCase().trim();

    // 基础统计
    const wordCount = this.countWords(normalizedText);
    const avgWordLength = this.calculateAvgWordLength(normalizedText);
    const clauseCount = this.countClauses(normalizedText);

    // 专业术语检测
    const technicalTerms = this.detectTechnicalTerms(normalizedText);

    // 计算复杂度分数
    const score = this.calculateComplexityScore({
      wordCount,
      avgWordLength,
      clauseCount,
      technicalTermCount: technicalTerms.length,
    });

    // 确定可读性等级
    const readabilityLevel = this.calculateReadabilityLevel(score);

    // 确定复杂度等级
    const level = this.determineComplexityLevel(score);

    const analysis: ComplexityAnalysis = {
      score,
      wordCount,
      clauseCount,
      avgWordLength,
      technicalTermCount: technicalTerms.length,
      technicalTerms,
      readabilityLevel,
      level,
    };

    logger.info('TextComplexityAnalyzer: Analysis complete', {
      score,
      level,
      wordCount,
      technicalTermCount: technicalTerms.length,
    });

    return analysis;
  }

  /**
   * 快速判断文本复杂度等级
   * @param text 要分析的文本
   * @returns 复杂度等级
   */
  static quickAnalyze(text: string): 'simple' | 'medium' | 'complex' {
    const analysis = this.analyze(text);
    return analysis.level;
  }

  /**
   * 统计词数
   */
  private static countWords(text: string): number {
    const words = text.match(/\b[a-z]+\b/g);
    return words?.length || 0;
  }

  /**
   * 计算平均词长
   */
  private static calculateAvgWordLength(text: string): number {
    const words = text.match(/\b[a-z]+\b/g) || [];
    if (words.length === 0) return 0;

    const totalLength = words.reduce((sum, word) => sum + word.length, 0);
    return Math.round((totalLength / words.length) * 10) / 10;
  }

  /**
   * 统计从句数量
   * 基于连接词和标点符号的启发式检测
   */
  private static countClauses(text: string): number {
    let clauseCount = 1; // 至少有一个主句

    // 检测从属连词
    for (const indicator of CLAUSE_INDICATORS) {
      const regex = new RegExp(`\\b${indicator}\\b`, 'g');
      const matches = text.match(regex);
      if (matches) {
        clauseCount += matches.length;
      }
    }

    // 检测复杂连接词（增加权重）
    for (const connector of COMPLEX_CONNECTORS) {
      const regex = new RegExp(`\\b${connector.replace(/\s+/g, '\\s+')}\\b`, 'g');
      const matches = text.match(regex);
      if (matches) {
        clauseCount += matches.length * 0.5;
      }
    }

    // 检测分号（通常分隔独立子句）
    const semicolons = text.match(/;/g);
    if (semicolons) {
      clauseCount += semicolons.length;
    }

    // 检测冒号（有时引入解释性子句）
    const colons = text.match(/:/g);
    if (colons) {
      clauseCount += colons.length * 0.5;
    }

    // 检测括号内容（通常包含补充信息）
    const parentheses = text.match(/\([^)]*\)/g);
    if (parentheses) {
      clauseCount += parentheses.length * 0.5;
    }

    return Math.round(clauseCount);
  }

  /**
   * 检测专业术语
   */
  private static detectTechnicalTerms(text: string): string[] {
    const terms: string[] = [];

    for (const [_domain, domainTerms] of Object.entries(TECHNICAL_TERMS)) {
      for (const term of domainTerms) {
        // 使用单词边界匹配多词术语
        const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');
        if (regex.test(text)) {
          terms.push(term);
        }
      }
    }

    return [...new Set(terms)]; // 去重
  }

  /**
   * 计算复杂度分数
   * 基于多个因素的加权评分
   */
  private static calculateComplexityScore(params: {
    wordCount: number;
    avgWordLength: number;
    clauseCount: number;
    technicalTermCount: number;
  }): number {
    const { wordCount, avgWordLength, clauseCount, technicalTermCount } = params;

    // 各项权重
    const weights = {
      wordCount: 0.15,           // 词数权重
      avgWordLength: 0.2,        // 平均词长权重
      clauseCount: 0.35,         // 从句数量权重
      technicalTermCount: 0.3,   // 专业术语权重
    };

    // 归一化各项分数（0-100）
    const wordCountScore = Math.min(wordCount / 20, 1) * 100;
    const avgWordLengthScore = Math.max(0, Math.min((avgWordLength - 3) / 4, 1)) * 100;
    const clauseCountScore = Math.min((clauseCount - 1) / 4, 1) * 100;
    const technicalTermScore = Math.min(technicalTermCount / 3, 1) * 100;

    // 加权计算总分
    const score =
      wordCountScore * weights.wordCount +
      avgWordLengthScore * weights.avgWordLength +
      clauseCountScore * weights.clauseCount +
      technicalTermScore * weights.technicalTermCount;

    return Math.round(score);
  }

  /**
   * 计算可读性等级（1-10）
   */
  private static calculateReadabilityLevel(complexityScore: number): number {
    if (complexityScore <= 20) return 1;
    if (complexityScore <= 30) return 2;
    if (complexityScore <= 40) return 3;
    if (complexityScore <= 50) return 4;
    if (complexityScore <= 60) return 5;
    if (complexityScore <= 70) return 6;
    if (complexityScore <= 80) return 7;
    if (complexityScore <= 90) return 8;
    if (complexityScore <= 95) return 9;
    return 10;
  }

  /**
   * 确定复杂度等级
   */
  private static determineComplexityLevel(score: number): 'simple' | 'medium' | 'complex' {
    if (score <= 35) return 'simple';
    if (score <= 65) return 'medium';
    return 'complex';
  }

  /**
   * 判断文本是否需要LLM翻译（复杂文本）
   * @param text 要判断的文本
   * @returns 是否需要LLM翻译
   */
  static requiresLLM(text: string): boolean {
    const analysis = this.analyze(text);
    return analysis.level === 'complex' || analysis.score > 60;
  }

  /**
   * 判断文本是否适合传统API翻译（简单文本）
   * @param text 要判断的文本
   * @returns 是否适合传统API翻译
   */
  static suitableForTraditional(text: string): boolean {
    const analysis = this.analyze(text);
    return analysis.level === 'simple' && analysis.score <= 35;
  }
}

export default TextComplexityAnalyzer;
