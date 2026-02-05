import type { TranslationResult, TranslationMode, TranslatedWord, TranslatedSentence } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';

/**
 * TranslationDisplay - 根据不同模式渲染翻译结果
 *
 * 设计原则：
 * 1. 非侵入式：使用 TreeWalker 遍历文本节点，只包装需要高亮的词汇
 * 2. 保持原有事件：不替换整个 innerHTML，保留原有的点击、链接等事件
 * 3. 选中触发：高亮词的交互改为选中后弹窗，避免干扰原有点击事件
 */
export class TranslationDisplay {
  /**
   * 应用翻译到段落
   */
  static applyTranslation(
    paragraph: HTMLElement,
    result: TranslationResult,
    mode: TranslationMode
  ): void {
    // 保存原始HTML（用于恢复）
    if (!paragraph.dataset.originalHtml) {
      paragraph.dataset.originalHtml = paragraph.innerHTML;
    }

    // 先移除已有的翻译
    this.clearTranslation(paragraph);

    switch (mode) {
      case 'inline-only':
        this.applyInlineModeNonInvasive(paragraph, result);
        break;
      case 'bilingual':
        this.applyBilingualModeNonInvasive(paragraph, result);
        break;
      case 'full-translate':
        this.applyFullTranslateModeNonInvasive(paragraph, result);
        break;
    }

    // 无论什么模式，如果识别出了具体的语法点，都进行波浪线高亮（非侵入式）
    if (result.grammarPoints && result.grammarPoints.length > 0) {
      this.applyGrammarHighlights(paragraph, result.grammarPoints);
    }
  }

  /**
   * 应用语法高亮（波浪线）
   */
  private static applyGrammarHighlights(
    paragraph: HTMLElement,
    grammarPoints: import('@/shared/types').GrammarPoint[]
  ): void {
    // 按长度倒序排列，先包装长的，避免短的匹配破坏长结构的 DOM 查找
    const sortedPoints = [...grammarPoints].sort((a, b) => b.original.length - a.original.length);

    for (const point of sortedPoints) {
      this.wrapGrammarInText(paragraph, point);
    }
  }

  /**
   * 包装语法点（行内注解模式）
   *
   * 改进：直接在语法高亮后面显示解释，无需点击
   * 格式：原文 [语法类型: 解释]
   */
  private static wrapGrammarInText(
    paragraph: HTMLElement,
    point: import('@/shared/types').GrammarPoint
  ): void {
    const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, null);
    let currentNode: Text | null;
    let found = false;

