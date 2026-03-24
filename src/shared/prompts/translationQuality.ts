/**
 * 翻译质量评估模块
 *
 * 提供翻译结果的自动化质量评估功能
 */

/**
 * 翻译质量评估结果
 */
export interface TranslationQualityResult {
  /** 整体质量分数 (0-100) */
  overallScore: number;
  /** 准确度分数 (0-100) */
  accuracyScore: number;
  /** 流畅度分数 (0-100) */
  fluencyScore: number;
  /** 上下文相关性分数 (0-100) */
  contextScore: number;
  /** 是否为高质量翻译 (overallScore >= 80) */
  isHighQuality: boolean;
  /** 评估详情 */
  details: {
    /** 源文本长度 */
    sourceLength: number;
    /** 目标文本长度 */
    targetLength: number;
    /** 长度比 (目标/源) */
    lengthRatio: number;
    /** 是否检测到术语 */
    hasTerminology: boolean;
    /** 是否检测到数字 */
    hasNumbers: boolean;
    /** 数字保留正确 */
    numbersPreserved: boolean;
  };
  /** 问题列表 */
  issues: QualityIssue[];
}

/**
 * 质量问题
 */
export interface QualityIssue {
  type: 'accuracy' | 'fluency' | 'context' | 'terminology' | 'formatting';
  severity: 'low' | 'medium' | 'high';
  description: string;
  suggestion?: string;
}

/**
 * 翻译质量评估器配置
 */
export interface QualityEvaluatorConfig {
  /** 最小长度比 (目标/源) */
  minLengthRatio: number;
  /** 最大长度比 (目标/源) */
  maxLengthRatio: number;
  /** 高质量阈值 */
  highQualityThreshold: number;
  /** 是否启用术语检查 */
  enableTerminologyCheck: boolean;
  /** 是否启用数字检查 */
  enableNumberCheck: boolean;
}

/** 默认配置 */
export const DEFAULT_QUALITY_CONFIG: QualityEvaluatorConfig = {
  minLengthRatio: 0.3,
  maxLengthRatio: 3.0,
  highQualityThreshold: 80,
  enableTerminologyCheck: true,
  enableNumberCheck: true,
};

/**
 * 翻译质量评估器
 */
export class TranslationQualityEvaluator {
  private config: QualityEvaluatorConfig;

  constructor(config: Partial<QualityEvaluatorConfig> = {}) {
    this.config = { ...DEFAULT_QUALITY_CONFIG, ...config };
  }

  /**
   * 评估翻译质量
   */
  evaluate(
    sourceText: string,
    targetText: string,
    context?: string
  ): TranslationQualityResult {
    const issues: QualityIssue[] = [];
    const sourceLength = sourceText.length;
    const targetLength = targetText.length;
    const lengthRatio = targetLength / Math.max(1, sourceLength);

    // 检测数字
    const sourceNumbers = this.extractNumbers(sourceText);
    const hasNumbers = sourceNumbers.length > 0;
    const numbersPreserved = this.checkNumbersPreserved(sourceNumbers, targetText);

    // 检测术语
    const hasTerminology = this.detectTerminology(sourceText);

    // 长度检查
    if (lengthRatio < this.config.minLengthRatio) {
      issues.push({
        type: 'accuracy',
        severity: 'medium',
        description: `译文过短，长度比为 ${lengthRatio.toFixed(2)}`,
        suggestion: '检查是否有遗漏内容',
      });
    } else if (lengthRatio > this.config.maxLengthRatio) {
      issues.push({
        type: 'fluency',
        severity: 'medium',
        description: `译文过长，长度比为 ${lengthRatio.toFixed(2)}`,
        suggestion: '检查是否有冗余内容',
      });
    }

    // 数字保留检查
    if (this.config.enableNumberCheck && hasNumbers && !numbersPreserved) {
      issues.push({
        type: 'accuracy',
        severity: 'high',
        description: '数字未被正确保留',
        suggestion: '确保数字在译文中保持一致',
      });
    }

    // 计算各项分数
    const accuracyScore = this.calculateAccuracyScore(
      sourceText,
      targetText,
      issues.filter((i) => i.type === 'accuracy')
    );
    const fluencyScore = this.calculateFluencyScore(
      targetText,
      issues.filter((i) => i.type === 'fluency')
    );
    const contextScore = this.calculateContextScore(sourceText, targetText, context);

    // 综合评分
    const overallScore = Math.round(accuracyScore * 0.4 + fluencyScore * 0.35 + contextScore * 0.25);
    const isHighQuality = overallScore >= this.config.highQualityThreshold;

    return {
      overallScore,
      accuracyScore,
      fluencyScore,
      contextScore,
      isHighQuality,
      details: {
        sourceLength,
        targetLength,
        lengthRatio,
        hasTerminology,
        hasNumbers,
        numbersPreserved,
      },
      issues,
    };
  }

  /**
   * 提取文本中的数字
   */
  private extractNumbers(text: string): string[] {
    const numberRegex = /\d+(?:\.\d+)?/g;
    return text.match(numberRegex) || [];
  }

