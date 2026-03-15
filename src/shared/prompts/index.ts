/**
 * 提示词管理系统 (Prompt Management System)
 *
 * 设计目标：
 * 1. 支持提示词版本控制和 A/B 测试
 * 2. 提供结构化的提示词构建，避免字符串拼接错误
 * 3. 支持提示词效果评估和对比
 * 4. 支持动态提示词切换（无需重新部署）
 */

import type { UserProfile, UserSettings, TranslationMode } from '../types';
import { EXAM_DISPLAY_NAMES } from '../constants';

// ============ 类型定义 ============

/**
 * 提示词变量定义
 */
export interface PromptVariables {
  vocabularySize: number;
  examLevel: string;
  text: string;
  context: string;
  paragraphs?: string; // 批量翻译专用
}

/**
 * 提示词配置选项
 */
export interface PromptOptions {
  phraseTranslationEnabled: boolean;
  grammarTranslationEnabled: boolean;
  mode: TranslationMode;
}

/**
 * 提示词版本元数据
 */
export interface PromptVersion {
  version: string;
  name: string;
  description: string;
  createdAt: string;
  author: string;
  tags: string[];
  isDefault: boolean;
  isActive: boolean;
}

/**
 * 提示词内容结构
 */
export interface PromptTemplate {
  version: string;
  systemPrompt: string;
  userPromptTemplate: string;
  outputSchema: OutputSchema;
  config: PromptConfig;
}

/**
 * 输出 JSON Schema 定义
 */
export interface OutputSchema {
  type: 'object';
  properties: Record<string, SchemaProperty>;
  required: string[];
}

export interface SchemaProperty {
  type: string;
  description?: string;
  items?: SchemaProperty;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
}

/**
 * 提示词行为配置
 */
export interface PromptConfig {
  temperature: number;
  maxTokens: number;
  topP: number;
  responseFormat: 'json' | 'text';
}

/**
 * 提示词评估结果
 */
export interface PromptEvaluation {
  version: string;
  testCases: number;
  passRate: number;
  avgLatency: number;
  avgTokenUsage: number;
  errorTypes: Record<string, number>;
  lastEvaluatedAt: string;
}

// ============ 提示词构建器 ============

/**
 * 翻译提示词构建器
 * 使用结构化方式构建提示词，避免字符串拼接错误
 */
export class TranslationPromptBuilder {
  private variables: PromptVariables;
  private options: PromptOptions;

  constructor(
    userProfile: UserProfile,
    text: string,
    context: string,
    settings: UserSettings,
    paragraphs?: string
  ) {
    this.variables = {
      vocabularySize: userProfile.estimatedVocabulary,
      examLevel: EXAM_DISPLAY_NAMES[userProfile.examType],
      text,
      context,
      paragraphs,
    };
    this.options = {
      phraseTranslationEnabled: settings.phraseTranslationEnabled,
      grammarTranslationEnabled: settings.grammarTranslationEnabled,
      mode: settings.translationMode,
    };
  }

  /**
   * 构建系统提示词
   */
  buildSystemPrompt(): string {
    const { examLevel } = this.variables;
    const { phraseTranslationEnabled, grammarTranslationEnabled } = this.options;

    const tasks: string[] = [
      `1. 单词（超出${examLevel}词汇范围的）`,
    ];

    if (phraseTranslationEnabled) {
      tasks.push('2. 短语/习语');
    }

    if (grammarTranslationEnabled) {
      const taskNumber = phraseTranslationEnabled ? '3' : '2';
      tasks.push(`${taskNumber}. 复杂语法结构（如倒装句、虚拟语气、复杂从句等）`);
    }

    return `你是一个专业的英语学习助手。用户的英语水平约为 ${this.variables.vocabularySize} 词汇量（相当于${examLevel}水平）。

你的任务是分析英文文本，找出可能超出用户水平的内容。

分析任务：
${tasks.join('\n')}

对于每个识别出的内容，必须提供：
- 中文翻译
- 难度等级（1-10，1最简单，10最难）

同时提供整段文本的完整中文翻译，保持原文的语气和风格。

重要规则：
- 只标注超出用户水平的内容
- 普通词汇和简单句不需要标注
- 翻译要准确、自然、符合中文表达习惯`;
  }

