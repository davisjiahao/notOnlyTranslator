/**
 * 提示词效果评估测试
 *
 * 测试 PromptEvaluator, ABTestFramework, EvaluationReportGenerator
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromptEvaluator,
  ABTestFramework,
  EvaluationReportGenerator,
  DEFAULT_EVALUATION_CONFIG,
  promptEvaluator,
  abTestFramework,
  evaluationReportGenerator,
  type EvaluationMetrics,
  type PromptVersionEvaluation,
  type TestCaseResult,
} from '@/shared/prompts/evaluation';
import type { PromptTestCase } from '@/shared/prompts/testCases';

describe('DEFAULT_EVALUATION_CONFIG', () => {
  it('should have default thresholds', () => {
    expect(DEFAULT_EVALUATION_CONFIG.precisionThreshold).toBe(0.7);
    expect(DEFAULT_EVALUATION_CONFIG.recallThreshold).toBe(0.7);
    expect(DEFAULT_EVALUATION_CONFIG.maxLatency).toBe(5000);
    expect(DEFAULT_EVALUATION_CONFIG.minJsonCompliance).toBe(0.95);
    expect(DEFAULT_EVALUATION_CONFIG.minTranslationQuality).toBe(7.0);
    expect(DEFAULT_EVALUATION_CONFIG.significanceThreshold).toBe(0.05);
  });
});

describe('PromptEvaluator', () => {
  let evaluator: PromptEvaluator;

  beforeEach(() => {
    evaluator = new PromptEvaluator();
  });

  // Helper: create a minimal test case
  function makeTestCase(words: Array<{
    original: string;
    shouldIdentifyForLevel: Record<string, boolean>;
    expectedDifficulty?: number;
  }>): PromptTestCase {
    return {
      id: 'test-001',
      name: 'Test Case',
      text: 'test text',
      difficulty: 'medium',
      domain: 'general',
      expectedWords: words.map(w => ({
        original: w.original,
        expectedTranslation: '测试翻译',
        expectedDifficulty: w.expectedDifficulty ?? 5,
        isPhrase: false,
        shouldIdentifyForLevel: w.shouldIdentifyForLevel,
      })),
      targetLevels: ['cet4'],
      tags: ['test'],
    };
  }

  describe('evaluateTestCase', () => {
    it('should return a TestCaseResult with all fields', () => {
      const testCase = makeTestCase([
        { original: 'hello', shouldIdentifyForLevel: { cet4: true } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [{ original: 'hello', translation: '你好', difficulty: 5 }] }),
        100,
        { input: 50, output: 30 },
        'v1.0',
        'cet4'
      );

      expect(result.testCaseId).toBe('test-001');
      expect(result.promptVersion).toBe('v1.0');
      expect(result.wordResults.length).toBeGreaterThan(0);
      expect(result.metrics).toBeDefined();
      expect(result.metrics.latency).toBe(100);
      expect(result.metrics.tokenUsage).toBe(80);
      expect(result.metrics.inputTokens).toBe(50);
      expect(result.metrics.outputTokens).toBe(30);
    });

    it('should correctly identify a word that should be identified', () => {
      const testCase = makeTestCase([
        { original: 'algorithm', shouldIdentifyForLevel: { cet4: true } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [{ original: 'algorithm', translation: '算法', difficulty: 6 }] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      const wordResult = result.wordResults.find(w => w.original === 'algorithm');
      expect(wordResult?.correctlyIdentified).toBe(true);
      expect(wordResult?.falsePositive).toBe(false);
      expect(wordResult?.falseNegative).toBe(false);
    });

    it('should flag false positive when word should NOT be identified but was', () => {
      const testCase = makeTestCase([
        { original: 'simple', shouldIdentifyForLevel: { cet4: false } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [{ original: 'simple', translation: '简单', difficulty: 3 }] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      const wordResult = result.wordResults.find(w => w.original === 'simple');
      expect(wordResult?.falsePositive).toBe(true);
      expect(wordResult?.correctlyIdentified).toBe(false);
    });

    it('should flag false negative when word should be identified but was not', () => {
      const testCase = makeTestCase([
        { original: 'complex', shouldIdentifyForLevel: { cet4: true } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      const wordResult = result.wordResults.find(w => w.original === 'complex');
      expect(wordResult?.falseNegative).toBe(true);
      expect(wordResult?.correctlyIdentified).toBe(false);
    });

    it('should detect parse error for invalid JSON string output', () => {
      const testCase = makeTestCase([]);

      const result = evaluator.evaluateTestCase(
        testCase,
        'not valid json',
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.hasParseError).toBe(true);
      expect(result.errorMessage).toBeDefined();
    });

    it('should not detect parse error for valid JSON', () => {
      const testCase = makeTestCase([]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.hasParseError).toBe(false);
      expect(result.errorMessage).toBeUndefined();
    });

    it('should handle object (non-string) raw output', () => {
      const testCase = makeTestCase([
        { original: 'word', shouldIdentifyForLevel: { cet4: true } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        { words: [{ original: 'word', translation: '单词', difficulty: 5 }] },
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.hasParseError).toBe(false);
      expect(result.wordResults.length).toBeGreaterThan(0);
    });
  });

  describe('calculateMetrics', () => {
    it('precision should be 1.0 when all identified words are correct', () => {
      const testCase = makeTestCase([
        { original: 'good', shouldIdentifyForLevel: { cet4: true } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [{ original: 'good', translation: '好', difficulty: 3 }] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.metrics.precision).toBe(1.0);
    });

    it('recall should be 0.0 when no expected words are identified', () => {
      const testCase = makeTestCase([
        { original: 'missed', shouldIdentifyForLevel: { cet4: true } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.metrics.recall).toBe(0.0);
    });

    it('f1Score should be 0 when precision and recall are 0', () => {
      const testCase = makeTestCase([
        { original: 'missed', shouldIdentifyForLevel: { cet4: true } },
      ]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.metrics.f1Score).toBe(0.0);
    });

    it('jsonComplianceRate should be 0 on parse error', () => {
      const testCase = makeTestCase([]);

      const result = evaluator.evaluateTestCase(
        testCase,
        'broken json',
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.metrics.jsonComplianceRate).toBe(0);
    });

    it('jsonComplianceRate should be 1 on valid JSON', () => {
      const testCase = makeTestCase([]);

      const result = evaluator.evaluateTestCase(
        testCase,
        JSON.stringify({ words: [] }),
        50,
        { input: 10, output: 5 },
        'v1.0',
        'cet4'
      );

      expect(result.metrics.jsonComplianceRate).toBe(1);
    });
  });

  describe('isPassing', () => {
    function makeMetrics(overrides: Partial<EvaluationMetrics>): EvaluationMetrics {
      return {
        precision: 0.8,
        recall: 0.8,
        f1Score: 0.8,
        latency: 1000,
        tokenUsage: 100,
        inputTokens: 60,
        outputTokens: 40,
        jsonComplianceRate: 1.0,
        translationQuality: 8.0,
        difficultyAccuracy: 8.0,
        ...overrides,
      };
    }

    it('should return true for metrics above thresholds', () => {
      expect(evaluator.isPassing(makeMetrics({}))).toBe(true);
    });

    it('should return false when precision below threshold', () => {
      expect(evaluator.isPassing(makeMetrics({ precision: 0.5 }))).toBe(false);
    });

    it('should return false when recall below threshold', () => {
      expect(evaluator.isPassing(makeMetrics({ recall: 0.5 }))).toBe(false);
    });

    it('should return false when latency exceeds max', () => {
      expect(evaluator.isPassing(makeMetrics({ latency: 10000 }))).toBe(false);
    });

    it('should return false when json compliance below threshold', () => {
      expect(evaluator.isPassing(makeMetrics({ jsonComplianceRate: 0.8 }))).toBe(false);
    });

    it('should return false when translation quality below threshold', () => {
      expect(evaluator.isPassing(makeMetrics({ translationQuality: 5.0 }))).toBe(false);
    });
  });

  describe('evaluateTestCases', () => {
    it('should calculate pass rate correctly', () => {
      const testCaseResults: TestCaseResult[] = [
        {
          testCaseId: '1',
          testCaseName: 'Passing',
          promptVersion: 'v1.0',
          timestamp: Date.now(),
          metrics: {
            precision: 0.9, recall: 0.9, f1Score: 0.9, latency: 500,
            tokenUsage: 50, inputTokens: 30, outputTokens: 20,
            jsonComplianceRate: 1.0, translationQuality: 9.0, difficultyAccuracy: 8.0,
          },
          wordResults: [],
          rawOutput: '{}',
          hasParseError: false,
        },
        {
          testCaseId: '2',
          testCaseName: 'Failing',
          promptVersion: 'v1.0',
          timestamp: Date.now(),
          metrics: {
            precision: 0.3, recall: 0.3, f1Score: 0.3, latency: 1000,
            tokenUsage: 50, inputTokens: 30, outputTokens: 20,
            jsonComplianceRate: 0.5, translationQuality: 4.0, difficultyAccuracy: 3.0,
          },
          wordResults: [],
          rawOutput: '{}',
          hasParseError: false,
        },
      ];

      const evaluation = evaluator.evaluateTestCases(testCaseResults, 'v1.0');

      expect(evaluation.version).toBe('v1.0');
      expect(evaluation.testCases).toBe(2);
      expect(evaluation.passedCount).toBe(1);
      expect(evaluation.passRate).toBe(0.5);
    });

    it('should return zero pass rate for empty array', () => {
      const evaluation = evaluator.evaluateTestCases([], 'v1.0');

      expect(evaluation.passRate).toBe(0);
      expect(evaluation.testCases).toBe(0);
    });

    it('should calculate average metrics', () => {
      const results: TestCaseResult[] = [
        {
          testCaseId: '1', testCaseName: 'A', promptVersion: 'v1.0', timestamp: Date.now(),
          metrics: { precision: 0.8, recall: 0.6, f1Score: 0.7, latency: 500, tokenUsage: 100, inputTokens: 60, outputTokens: 40, jsonComplianceRate: 1.0, translationQuality: 8.0, difficultyAccuracy: 7.0 },
          wordResults: [], rawOutput: '{}', hasParseError: false,
        },
        {
          testCaseId: '2', testCaseName: 'B', promptVersion: 'v1.0', timestamp: Date.now(),
          metrics: { precision: 0.6, recall: 0.4, f1Score: 0.5, latency: 1000, tokenUsage: 200, inputTokens: 120, outputTokens: 80, jsonComplianceRate: 0.8, translationQuality: 6.0, difficultyAccuracy: 5.0 },
          wordResults: [], rawOutput: '{}', hasParseError: false,
        },
      ];

      const evaluation = evaluator.evaluateTestCases(results, 'v1.0');

      expect(evaluation.averageMetrics.precision).toBeCloseTo(0.7);
      expect(evaluation.averageMetrics.recall).toBeCloseTo(0.5);
      expect(evaluation.averageMetrics.latency).toBe(750);
    });
  });
});

describe('ABTestFramework', () => {
  let framework: ABTestFramework;

  beforeEach(() => {
    framework = new ABTestFramework();
  });

  function makeEvaluation(version: string, passRate: number, precision: number): PromptVersionEvaluation {
    return {
      version,
      testCases: 20,
      passedCount: Math.round(passRate * 20),
      passRate,
      averageMetrics: {
        precision,
        recall: 0.8,
        f1Score: 0.75,
        latency: 1000,
        tokenUsage: 100,
        inputTokens: 60,
        outputTokens: 40,
        jsonComplianceRate: 1.0,
        translationQuality: 8.0,
        difficultyAccuracy: 7.0,
      },
      results: [],
      evaluatedAt: Date.now(),
      duration: 20000,
    };
  }

  describe('runABTest', () => {
    it('should declare challenger winner when significantly better across metrics', () => {
      const baseline = makeEvaluation('v1.0', 0.5, 0.5);
      baseline.averageMetrics = {
        ...baseline.averageMetrics,
        precision: 0.5, recall: 0.5, f1Score: 0.5, translationQuality: 5.0, difficultyAccuracy: 4.0,
      };
      const challenger = makeEvaluation('v2.0', 0.9, 0.9);
      challenger.averageMetrics = {
        ...challenger.averageMetrics,
        precision: 0.9, recall: 0.9, f1Score: 0.9, translationQuality: 9.0, difficultyAccuracy: 9.0,
      };

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);

      expect(result.winner).toBe('challenger');
      expect(result.baselineVersion).toBe('v1.0');
      expect(result.challengerVersion).toBe('v2.0');
    });

    it('should declare baseline winner when challenger degraded across metrics', () => {
      const baseline = makeEvaluation('v1.0', 0.9, 0.9);
      baseline.averageMetrics = {
        ...baseline.averageMetrics,
        precision: 0.9, recall: 0.9, f1Score: 0.9, translationQuality: 9.0, difficultyAccuracy: 9.0,
      };
      const challenger = makeEvaluation('v2.0', 0.4, 0.4);
      challenger.averageMetrics = {
        ...challenger.averageMetrics,
        precision: 0.3, recall: 0.3, f1Score: 0.3, translationQuality: 3.0, difficultyAccuracy: 3.0,
      };

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);

      expect(result.winner).toBe('baseline');
    });

    it('should declare tie when close performance', () => {
      const baseline = makeEvaluation('v1.0', 0.75, 0.75);
      const challenger = makeEvaluation('v2.0', 0.78, 0.78);

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);

      expect(result.winner).toBe('tie');
    });

    it('should include comparisons for key metrics', () => {
      const baseline = makeEvaluation('v1.0', 0.7, 0.7);
      const challenger = makeEvaluation('v2.0', 0.8, 0.8);

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);

      expect(result.comparisons.length).toBeGreaterThan(0);
      expect(result.comparisons.map(c => c.metric)).toContain('precision');
      expect(result.comparisons.map(c => c.metric)).toContain('recall');
      expect(result.comparisons.map(c => c.metric)).toContain('f1Score');
    });

    it('should calculate winning margin', () => {
      const baseline = makeEvaluation('v1.0', 0.6, 0.6);
      const challenger = makeEvaluation('v2.0', 0.9, 0.9);

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);

      expect(result.winningMargin).toBeGreaterThanOrEqual(0);
    });

    it('should return statistical significance', () => {
      const baseline = makeEvaluation('v1.0', 0.5, 0.5);
      const challenger = makeEvaluation('v2.0', 0.9, 0.9);

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);

      expect(result.statisticalSignificance).toBeGreaterThan(0);
      expect(result.statisticalSignificance).toBeLessThanOrEqual(1);
    });

    it('should return low significance for small sample size', () => {
      const smallBaseline = { ...makeEvaluation('v1.0', 0.5, 0.5), testCases: 5 };
      const smallChallenger = { ...makeEvaluation('v2.0', 0.9, 0.9), testCases: 5 };

      const result = framework.runABTest('v1.0', 'v2.0', smallBaseline, smallChallenger);

      expect(result.statisticalSignificance).toBe(0.5); // small sample
    });
  });

  describe('compareMetrics', () => {
    it('should mark precision as improved when higher', () => {
      const baseline = makeEvaluation('v1.0', 0.7, 0.6);
      const challenger = makeEvaluation('v2.0', 0.7, 0.8);

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);
      const precisionComparison = result.comparisons.find(c => c.metric === 'precision');

      expect(precisionComparison?.improved).toBe(true);
      expect(precisionComparison?.difference).toBeGreaterThan(0);
    });

    it('should mark recall as degraded when lower', () => {
      const baseline = makeEvaluation('v1.0', 0.7, 0.7);
      baseline.averageMetrics.recall = 0.8;
      const challenger = makeEvaluation('v2.0', 0.7, 0.7);
      challenger.averageMetrics.recall = 0.4;

      const result = framework.runABTest('v1.0', 'v2.0', baseline, challenger);
      const recallComparison = result.comparisons.find(c => c.metric === 'recall');

      expect(recallComparison?.improved).toBe(false);
      expect(recallComparison?.difference).toBeLessThan(0);
    });
  });
});

describe('EvaluationReportGenerator', () => {
  let generator: EvaluationReportGenerator;

  beforeEach(() => {
    generator = new EvaluationReportGenerator();
  });

  function makeEvaluation(version: string, passRate: number): PromptVersionEvaluation {
    return {
      version,
      testCases: 10,
      passedCount: Math.round(passRate * 10),
      passRate,
      averageMetrics: {
        precision: 0.8, recall: 0.8, f1Score: 0.8, latency: 1000,
        tokenUsage: 100, inputTokens: 60, outputTokens: 40,
        jsonComplianceRate: 0.98, translationQuality: 8.0, difficultyAccuracy: 7.0,
      },
      results: [],
      evaluatedAt: Date.now(),
      duration: 10000,
    };
  }

  describe('generateReport', () => {
    it('should return a report with all required fields', () => {
      const evaluations = [makeEvaluation('v1.0', 0.8)];
      const report = generator.generateReport('Test Report', evaluations);

      expect(report.id).toBeDefined();
      expect(report.title).toBe('Test Report');
      expect(report.generatedAt).toBeDefined();
      expect(report.versionEvaluations).toHaveLength(1);
      expect(report.abTestResults).toEqual([]);
      expect(report.summary).toBeDefined();
    });

    it('should calculate summary statistics', () => {
      const evaluations = [
        makeEvaluation('v1.0', 0.8),
        makeEvaluation('v2.0', 0.6),
      ];

      const report = generator.generateReport('Comparison Report', evaluations);

      expect(report.summary.averagePassRate).toBeCloseTo(0.7);
      expect(report.summary.bestPerformingVersion).toBe('v1.0');
    });

    it('should include A/B test results when provided', () => {
      const evaluations = [makeEvaluation('v1.0', 0.8)];
      const abResults = [
        {
          id: 'ab-1',
          baselineVersion: 'v1.0',
          challengerVersion: 'v2.0',
          baselineResult: makeEvaluation('v1.0', 0.7),
          challengerResult: makeEvaluation('v2.0', 0.8),
          comparisons: [],
          winner: 'challenger' as const,
          winningMargin: 14.3,
          statisticalSignificance: 0.01,
          testedAt: Date.now(),
        },
      ];

      const report = generator.generateReport('AB Report', evaluations, abResults);

      expect(report.abTestResults).toHaveLength(1);
    });

    it('should generate recommendations for low pass rate', () => {
      const evaluations = [makeEvaluation('v1.0', 0.5)];
      const report = generator.generateReport('Low Quality Report', evaluations);

      expect(report.summary.recommendations.some(r => r.includes('通过率'))).toBe(true);
    });

    it('should generate recommendations for high latency', () => {
      const evaluations = [{
        ...makeEvaluation('v1.0', 0.8),
        averageMetrics: {
          ...makeEvaluation('v1.0', 0.8).averageMetrics,
          latency: 4000,
        },
      }];
      const report = generator.generateReport('Slow Report', evaluations);

      expect(report.summary.recommendations.some(r => r.includes('响应时间'))).toBe(true);
    });

    it('should generate recommendations for low JSON compliance', () => {
      const evaluations = [{
        ...makeEvaluation('v1.0', 0.8),
        averageMetrics: {
          ...makeEvaluation('v1.0', 0.8).averageMetrics,
          jsonComplianceRate: 0.8,
        },
      }];
      const report = generator.generateReport('Compliance Report', evaluations);

      expect(report.summary.recommendations.some(r => r.includes('JSON'))).toBe(true);
    });

    it('should recommend upgrading when challenger wins', () => {
      const evaluations = [makeEvaluation('v1.0', 0.8), makeEvaluation('v2.0', 0.9)];
      const abResults = [
        {
          id: 'ab-1',
          baselineVersion: 'v1.0',
          challengerVersion: 'v2.0',
          baselineResult: makeEvaluation('v1.0', 0.8),
          challengerResult: makeEvaluation('v2.0', 0.9),
          comparisons: [],
          winner: 'challenger' as const,
          winningMargin: 12.5,
          statisticalSignificance: 0.01,
          testedAt: Date.now(),
        },
      ];

      const report = generator.generateReport('Upgrade Report', evaluations, abResults);

      expect(report.summary.recommendations.some(r => r.includes('升级'))).toBe(true);
    });

    it('should return positive message when everything looks good', () => {
      const evaluations = [makeEvaluation('v1.0', 0.95)];
      const report = generator.generateReport('Good Report', evaluations);

      expect(report.summary.recommendations.some(r => r.includes('表现良好'))).toBe(true);
    });
  });

  describe('assessRisk', () => {
    it('should return low risk for high pass rates', () => {
      const evaluations = [makeEvaluation('v1.0', 0.9)];
      const report = generator.generateReport('Low Risk', evaluations);

      expect(report.summary.riskAssessment.level).toBe('low');
    });

    it('should return medium risk for moderate pass rates', () => {
      const evaluations = [makeEvaluation('v1.0', 0.8)];
      const report = generator.generateReport('Medium Risk', evaluations);

      expect(report.summary.riskAssessment.level).toBe('medium');
    });

    it('should return high risk for low pass rates', () => {
      const evaluations = [makeEvaluation('v1.0', 0.6)];
      const report = generator.generateReport('High Risk', evaluations);

      expect(report.summary.riskAssessment.level).toBe('high');
    });

    it('should return critical risk for very low pass rates', () => {
      const evaluations = [makeEvaluation('v1.0', 0.3)];
      const report = generator.generateReport('Critical Risk', evaluations);

      expect(report.summary.riskAssessment.level).toBe('critical');
    });

    it('should flag extremely low performing versions', () => {
      const evaluations = [
        makeEvaluation('v1.0', 0.9),
        makeEvaluation('v2.0', 0.1),
      ];
      const report = generator.generateReport('Risk Report', evaluations);

      expect(report.summary.riskAssessment.concerns.some(c => c.includes('极差'))).toBe(true);
    });
  });
});

describe('Singleton exports', () => {
  it('promptEvaluator should be a PromptEvaluator instance', () => {
    expect(promptEvaluator).toBeInstanceOf(PromptEvaluator);
  });

  it('abTestFramework should be an ABTestFramework instance', () => {
    expect(abTestFramework).toBeInstanceOf(ABTestFramework);
  });

  it('evaluationReportGenerator should be an EvaluationReportGenerator instance', () => {
    expect(evaluationReportGenerator).toBeInstanceOf(EvaluationReportGenerator);
  });
});
