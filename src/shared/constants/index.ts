import type { ExamType, UserSettings, BatchTranslationConfig } from '../types';

// 导出供应商配置
export * from './providers';

// 导出掌握度系统常量
export * from './mastery';

// Vocabulary size estimates for different exam levels
export const EXAM_VOCABULARY_SIZES: Record<ExamType, number> = {
  cet4: 4500,
  cet6: 6000,
  toefl: 8000,
  ielts: 7000,
  gre: 12000,
  custom: 5000,
};

// Score multipliers for different exam types
export const SCORE_MULTIPLIERS: Record<ExamType, (score: number) => number> = {
  cet4: (score: number) => {
    // CET4 scores range from 220-710
    const normalized = (score - 220) / (710 - 220);
    return 0.6 + normalized * 0.4;
  },
  cet6: (score: number) => {
    // CET6 scores range from 220-710
    const normalized = (score - 220) / (710 - 220);
    return 0.6 + normalized * 0.4;
  },
  toefl: (score: number) => {
    // TOEFL scores range from 0-120
    return 0.5 + (score / 120) * 0.5;
  },
  ielts: (score: number) => {
    // IELTS scores range from 0-9
    return 0.5 + (score / 9) * 0.5;
  },
  gre: (score: number) => {
    // GRE Verbal scores range from 130-170
    const normalized = (score - 130) / (170 - 130);
    return 0.5 + normalized * 0.5;
  },
  custom: () => 1,
};

// Exam display names
export const EXAM_DISPLAY_NAMES: Record<ExamType, string> = {
  cet4: 'CET-4 (大学英语四级)',
  cet6: 'CET-6 (大学英语六级)',
  toefl: 'TOEFL (托福)',
  ielts: 'IELTS (雅思)',
  gre: 'GRE',
  custom: '自定义',
};

// Score ranges for different exams
export const EXAM_SCORE_RANGES: Record<ExamType, { min: number; max: number; step: number }> = {
  cet4: { min: 220, max: 710, step: 10 },
  cet6: { min: 220, max: 710, step: 10 },
  toefl: { min: 0, max: 120, step: 1 },
  ielts: { min: 0, max: 9, step: 0.5 },
  gre: { min: 130, max: 170, step: 1 },
  custom: { min: 0, max: 20000, step: 100 },
};

// Default settings
export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  autoHighlight: true,
  vocabHighlightEnabled: true, // 默认启用 CEFR 词汇高亮
  phraseTranslationEnabled: true, // 默认启用词组翻译
  grammarTranslationEnabled: true, // 默认启用语法翻译
  translationMode: 'inline-only',
  showDifficulty: true,
  highlightColor: '#fef08a', // Light yellow
  fontSize: 14,
  apiProvider: 'openai',
  customApiUrl: '',
  customModelName: '',
  blacklist: [],
  apiConfigs: [],
  activeApiConfigId: undefined,
  hoverDelay: 500, // 默认悬停 500ms 后显示 Tooltip
  theme: 'system', // 默认跟随系统主题
  promptVersion: 'v1.0.0', // 默认提示词版本
};