    while ((currentNode = walker.nextNode() as Text | null) && !found) {
      const nodeText = currentNode.textContent || '';
      const index = nodeText.toLowerCase().indexOf(point.original.toLowerCase());

      if (index !== -1) {
        const parent = currentNode.parentNode;
        if (!parent || (parent as HTMLElement).classList?.contains('not-translator-highlight')) continue;
        if ((parent as HTMLElement).classList?.contains('not-translator-grammar-highlight')) continue;

        const beforeText = nodeText.slice(0, index);
        const matchedText = nodeText.slice(index, index + point.original.length);
        const afterText = nodeText.slice(index + point.original.length);

        // 1. 创建语法高亮 span (波浪线部分)
        const grammarSpan = document.createElement('span');
        grammarSpan.className = 'not-translator-grammar-highlight';
        grammarSpan.dataset.grammarExplanation = point.explanation;
        grammarSpan.dataset.grammarType = point.type || '语法点';
        grammarSpan.dataset.grammarOriginal = point.original;
        grammarSpan.textContent = matchedText;

        // 2. 创建独立的注解标签 (解释部分)
        const annotationSpan = document.createElement('span');
        annotationSpan.className = 'not-translator-grammar-annotation';
        // 格式：[类型: 解释]
        const shortType = this.shortenGrammarType(point.type || '语法');
        annotationSpan.textContent = `${shortType}: ${point.explanation}`;
        annotationSpan.title = `${point.type}: ${point.explanation}`;

        const fragment = document.createDocumentFragment();
        if (beforeText) fragment.appendChild(document.createTextNode(beforeText));
        fragment.appendChild(grammarSpan);
        fragment.appendChild(annotationSpan); // 作为兄弟节点插入，而非子节点
        if (afterText) fragment.appendChild(document.createTextNode(afterText));

        parent.replaceChild(fragment, currentNode);
        found = true;
      }
    }
  }

  /**
   * 缩短语法类型名称
   */
  private static shortenGrammarType(type: string): string {
    const shortNames: Record<string, string> = {
      '虚拟语气': '虚拟',
      '倒装句': '倒装',
      '定语从句': '定从',
      '状语从句': '状从',
      '名词性从句': '名从',
      '强调句': '强调',
      '独立主格': '独立主格',
      '分词结构': '分词',
      '不定式': '不定式',
      '动名词': '动名词',
    };
    return shortNames[type] || type;
  }

  /**
   * 模式1: 行内翻译（非侵入式）
   * 在原文中找到生词位置，用 span 包装并在后面添加译文
   */
  private static applyInlineModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    // 按位置从后往前排序（避免修改DOM时位置偏移）
    const sortedWords = [...result.words].sort((a, b) => b.position[0] - a.position[0]);

    // 遍历每个生词，在原文中找到并包装
    for (const word of sortedWords) {
      this.wrapWordInText(paragraph, word, true);
    }

    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 模式2: 双文对照（非侵入式）
   * 在原文中高亮生词，在段落后添加译文行
   */
  private static applyBilingualModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    if (!result.fullText) {
      // 如果没有完整译文，降级为行内模式
      this.applyInlineModeNonInvasive(paragraph, result);
      return;
    }

    // 按位置从后往前排序
    const sortedWords = [...result.words].sort((a, b) => b.position[0] - a.position[0]);

    // 在原文中高亮生词，并显示行内译文
    for (let i = sortedWords.length - 1; i >= 0; i--) {
      const word = sortedWords[i];
      this.wrapWordInText(paragraph, word, true, i);
    }

    // 创建译文行
    const translationLine = document.createElement('div');
    translationLine.className = 'not-translator-translation-line';

    let translationHtml = this.escapeHtml(result.fullText);

    // 在译文中标记每个生词的翻译
    // 按原始顺序处理
    const wordsInOrder = [...result.words].sort((a, b) => a.position[0] - b.position[0]);
    wordsInOrder.forEach((word, i) => {
      const translation = word.translation;
      const regex = new RegExp(this.escapeRegex(translation), 'g');
      let matchCount = 0;

      translationHtml = translationHtml.replace(regex, (match) => {
        matchCount++;
        if (matchCount === 1) {
          return `<span class="not-translator-highlighted-translation" data-index="${i}" data-word="${this.escapeHtml(word.original)}">${match}</span>`;
        }
        return match;
      });
    });

    translationLine.innerHTML = translationHtml;

    // 在段落后插入译文行
    paragraph.insertAdjacentElement('afterend', translationLine);

    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 模式3: 全文翻译（译文替换原文模式）
   * 用译文替换原文内容，同时保留 DOM 结构（链接、样式、事件等）
   */
  private static applyFullTranslateModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    if (!result.fullText) {
      this.applyInlineModeNonInvasive(paragraph, result);
      return;
    }

    // 保存原始文本
    this.saveOriginalText(paragraph);

    // 检查是否有需要保留的 DOM 结构（链接、格式元素等）
    const hasPreservableElements = paragraph.querySelector(
      'a, strong, b, em, i, code, span[style], span[onclick], button'
    ) !== null;

    if (hasPreservableElements) {
      // 使用保留 DOM 结构的替换方法
      this.replaceTextPreservingDom(paragraph, result);
    } else {
      // 简单结构，直接替换
      paragraph.textContent = result.fullText;
    }

    paragraph.classList.add('not-translator-processed');
    paragraph.classList.add('not-translator-full-translated');
  }

  /**
   * 保留 DOM 结构的文本替换
   * 使用 TreeWalker 遍历文本节点，逐个替换文本内容
   */
  private static replaceTextPreservingDom(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    const walker = document.createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT,
      null
    );

    // 收集所有文本节点及其原始长度（用于后续按比例分配）
    const textNodesInfo: Array<{ node: Text; originalLength: number }> = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent?.trim()) {
        textNodesInfo.push({
          node,
          originalLength: node.textContent.length
        });
      }
    }

    if (textNodesInfo.length === 0) {
      paragraph.textContent = result.fullText || '';
      return;
    }

    const textNodes = textNodesInfo.map(info => info.node);

    // 优先使用 sentences 数据进行句子级别替换
    if (result.sentences && result.sentences.length > 0) {
      this.replaceBySentences(textNodes, result.sentences);
    }

    // 使用 words 数据替换剩余的英文单词
    if (result.words && result.words.length > 0) {
      this.replaceByWords(textNodes, result.words);
    }

    // 最后检查：如果英文残留太多，使用 fullText 按比例分配（基于原始长度）
    this.handleRemainingText(paragraph, textNodesInfo, result.fullText || '');
  }

  /**
   * 使用 sentences 数据替换文本
   * 注意：如果句子跨越多个文本节点，此方法可能无法完全替换，
   * 残留的英文会由后续的 words 替换或 handleRemainingText 处理
   */
  private static replaceBySentences(
    textNodes: Text[],
    sentences: TranslatedSentence[]
  ): void {
    // 按长度降序排序，先替换长的避免部分匹配问题
    const sorted = [...sentences].sort(
      (a, b) => b.original.length - a.original.length
    );

    for (const sentence of sorted) {
      if (!sentence.original || !sentence.translation) continue;

      // 尝试在单个文本节点中找到完整句子
      for (const textNode of textNodes) {
        const content = textNode.textContent || '';
        if (content.includes(sentence.original)) {
          textNode.textContent = content.replace(
            sentence.original,
            sentence.translation
          );
          break; // 每个句子只替换一次
        }
      }
    }
  }

  /**
   * 使用 words 数据替换剩余的英文单词
   */
  private static replaceByWords(
    textNodes: Text[],
    words: TranslatedWord[]
  ): void {
    const sorted = [...words].sort(
      (a, b) => b.original.length - a.original.length
    );

    // 单词边界检查函数（包含 Unicode 字符支持）
    const isWordBoundary = (char: string) =>
      /[\s.,!?;:'"()[\]{}<>/\\-\u4e00-\u9fff\u3040-\u30ff]/.test(char) || char === '';

    for (const word of sorted) {
      for (const textNode of textNodes) {
        const content = textNode.textContent || '';
        const lowerContent = content.toLowerCase();
        const lowerOriginal = word.original.toLowerCase();
        const index = lowerContent.indexOf(lowerOriginal);

        if (index !== -1) {
          const before = index > 0 ? content[index - 1] : ' ';
          const after = index + word.original.length < content.length
            ? content[index + word.original.length]
            : ' ';

          if (isWordBoundary(before) && isWordBoundary(after)) {
            const beforeText = content.slice(0, index);
            const afterText = content.slice(index + word.original.length);

            // 替换为译文
            textNode.textContent = beforeText + word.translation + afterText;
            break;
          }
        }
      }
    }
  }

  /**
   * 处理残留文本：如果还有大量英文，按比例分配 fullText
   * 使用原始文本长度进行比例计算，避免被之前的替换影响
   */
  private static handleRemainingText(
    paragraph: HTMLElement,
    textNodesInfo: Array<{ node: Text; originalLength: number }>,
    fullText: string
  ): void {
    const remainingText = paragraph.textContent || '';
    // 匹配3个字符以上的英文单词（排除 "a", "an", "the" 等短词干扰）
    const englishWords = remainingText.match(/[a-zA-Z]{3,}/g) || [];

    // 英文残留阈值：超过5个单词说明之前的替换策略效果不佳
    const REMAINING_ENGLISH_THRESHOLD = 5;
    if (englishWords.length > REMAINING_ENGLISH_THRESHOLD) {
      // 使用原始长度计算比例
      const totalOriginalLength = textNodesInfo.reduce(
        (sum, info) => sum + info.originalLength, 0
      );

      if (totalOriginalLength === 0) return;

      let translationPos = 0;
      for (let i = 0; i < textNodesInfo.length; i++) {
        const { node, originalLength } = textNodesInfo[i];
        const ratio = originalLength / totalOriginalLength;
        const translationLength = Math.round(ratio * fullText.length);

        // 最后一个节点取剩余所有文本
        const endPos = i === textNodesInfo.length - 1
          ? fullText.length
          : Math.min(translationPos + translationLength, fullText.length);

        node.textContent = fullText.slice(translationPos, endPos);
        translationPos = endPos;
      }
    }
  }

  /**
   * 在段落中找到并包装指定的单词
   * 使用 TreeWalker 遍历文本节点，精确定位单词位置
   */
  private static wrapWordInText(
    paragraph: HTMLElement,
    word: TranslatedWord,
    showInlineTranslation: boolean,
    dataIndex?: number
  ): void {
    const targetText = word.original;

    // 创建 TreeWalker 遍历所有文本节点
    const walker = document.createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT,
      null
    );

    let currentNode: Text | null;
    let found = false;

    while ((currentNode = walker.nextNode() as Text | null) && !found) {
      const nodeText = currentNode.textContent || '';

      // 使用不区分大小写的匹配，找到单词
      const lowerNodeText = nodeText.toLowerCase();
      const lowerTarget = targetText.toLowerCase();
      const index = lowerNodeText.indexOf(lowerTarget);

      if (index !== -1) {
        // 检查是否是完整单词（前后是边界）
        const before = index > 0 ? nodeText[index - 1] : ' ';
        const after = index + targetText.length < nodeText.length
          ? nodeText[index + targetText.length]
          : ' ';

        // 简单的单词边界检查
        const isWordBoundary = (char: string) => /[\s.,!?;:'"()[\]{}<>/\\-]/.test(char) || char === '';

        if (isWordBoundary(before) && isWordBoundary(after)) {
          // 找到了目标单词，进行包装
          const parent = currentNode.parentNode;
          if (!parent) continue;

          // 检查父元素是否已经是高亮元素，避免重复包装
          if ((parent as HTMLElement).classList?.contains(CSS_CLASSES.HIGHLIGHT)) {
            continue;
          }

          // 分割文本节点
          const beforeText = nodeText.slice(0, index);
          const matchedText = nodeText.slice(index, index + targetText.length);
          const afterText = nodeText.slice(index + targetText.length);

          // 创建高亮 span
          const highlightSpan = document.createElement('span');
          highlightSpan.className = CSS_CLASSES.HIGHLIGHT;
          highlightSpan.setAttribute('data-difficulty', String(word.difficulty));
          highlightSpan.setAttribute('data-translation', word.translation);
          highlightSpan.setAttribute('data-word', word.original);
          if (word.isPhrase) {
            highlightSpan.setAttribute('data-is-phrase', 'true');
          }
          if (dataIndex !== undefined) {
            highlightSpan.setAttribute('data-index', String(dataIndex));
            highlightSpan.classList.add('not-translator-highlighted-word');
          }
          highlightSpan.textContent = matchedText;

          // 如果需要显示行内译文
          if (showInlineTranslation) {
            const translationSpan = document.createElement('span');
            translationSpan.className = 'not-translator-inline-translation';
            translationSpan.textContent = word.translation;
            highlightSpan.appendChild(translationSpan);
          }

          // 替换原文本节点
          const fragment = document.createDocumentFragment();
          if (beforeText) {
            fragment.appendChild(document.createTextNode(beforeText));
          }
          fragment.appendChild(highlightSpan);
          if (afterText) {
            fragment.appendChild(document.createTextNode(afterText));
          }

          parent.replaceChild(fragment, currentNode);
          found = true;
        }
      }
    }
  }

  /**
   * 清除段落中的翻译
   */
  static clearTranslation(paragraph: HTMLElement): void {
    if (paragraph.classList.contains('not-translator-processed')) {
      // 移除后面添加的译文行
      let nextSibling = paragraph.nextElementSibling;
      while (nextSibling) {
        if (
          nextSibling.classList.contains('not-translator-translation-line') ||
          nextSibling.classList.contains('not-translator-full-translation')
        ) {
          const toRemove = nextSibling;
          nextSibling = nextSibling.nextElementSibling;
          toRemove.remove();
        } else {
          break;
        }
      }

      // 恢复原始HTML
      if (paragraph.dataset.originalHtml) {
        paragraph.innerHTML = paragraph.dataset.originalHtml;
      }

      paragraph.classList.remove('not-translator-processed');
      paragraph.classList.remove('not-translator-full-translated');
    }
  }

  /**
   * HTML转义
   */
  private static escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 正则表达式转义
   */
  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * 检查元素是否已处理
   */
  static isProcessed(element: HTMLElement): boolean {
    return element.classList.contains('not-translator-processed');
  }

  /**
   * 保存原始文本到data属性
   */
  static saveOriginalText(element: HTMLElement): void {
    if (!element.dataset.originalText) {
      element.dataset.originalText = element.textContent || '';
    }
    if (!element.dataset.originalHtml) {
      element.dataset.originalHtml = element.innerHTML;
    }
  }

  /**
   * 显示加载中状态
   * 使用一个独立的 Loading 元素，而不是修改段落本身
   */
  static showLoading(element: HTMLElement): void {
    if (element.querySelector('.not-translator-loading-spinner')) return;

    // 标记段落正在处理
    element.classList.add('not-translator-paragraph-loading');

    // 创建 Loading 指示器
    const spinner = document.createElement('span');
    spinner.className = 'not-translator-loading-spinner';
    spinner.innerHTML = `
      <svg class="animate-spin" viewBox="0 0 24 24" fill="none" style="width: 10px; height: 10px;">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
    `;

    // 根据元素类型决定插入位置
    // 标题类元素插在后面，段落类元素插在开头或结尾
    element.appendChild(spinner);
  }

  /**
   * 移除加载中状态
   */
  static removeLoading(element: HTMLElement): void {
    element.classList.remove('not-translator-paragraph-loading');
    const spinner = element.querySelector('.not-translator-loading-spinner');
    if (spinner) {
      spinner.remove();
    }
  }
}
