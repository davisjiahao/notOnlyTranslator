import { describe, it, expect, beforeEach } from 'vitest';
import {
  PromptEvaluator,
  ABTestFramework,
  EvaluationReportGenerator,
  DEFAULT_EVALUATION_CONFIG,
  type EvaluationConfig,
  type TestCaseResult,
  type PromptVersionEvaluation,
} from '@/shared/prompts/evaluation';
import type { PromptTestCase } from '@/shared/prompts/testCases';

describe('Prompt Evaluation System', () => {
  describe('PromptEvaluator', () => {
    let evaluator: PromptEvaluator;

    beforeEach(() => {
      evaluator = new PromptEvaluator();
    });

    describe('constructor', () => {
      it('should use default config when no config provided', () => {
        const defaultEvaluator = new PromptEvaluator();
        expect(defaultEvaluator).toBeDefined();
      });

      it('should merge custom config with defaults', () => {
        const customConfig: Partial<EvaluationConfig> = {
          precisionThreshold: 0.8,
          maxLatency: 3000,
        };
        const customEvaluator = new PromptEvaluator(customConfig);
        expect(customEvaluator).toBeDefined();
      });
    });

    describe('evaluateTestCase', () => {
      const mockTestCase: PromptTestCase = {
        id: 'test-001',
        name: '测试用例1',
        text: 'The algorithm analyzes data efficiently.',
        difficulty: 'medium',
        domain: 'technology',
        expectedWords: [
          {
            original: 'algorithm',
            expectedTranslation: '算法',
            expectedDifficulty: 6,
            isPhrase: false,
            shouldIdentifyForLevel: { cet4: true, cet6: false },
          },
        ],
        targetLevels: ['cet4', 'cet6'],
        tags: ['test'],
      };

      const mockOutput = {
        fullText: '该算法高效地分析数据。',
        words: [
          { original: 'algorithm', translation: '算法', difficulty: 6 },
        ],
      };

      it('should evaluate test case and return result', () => {
        const result = evaluator.evaluateTestCase(
          mockTestCase,
          mockOutput,
          1500,
          { input: 100, output: 50 },
          'v1.0.0',
          'cet4'
        );

        expect(result).toBeDefined();
        expect(result.testCaseId).toBe('test-001');
        expect(result.promptVersion).toBe('v1.0.0');
        expect(result.metrics).toBeDefined();
        expect(result.wordResults).toBeDefined();
      });

      it('should calculate precision correctly', () => {
        const result = evaluator.evaluateTestCase(
          mockTestCase,
          mockOutput,
          1500,
          { input: 100, output: 50 },
          'v1.0.0',
          'cet4'
        );

        expect(result.metrics.precision).toBeGreaterThanOrEqual(0);
        expect(result.metrics.precision).toBeLessThanOrEqual(1);
      });

      it('should calculate recall correctly', () => {
        const result = evaluator.evaluateTestCase(
          mockTestCase,
          mockOutput,
          1500,
          { input: 100, output: 50 },
          'v1.0.0',
          'cet4'
        );

        expect(result.metrics.recall).toBeGreaterThanOrEqual(0);
        expect(result.metrics.recall).toBeLessThanOrEqual(1);
      });

      it('should handle string output', () => {
        const stringOutput = JSON.stringify(mockOutput);
        const result = evaluator.evaluateTestCase(
          mockTestCase,
          stringOutput,
          1500,
          { input: 100, output: 50 },
          'v1.0.0',
          'cet4'
        );

        expect(result).toBeDefined();
        expect(result.hasParseError).toBe(false);
      });

      it('should handle invalid JSON string', () => {
        const invalidOutput = 'not valid json';
        const result = evaluator.evaluateTestCase(
          mockTestCase,
          invalidOutput,
          1500,
          { input: 100, output: 50 },
          'v1.0.0',
          'cet4'
        );

        expect(result.hasParseError).toBe(true);
        expect(result.errorMessage).toBeDefined();
        expect(result.metrics.jsonComplianceRate).toBe(0);
      });

      it('should track latency', () => {
        const result = evaluator.evaluateTestCase(
          mockTestCase,
          mockOutput,
          2500,
          { input: 100, output: 50 },
          'v1.0.0',
          'cet4'
        );

        expect(result.metrics.latency).toBe(2500);
      });

      it('should track token usage', () => {
        const result = evaluator.evaluateTestCase(
          mockTestCase,
          mockOutput,
          1500,
          { input: 100, output: 50 },
          'v1.0.0',
          'cet4'
        );

        expect(result.metrics.tokenUsage).toBe(150);
        expect(result.metrics.inputTokens).toBe(100);
        expect(result.metrics.outputTokens).toBe(50);
      });
    });

    describe('isPassing', () => {
      it('should return true for passing metrics', () => {
        const passingMetrics = {
          precision: 0.8,
          recall: 0.8,
          f1Score: 0.8,
          latency: 3000,
          tokenUsage: 100,
          inputTokens: 50,
          outputTokens: 50,
          jsonComplianceRate: 1,
          translationQuality: 8,
          difficultyAccuracy: 8,
        };

        expect(evaluator.isPassing(passingMetrics)).toBe(true);
      });

      it('should return false for failing precision', () => {
        const failingMetrics = {
          precision: 0.5,
          recall: 0.8,
          f1Score: 0.6,
          latency: 3000,
          tokenUsage: 100,
          inputTokens: 50,
          outputTokens: 50,
          jsonComplianceRate: 1,
          translationQuality: 8,
          difficultyAccuracy: 8,
        };

        expect(evaluator.isPassing(failingMetrics)).toBe(false);
      });

      it('should return false for excessive latency', () => {
        const slowMetrics = {
          precision: 0.8,
          recall: 0.8,
          f1Score: 0.8,
          latency: 6000,
          tokenUsage: 100,
          inputTokens: 50,
          outputTokens: 50,
          jsonComplianceRate: 1,
          translationQuality: 8,
          difficultyAccuracy: 8,
        };

        expect(evaluator.isPassing(slowMetrics)).toBe(false);
      });

      it('should return false for low JSON compliance', () => {
        const nonCompliantMetrics = {
          precision: 0.8,
          recall: 0.8,
          f1Score: 0.8,
          latency: 3000,
          tokenUsage: 100,
          inputTokens: 50,
          outputTokens: 50,
          jsonComplianceRate: 0.9,
          translationQuality: 8,
          difficultyAccuracy: 8,
        };

        expect(evaluator.isPassing(nonCompliantMetrics)).toBe(false);
      });
    });

    describe('evaluateTestCases', () => {
      const mockResults: TestCaseResult[] = [
        {
          testCaseId: 'test-001',
          testCaseName: 'Test 1',
          promptVersion: 'v1.0.0',
          timestamp: Date.now(),
          metrics: {
            precision: 0.8,
            recall: 0.75,
            f1Score: 0.775,
            latency: 1500,
            tokenUsage: 150,
            inputTokens: 100,
            outputTokens: 50,
            jsonComplianceRate: 1,
            translationQuality: 8,
            difficultyAccuracy: 7,
          },
          wordResults: [],
          rawOutput: {},
          hasParseError: false,
        },
        {
          testCaseId: 'test-002',
          testCaseName: 'Test 2',
          promptVersion: 'v1.0.0',
          timestamp: Date.now(),
          metrics: {
            precision: 0.7,
            recall: 0.8,
            f1Score: 0.75,
            latency: 2000,
            tokenUsage: 180,
            inputTokens: 120,
            outputTokens: 60,
            jsonComplianceRate: 1,
            translationQuality: 7.5,
            difficultyAccuracy: 8,
          },
          wordResults: [],
          rawOutput: {},
          hasParseError: false,
        },
      ];

      it('should aggregate test case results', () => {
        const evaluation = evaluator.evaluateTestCases(mockResults, 'v1.0.0');

        expect(evaluation).toBeDefined();
        expect(evaluation.version).toBe('v1.0.0');
        expect(evaluation.testCases).toBe(2);
        expect(evaluation.averageMetrics).toBeDefined();
      });

      it('should calculate average metrics', () => {
        const evaluation = evaluator.evaluateTestCases(mockResults, 'v1.0.0');

        expect(evaluation.averageMetrics.precision).toBe(0.75);
        expect(evaluation.averageMetrics.recall).toBe(0.775);
        expect(evaluation.averageMetrics.latency).toBe(1750);
      });

      it('should calculate pass rate', () => {
        const evaluation = evaluator.evaluateTestCases(mockResults, 'v1.0.0');

        expect(evaluation.passRate).toBeGreaterThanOrEqual(0);
        expect(evaluation.passRate).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('ABTestFramework', () => {
    let framework: ABTestFramework;

    beforeEach(() => {
      framework = new ABTestFramework(new PromptEvaluator());
    });

    describe('runABTest', () => {
      const mockBaselineResult: PromptVersionEvaluation = {
        version: 'v1.0.0',
        testCases: 10,
        passedCount: 7,
        passRate: 0.7,
        averageMetrics: {
          precision: 0.7,
          recall: 0.65,
          f1Score: 0.675,
          latency: 2000,
          tokenUsage: 150,
          inputTokens: 100,
          outputTokens: 50,
          jsonComplianceRate: 0.95,
          translationQuality: 7,
          difficultyAccuracy: 6.5,
        },
        results: [],
        evaluatedAt: Date.now(),
        duration: 20000,
      };

      const mockChallengerResult: PromptVersionEvaluation = {
        version: 'v2.0.0',
        testCases: 10,
        passedCount: 8,
        passRate: 0.8,
        averageMetrics: {
          precision: 0.8,
          recall: 0.75,
          f1Score: 0.775,
          latency: 1800,
          tokenUsage: 140,
          inputTokens: 90,
          outputTokens: 50,
          jsonComplianceRate: 0.98,
          translationQuality: 7.5,
          difficultyAccuracy: 7,
        },
        results: [],
        evaluatedAt: Date.now(),
        duration: 18000,
      };

      it('should compare two versions and return AB test result', () => {
        const result = framework.runABTest(
          'v1.0.0',
          'v2.0.0',
          mockBaselineResult,
          mockChallengerResult
        );

        expect(result).toBeDefined();
        expect(result.baselineVersion).toBe('v1.0.0');
        expect(result.challengerVersion).toBe('v2.0.0');
        expect(result.comparisons).toBeDefined();
        expect(result.comparisons.length).toBeGreaterThan(0);
      });

      it('should identify challenger as winner when improved', () => {
        const result = framework.runABTest(
          'v1.0.0',
          'v2.0.0',
          mockBaselineResult,
          mockChallengerResult
        );

        expect(result.winner).toBe('challenger');
      });

      it('should include metric comparisons', () => {
        const result = framework.runABTest(
          'v1.0.0',
          'v2.0.0',
          mockBaselineResult,
          mockChallengerResult
        );

        const precisionComparison = result.comparisons.find(c => c.metric === 'precision');
        expect(precisionComparison).toBeDefined();
        expect(precisionComparison?.improved).toBe(true);
        expect(precisionComparison?.difference).toBeGreaterThan(0);
      });

      it('should calculate statistical significance', () => {
        const result = framework.runABTest(
          'v1.0.0',
          'v2.0.0',
          mockBaselineResult,
          mockChallengerResult
        );

        expect(result.statisticalSignificance).toBeGreaterThanOrEqual(0);
        expect(result.statisticalSignificance).toBeLessThanOrEqual(1);
      });

      it('should identify degraded challenger as not winner', () => {
        const degradedResult: PromptVersionEvaluation = {
          ...mockChallengerResult,
          averageMetrics: {
            ...mockChallengerResult.averageMetrics,
            precision: 0.3,
            recall: 0.3,
            f1Score: 0.3,
          },
        };

        const result = framework.runABTest(
          'v1.0.0',
          'v2.0.0',
          mockBaselineResult,
          degradedResult
        );

        // 当 challenger 表现明显差时，应该不是 challenger 赢
        expect(result.winner).not.toBe('challenger');
      });

      it('should handle tie when similar performance', () => {
        const similarResult: PromptVersionEvaluation = {
          ...mockBaselineResult,
          averageMetrics: {
            ...mockBaselineResult.averageMetrics,
          },
        };

        const result = framework.runABTest(
          'v1.0.0',
          'v2.0.0',
          mockBaselineResult,
          similarResult
        );

        expect(result.winner).toBe('tie');
      });
    });
  });

  describe('EvaluationReportGenerator', () => {
    let generator: EvaluationReportGenerator;

    beforeEach(() => {
      generator = new EvaluationReportGenerator();
    });

    describe('generateReport', () => {
      const mockEvaluations: PromptVersionEvaluation[] = [
        {
          version: 'v1.0.0',
          testCases: 10,
          passedCount: 7,
          passRate: 0.7,
          averageMetrics: {
            precision: 0.7,
            recall: 0.65,
            f1Score: 0.675,
            latency: 2000,
            tokenUsage: 150,
            inputTokens: 100,
            outputTokens: 50,
            jsonComplianceRate: 0.95,
            translationQuality: 7,
            difficultyAccuracy: 6.5,
          },
          results: [],
          evaluatedAt: Date.now(),
          duration: 20000,
        },
        {
          version: 'v2.0.0',
          testCases: 10,
          passedCount: 8,
          passRate: 0.8,
          averageMetrics: {
            precision: 0.8,
            recall: 0.75,
            f1Score: 0.775,
            latency: 1800,
            tokenUsage: 140,
            inputTokens: 90,
            outputTokens: 50,
            jsonComplianceRate: 0.98,
            translationQuality: 7.5,
            difficultyAccuracy: 7,
          },
          results: [],
          evaluatedAt: Date.now(),
          duration: 18000,
        },
      ];

      it('should generate complete report', () => {
        const report = generator.generateReport('测试报告', mockEvaluations);

        expect(report).toBeDefined();
        expect(report.id).toBeDefined();
        expect(report.title).toBe('测试报告');
        expect(report.generatedAt).toBeDefined();
        expect(report.versionEvaluations).toHaveLength(2);
        expect(report.summary).toBeDefined();
      });

      it('should identify best performing version', () => {
        const report = generator.generateReport('测试报告', mockEvaluations);

        expect(report.summary.bestPerformingVersion).toBe('v2.0.0');
      });

      it('should calculate average pass rate', () => {
        const report = generator.generateReport('测试报告', mockEvaluations);

        expect(report.summary.averagePassRate).toBe(0.75);
      });

      it('should generate recommendations', () => {
        const report = generator.generateReport('测试报告', mockEvaluations);

        expect(report.summary.recommendations).toBeDefined();
        expect(report.summary.recommendations.length).toBeGreaterThan(0);
      });

      it('should assess risk', () => {
        const report = generator.generateReport('测试报告', mockEvaluations);

        expect(report.summary.riskAssessment).toBeDefined();
        expect(report.summary.riskAssessment.level).toBeDefined();
        expect(report.summary.riskAssessment.description).toBeDefined();
      });

      it('should handle empty evaluations', () => {
        const report = generator.generateReport('空报告', []);

        expect(report).toBeDefined();
        expect(report.summary.bestPerformingVersion).toBe('none');
        expect(report.summary.averagePassRate).toBe(0);
      });
    });

    describe('risk assessment', () => {
      it('should assess critical risk for very low pass rate', () => {
        const lowPassEvaluations: PromptVersionEvaluation[] = [
          {
            version: 'v1.0.0',
            testCases: 10,
            passedCount: 3,
            passRate: 0.3,
            averageMetrics: {
              precision: 0.3,
              recall: 0.3,
              f1Score: 0.3,
              latency: 2000,
              tokenUsage: 150,
              inputTokens: 100,
              outputTokens: 50,
              jsonComplianceRate: 0.9,
              translationQuality: 5,
              difficultyAccuracy: 5,
            },
            results: [],
            evaluatedAt: Date.now(),
            duration: 20000,
          },
        ];

        const report = generator.generateReport('风险报告', lowPassEvaluations);

        expect(report.summary.riskAssessment.level).toBe('critical');
      });

      it('should assess high risk for low pass rate', () => {
        const mediumPassEvaluations: PromptVersionEvaluation[] = [
          {
            version: 'v1.0.0',
            testCases: 10,
            passedCount: 5,
            passRate: 0.5,
            averageMetrics: {
              precision: 0.5,
              recall: 0.5,
              f1Score: 0.5,
              latency: 2000,
              tokenUsage: 150,
              inputTokens: 100,
              outputTokens: 50,
              jsonComplianceRate: 0.92,
              translationQuality: 5.5,
              difficultyAccuracy: 5,
            },
            results: [],
            evaluatedAt: Date.now(),
            duration: 20000,
          },
        ];

        const report = generator.generateReport('风险报告', mediumPassEvaluations);

        expect(report.summary.riskAssessment.level).toBe('high');
      });

      it('should assess low risk for good pass rate', () => {
        const goodPassEvaluations: PromptVersionEvaluation[] = [
          {
            version: 'v1.0.0',
            testCases: 10,
            passedCount: 9,
            passRate: 0.9,
            averageMetrics: {
              precision: 0.9,
              recall: 0.9,
              f1Score: 0.9,
              latency: 2000,
              tokenUsage: 150,
              inputTokens: 100,
              outputTokens: 50,
              jsonComplianceRate: 0.98,
              translationQuality: 8.5,
              difficultyAccuracy: 8,
            },
            results: [],
            evaluatedAt: Date.now(),
            duration: 20000,
          },
        ];

        const report = generator.generateReport('风险报告', goodPassEvaluations);

        expect(report.summary.riskAssessment.level).toBe('low');
      });
    });
  });

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
});
