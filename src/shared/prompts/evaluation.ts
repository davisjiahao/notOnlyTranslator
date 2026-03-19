/**
 * 提示词效果评估系统
 *
 * 提供提示词评估、A/B 测试和性能对比功能
 */

import type { PromptTestCase } from './testCases';

// ============ 评估指标类型 ============

/**
 * 单次评估运行的指标
 */
export interface EvaluationMetrics {
  /** 准确率：识别出的词汇中真正超出用户水平的比例 */
  precision: number;
  /** 召回率：应该被识别的词汇中被成功识别的比例 */
  recall: number;
  /** F1 分数：准确率和召回率的调和平均 */
  f1Score: number;
  /** 响应时间（毫秒） */
  latency: number;
  /** Token 消耗 */
  tokenUsage: number;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** JSON 格式合规率（0-1） */
  jsonComplianceRate: number;
  /** 翻译质量评分（0-10） */
  translationQuality: number;
  /** 难度评级准确性（期望难度和实际难度的偏差） */
  difficultyAccuracy: number;
}

/**
 * 单词级别的评估结果
 */
export interface WordEvaluationResult {
  /** 单词原文 */
  original: string;
  /** 是否被正确识别 */
  correctlyIdentified: boolean;
  /** 是否被错误识别（假阳性） */
  falsePositive: boolean;
  /** 是否被遗漏（假阴性） */
  falseNegative: boolean;
  /** 期望难度 */
  expectedDifficulty: number;
  /** 实际难度评级 */
  actualDifficulty?: number;
  /** 难度偏差 */
  difficultyDeviation?: number;
  /** 翻译准确性评分（0-10） */
  translationAccuracy: number;
}

/**
 * 单次测试用例评估结果
 */
export interface TestCaseResult {
  /** 测试用例ID */
  testCaseId: string;
  /** 测试用例名称 */
  testCaseName: string;
  /** 提示词版本 */
  promptVersion: string;
  /** 执行时间戳 */
  timestamp: number;
  /** 评估指标 */
  metrics: EvaluationMetrics;
  /** 单词级别的评估结果 */
  wordResults: WordEvaluationResult[];
  /** 原始输出 */
  rawOutput: unknown;
  /** 是否有解析错误 */
  hasParseError: boolean;
  /** 错误信息 */
  errorMessage?: string;
}

/**
 * 提示词版本评估结果
 */
export interface PromptVersionEvaluation {
  /** 提示词版本 */
  version: string;
  /** 测试用例数量 */
  testCases: number;
  /** 通过数量（达到阈值） */
  passedCount: number;
  /** 通过率 */
  passRate: number;
  /** 平均指标 */
  averageMetrics: EvaluationMetrics;
  /** 各测试用例结果 */
  results: TestCaseResult[];
  /** 评估时间戳 */
  evaluatedAt: number;
  /** 评估持续时间（毫秒） */
  duration: number;
}

/**
 * A/B 测试结果
 */
export interface ABTestResult {
  /** 测试ID */
  id: string;
  /** 基准版本 */
  baselineVersion: string;
  /** 对比版本 */
  challengerVersion: string;
  /** 基准版本评估结果 */
  baselineResult: PromptVersionEvaluation;
  /** 对比版本评估结果 */
  challengerResult: PromptVersionEvaluation;
  /** 各指标对比 */
  comparisons: MetricComparison[];
  /** 胜出版本 */
  winner: 'baseline' | 'challenger' | 'tie';
  /** 胜出差值（百分比） */
  winningMargin: number;
  /** 统计显著性（p值） */
  statisticalSignificance: number;
  /** 测试时间戳 */
  testedAt: number;
}

/**
 * 指标对比
 */
export interface MetricComparison {
  /** 指标名称 */
  metric: keyof EvaluationMetrics;
  /** 基准值 */
  baseline: number;
  /** 对比值 */
  challenger: number;
  /** 差异（百分比） */
  difference: number;
  /** 是否提升 */
  improved: boolean;
}

/**
 * 评估配置
 */
export interface EvaluationConfig {
  /** 准确率阈值 */
  precisionThreshold: number;
  /** 召回率阈值 */
  recallThreshold: number;
  /** 最大响应时间（毫秒） */
  maxLatency: number;
  /** JSON 合规率阈值 */
  minJsonCompliance: number;
  /** 翻译质量阈值 */
  minTranslationQuality: number;
  /** 统计显著性阈值（p值） */
  significanceThreshold: number;
}

/**
 * 默认评估配置
 */
export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  precisionThreshold: 0.7,
  recallThreshold: 0.7,
  maxLatency: 5000,
  minJsonCompliance: 0.95,
  minTranslationQuality: 7.0,
  significanceThreshold: 0.05,
};

