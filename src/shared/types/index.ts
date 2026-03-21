// User Profile Types
export type ExamType = 'cet4' | 'cet6' | 'toefl' | 'ielts' | 'gre' | 'custom';

// 导入复习提醒类型（需要在 UserSettings 中使用）
import type { ReviewReminderConfig as ReviewReminderConfigType } from './reviewReminder';

// ========== API 供应商类型 ==========

/**
 * API 供应商标识
 * - 国外：openai, anthropic, gemini, groq, deepl, google_translate
 * - 国内：deepseek, zhipu, alibaba, baidu
 * - 本地：ollama
 * - 自定义：custom
 */
export type ApiProvider =
  | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'deepl' | 'google_translate' | 'youdao'  // 国外 + 传统翻译
  | 'deepseek' | 'zhipu' | 'alibaba' | 'baidu'  // 国内
  | 'ollama'  // 本地部署
  | 'custom';

/**
 * API 格式类型
 */
export type ApiFormat = 'openai' | 'anthropic' | 'gemini' | 'dashscope' | 'baidu' | 'ollama' | 'deepl' | 'google_translate' | 'youdao_translate';

/**
 * 模型信息
 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  isRecommended?: boolean;
}

/**
 * 供应商配置
 */
export interface ProviderConfig {
  id: ApiProvider;
  name: string;
  description: string;
  region: 'domestic' | 'international';
  apiFormat: ApiFormat;
  defaultEndpoint: string;
  chatEndpoint: string;
  modelsEndpoint?: string;
  modelsSupported: boolean;
  defaultModels: ModelInfo[];
  recommendedModel: string;
  authHeaderName?: string;
  docUrl: string;
  apiKeyPlaceholder: string;
}

export interface UnknownWordEntry {
  word: string;
  context: string;
  translation: string;
  markedAt: number;
  reviewCount: number;
  lastReviewAt?: number;
}

export interface UserProfile {
  examType: ExamType;
  examScore?: number;
  estimatedVocabulary: number;
  knownWords: string[];
  unknownWords: UnknownWordEntry[];
  levelConfidence: number;
  createdAt: number;
  updatedAt: number;
}

// Translation Types
export type TranslationMode =
  | 'inline-only'      // 仅翻译生僻部分，译文高亮显示在原文后
  | 'bilingual'        // 双文对照，译文在原文下方
  | 'full-translate';  // 全文翻译，生僻部分高亮

export interface TranslationRequest {
  text: string;
  context: string;
  userLevel: UserProfile;
  mode: TranslationMode;
}

export interface TranslatedWord {
  original: string;
  translation: string;
  position: [number, number];
  difficulty: number;
  isPhrase: boolean;
  /** 音标（可选） */
  phonetic?: string;
  /** 词性（可选） */
  partOfSpeech?: string;
  /** 例句（可选） */
  examples?: string[];
}

export interface TranslatedSentence {
  original: string;
  translation: string;
  grammarNote?: string;
}

export interface GrammarPoint {
  original: string;
  explanation: string;
  position: [number, number];
  type?: string;
}

export interface TranslationResult {
  words: TranslatedWord[];
  sentences: TranslatedSentence[];
  grammarPoints?: GrammarPoint[]; // New field for segment-based grammar learning
  fullText?: string;  // 完整译文（用于双文对照和全文翻译模式）
  cached?: boolean;
  /** 翻译来源（内部使用，用于调试和分析） */
  _source?: 'deepl' | 'llm' | 'hybrid';
}

// API 配置（支持多个配置）
export interface ApiConfig {
  id: string;
  name: string;
  provider: ApiProvider;
  apiKey: string;
  apiUrl?: string;
  modelName?: string;
  /** 百度文心需要的 Secret Key */
  secondaryApiKey?: string;
  /** 是否测试通过 */
  tested: boolean;
  /** 上次测试时间 */
  lastTestedAt?: number;
  /** 创建时间 */
  createdAt: number;
}

// Settings Types
export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * 高亮样式类型
 */
export type HighlightStyleType = 'background' | 'underline' | 'bold' | 'dotted';

/**
 * 翻译样式配置
 */
export interface TranslationStyleConfig {
  /** 高亮样式类型 */
  highlightStyle: HighlightStyleType;
  /** 高亮透明度 (0-100) */
  highlightOpacity: number;
  /** 译文行透明度 (0-100) */
  translationLineOpacity: number;
  /** 译文行缩进 (px) */
  translationLineIndent: number;
  /** 是否显示原文标注 */
  showOriginalAnnotation: boolean;
  /** 自定义 CSS */
  customCss?: string;
  /** 译文字体 */
  translationFontFamily?: string;
}