  /**
   * 检查数字是否被保留
   */
  private checkNumbersPreserved(numbers: string[], targetText: string): boolean {
    if (numbers.length === 0) return true;

    for (const num of numbers) {
      if (!targetText.includes(num)) {
        return false;
      }
    }
    return true;
  }

  /**
   * 检测术语
   */
  private detectTerminology(text: string): boolean {
    // 常见技术术语模式
    const terminologyPatterns = [
      /\bAPI\b/i,
      /\bSDK\b/i,
      /\bURL\b/i,
      /\bHTTP\b/i,
      /\bJSON\b/i,
      /\bXML\b/i,
      /\bHTML\b/i,
      /\bCSS\b/i,
      /\bJavaScript\b/i,
      /\bTypeScript\b/i,
      /\bReact\b/i,
      /\bNode\.js\b/i,
      /\bPython\b/i,
      /\bJava\b/i,
    ];

    return terminologyPatterns.some((pattern) => pattern.test(text));
  }

  /**
   * 计算准确度分数
   */
  private calculateAccuracyScore(
    _sourceText: string,
    _targetText: string,
    issues: QualityIssue[]
  ): number {
    let score = 100;

    for (const issue of issues) {
      switch (issue.severity) {
        case 'high':
          score -= 20;
          break;
        case 'medium':
          score -= 10;
          break;
        case 'low':
          score -= 5;
          break;
      }
    }

    return Math.max(0, score);
  }

  /**
   * 计算流畅度分数
   */
  private calculateFluencyScore(targetText: string, issues: QualityIssue[]): number {
    let score = 100;

    // 检查基本流畅度指标
    const hasRepeatedWords = this.checkRepeatedWords(targetText);
    if (hasRepeatedWords) {
      score -= 10;
    }

    // 检查标点符号
    const hasProperPunctuation = this.checkPunctuation(targetText);
    if (!hasProperPunctuation) {
      score -= 5;
    }

    // 扣除问题分数
    for (const issue of issues) {
      switch (issue.severity) {
        case 'high':
          score -= 15;
          break;
        case 'medium':
          score -= 8;
          break;
        case 'low':
          score -= 3;
          break;
      }
    }

    return Math.max(0, score);
  }

  /**
   * 检查重复词
   */
  private checkRepeatedWords(text: string): boolean {
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length - 1; i++) {
      if (words[i] === words[i + 1] && words[i].length > 2) {
        return true;
      }
    }
    return false;
  }

  /**
   * 检查标点符号
   */
  private checkPunctuation(text: string): boolean {
    // 中文文本应有中文标点
    const hasChinese = /[\u4e00-\u9fa5]/.test(text);
    if (hasChinese) {
      return /[，。！？、；：]/.test(text);
    }
    return true;
  }

  /**
   * 计算上下文相关性分数
   */
  private calculateContextScore(
    sourceText: string,
    _targetText: string,
    context?: string
  ): number {
    // 基础分数
    let score = 85;

    // 如果有上下文，进行额外检查
    if (context) {
      const contextWords = new Set(context.toLowerCase().split(/\s+/));
      const sourceWords = new Set(sourceText.toLowerCase().split(/\s+/));

      // 检查上下文词汇重叠
      const overlap = [...sourceWords].filter((w) => contextWords.has(w)).length;
      const overlapRatio = overlap / Math.max(1, sourceWords.size);

      if (overlapRatio > 0.3) {
        score += 10;
      }
    }

    // 检查源文本和目标文本的关键词对应
    const sourceKeywords = this.extractKeywords(sourceText);
    if (sourceKeywords.length > 0) {
      // 简化：假设关键词被翻译
      score += 5;
    }

    return Math.min(100, score);
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 简单关键词提取：移除常见停用词
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'need',
      'dare',
      'ought',
      'used',
      'to',
      'of',
      'in',
      'for',
      'on',
      'with',
      'at',
      'by',
      'from',
      'as',
      'into',
      'through',
      'during',
      'before',
      'after',
      'above',
      'below',
      'between',
      'under',
      'again',
      'further',
      'then',
      'once',
      '的',
      '是',
      '在',
      '有',
      '和',
      '与',
      '或',
      '了',
      '着',
      '过',
    ]);

    const words = text.toLowerCase().split(/\s+/);
    return words.filter((w) => w.length > 2 && !stopWords.has(w));
  }

  /**
   * 更新配置
   */
  updateConfig(newConfig: Partial<QualityEvaluatorConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * 获取当前配置
   */
  getConfig(): QualityEvaluatorConfig {
    return { ...this.config };
  }
}

/** 全局评估器实例 */
let globalEvaluator: TranslationQualityEvaluator | null = null;

/**
 * 获取全局评估器实例
 */
export function getQualityEvaluator(): TranslationQualityEvaluator {
  if (!globalEvaluator) {
    globalEvaluator = new TranslationQualityEvaluator();
  }
  return globalEvaluator;
}

/**
 * 评估翻译质量（便捷函数）
 */
export function evaluateTranslationQuality(
  sourceText: string,
  targetText: string,
  context?: string
): TranslationQualityResult {
  return getQualityEvaluator().evaluate(sourceText, targetText, context);
}
