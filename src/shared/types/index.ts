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

export interface TranslationResult {
  words: TranslatedWord[];
  sentences: TranslatedSentence[];
  fullText?: string;  // 完整译文（用于双文对照和全文翻译模式）
  cached?: boolean;
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