export interface UserSettings {
  enabled: boolean;
  autoHighlight: boolean;
  /** 是否启用 CEFR 词汇高亮功能 */
  vocabHighlightEnabled: boolean;
  /** 是否启用词组/短语翻译 */
  phraseTranslationEnabled: boolean;
  /** 是否启用语法点识别和解释 */
  grammarTranslationEnabled: boolean;
  translationMode: TranslationMode;
  showDifficulty: boolean;
  highlightColor: string;
  fontSize: number;
  apiProvider: ApiProvider;
  customApiUrl?: string;
  customModelName?: string;
  /** 百度文心需要的 Secret Key */
  secondaryApiKey?: string;
  /** 网站黑名单（不翻译的网站域名列表） */
  blacklist: string[];
  /** 多个 API 配置 */
  apiConfigs: ApiConfig[];
  /** 当前激活的 API 配置 ID */
  activeApiConfigId?: string;
  /** 悬停触发 Tooltip 延迟时间（毫秒），0 表示关闭悬停触发 */
  hoverDelay: number;
  /** 主题模式 */
  theme: ThemeMode;
  /** 提示词版本 */
  promptVersion?: string;
  /** 是否已关闭招募Banner */
  recruitmentBannerDismissed?: boolean;
  /** 混合翻译配置 */
  hybridTranslation?: {
    /** 是否启用混合翻译 */
    enabled: boolean;
    /** 默认翻译引擎 */
    defaultEngine: 'llm' | 'traditional' | 'hybrid';
    /** 传统API提供商 */
    traditionalProvider: 'deepl' | 'google_translate' | 'youdao';
    /** 简单文本阈值（词数） */
    simpleTextThreshold: number;
    /** 是否启用智能路由 */
    enableSmartRouting: boolean;
    /** 质量/速度优先级 */
    priority: 'quality' | 'speed' | 'balanced';
    /** 传统API API Key */
    traditionalApiKey?: string;
  };
  /** 自定义快捷键配置 */
  shortcuts?: ShortcutConfig[];
  /** 翻译样式配置 */
  translationStyle?: TranslationStyleConfig;
  /** 复习提醒配置 */
  reviewReminder?: ReviewReminderConfigType;
}

/**
 * 快捷键配置
 */
export interface ShortcutConfig {
  /** 动作标识 */
  action: string;
  /** 快捷键组合 */
  key: string;
  /** 描述 */
  description: string;
  /** 是否启用 */
  enabled: boolean;
}

// Storage Types
export interface LocalStorageData {
  knownWords: string[];
  unknownWords: UnknownWordEntry[];
  translationCache: Record<string, TranslationResult>;
}

export interface SyncStorageData {
  userProfile: Omit<UserProfile, 'knownWords' | 'unknownWords'>;
  settings: UserSettings;
  apiKey: string;
}

// Message Types for Background <-> Content Script communication
export type MessageType =
  | 'TRANSLATE_TEXT'
  | 'BATCH_TRANSLATE_TEXT'  // 批量翻译请求
  | 'MARK_WORD_KNOWN'
  | 'MARK_WORD_UNKNOWN'
  | 'GET_USER_PROFILE'
  | 'UPDATE_USER_PROFILE'
  | 'GET_SETTINGS'
  | 'UPDATE_SETTINGS'
  | 'GET_VOCABULARY'
  | 'ADD_TO_VOCABULARY'
  | 'REMOVE_FROM_VOCABULARY'
  | 'SHOW_TRANSLATION'
  | 'WORD_MARKED'
  | 'ADDED_TO_VOCABULARY'
  | 'SETTINGS_UPDATED'
  | 'TOGGLE_ENABLED'
  // 掌握度系统消息类型
  | 'GET_MASTERY_OVERVIEW'
  | 'GET_CEFR_LEVEL'
  | 'GET_REVIEW_WORDS'
  | 'GET_MASTERY_TREND'
  | 'GET_LEARNING_STATISTICS'
  | 'SYNC_USER_VOCABULARY'
  | 'EXPORT_MASTERY_DATA'
  | 'IMPORT_MASTERY_DATA'
  | 'GET_WORD_MASTERY_INFO'
  // 缓存统计消息类型
  | 'GET_CACHE_STATS'
  | 'GET_CACHE_METRICS'
  | 'CLEAR_TRANSLATION_CACHE'
  | 'RESET_CACHE_METRICS'
  // 错误追踪消息类型
  | 'GET_ERROR_STATS'
  | 'QUERY_ERRORS'
  | 'DELETE_ERROR'
  | 'DELETE_ERRORS'
  | 'CLEAR_ALL_ERRORS'
  | 'MARK_ERRORS_AS_REPORTED'
  | 'REPORT_ERRORS'
  // 翻译历史记录消息类型 (CMP-87)
  | 'SAVE_TRANSLATION_HISTORY'
  | 'QUERY_TRANSLATION_HISTORY'
  | 'GET_HISTORY_BY_ID'
  | 'DELETE_HISTORY_ENTRY'
  | 'DELETE_HISTORY_ENTRIES'
  | 'CLEAR_ALL_HISTORY'
  | 'GET_HISTORY_STATS'
  | 'EXPORT_HISTORY_DATA'
  | 'IMPORT_HISTORY_DATA'
  // 快捷键命令消息类型 (CMP-113)
  | 'TRANSLATE_PARAGRAPH'
  | 'TOGGLE_TRANSLATION';