/**
 * 评估报告
 */
export interface EvaluationReport {
  /** 报告ID */
  id: string;
  /** 报告标题 */
  title: string;
  /** 生成时间 */
  generatedAt: number;
  /** 包含的提示词版本评估 */
  versionEvaluations: PromptVersionEvaluation[];
  /** A/B 测试结果 */
  abTestResults: ABTestResult[];
  /** 历史趋势（可选） */
  historicalTrend?: HistoricalDataPoint[];
  /** 摘要 */
  summary: ReportSummary;
}

/**
 * 报告摘要
 */
export interface ReportSummary {
  /** 总测试用例数 */
  totalTestCases: number;
  /** 通过的测试用例数 */
  passedTestCases: number;
  /** 平均通过率 */
  averagePassRate: number;
  /** 最佳表现版本 */
  bestPerformingVersion: string;
  /** 建议 */
  recommendations: string[];
  /** 风险评估 */
  riskAssessment: RiskAssessment;
}

/**
 * 风险评估
 */
export interface RiskAssessment {
  /** 风险级别 */
  level: 'low' | 'medium' | 'high' | 'critical';
  /** 风险描述 */
  description: string;
  /** 主要关注点 */
  concerns: string[];
}

/**
 * 历史数据点
 */
export interface HistoricalDataPoint {
  /** 时间戳 */
  timestamp: number;
  /** 版本 */
  version: string;
  /** 通过率 */
  passRate: number;
  /** 平均延迟 */
  avgLatency: number;
}

// ============ 评估器类 ============

/**
 * 提示词效果评估器
 */
export class PromptEvaluator {
  private config: EvaluationConfig;

  constructor(config: Partial<EvaluationConfig> = {}) {
    this.config = { ...DEFAULT_EVALUATION_CONFIG, ...config };
  }

  /**
   * 评估单个测试用例的结果
   */
  evaluateTestCase(
    testCase: PromptTestCase,
    rawOutput: unknown,
    latency: number,
    tokenUsage: { input: number; output: number },
    promptVersion: string,
    userLevel: string
  ): TestCaseResult {
    const wordResults = this.evaluateWordResults(testCase, rawOutput, userLevel);
    const metrics = this.calculateMetrics(wordResults, latency, tokenUsage, rawOutput);

    return {
      testCaseId: testCase.id,
      testCaseName: testCase.name,
      promptVersion,
      timestamp: Date.now(),
      metrics,
      wordResults,
      rawOutput,
      hasParseError: this.hasParseError(rawOutput),
      errorMessage: this.getErrorMessage(rawOutput),
    };
  }

  /**
   * 评估单词识别结果
   */
  private evaluateWordResults(
    testCase: PromptTestCase,
    rawOutput: unknown,
    userLevel: string
  ): WordEvaluationResult[] {
    const results: WordEvaluationResult[] = [];

    // 解析输出中的单词列表
    const identifiedWords = this.parseIdentifiedWords(rawOutput);
    const identifiedSet = new Set(identifiedWords.map(w => w.original.toLowerCase()));

    for (const expectedWord of testCase.expectedWords) {
      const wasIdentified = identifiedSet.has(expectedWord.original.toLowerCase());
      const shouldIdentify = expectedWord.shouldIdentifyForLevel[userLevel] ?? true;

      const result: WordEvaluationResult = {
        original: expectedWord.original,
        correctlyIdentified: wasIdentified && shouldIdentify,
        falsePositive: wasIdentified && !shouldIdentify,
        falseNegative: !wasIdentified && shouldIdentify,
        expectedDifficulty: expectedWord.expectedDifficulty,
        actualDifficulty: identifiedWords.find(
          w => w.original.toLowerCase() === expectedWord.original.toLowerCase()
        )?.difficulty,
        difficultyDeviation: undefined,
        translationAccuracy: 0, // 需要语义比较
      };

      // 计算难度偏差
      if (result.actualDifficulty !== undefined) {
        result.difficultyDeviation = Math.abs(result.actualDifficulty - expectedWord.expectedDifficulty);
      }

      results.push(result);
    }

    // 检查是否有假阳性（识别了不在期望列表中的词）
    const expectedSet = new Set(testCase.expectedWords.map(w => w.original.toLowerCase()));
    for (const identified of identifiedWords) {
      if (!expectedSet.has(identified.original.toLowerCase())) {
        results.push({
          original: identified.original,
          correctlyIdentified: false,
          falsePositive: true,
          falseNegative: false,
          expectedDifficulty: 5, // 默认值
          actualDifficulty: identified.difficulty,
          translationAccuracy: 0,
        });
      }
    }

    return results;
  }

