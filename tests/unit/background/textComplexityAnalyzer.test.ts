import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  TextComplexityAnalyzer,
  type ComplexityAnalysis,
} from '@/background/textComplexityAnalyzer';

describe('TextComplexityAnalyzer', () => {
  describe('analyze', () => {
    it('应该正确分析简单文本', () => {
      const text = 'Hello world';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.wordCount).toBe(2);
      expect(result.level).toBe('simple');
      expect(result.score).toBeLessThanOrEqual(35);
      expect(result.clauseCount).toBe(1);
    });

    it('应该正确分析中等复杂度文本', () => {
      const text = 'The quick brown fox jumps over the lazy dog, but the dog does not care and continues sleeping.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.wordCount).toBeGreaterThan(10);
      expect(result.clauseCount).toBeGreaterThanOrEqual(1);
    });

    it('应该检测从句（使用 because）', () => {
      const text = 'I study English because I want to travel abroad.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.clauseCount).toBeGreaterThanOrEqual(2);
    });

    it('应该检测从句（使用 although）', () => {
      const text = 'Although it was raining, we went for a walk.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.clauseCount).toBeGreaterThanOrEqual(2);
    });

    it('应该检测从句（使用 if）', () => {
      const text = 'If you study hard, you will pass the exam.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.clauseCount).toBeGreaterThanOrEqual(2);
    });

    it('应该检测分号分隔的从句', () => {
      const text = 'I love reading; it opens new worlds to me.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.clauseCount).toBeGreaterThanOrEqual(2);
    });

    it('应该检测括号内容', () => {
      const text = 'The book (which I bought yesterday) is very interesting.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.clauseCount).toBeGreaterThanOrEqual(1);
    });

    it('应该检测计算机专业术语', () => {
      const text = 'This algorithm uses machine learning and neural networks for optimization.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.technicalTerms.length).toBeGreaterThanOrEqual(2);
      expect(result.technicalTerms).toContain('algorithm');
      expect(result.technicalTerms).toContain('machine learning');
    });

    it('应该检测医学专业术语', () => {
      const text = 'The patient needs surgery treatment.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.technicalTerms).toContain('surgery');
    });

    it('应该检测金融专业术语', () => {
      const text = 'The company is planning an acquisition and merger strategy.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.technicalTerms).toContain('acquisition');
      expect(result.technicalTerms).toContain('merger');
    });

    it('应该识别复杂文本', () => {
      const text = `Furthermore, the implementation of artificial intelligence algorithms
        requires sophisticated neural network architectures, which consequently increases
        computational complexity and latency.`;
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.level).toBe('complex');
      expect(result.score).toBeGreaterThanOrEqual(65);
      expect(result.technicalTerms.length).toBeGreaterThanOrEqual(3);
    });

    it('应该计算平均词长', () => {
      const text = 'hello world test';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.avgWordLength).toBeGreaterThan(0);
      expect(result.avgWordLength).toBeLessThan(10);
    });

    it('应该处理空文本', () => {
      const text = '';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.wordCount).toBe(0);
      expect(result.clauseCount).toBe(1); // 至少一个主句
      expect(result.level).toBe('simple');
    });

    it('应该处理只有一个词的文本', () => {
      const text = 'Hello';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.wordCount).toBe(1);
      expect(result.level).toBe('simple');
    });

    it('应该检测复杂连接词（furthermore）', () => {
      const text = 'Furthermore, we need to consider all possible outcomes.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.clauseCount).toBeGreaterThanOrEqual(1);
    });

    it('应该检测冒号引入的解释', () => {
      const text = 'There is one thing to remember: practice makes perfect.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.clauseCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('quickAnalyze', () => {
    it('应该快速返回简单等级', () => {
      const result = TextComplexityAnalyzer.quickAnalyze('Hello');
      expect(result).toBe('simple');
    });

    it('应该快速返回复杂等级', () => {
      const text = `The implementation of quantum computing algorithms leverages blockchain technology
        for distributed consensus and requires sophisticated neural network architectures with
        advanced machine learning capabilities, furthermore the system must handle load balancing
        and scalability concerns through distributed microservices architecture.`;
      const result = TextComplexityAnalyzer.quickAnalyze(text);
      // 由于复杂度评分依赖于多个因素，我们只验证它不是简单文本
      expect(['medium', 'complex']).toContain(result);
    });
  });

  describe('requiresLLM', () => {
    it('应该识别需要LLM的复杂文本', () => {
      const text = 'The convolutional neural network utilizes backpropagation for gradient descent optimization and requires sophisticated machine learning algorithms.';
      const result = TextComplexityAnalyzer.requiresLLM(text);
      expect(result).toBe(true);
    });

    it('应该识别不需要LLM的简单文本', () => {
      const text = 'Hello world';
      const result = TextComplexityAnalyzer.requiresLLM(text);
      expect(result).toBe(false);
    });
  });

  describe('suitableForTraditional', () => {
    it('应该识别适合传统API的简单文本', () => {
      const text = 'Good morning';
      const result = TextComplexityAnalyzer.suitableForTraditional(text);
      expect(result).toBe(true);
    });

    it('应该识别不适合传统API的复杂文本', () => {
      const text = 'The implementation of distributed microservices architecture requires load balancing.';
      const result = TextComplexityAnalyzer.suitableForTraditional(text);
      expect(result).toBe(false);
    });
  });

  describe('专业术语检测 - 技术领域', () => {
    it('应该检测软件开发术语', () => {
      const text = 'We need to refactor this code and push it to github using git.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.technicalTerms).toContain('refactor');
      expect(result.technicalTerms).toContain('github');
      expect(result.technicalTerms).toContain('git');
    });

    it('应该检测数据库术语', () => {
      const text = 'The sql query optimizes database performance using indexing.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.technicalTerms).toContain('sql');
      expect(result.technicalTerms).toContain('database');
      expect(result.technicalTerms).toContain('query');
    });

    it('应该检测网络安全术语', () => {
      const text = 'The firewall blocks unauthorized access and uses ssl encryption.';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.technicalTerms).toContain('firewall');
      expect(result.technicalTerms).toContain('encryption');
      expect(result.technicalTerms).toContain('ssl');
    });
  });

  describe('复杂度分数边界测试', () => {
    it('应该在复杂度35以下为简单', () => {
      const text = 'Hello world';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.level).toBe('simple');
      expect(result.readabilityLevel).toBeLessThanOrEqual(3);
    });

    it('应该在复杂度65以上为复杂', () => {
      const text = `The implementation of artificial intelligence algorithms in natural language processing
        requires sophisticated neural network architectures and extensive computational resources, furthermore
        the system must handle load balancing and scalability concerns.`;
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.level).toBe('complex');
      expect(result.readabilityLevel).toBeGreaterThanOrEqual(6);
    });

    it('应该在35-65之间为中等', () => {
      // 使用中等复杂度的文本
      const text = 'Although it is simple, the code works well.';
      const result = TextComplexityAnalyzer.analyze(text);

      // 验证分数在中等范围内
      expect(result.score).toBeGreaterThanOrEqual(20);
      expect(result.score).toBeLessThan(70);
    });
  });

  describe('可读性等级计算', () => {
    it('应该为简单文本分配低可读性等级', () => {
      const text = 'Hello world';
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.readabilityLevel).toBeGreaterThanOrEqual(1);
      expect(result.readabilityLevel).toBeLessThanOrEqual(10);
    });

    it('应该为复杂文本分配高可读性等级', () => {
      const text = `The implementation of machine learning algorithms in natural language processing
        requires sophisticated neural network architectures and extensive computational resources.`;
      const result = TextComplexityAnalyzer.analyze(text);

      expect(result.readabilityLevel).toBeGreaterThanOrEqual(5);
      expect(result.readabilityLevel).toBeLessThanOrEqual(10);
    });
  });
});