export interface Message<T = unknown> {
  type: MessageType;
  payload?: T;
}

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// Quick Test Types
export interface TestQuestion {
  id: string;
  word: string;
  options: string[];
  correctIndex: number;
  difficulty: number;
}

export interface TestResult {
  totalQuestions: number;
  correctAnswers: number;
  estimatedVocabulary: number;
  completedAt: number;
}

// Vocabulary Level Data
export interface VocabularyLevel {
  examType: ExamType;
  baseVocabulary: number;
  words: string[];
}

// ========== 批量翻译相关类型 ==========

/**
 * 批量翻译中的单个段落请求
 */
export interface BatchParagraphRequest {
  /** 段落唯一标识符 */
  id: string;
  /** 段落文本内容 */
  text: string;
  /** 元素路径，用于定位DOM元素 */
  elementPath: string;
}

/**
 * 批量翻译请求
 */
export interface BatchTranslationRequest {
  /** 要翻译的段落列表 */
  paragraphs: BatchParagraphRequest[];
  /** 翻译模式 */
  mode: TranslationMode;
  /** 页面URL，用于缓存关联 */
  pageUrl: string;
  /** 用户等级信息 */
  userLevel?: UserProfile;
}

/**
 * 批量翻译中的单个段落结果
 */
export interface BatchParagraphResult {
  /** 段落唯一标识符，与请求对应 */
  id: string;
  /** 翻译结果 */
  result: TranslationResult;
  /** 是否来自缓存 */
  cached: boolean;
}

/**
 * 批量翻译响应
 */
export interface BatchTranslationResponse {
  /** 各段落的翻译结果 */
  results: BatchParagraphResult[];
  /** 实际调用API的段落数量（排除缓存命中的） */
  apiCallCount: number;
  /** 缓存命中数量 */
  cacheHitCount: number;
}

/**
 * 段落级缓存条目
 */
export interface ParagraphCacheEntry {
  /** 文本内容的哈希值 */
  textHash: string;
  /** 翻译结果 */
  result: TranslationResult;
  /** 翻译模式 */
  mode: TranslationMode;
  /** 页面URL */
  pageUrl: string;
  /** 创建时间 */
  createdAt: number;
  /** 最后访问时间，用于LRU */
  lastAccessedAt: number;
  /** 翻译来源：'deepl' | 'llm' | 'hybrid' */
  source?: 'deepl' | 'llm' | 'hybrid';
}

/**
 * 增强缓存存储结构
 */
export interface EnhancedCacheStorage {
  /** 段落缓存，key为文本哈希 */
  paragraphCache: Record<string, ParagraphCacheEntry>;
  /** 缓存版本号 */
  version: number;
}

/**
 * 批量翻译配置
 */
export interface BatchTranslationConfig {
  /** 单批最大段落数 */
  maxParagraphsPerBatch: number;
  /** 单批最大字符数 */
  maxCharsPerBatch: number;
  /** 防抖延迟（毫秒） */
  debounceDelay: number;
  /** 缓存最大条目数 */
  maxCacheEntries: number;
  /** 缓存过期时间（毫秒） */
  cacheExpireTime: number;
}

// 导出复习提醒类型
export type {
  ReviewReminderConfig,
  ReviewScheduleItem,
  SM2Parameters,
  ReviewStats,
  ReviewResult,
} from './reviewReminder';
export { ReviewQuality, DEFAULT_REVIEW_REMINDER_CONFIG, DEFAULT_SM2_PARAMETERS } from './reviewReminder';
