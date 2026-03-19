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
  hybridTranslation: {
    enabled: false, // 默认不启用，需要用户手动开启
    defaultEngine: 'hybrid',
    traditionalProvider: 'deepl',
    simpleTextThreshold: 20,
    enableSmartRouting: true,
    priority: 'balanced',
  },
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
 * 段落缓存存储键
 */
export const PARAGRAPH_CACHE_KEY = 'paragraphCache';

/**
 * 缓存版本号，用于迁移
 */
export const CACHE_VERSION = 1;