  /**
   * 解析模型输出中的单词列表
   */
  private parseIdentifiedWords(rawOutput: unknown): Array<{
    original: string;
    translation?: string;
    difficulty?: number;
  }> {
    try {
      if (typeof rawOutput === 'string') {
        const parsed = JSON.parse(rawOutput);
        return parsed.words || [];
      }
      if (typeof rawOutput === 'object' && rawOutput !== null) {
        const obj = rawOutput as Record<string, unknown>;
        return (obj.words as Array<{
          original: string;
          translation?: string;
          difficulty?: number;
        }>) || [];
      }
    } catch {
      // 解析失败返回空数组
    }
    return [];
  }

  /**
   * 计算评估指标
   */
  private calculateMetrics(
    wordResults: WordEvaluationResult[],
    latency: number,
    tokenUsage: { input: number; output: number },
    rawOutput: unknown
  ): EvaluationMetrics {
    const truePositives = wordResults.filter(r => r.correctlyIdentified).length;
    const falsePositives = wordResults.filter(r => r.falsePositive).length;
    const falseNegatives = wordResults.filter(r => r.falseNegative).length;

    const precision = truePositives + falsePositives > 0
      ? truePositives / (truePositives + falsePositives)
      : 0;

    const recall = truePositives + falseNegatives > 0
      ? truePositives / (truePositives + falseNegatives)
      : 0;

    const f1Score = precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

    // 计算难度准确性（难度评级的平均偏差）
    const difficultyDeviations = wordResults
      .filter(r => r.difficultyDeviation !== undefined)
      .map(r => r.difficultyDeviation!);

    const difficultyAccuracy = difficultyDeviations.length > 0
      ? 10 - (difficultyDeviations.reduce((a, b) => a + b, 0) / difficultyDeviations.length)
      : 5;

    return {
      precision,
      recall,
      f1Score,
      latency,
      tokenUsage: tokenUsage.input + tokenUsage.output,
      inputTokens: tokenUsage.input,
      outputTokens: tokenUsage.output,
      jsonComplianceRate: this.hasParseError(rawOutput) ? 0 : 1,
      translationQuality: this.estimateTranslationQuality(wordResults),
      difficultyAccuracy: Math.max(0, difficultyAccuracy),
    };
  }

  /**
   * 估计翻译质量
   */
  private estimateTranslationQuality(wordResults: WordEvaluationResult[]): number {
    if (wordResults.length === 0) return 5; // 默认值

    // 基于正确识别的比例和难度偏差计算
    const correctlyIdentified = wordResults.filter(r => r.correctlyIdentified).length;
    const accuracy = wordResults.length > 0 ? correctlyIdentified / wordResults.length : 0;

    const avgDeviation = wordResults
      .filter(r => r.difficultyDeviation !== undefined)
      .reduce((sum, r) => sum + (r.difficultyDeviation || 0), 0) / wordResults.length;

    // 准确性占70%，难度评级占30%
    const quality = accuracy * 7 + Math.max(0, (1 - avgDeviation / 10) * 3);
    return Math.min(10, Math.max(0, quality));
  }

