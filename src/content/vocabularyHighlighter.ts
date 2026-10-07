import type { CEFRLevel } from '@/shared/types/mastery';
import type {
  WordDifficultyResult,
  VocabularyFilterResult,
} from '@/shared/utils/vocabularyService';
import {
  VocabularyService,
  getRecommendedWords as getRecommendedWordsFromService,
} from '@/shared/utils/vocabularyService';
import { CSS_CLASSES } from '@/shared/constants';
import { logger } from '@/shared/utils';
import { createTranslatableTextWalker, getTranslatableText } from './pageScanner';
import { TranslationDisplay } from './translationDisplay';
import { captureFocusReturn } from './utils/focusReturn';

/**
 * 词汇高亮配置
 */
export interface VocabularyHighlightConfig {
  /** 用户 CEFR 等级 */
  userLevel: CEFRLevel;
  /** 是否启用词汇高亮 */
  enabled: boolean;
  /** 高亮样式：背景色/下划线/边框 */
  highlightStyle: 'background' | 'underline' | 'border';
  /** 是否显示难度指示器 */
  showDifficultyIndicator: boolean;
}

/**
 * 高亮单词条目
 */
export interface HighlightedVocabularyWord {
  /** 单词本身 */
  word: string;
  /** 预估的 CEFR 等级 */
  level: CEFRLevel;
  /** 难度分数 1-10 */
  difficulty: number;
  /** DOM 元素引用（只读，更新时生成新数组） */
  elements: readonly HTMLElement[];
}

/**
 * VocabularyHighlighter - 基于 CEFR 词汇水平的单词高亮器
 *
 * 职责：
 * 1. 扫描段落文本，识别超出用户 CEFR 水平的单词
 * 2. 高亮这些单词，但不进行翻译
 * 3. 支持用户自定义已知/未知词汇列表
 * 4. 支持动态内容更新
 */
export class VocabularyHighlighter {
  private vocabularyService: VocabularyService;
  private config: VocabularyHighlightConfig;
  private highlightedWords: Map<string, HighlightedVocabularyWord> = new Map();
  private processedElements: WeakSet<HTMLElement> = new WeakSet();

  /** 已扫描的根元素（用于等级/词表变化后的重扫；rescan 时清理已脱离文档的引用） */
  private scannedRoots: Set<HTMLElement> = new Set();

  /** 销毁标记：销毁后不再处理任何元素 */
  private destroyed = false;

  /** 默认配置 */
  private static readonly DEFAULT_CONFIG: VocabularyHighlightConfig = {
    userLevel: 'B1',
    enabled: true,
    highlightStyle: 'background',
    showDifficultyIndicator: true,
  };

  constructor(config?: Partial<VocabularyHighlightConfig>) {
    this.config = {
      ...VocabularyHighlighter.DEFAULT_CONFIG,
      ...config,
    };
    this.vocabularyService = new VocabularyService({
      userLevel: this.config.userLevel,
    });
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<VocabularyHighlightConfig>): void {
    const oldEnabled = this.config.enabled;
    const oldLevel = this.config.userLevel;

    this.config = {
      ...this.config,
      ...config,
    };

    // 更新词汇服务配置
    if (config.userLevel !== undefined) {
      this.vocabularyService.setUserLevel(config.userLevel);
    }

    // 如果禁用高亮，清除所有高亮
    if (oldEnabled && !this.config.enabled) {
      this.clearAllHighlights();
    }

    // 如果用户等级改变，清除后按新等级重扫已跟踪的根元素
    if (config.userLevel !== undefined && oldLevel !== config.userLevel) {
      this.rescan();
    }
  }

  /**
   * 高亮单个元素中的词汇
   *
   * @param element - 要处理的 HTML 元素
   * @returns 识别并高亮的单词列表
   */
  highlightElement(element: HTMLElement): HighlightedVocabularyWord[] {
    if (this.destroyed || this.processedElements.has(element)) return [];
    return TranslationDisplay.updateVocabularyHighlights([element], () => this.highlightOriginalElement(element));
  }

