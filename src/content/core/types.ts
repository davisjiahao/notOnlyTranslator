import type { UserSettings, TranslationResult } from '@/shared/types';
import type { Highlighter } from '../highlighter';
import type { Tooltip } from '../tooltip';
import type { MarkerService } from '../marker';
import type { ViewportObserver } from '../viewportObserver';
import type { BatchTranslationManager } from '../batchTranslationManager';
import type { FloatingButton } from '../floatingButton';

/**
 * NotOnlyTranslator 核心依赖接口
 * 用于模块间解耦
 */
export interface TranslatorDependencies {
  highlighter: Highlighter;
  tooltip: Tooltip;
  marker: MarkerService;
  settings: UserSettings | null;
  isEnabled: boolean;
}

/**
 * NotOnlyTranslator 完整状态接口
 */
export interface TranslatorState extends TranslatorDependencies {
  viewportObserver: ViewportObserver | null;
  batchManager: BatchTranslationManager | null;
  useBatchMode: boolean;
  observer: MutationObserver | null;
  floatingButton: FloatingButton | null;
}

/**
 * 悬停状态
 */
export interface HoverState {
  timer: ReturnType<typeof setTimeout> | null;
  element: HTMLElement | null;
}

/**
 * 导航状态
 */
export interface NavigationState {
  currentIndex: number;
  highlights: HTMLElement[];
  highlightTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * 翻译回调函数类型
 */
export type TranslateTextFn = (text: string, context?: string) => Promise<TranslationResult>;
export type SendMessageFn = (message: unknown, timeout?: number) => Promise<unknown>;