// Default user profile
export const DEFAULT_USER_PROFILE = {
  examType: 'cet4' as ExamType,
  examScore: 425,
  estimatedVocabulary: 4500,
  levelConfidence: 0.5,
  knownWords: [] as string[],
  unknownWords: [] as string[],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// Chinese detection thresholds
export const CHINESE_DETECTION_THRESHOLD = {
  PAGE: 0.3,    // Page-level: skip if Chinese ratio > 30%
  PARAGRAPH: 0.2, // Paragraph-level: skip if Chinese ratio > 20%
};

// Content script timing constants
export const TIMING = {
  // Event delays (ms)
  SELECTION_DELAY: 50,           // 文本选择检测延迟
  DEFAULT_HOVER_DELAY: 500,      // 默认悬停延迟
  MODE_SWITCH_TRANSITION: 150,   // 模式切换 CSS 过渡时间
  NAVIGATION_HIGHLIGHT_DURATION: 2000, // 导航高亮持续时间

  // Message timeouts (ms)
  DEFAULT_MESSAGE_TIMEOUT: 5000, // 默认消息超时
  TRANSLATION_MESSAGE_TIMEOUT: 30000, // 翻译消息超时

  // Debounce delays (ms)
  SCAN_DEBOUNCE: 1000,           // 页面扫描防抖延迟
  TOOLTIP_HIDE_DELAY: 100,       // Tooltip 隐藏延迟

  // Content thresholds
  MIN_PARAGRAPH_LENGTH: 50,      // 最小段落长度
  MAX_SAMPLE_LENGTH: 2000,       // 最大采样长度
  TEXT_SELECTION_MAX_LENGTH: 100, // 文本选择最大长度
};

// LLM Prompt templates
export const TRANSLATION_PROMPT_TEMPLATE = `你是一个英语学习助手。用户的英语水平约为 {vocabulary_size} 词汇量（相当于{exam_level}水平）。

请分析以下英文文本，找出可能超出用户水平的：
1. 单词（超出{exam_level}词汇范围的）
2. 短语/习语
3. 复杂语法结构（如倒装句、虚拟语气、复杂从句等）

对于每个识别出的内容，提供：
- 中文翻译
- 难度等级（1-10）

同时提供整段文本的完整中文翻译。

文本：
{text}

上下文：
{context}

请以JSON格式返回结果，格式如下：
{
  "fullText": "整段文本的完整中文翻译",
  "words": [
    {
      "original": "词汇原文",
      "translation": "中文翻译",
      "position": [起始位置, 结束位置],
      "difficulty": 难度等级1-10,
      "isPhrase": 是否为短语
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
      "original": "语法结构原文片段（如 had I known, were it not for 等）",
      "explanation": "语法解释（如：这是虚拟语气的倒装结构，表示与过去事实相反的假设）",
      "type": "语法类型（如：虚拟语气、倒装句、定语从句、强调句等）",
      "position": [起始位置, 结束位置]
    }
  ]
}

注意：grammarPoints 用于标注文本中的特殊语法结构，帮助学习者理解复杂语法。只有当文本中存在值得学习的语法点时才需要返回，普通简单句不需要标注。`;

// Storage keys
export const STORAGE_KEYS = {
  LOCAL: {
    KNOWN_WORDS: 'knownWords',
    UNKNOWN_WORDS: 'unknownWords',
    TRANSLATION_CACHE: 'translationCache',
  },
  SYNC: {
    USER_PROFILE: 'userProfile',
    SETTINGS: 'settings',
    API_KEY: 'apiKey',
  },
};

// Context menu IDs
export const CONTEXT_MENU_IDS = {
  TRANSLATE_SELECTION: 'translateSelection',
  MARK_KNOWN: 'markKnown',
  MARK_UNKNOWN: 'markUnknown',
  ADD_TO_VOCABULARY: 'addToVocabulary',
};

// CSS class names for content script
export const CSS_CLASSES = {
  HIGHLIGHT: 'not-translator-highlight',
  TOOLTIP: 'not-translator-tooltip',
  TOOLTIP_VISIBLE: 'not-translator-tooltip-visible',
  MARK_BUTTON: 'not-translator-mark-btn',
  KNOWN: 'not-translator-known',
  UNKNOWN: 'not-translator-unknown',
};

// API endpoints
export const API_ENDPOINTS = {
  OPENAI: 'https://api.openai.com/v1/chat/completions',
  ANTHROPIC: 'https://api.anthropic.com/v1/messages',
};

// ========== 批量翻译配置 ==========

/**
 * 批量翻译默认配置
 *
 * 注意：maxParagraphsPerBatch 设为 15（而非 20）的原因：
 * - 减少 LLM 处理多个段落时的混淆和幻觉风险
 * - 单次请求 token 消耗更可控
 * - 在保持效率的同时提高翻译准确性
 */
export const DEFAULT_BATCH_CONFIG: BatchTranslationConfig = {
  /** 单批最大段落数（15 个段落是准确性与效率的平衡点） */
  maxParagraphsPerBatch: 15,
  /** 单批最大字符数 */
  maxCharsPerBatch: 10000,
  /** 防抖延迟（毫秒） */
  debounceDelay: 300,
  /** 缓存最大条目数 */
  maxCacheEntries: 500,
  /** 缓存过期时间（7天，毫秒） */
  cacheExpireTime: 7 * 24 * 60 * 60 * 1000,
};

/**
 * 批量翻译提示词模板
 * 使用 [PARA_n] 标记区分不同段落
 */
export const BATCH_TRANSLATION_PROMPT_TEMPLATE = `你是一个英语学习助手。用户的英语水平约为 {vocabulary_size} 词汇量（相当于{exam_level}水平）。

请分析以下多个英文段落（用 [PARA_n] 标记区分），找出每个段落中可能超出用户水平的：
1. 单词（超出{exam_level}词汇范围的）
2. 短语/习语
3. 复杂语法结构（如倒装句、虚拟语气、复杂从句等）

对于每个识别出的内容，提供：
- 中文翻译
- 难度等级（1-10）

同时提供每个段落的完整中文翻译。

段落内容：
{paragraphs}

请以JSON格式返回结果，格式如下：
{
  "paragraphs": [
    {
      "id": "[PARA_n]中的n",
      "fullText": "该段落的完整中文翻译",
      "words": [
        {
          "original": "词汇原文",
          "translation": "中文翻译",
          "position": [起始位置, 结束位置],
          "difficulty": 难度等级1-10,
          "isPhrase": 是否为短语
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
          "original": "语法结构原文片段",
          "explanation": "语法解释",
          "type": "语法类型（如：虚拟语气、倒装句、定语从句等）",
          "position": [起始位置, 结束位置]
        }
      ]
    }
  ]
}

注意：grammarPoints 用于标注文本中的特殊语法结构，帮助学习者理解复杂语法。只有当段落中存在值得学习的语法点时才需要返回，普通简单句不需要标注。`;

/**
 * 段落缓存存储键
 */
export const PARAGRAPH_CACHE_KEY = 'paragraphCache';

/**
 * 缓存版本号，用于迁移
 */
export const CACHE_VERSION = 1;