  private highlightOriginalElement(element: HTMLElement): HighlightedVocabularyWord[] {
    // 记录扫描根元素，供词表/等级变化后的重扫使用
    this.scannedRoots.add(element);

    // 检查是否应该跳过此元素
    if (!this.shouldProcessElement(element)) {
      this.processedElements.add(element);
      return [];
    }

    // 获取元素文本
    const text = getTranslatableText(element);
    if (text.length < 10) {
      this.processedElements.add(element);
      return [];
    }

    // 使用词汇服务分析文本
    const result = this.vocabularyService.analyzeText(text);

    // 如果没有超出水平的词，标记为已处理并返回
    if (result.wordsAboveLevel.length === 0) {
      this.processedElements.add(element);
      return [];
    }

    // 高亮单词
    const highlighted = this.applyHighlighting(element, result.wordsAboveLevel);

    // 标记为已处理
    this.processedElements.add(element);

    logger.info('VocabularyHighlighter: 高亮完成', {
      element: element.tagName,
      wordsAboveLevel: result.wordsAboveLevel.length,
      highlighted: highlighted.length,
    });

    return highlighted;
  }

  /**
   * 批量高亮多个元素
   */
  highlightElements(elements: HTMLElement[]): HighlightedVocabularyWord[] {
    if (!this.config.enabled || this.destroyed) return [];
    return TranslationDisplay.updateVocabularyHighlights(elements, () => this.highlightOriginalElements(elements));
  }

  private highlightOriginalElements(elements: HTMLElement[]): HighlightedVocabularyWord[] {
    if (!this.config.enabled) return [];
    const allHighlighted: HighlightedVocabularyWord[] = [];
    for (const element of elements) {
      if (this.processedElements.has(element)) continue;
      allHighlighted.push(...this.highlightOriginalElement(element));
    }
    return allHighlighted;
  }

  /**
   * 检查元素是否应该被处理
   */
  private shouldProcessElement(element: HTMLElement): boolean {
    // 跳过已处理的元素
    if (element.classList.contains('not-translator-vocab-processed')) {
      return false;
    }

    // 跳过脚本、样式等元素
    const skipTags = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'CODE', 'PRE', 'TEXTAREA', 'INPUT'];
    if (skipTags.includes(element.tagName)) {
      return false;
    }

    // 已处理的原文段落仍可安全重扫；仅跳过译文与扩展界面节点。
    if (
      element.classList.contains(CSS_CLASSES.HIGHLIGHT) ||
      element.classList.contains('not-translator-translation-line') ||
      element.classList.contains('not-translator-full-translation') ||
      element.classList.contains('not-translator-full-translated') ||
      element.closest(`.${CSS_CLASSES.TOOLTIP}`)
    ) {
      return false;
    }