  /**
   * 检查是否有解析错误
   */
  private hasParseError(rawOutput: unknown): boolean {
    if (typeof rawOutput === 'string') {
      try {
        JSON.parse(rawOutput);
        return false;
      } catch {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取错误信息
   */
  private getErrorMessage(rawOutput: unknown): string | undefined {
    if (typeof rawOutput === 'string') {
      try {
        JSON.parse(rawOutput);
      } catch (e) {
        return e instanceof Error ? e.message : 'JSON parse error';
      }
    }
    return undefined;
  }

  /**
   * 判断测试是否通过
   */
  isPassing(metrics: EvaluationMetrics): boolean {
    return (
      metrics.precision >= this.config.precisionThreshold &&
      metrics.recall >= this.config.recallThreshold &&
      metrics.latency <= this.config.maxLatency &&
      metrics.jsonComplianceRate >= this.config.minJsonCompliance &&
      metrics.translationQuality >= this.config.minTranslationQuality
    );
  }

  /**
   * 评估多个测试用例
   */
  evaluateTestCases(
    testCaseResults: TestCaseResult[],
    promptVersion: string
  ): PromptVersionEvaluation {
    const passedCount = testCaseResults.filter(r => this.isPassing(r.metrics)).length;
    const passRate = testCaseResults.length > 0 ? passedCount / testCaseResults.length : 0;

    // 计算平均指标
    const avgMetrics: EvaluationMetrics = {
      precision: this.average(testCaseResults.map(r => r.metrics.precision)),
      recall: this.average(testCaseResults.map(r => r.metrics.recall)),
      f1Score: this.average(testCaseResults.map(r => r.metrics.f1Score)),
      latency: this.average(testCaseResults.map(r => r.metrics.latency)),
      tokenUsage: this.average(testCaseResults.map(r => r.metrics.tokenUsage)),
      inputTokens: this.average(testCaseResults.map(r => r.metrics.inputTokens)),
      outputTokens: this.average(testCaseResults.map(r => r.metrics.outputTokens)),
      jsonComplianceRate: this.average(testCaseResults.map(r => r.metrics.jsonComplianceRate)),
      translationQuality: this.average(testCaseResults.map(r => r.metrics.translationQuality)),
      difficultyAccuracy: this.average(testCaseResults.map(r => r.metrics.difficultyAccuracy)),
    };

    return {
      version: promptVersion,
      testCases: testCaseResults.length,
      passedCount,
      passRate,
      averageMetrics: avgMetrics,
      results: testCaseResults,
      evaluatedAt: Date.now(),
      duration: testCaseResults.reduce((sum, r) => sum + r.metrics.latency, 0),
    };
  }

  /**
   * 计算平均值
   */
  private average(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
}

/**
 * A/B 测试框架
 */
export class ABTestFramework {
  /**
   * 运行 A/B 测试
   */
  runABTest(
    baselineVersion: string,
    challengerVersion: string,
    baselineResults: PromptVersionEvaluation,
    challengerResults: PromptVersionEvaluation
  ): ABTestResult {
    const comparisons = this.compareMetrics(
      baselineResults.averageMetrics,
      challengerResults.averageMetrics
    );

    // 计算统计显著性（简化版）
    const significance = this.calculateSignificance(baselineResults, challengerResults);

    // 确定胜出者
    const improvedCount = comparisons.filter(c => c.improved).length;
    const degradedCount = comparisons.filter(c => !c.improved && c.difference !== 0).length;

    let winner: 'baseline' | 'challenger' | 'tie';
    if (improvedCount > degradedCount + 1) {
      winner = 'challenger';
    } else if (degradedCount > improvedCount + 1) {
      winner = 'baseline';
    } else {
      winner = 'tie';
    }

    // 计算胜出差值
    const avgDifference = this.average(comparisons.map(c => Math.abs(c.difference)));

    return {
      id: `ab-${Date.now()}`,
      baselineVersion,
      challengerVersion,
      baselineResult: baselineResults,
      challengerResult: challengerResults,
      comparisons,
      winner,
      winningMargin: avgDifference,
      statisticalSignificance: significance,
      testedAt: Date.now(),
    };
  }

  /**
   * 比较指标
   */
  private compareMetrics(
    baseline: EvaluationMetrics,
    challenger: EvaluationMetrics
  ): MetricComparison[] {
    const metrics: (keyof EvaluationMetrics)[] = [
      'precision',
      'recall',
      'f1Score',
      'translationQuality',
      'difficultyAccuracy',
    ];

    return metrics.map(metric => {
      const baselineValue = baseline[metric];
      const challengerValue = challenger[metric];
      const difference = baselineValue > 0
        ? ((challengerValue - baselineValue) / baselineValue) * 100
        : 0;

      // 对于延迟和 token 消耗，越低越好
      const isLowerBetter = metric === 'latency' || metric === 'tokenUsage';
      const improved = isLowerBetter ? difference < 0 : difference > 0;

      return {
        metric,
        baseline: baselineValue,
        challenger: challengerValue,
        difference,
        improved,
      };
    });
  }

  /**
   * 计算统计显著性（简化实现）
   */
  private calculateSignificance(
    baseline: PromptVersionEvaluation,
    challenger: PromptVersionEvaluation
  ): number {
    // 简化版：基于通过率差异计算
    const passRateDiff = Math.abs(challenger.passRate - baseline.passRate);
    const sampleSize = Math.min(baseline.testCases, challenger.testCases);

    // 样本量越大，通过率差异越大，p值越小
    if (sampleSize < 10) return 0.5; // 样本太小

    if (passRateDiff < 0.05) return 0.5; // 差异太小
    if (passRateDiff > 0.2) return 0.01; // 显著差异
    if (passRateDiff > 0.1) return 0.05; // 中等差异
    return 0.1;
  }

  /**
   * 计算平均值
   */
  private average(values: number[]): number {
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  }
}

/**
 * 评估报告生成器
 */
export class EvaluationReportGenerator {
  /**
   * 生成评估报告
   */
  generateReport(
    title: string,
    versionEvaluations: PromptVersionEvaluation[],
    abTestResults: ABTestResult[] = []
  ): EvaluationReport {
    const totalTestCases = versionEvaluations.reduce(
      (sum, e) => sum + e.testCases,
      0
    ) / versionEvaluations.length || 0;

    const passedTestCases = versionEvaluations.reduce(
      (sum, e) => sum + e.passedCount,
      0
    ) / versionEvaluations.length || 0;

    const averagePassRate = versionEvaluations.length > 0
      ? versionEvaluations.reduce((sum, e) => sum + e.passRate, 0) / versionEvaluations.length
      : 0;

    // 找出最佳表现版本
    const bestVersion = versionEvaluations.length > 0
      ? versionEvaluations.reduce((best, current) =>
          current.passRate > best.passRate ? current : best
        ).version
      : 'none';

    const summary: ReportSummary = {
      totalTestCases: Math.round(totalTestCases),
      passedTestCases: Math.round(passedTestCases),
      averagePassRate,
      bestPerformingVersion: bestVersion,
      recommendations: this.generateRecommendations(versionEvaluations, abTestResults),
      riskAssessment: this.assessRisk(versionEvaluations),
    };

    return {
      id: `report-${Date.now()}`,
      title,
      generatedAt: Date.now(),
      versionEvaluations,
      abTestResults,
      summary,
    };
  }

  /**
   * 生成建议
   */
  private generateRecommendations(
    evaluations: PromptVersionEvaluation[],
    abTests: ABTestResult[]
  ): string[] {
    const recommendations: string[] = [];

    // 基于 A/B 测试结果
    for (const test of abTests) {
      if (test.winner === 'challenger') {
        recommendations.push(
          `提示词版本 ${test.challengerVersion} 相比 ${test.baselineVersion} 有显著改进，建议考虑升级。`
        );
      } else if (test.winner === 'tie') {
        recommendations.push(
          `提示词版本 ${test.challengerVersion} 和 ${test.baselineVersion} 表现相当，可根据其他因素（如成本）选择。`
        );
      }
    }

    // 基于整体表现
    const avgPassRate = evaluations.reduce((sum, e) => sum + e.passRate, 0) / evaluations.length;
    if (avgPassRate < 0.7) {
      recommendations.push('整体通过率较低，建议优化提示词模板以提高准确性。');
    }

    // 检查延迟
    const avgLatency = evaluations.reduce(
      (sum, e) => sum + e.averageMetrics.latency,
      0
    ) / evaluations.length;
    if (avgLatency > 3000) {
      recommendations.push('平均响应时间较长，考虑优化提示词长度或使用更快的模型。');
    }

    // 检查 JSON 合规率
    const avgJsonCompliance = evaluations.reduce(
      (sum, e) => sum + e.averageMetrics.jsonComplianceRate,
      0
    ) / evaluations.length;
    if (avgJsonCompliance < 0.95) {
      recommendations.push('JSON 格式合规率不足，建议加强输出格式约束。');
    }

    return recommendations.length > 0
      ? recommendations
      : ['当前提示词表现良好，建议继续监控。'];
  }

  /**
   * 风险评估
   */
  private assessRisk(evaluations: PromptVersionEvaluation[]): RiskAssessment {
    const avgPassRate = evaluations.reduce((sum, e) => sum + e.passRate, 0) / evaluations.length;
    const minPassRate = evaluations.length > 0
      ? Math.min(...evaluations.map(e => e.passRate))
      : 0;

    const concerns: string[] = [];
    let level: 'low' | 'medium' | 'high' | 'critical' = 'low';

    if (avgPassRate < 0.5) {
      level = 'critical';
      concerns.push('平均通过率过低');
    } else if (avgPassRate < 0.7) {
      level = 'high';
      concerns.push('通过率需要改进');
    } else if (avgPassRate < 0.85) {
      level = 'medium';
    }

    if (minPassRate < 0.3) {
      concerns.push('存在表现极差的版本');
    }

    const descriptions: Record<string, string> = {
      low: '当前提示词系统风险可控，建议按计划迭代。',
      medium: '存在一些需要关注的问题，建议优先处理。',
      high: '多个关键指标未达标，需要立即改进。',
      critical: '提示词系统存在严重问题，建议暂停发布并修复。',
    };

    return {
      level,
      description: descriptions[level],
      concerns,
    };
  }
}

// ============ 导出单例 ============

export const promptEvaluator = new PromptEvaluator();
export const abTestFramework = new ABTestFramework();
export const evaluationReportGenerator = new EvaluationReportGenerator();