  /**
   * 构建用户提示词
   */
  buildUserPrompt(): string {
    const { text, context, paragraphs } = this.variables;
    const { grammarTranslationEnabled } = this.options;

    const isBatch = paragraphs !== undefined;

    const basePrompt = isBatch
      ? `请分析以下多个英文段落（用 [PARA_n] 标记区分），找出每个段落中可能超出用户水平的单词、短语和复杂语法结构。

段落内容：
${paragraphs}`
      : `请分析以下英文文本，找出可能超出用户水平的单词、短语和复杂语法结构。

文本：
${text}`;

    const contextSection = context && context !== text
      ? `\n\n上下文：\n${context}`
      : '';

    const grammarNote = grammarTranslationEnabled
      ? `\n\n语法分析要求：\n- 标注值得学习的语法结构，如虚拟语气、倒装句、定语从句、强调句等\n- 提供语法解释，说明其用法和意义\n- 普通简单句不需要标注`
      : '';

    return `${basePrompt}${contextSection}${grammarNote}

请以JSON格式返回结果，严格按照以下schema：${this.getOutputSchemaDescription(isBatch)}`;
  }

  /**
   * 获取输出 Schema 描述
   */
  private getOutputSchemaDescription(isBatch: boolean): string {
    if (isBatch) {
      return `
{
  "paragraphs": [
    {
      "id": "段落标识符",
      "fullText": "完整中文翻译",
      "words": [
        {
          "original": "英文原文",
          "translation": "中文翻译",
          "position": [起始位置, 结束位置],
          "difficulty": 1-10,
          "isPhrase": true/false
        }
      ],
      "sentences": [
        {
          "original": "复杂句子原文",
          "translation": "中文翻译",
          "grammarNote": "语法说明（可选）"
        }
      ],
      "grammarPoints": [
        {
          "original": "语法结构原文",
          "explanation": "语法解释",
          "type": "语法类型",
          "position": [起始位置, 结束位置]
        }
      ]
    }
  ]
}`;
    }

    return `
{
  "fullText": "完整中文翻译",
  "words": [
    {
      "original": "英文原文",
      "translation": "中文翻译",
      "position": [起始位置, 结束位置],
      "difficulty": 1-10,
      "isPhrase": true/false
    }
  ],
  "sentences": [
    {
      "original": "复杂句子原文",
      "translation": "中文翻译",
      "grammarNote": "语法说明（可选）"
    }
  ],
  "grammarPoints": [
    {
      "original": "语法结构原文",
      "explanation": "语法解释",
      "type": "语法类型",
      "position": [起始位置, 结束位置]
    }
  ]
}`;
  }

  /**
   * 构建完整的提示词对象
   */
  build(): { systemPrompt: string; userPrompt: string } {
    return {
      systemPrompt: this.buildSystemPrompt(),
      userPrompt: this.buildUserPrompt(),
    };
  }
}

// ============ 提示词版本管理 ============

/**
 * 提示词注册表
 * 存储所有可用的提示词版本
 */
