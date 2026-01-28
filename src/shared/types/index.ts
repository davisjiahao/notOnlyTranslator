// User Profile Types
export type ExamType = 'cet4' | 'cet6' | 'toefl' | 'ielts' | 'gre' | 'custom';

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
}

// API 配置（支持多个配置）
export interface ApiConfig {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'custom';
  apiKey: string;
  apiUrl?: string;
  modelName?: string;
  /** 是否测试通过 */
  tested: boolean;
  /** 上次测试时间 */
  lastTestedAt?: number;
  /** 创建时间 */
  createdAt: number;
}

// Settings Types
export interface UserSettings {
  enabled: boolean;
  autoHighlight: boolean;
  translationMode: TranslationMode;
  showDifficulty: boolean;
  highlightColor: string;
  fontSize: number;
  apiProvider: 'openai' | 'anthropic' | 'custom';
  customApiUrl?: string;
  customModelName?: string;
  /** 网站黑名单（不翻译的网站域名列表） */
  blacklist: string[];
  /** 多个 API 配置 */
  apiConfigs: ApiConfig[];
  /** 当前激活的 API 配置 ID */
  activeApiConfigId?: string;
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
  | 'TOGGLE_ENABLED';

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
