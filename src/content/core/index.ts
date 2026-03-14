// 导出类型
export type {
  TranslatorDependencies,
  TranslatorState,
  HoverState,
  NavigationState,
  TranslateTextFn,
  SendMessageFn,
} from './types';

// 导出管理器
export { NavigationManager } from './navigationManager';
export { PageScanner } from './pageScanner';
export { HoverManager } from './hoverManager';