export const PROMPT_VERSIONS: Record<string, PromptTemplate> = {
  'v1.0.0': {
    version: 'v1.0.0',
    systemPrompt: `你是一个英语学习助手。用户的英语水平约为 {vocabulary_size} 词汇量（相当于{exam_level}水平）。

请分析以下英文文本，找出可能超出用户水平的：
1. 单词（超出{exam_level}词汇范围的）
2. 短语/习语
3. 复杂语法结构（如倒装句、虚拟语气、复杂从句等）

对于每个识别出的内容，提供：
- 中文翻译
- 难度等级（1-10）

同时提供整段文本的完整中文翻译。`,
    userPromptTemplate: `文本：\n{text}\n\n上下文：\n{context}\n\n请以JSON格式返回结果。`,
    outputSchema: {
      type: 'object',
      properties: {
        fullText: { type: 'string', description: '完整中文翻译' },
        words: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string', description: '英文原文' },
              translation: { type: 'string', description: '中文翻译' },
              position: { type: 'array', description: '起始和结束位置' },
              difficulty: { type: 'number', description: '难度等级1-10' },
              isPhrase: { type: 'boolean', description: '是否为短语' },
            },
            required: ['original', 'translation', 'position', 'difficulty', 'isPhrase'],
          },
        },
        sentences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string', description: '复杂句子原文' },
              translation: { type: 'string', description: '中文翻译' },
              grammarNote: { type: 'string', description: '语法说明（可选）' },
            },
            required: ['original', 'translation'],
          },
        },
        grammarPoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string', description: '语法结构原文' },
              explanation: { type: 'string', description: '语法解释' },
              type: { type: 'string', description: '语法类型' },
              position: { type: 'array', description: '起始和结束位置' },
            },
            required: ['original', 'explanation', 'type', 'position'],
          },
        },
      },
      required: ['fullText', 'words', 'sentences'],
    },
    config: {
      temperature: 0.3,
      maxTokens: 4000,
      topP: 0.95,
      responseFormat: 'json',
    },
  },

  'v2.0.0-beta': {
    version: 'v2.0.0-beta',
    systemPrompt: `你是一位专业的英语教育专家和翻译家。用户的英语水平约为 {vocabulary_size} 词汇量（相当于{exam_level}水平）。

你的任务是识别文本中超出用户当前水平的语言点，帮助他们学习进步。

识别标准：
- 词汇：超出{exam_level}范围的学术、专业或低频词汇
- 短语：习语、固定搭配、口语表达
- 语法：复杂句型、特殊结构、高级语法点

输出要求：
- 翻译准确、地道、符合中文表达习惯
- 难度评级客观（1-10），考虑用户的基准水平
- 语法解释清晰、教学性强`,
    userPromptTemplate: `请分析以下文本：\n\n{text}\n\n上下文信息：\n{context}\n\n请以JSON格式返回分析结果，包含：完整译文、词汇列表、句子列表、语法点列表。`,
    outputSchema: {
      type: 'object',
      properties: {
        fullText: { type: 'string', description: '完整中文翻译' },
        words: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string', description: '英文原文' },
              translation: { type: 'string', description: '中文翻译' },
              phonetic: { type: 'string', description: '音标（可选）' },
              partOfSpeech: { type: 'string', description: '词性（可选）' },
              position: { type: 'array', description: '起始和结束位置' },
              difficulty: { type: 'number', description: '难度等级1-10' },
              isPhrase: { type: 'boolean', description: '是否为短语' },
              examples: { type: 'array', description: '例句列表（可选）' },
            },
            required: ['original', 'translation', 'position', 'difficulty', 'isPhrase'],
          },
        },
        sentences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string', description: '复杂句子原文' },
              translation: { type: 'string', description: '中文翻译' },
              grammarNote: { type: 'string', description: '语法说明（可选）' },
            },
            required: ['original', 'translation'],
          },
        },
        grammarPoints: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              original: { type: 'string', description: '语法结构原文' },
              explanation: { type: 'string', description: '语法解释' },
              type: { type: 'string', description: '语法类型' },
              difficulty: { type: 'number', description: '难度等级1-10' },
              position: { type: 'array', description: '起始和结束位置' },
            },
            required: ['original', 'explanation', 'type', 'position'],
          },
        },
      },
      required: ['fullText', 'words'],
    },
    config: {
      temperature: 0.2,
      maxTokens: 4000,
      topP: 0.9,
      responseFormat: 'json',
    },
  },
};

/**
 * 提示词版本管理器
 */
export class PromptVersionManager {
  private currentVersion: string = 'v1.0.0';
  private activeVersions: Set<string> = new Set(['v1.0.0']);

  /**
   * 获取当前激活的提示词版本
   */
  getCurrentVersion(): string {
    return this.currentVersion;
  }

  /**
   * 设置当前使用的提示词版本
   */
  setCurrentVersion(version: string): boolean {
    if (PROMPT_VERSIONS[version]) {
      this.currentVersion = version;
      this.activeVersions.add(version);
      return true;
    }
    return false;
  }

  /**
   * 获取提示词模板
   */
  getTemplate(version?: string): PromptTemplate {
    const v = version || this.currentVersion;
    const template = PROMPT_VERSIONS[v];
    if (!template) {
      throw new Error(`Prompt version ${v} not found`);
    }
    return template;
  }

  /**
   * 列出所有可用版本
   */
  listVersions(): string[] {
    return Object.keys(PROMPT_VERSIONS);
  }

  /**
   * 检查版本是否存在
   */
  hasVersion(version: string): boolean {
    return version in PROMPT_VERSIONS;
  }

  /**
   * 注册新版本
   */
  registerVersion(template: PromptTemplate): void {
    PROMPT_VERSIONS[template.version] = template;
  }
}

// ============ 导出单例 ============

export const promptVersionManager = new PromptVersionManager();