    return true;
  }

  /**
   * 应用高亮到元素中的单词
   */
  private applyHighlighting(
    container: HTMLElement,
    wordsToHighlight: WordDifficultyResult[]
  ): HighlightedVocabularyWord[] {
    const highlighted: HighlightedVocabularyWord[] = [];
    const wordMap = new Map<string, WordDifficultyResult>();

    // 创建单词查找映射
    for (const word of wordsToHighlight) {
      wordMap.set(word.word.toLowerCase(), word);
    }

    // 使用 TreeWalker 遍历文本节点
    const walker = createTranslatableTextWalker(container, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // 跳过已有词汇标记、翻译标记及扩展界面，避免嵌套或扫描译文。
        if (
          parent.closest(
            `.not-translator-vocab-highlight, .${CSS_CLASSES.HIGHLIGHT}, .not-translator-translation-line, .not-translator-full-translation, .${CSS_CLASSES.TOOLTIP}`
          )
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        // 检查文本是否包含需要高亮的单词
        const text = node.textContent?.toLowerCase() || '';
        for (const word of wordMap.keys()) {
          // 使用单词边界匹配
          const regex = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i');
          if (regex.test(text)) {
            return NodeFilter.FILTER_ACCEPT;
          }
        }

        return NodeFilter.FILTER_SKIP;
      },
    });

    // 收集所有需要处理的文本节点
    const nodesToProcess: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      nodesToProcess.push(node as Text);
    }

    // 处理每个文本节点
    for (const textNode of nodesToProcess) {
      const result = this.processTextNode(textNode, wordMap);
      highlighted.push(...result);
    }

    // 标记容器为已处理
    container.classList.add('not-translator-vocab-processed');

    return highlighted;
  }

  /**
   * 处理单个文本节点
   */
  private processTextNode(
    textNode: Text,
    wordMap: Map<string, WordDifficultyResult>
  ): HighlightedVocabularyWord[] {
    const text = textNode.textContent || '';
    if (!text.trim()) return [];

    const parent = textNode.parentNode;
    if (!parent) return [];

    // 查找所有匹配
    const matches: Array<{
      start: number;
      end: number;
      word: WordDifficultyResult;
      originalText: string;
    }> = [];

    for (const [, wordData] of wordMap) {
      const regex = new RegExp(`\\b${this.escapeRegex(wordData.word)}\\b`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          word: wordData,
          originalText: match[0],
        });
      }
    }

    if (matches.length === 0) return [];

    // 按位置排序并去除重叠
    matches.sort((a, b) => a.start - b.start);
    const filteredMatches: typeof matches = [];
    let lastEnd = 0;
    for (const match of matches) {
      if (match.start >= lastEnd) {
        filteredMatches.push(match);
        lastEnd = match.end;
      }
    }

    // 创建文档片段
    const fragment = document.createDocumentFragment();
    let currentIndex = 0;
    const highlighted: HighlightedVocabularyWord[] = [];

    for (const match of filteredMatches) {
      // 添加匹配前的文本
      if (match.start > currentIndex) {
        fragment.appendChild(document.createTextNode(text.slice(currentIndex, match.start)));
      }

      // 创建高亮元素
      const span = this.createHighlightElement(match.word, match.originalText);
      fragment.appendChild(span);

      // 记录高亮的单词（不可变更新：新 Map + 新条目对象）
      const key = match.word.word.toLowerCase();
      const existing = this.highlightedWords.get(key);
      if (existing) {
        this.highlightedWords = new Map(this.highlightedWords).set(key, {
          ...existing,
          elements: [...existing.elements, span],
        });
      } else {
        const newEntry: HighlightedVocabularyWord = {
          word: match.word.word,
          level: match.word.level,
          difficulty: match.word.difficulty,
          elements: [span],
        };
        this.highlightedWords = new Map(this.highlightedWords).set(key, newEntry);
        highlighted.push(newEntry);
      }

      currentIndex = match.end;
    }

    // 添加剩余文本
    if (currentIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(currentIndex)));
    }

    // 替换原节点
    parent.replaceChild(fragment, textNode);

    return highlighted;
  }

  /**
   * 创建高亮元素
   */
  // WCAG 1.3.1: 使用 <mark> 语义元素替代 <span> 表示高亮内容
  private createHighlightElement(
    wordData: WordDifficultyResult,
    originalText: string
  ): HTMLElement {
    const mark = document.createElement('mark');
    mark.className = 'not-translator-vocab-highlight';
    mark.textContent = originalText;
    mark.title = `${wordData.word} (${wordData.level})`;
    mark.tabIndex = 0;
    mark.setAttribute('role', 'button');
    mark.setAttribute('aria-haspopup', 'dialog');

    // 添加数据属性
    mark.dataset.word = wordData.word;
    mark.dataset.level = wordData.level;
    mark.dataset.difficulty = String(wordData.difficulty);
    mark.dataset.confidence = String(wordData.confidence);

    // 应用样式类
    this.applyHighlightStyles(mark, wordData);

    return mark;
  }

  /**
   * 应用高亮样式
   */
  private applyHighlightStyles(element: HTMLElement, wordData: WordDifficultyResult): void {
    const { highlightStyle, showDifficultyIndicator } = this.config;

    // 基础样式类
    element.classList.add(`vocab-highlight-${highlightStyle}`);

    // 根据 CEFR 等级添加特定样式
    element.classList.add(`vocab-level-${wordData.level.toLowerCase()}`);

    // 添加难度指示器（如果需要）
    if (showDifficultyIndicator) {
      element.classList.add('vocab-with-indicator');

      // 根据置信度调整透明度
      const opacity = 0.5 + wordData.confidence * 0.5;
      element.style.setProperty('--vocab-highlight-opacity', String(opacity));
    }
  }

  /**
   * 转义正则特殊字符
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** 解除词汇标记包装，同时保留翻译等内部 DOM 结构 */
  private unwrapVocabularyMark(mark: HTMLElement): void {
    if (!mark.parentNode) return;
    mark.replaceWith(...Array.from(mark.childNodes));
  }

  /**
   * 清除所有高亮
   */
  clearAllHighlights(): void {
    TranslationDisplay.updateVocabularyHighlights([document.body], () => this.clearOriginalHighlights());
  }

  private clearOriginalHighlights(): void {
    // 合并内部记录与当前 DOM，只解除真实词汇包装，不拍平内部结构。
    const marksToUnwrap = new Set<HTMLElement>();
    for (const [, data] of this.highlightedWords) {
      data.elements.forEach((element) => marksToUnwrap.add(element));
    }
    document.querySelectorAll<HTMLElement>('mark.not-translator-vocab-highlight').forEach((element) => {
      marksToUnwrap.add(element);
    });
    marksToUnwrap.forEach((element) => this.unwrapVocabularyMark(element));

    this.highlightedWords = new Map();

    // vocab-known 状态的标记一并还原；词表状态由 vocabularyService 决定，重扫时会正确重建
    document.querySelectorAll<HTMLElement>('mark.vocab-known').forEach((element) => {
      this.unwrapVocabularyMark(element);
    });

    // 清除已处理标记
    document.querySelectorAll('.not-translator-vocab-processed').forEach((el) => {
      el.classList.remove('not-translator-vocab-processed');
    });

    this.processedElements = new WeakSet();

    logger.info('VocabularyHighlighter: 已清除所有高亮');
  }

  /**
   * 清除指定元素的高亮
   */
  clearElementHighlights(element: HTMLElement): void {
    TranslationDisplay.updateVocabularyHighlights([element], () => this.clearOriginalElementHighlights(element));
  }

  private clearOriginalElementHighlights(element: HTMLElement): void {
    // 查找并恢复此元素内的高亮
    const highlights = element.querySelectorAll<HTMLElement>('.not-translator-vocab-highlight');
    highlights.forEach((highlight) => {
      const word = highlight.textContent || '';
      const key = word.toLowerCase();

      // 从映射中移除（不可变更新）
      const data = this.highlightedWords.get(key);
      if (data) {
        const remaining = data.elements.filter((el) => el !== highlight);
        const next = new Map(this.highlightedWords);
        if (remaining.length === 0) {
          next.delete(key);
        } else {
          next.set(key, { ...data, elements: remaining });
        }
        this.highlightedWords = next;
      }

      // 解除词汇标记，保留可能存在的翻译子节点
      this.unwrapVocabularyMark(highlight);
    });

    // 移除已处理标记
    element.classList.remove('not-translator-vocab-processed');
    this.processedElements.delete(element);
  }

  /**
   * 获取当前高亮的所有单词
   */
  getHighlightedWords(): HighlightedVocabularyWord[] {
    return Array.from(this.highlightedWords.values());
  }

  /**
   * 检查单词是否已被高亮
   */
  isHighlighted(word: string): boolean {
    return this.highlightedWords.has(word.toLowerCase());
  }

  /**
   * 获取单词的高亮数据
   */
  getWordData(word: string): HighlightedVocabularyWord | undefined {
    return this.highlightedWords.get(word.toLowerCase());
  }

  /**
   * 添加自定义已知单词（用户认识的词）
   * 还原该词的 DOM 标记并同步词表
   */
  addKnownWord(word: string): void {
    this.vocabularyService.addKnownWord(word);
    this.refreshWord(word);
  }

  /**
   * 添加自定义未知单词（用户不认识的词）
   * 立即重扫包含该词的元素并生成高亮
   */
  addUnknownWord(word: string): void {
    this.vocabularyService.addUnknownWord(word);
    this.refreshWord(word);
  }

  /**
   * 移除已知标记（撤销认识），按当前等级重新评估高亮
   */
  removeKnownWord(word: string): void {
    this.vocabularyService.removeKnownWord(word);
    this.refreshWord(word);
  }

  /**
   * 移除未知标记（撤销不认识/移出生词本），按当前等级重新评估高亮
   */
  removeUnknownWord(word: string): void {
    this.vocabularyService.removeUnknownWord(word);
    this.refreshWord(word);
  }

  /**
   * 整体注入自定义词表（初始化/存储同步入口），并重新评估页面高亮
   */
  setCustomWords(known: Iterable<string>, unknown: Iterable<string>): void {
    this.vocabularyService.setCustomWords(known, unknown);
    if (this.scannedRoots.size > 0) {
      this.rescan();
    }
  }

  /**
   * 一次性应用等级 + 词表快照，最多触发一次重扫
   */
  applySnapshot(snapshot: {
    userLevel: CEFRLevel;
    knownWords: ReadonlySet<string>;
    unknownWords: ReadonlySet<string>;
  }): void {
    const levelChanged = snapshot.userLevel !== this.config.userLevel;
    this.vocabularyService.setCustomWords(snapshot.knownWords, snapshot.unknownWords);
    if (levelChanged) {
      this.config = { ...this.config, userLevel: snapshot.userLevel };
      this.vocabularyService.setUserLevel(snapshot.userLevel);
    }
    if (levelChanged || this.scannedRoots.size > 0) {
      this.rescan();
    }
  }

  /**
   * 清除全部高亮后，按当前词表与等级重扫所有仍连接在文档中的根元素
   */
  rescan(): void {
    if (this.destroyed) return;
    const active = document.activeElement;
    const restoreFocus = active instanceof HTMLElement && active.matches('mark.not-translator-vocab-highlight')
      ? captureFocusReturn(active) : null;
    const roots = this.getLiveRoots();
    TranslationDisplay.updateVocabularyHighlights([document.body], () => {
      this.clearOriginalHighlights();
      this.highlightOriginalElements(roots);
    });
    restoreFocus?.();
  }

  /**
   * 销毁：清除高亮与内部状态，之后不再处理新元素
   */
  destroy(): void {
    this.destroyed = true;
    this.clearAllHighlights();
    this.scannedRoots.clear();
  }

  /**
   * 收集仍连接在文档中的已扫描根元素，顺带清理脱离文档的引用
   */
  private getLiveRoots(): HTMLElement[] {
    const live: HTMLElement[] = [];
    for (const el of this.scannedRoots) {
      if (el.isConnected) {
        live.push(el);
      } else {
        this.scannedRoots.delete(el);
      }
    }
    return live;
  }

  /**
   * 按当前词表重新评估一个单词在页面上的高亮状态
   * 已知词仅还原为普通文本；否则还原 mark 后清容器处理标记并重扫
   */
  private refreshWord(word: string): void {
    if (this.destroyed) return;
    const normalized = word.toLowerCase().trim();
    if (!normalized) return;
    const active = document.activeElement;
    const restoreFocus = active instanceof HTMLElement && active.dataset.word?.toLowerCase() === normalized
      ? captureFocusReturn(active) : null;
    TranslationDisplay.updateVocabularyHighlights([document.body], () => this.refreshOriginalWord(normalized));
    restoreFocus?.();
  }

  private refreshOriginalWord(normalized: string): void {
    this.restoreWordMarks(normalized);

    if (this.vocabularyService.getKnownWords().has(normalized)) return;

    const containers = this.findContainersForWord(normalized);
    for (const el of containers) {
      el.classList.remove('not-translator-vocab-processed');
      this.processedElements.delete(el);
    }
    this.highlightOriginalElements(containers);
  }

  /**
   * 还原指定单词的所有 mark（含历史 vocab-known 状态）为文本节点，并从高亮映射中移除
   */
  private restoreWordMarks(normalized: string): void {
    const marks = Array.from(
      document.querySelectorAll<HTMLElement>(
        'mark.not-translator-vocab-highlight, mark.vocab-known'
      )
    ).filter((mark) => (mark.dataset.word || '').toLowerCase() === normalized);

    if (marks.length === 0) return;

    const next = new Map(this.highlightedWords);
    next.delete(normalized);
    this.highlightedWords = next;

    for (const mark of marks) {
      this.unwrapVocabularyMark(mark);
    }
  }

  /**
   * 找到页面上包含指定单词、需要重新评估的容器
   * 来源：带 vocab-processed 标记的元素 + 已跟踪的扫描根元素
   * （后者覆盖"已扫描但无高亮、无 DOM 标记"的元素）
   */
  private findContainersForWord(word: string): HTMLElement[] {
    const key = word.toLowerCase().trim();
    const containers = new Set<HTMLElement>();

    document.querySelectorAll('.not-translator-vocab-processed').forEach((el) => {
      if (el instanceof HTMLElement && (el.textContent || '').toLowerCase().includes(key)) {
        containers.add(el);
      }
    });

    for (const el of this.getLiveRoots()) {
      if ((el.textContent || '').toLowerCase().includes(key)) {
        containers.add(el);
      }
    }

    return Array.from(containers);
  }

  /**
   * 分析文本但不应用高亮
   * 用于获取文本难度统计
   */
  analyzeText(text: string): VocabularyFilterResult {
    return this.vocabularyService.analyzeText(text);
  }

  /**
   * 获取建议学习的单词列表
   */
  getRecommendedWords(limit?: number): WordDifficultyResult[] {
    const allText = document.body.innerText;
    const result = this.vocabularyService.analyzeText(allText);
    return getRecommendedWordsFromService(result, limit);
  }
}
