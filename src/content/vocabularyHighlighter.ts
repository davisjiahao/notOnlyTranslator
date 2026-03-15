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
  /** DOM 元素引用 */
  elements: HTMLElement[];
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

    // 如果用户等级改变，需要重新扫描
    if (config.userLevel !== undefined && oldLevel !== config.userLevel) {
      this.clearAllHighlights();
      this.processedElements = new WeakSet();
    }
  }

  /**
   * 高亮单个元素中的词汇
   *
   * @param element - 要处理的 HTML 元素
   * @returns 识别并高亮的单词列表
   */
  highlightElement(element: HTMLElement): HighlightedVocabularyWord[] {
    // 检查是否已处理过
    if (this.processedElements.has(element)) {
      return [];
    }

    // 检查是否应该跳过此元素
    if (!this.shouldProcessElement(element)) {
      this.processedElements.add(element);
      return [];
    }

    // 获取元素文本
    const text = element.textContent || '';
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
    if (!this.config.enabled) {
      return [];
    }

    const allHighlighted: HighlightedVocabularyWord[] = [];

    for (const element of elements) {
      const highlighted = this.highlightElement(element);
      allHighlighted.push(...highlighted);
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

    // 跳过翻译相关的元素
    if (
      element.classList.contains(CSS_CLASSES.HIGHLIGHT) ||
      element.classList.contains('not-translator-processed') ||
      element.classList.contains('not-translator-translation-line')
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
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;

        // 跳过已经是高亮词的部分
        if (parent.classList.contains('not-translator-vocab-highlight')) {
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

      // 记录高亮的单词
      const key = match.word.word.toLowerCase();
      if (this.highlightedWords.has(key)) {
        const existing = this.highlightedWords.get(key)!;
        existing.elements.push(span);
      } else {
        const newEntry: HighlightedVocabularyWord = {
          word: match.word.word,
          level: match.word.level,
          difficulty: match.word.difficulty,
          elements: [span],
        };
        this.highlightedWords.set(key, newEntry);
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
  private createHighlightElement(
    wordData: WordDifficultyResult,
    originalText: string
  ): HTMLSpanElement {
    const span = document.createElement('span');
    span.className = 'not-translator-vocab-highlight';
    span.textContent = originalText;

    // 添加数据属性
    span.dataset.word = wordData.word;
    span.dataset.level = wordData.level;
    span.dataset.difficulty = String(wordData.difficulty);
    span.dataset.confidence = String(wordData.confidence);

    // 应用样式类
    this.applyHighlightStyles(span, wordData);

    return span;
  }

  /**
   * 应用高亮样式
   */
  private applyHighlightStyles(element: HTMLSpanElement, wordData: WordDifficultyResult): void {
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

  /**
   * 清除所有高亮
   */
  clearAllHighlights(): void {
    // 恢复原始文本
    for (const [, data] of this.highlightedWords) {
      for (const element of data.elements) {
        if (element.parentNode) {
          const text = document.createTextNode(element.textContent || '');
          element.parentNode.replaceChild(text, element);
        }
      }
    }

    this.highlightedWords.clear();

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
    // 查找并恢复此元素内的高亮
    const highlights = element.querySelectorAll('.not-translator-vocab-highlight');
    highlights.forEach((highlight) => {
      const word = highlight.textContent || '';
      const key = word.toLowerCase();

      // 从映射中移除
      if (this.highlightedWords.has(key)) {
        const data = this.highlightedWords.get(key)!;
        data.elements = data.elements.filter((el) => el !== highlight);
        if (data.elements.length === 0) {
          this.highlightedWords.delete(key);
        }
      }

      // 恢复文本节点
      if (highlight.parentNode) {
        const text = document.createTextNode(word);
        highlight.parentNode.replaceChild(text, highlight);
      }
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
   */
  addKnownWord(word: string): void {
    this.vocabularyService.addKnownWord(word);

    // 移除该单词的高亮
    const key = word.toLowerCase();
    if (this.highlightedWords.has(key)) {
      const data = this.highlightedWords.get(key)!;
      for (const element of data.elements) {
        element.classList.add('vocab-known');
        element.classList.remove('not-translator-vocab-highlight');
      }
    }
  }

  /**
   * 添加自定义未知单词（用户不认识的词）
   */
  addUnknownWord(word: string): void {
    this.vocabularyService.addUnknownWord(word);

    // 重新扫描包含该单词的元素
    const elements = document.querySelectorAll('.not-translator-vocab-processed');
    elements.forEach((el) => {
      const text = el.textContent?.toLowerCase() || '';
      if (text.includes(word.toLowerCase())) {
        // 清除已处理标记，允许重新处理
        el.classList.remove('not-translator-vocab-processed');
        this.processedElements.delete(el as HTMLElement);
      }
    });
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
