import type { TranslationResult, TranslationMode, TranslatedWord, UserSettings } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';
import { normalizeWordSet } from './core/vocabularyState';
import { createTranslatableTextWalker, getTranslatableText, isInExcludedArea } from './pageScanner';

/**
 * TranslationDisplay - 根据不同模式渲染翻译结果
 *
 * 设计原则：
 * 1. 非侵入式：使用 TreeWalker 遍历文本节点，只包装需要高亮的词汇
 * 2. 保持原有事件：不替换整个 innerHTML，保留原有的点击、链接等事件
 * 3. 选中触发：高亮词的交互改为选中后弹窗，避免干扰原有点击事件
 */
export class TranslationDisplay {
  // 只留存成功展示的结果，段落索引复用现有 processed 标记，断开节点不被强引用。
  private static results = new WeakMap<HTMLElement, { result: TranslationResult; mode: TranslationMode; settings?: UserSettings; text: string }>();
  private static restorations = new WeakMap<HTMLElement, Array<{
    canRestore: (children: ReadonlyMap<Node, readonly Node[]>) => boolean;
    previewRestore?: (children: Map<Node, readonly Node[]>) => void;
    restore: () => void;
  }>>();

  private static knownWords: ReadonlySet<string> = new Set();

  /** 只更新页内知识状态，使用方决定何时本地重绘；常规清空不重置知识状态。 */
  static setKnownWords(words: readonly string[]): void {
    this.knownWords = normalizeWordSet(words);
  }

  static setWordKnown(word: string, known: boolean): void {
    const normalized = [...normalizeWordSet([word])][0];
    if (!normalized) return;
    this.knownWords = known
      ? new Set([...this.knownWords, normalized])
      : new Set([...this.knownWords].filter(existing => existing !== normalized));
  }

  /** 纯展示模式切换：先保存条目，再由 applyTranslation 清理和重绘。 */
  static rerenderTranslations(mode: TranslationMode): void {
    const entries = Array.from(document.querySelectorAll<HTMLElement>('.not-translator-processed'),
      paragraph => [paragraph, this.results.get(paragraph)] as const);
    for (const [paragraph, saved] of entries) {
      if (saved && paragraph.isConnected) this.applyTranslation(paragraph, saved.result, mode, saved.settings);
    }
  }

  /** 词汇高亮只修改原文；完成后按原模式重绘，避免双方改写彼此拥有的节点。 */
  static updateVocabularyHighlights<T>(roots: readonly HTMLElement[], update: () => T): T {
    const entries = Array.from(document.querySelectorAll<HTMLElement>('.not-translator-processed')).flatMap(paragraph => {
      const saved = this.results.get(paragraph);
      if (!saved || !roots.some(root => root.contains(paragraph) || paragraph.contains(root))) return [];
      if (!this.clearTranslationContent(paragraph)) return [];
      return [{ paragraph, saved, text: getTranslatableText(paragraph) }];
    });
    // 只有同步更新成功才重新呈现；抛错时传播错误，保留原文且不登记旧结果。
    const updated = update();
    for (const { paragraph, saved, text } of entries) {
      // 回调期间正文若有外部改动，不能用旧翻译覆盖；资格仍由 apply 再核验。
      if (paragraph.isConnected && getTranslatableText(paragraph) === text) {
        this.applyTranslation(paragraph, saved.result, saved.mode, saved.settings);
      }
    }
    return updated;
  }

  /** 常规清空、词表或其他配置失效时，同时丢弃断开节点的旧结果。 */
  static clearAll(): void {
    document.querySelectorAll<HTMLElement>('.not-translator-processed').forEach(paragraph => {
      this.clearTranslation(paragraph);
    });
    this.results = new WeakMap();
    this.restorations = new WeakMap();
  }

  /**
   * 应用翻译到段落
   */
  static applyTranslation(
    paragraph: HTMLElement,
    result: TranslationResult,
    mode: TranslationMode,
    settings?: UserSettings
  ): void {
    // 在途响应到达时重新检查当前资格，必须早于快照、旧译文清理及任何写入。
    if (!paragraph.isConnected || isInExcludedArea(paragraph)) {
      this.discardTranslationState(paragraph);
      return;
    }

    // 只恢复本轮实际替换的正文文本；站点已改稿时不能用旧结果覆盖。
    if (!this.clearTranslationContent(paragraph)) return;
    this.saveOriginalText(paragraph);

    // 留存原始结果，展示只派生过滤词义；改回未知时无需重新获取译文。
    const displayResult = {
      ...result,
      words: result.words.filter(word => !this.knownWords.has(word.original.toLowerCase().trim())),
    };
    switch (mode) {
      case 'inline-only':
        this.applyInlineModeNonInvasive(paragraph, displayResult);
        break;
      case 'bilingual':
        this.applyBilingualModeNonInvasive(paragraph, displayResult);
        break;
      case 'full-translate':
        this.applyFullTranslateModeNonInvasive(paragraph, displayResult);
        break;
    }

    // 仅在启用语法翻译且识别出了具体的语法点时，才进行波浪线高亮
    if (settings?.grammarTranslationEnabled && result.grammarPoints && result.grammarPoints.length > 0) {
      this.applyGrammarHighlights(paragraph, result.grammarPoints);
    }
    this.results.set(paragraph, { result, mode, settings, text: getTranslatableText(paragraph) });
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
    const walker = createTranslatableTextWalker(paragraph);
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
        grammarSpan.tabIndex = 0;
        grammarSpan.setAttribute('role', 'button');
        grammarSpan.setAttribute('aria-haspopup', 'dialog');
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

        this.replaceTextNode(paragraph, currentNode, fragment);
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
   * 在英文生词后直接显示中文，复用行内注释样式与 Tooltip 数据
   */
  private static applyInlineModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    this.applyOriginalWordHighlights(paragraph, result.words, false);

    paragraph.classList.add('not-translator-processed');
  }

  /** 两种原文模式统一长短语优先；同词多义只使用核验过的出现位置。 */
  private static applyOriginalWordHighlights(paragraph: HTMLElement, words: TranslatedWord[], bilingual: boolean): void {
    const entries = [...words].sort((a, b) => a.position[0] - b.position[0])
      .map((word, index) => ({ word, index }))
      .sort((a, b) => b.word.original.length - a.word.original.length);
    const unmatched: TranslatedWord[] = [];
    for (const { word, index } of entries) {
      const alternatives = words.filter(other => other.original.toLowerCase() === word.original.toLowerCase()
        && other.translation !== word.translation);
      const conflictingPosition = alternatives.some(other => other.position[0] === word.position[0]);
      const matched = !conflictingPosition && this.wrapWordInText(paragraph, word, true,
        bilingual ? index : undefined, alternatives.length > 0 ? word.position : undefined);
      if (!matched && alternatives.length > 0 && word.original.trim() && word.translation.trim()) unmatched.push(word);
    }
    if (unmatched.length > 0) this.appendWordGlossary(paragraph, unmatched);
  }

  private static appendWordGlossary(paragraph: HTMLElement, words: TranslatedWord[]): void {
    const glossary = document.createElement('div');
    glossary.className = 'not-translator-translation-line';
    glossary.textContent = '难词对照：';
    const unique = [...new Map(words.map(word => [JSON.stringify([word.original, word.translation]), word])).values()];
    unique.forEach((word, index) => {
      if (index > 0) glossary.appendChild(document.createTextNode('；'));
      glossary.appendChild(this.createTranslationWordMark(word));
    });
    paragraph.insertAdjacentElement('afterend', glossary);
  }

  /** 无全文时仅展示已有词义，说明复用排除正文抽取且可自动清理的译文行。 */
  private static applyWordOnlyFallback(paragraph: HTMLElement, result: TranslationResult): void {
    this.applyInlineModeNonInvasive(paragraph, result);
    const notice = document.createElement('div');
    notice.className = 'not-translator-translation-line';
    notice.textContent = result.words.some(word => word.original.trim() && word.translation.trim())
      ? '当前仅有词义，暂无全文译文' : '当前没有全文译文，已保留原文';
    paragraph.insertAdjacentElement('afterend', notice);
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
      this.applyWordOnlyFallback(paragraph, result);
      return;
    }

    this.applyOriginalWordHighlights(paragraph, result.words, true);

    // 创建译文行（使用 DOM API 避免 XSS）
    const translationLine = document.createElement('div');
    translationLine.className = 'not-translator-translation-line';

    // 使用 DOM API 构建译文内容
    this.buildTranslationLineContent(translationLine, result);

    // 在段落后插入译文行
    paragraph.insertAdjacentElement('afterend', translationLine);

    paragraph.classList.add('not-translator-processed');
  }

  /**
   * 使用 DOM API 构建译文行内容（避免 XSS 风险）
   */
  private static buildTranslationLineContent(
    container: HTMLElement,
    result: TranslationResult
  ): void {
    const fullText = result.fullText;
    if (!fullText) return;

    // 收集需要高亮的词汇翻译及其索引
    const highlights: Array<{ translation: string; index: number; word: string }> = [];
    const wordsInOrder = [...result.words].sort((a, b) => a.position[0] - b.position[0]);
    wordsInOrder.forEach((word, i) => {
      if (word.translation && fullText.includes(word.translation)) {
        highlights.push({
          translation: word.translation,
          index: i,
          word: word.original
        });
      }
    });

    // 最终渲染：逐个处理高亮词汇
    this.renderTranslationWithHighlights(container, fullText, highlights);
  }

  /**
   * 渲染带高亮的译文
   */
  private static renderTranslationWithHighlights(
    container: HTMLElement,
    fullText: string,
    highlights: Array<{ translation: string; index: number; word: string }>
  ): void {
    if (highlights.length === 0) {
      container.textContent = fullText;
      return;
    }

    // 按首次出现位置排序
    const sortedHighlights = [...highlights].sort((a, b) => {
      const posA = fullText.indexOf(a.translation);
      const posB = fullText.indexOf(b.translation);
      return posA - posB;
    });

    let currentPos = 0;
    const fragment = document.createDocumentFragment();

    for (const highlight of sortedHighlights) {
      const pos = fullText.indexOf(highlight.translation, currentPos);
      if (pos === -1) continue;

      // 添加高亮前的普通文本
      if (pos > currentPos) {
        fragment.appendChild(document.createTextNode(fullText.slice(currentPos, pos)));
      }

      // WCAG 1.3.1: 使用 <mark> 语义元素表示高亮译文
      const highlightMark2 = document.createElement('mark');
      highlightMark2.className = 'not-translator-highlighted-translation';
      highlightMark2.title = `${highlight.word} → ${highlight.translation}`;
      highlightMark2.tabIndex = 0;
      highlightMark2.setAttribute('role', 'button');
      highlightMark2.setAttribute('aria-haspopup', 'dialog');
      highlightMark2.dataset.index = String(highlight.index);
      highlightMark2.dataset.word = highlight.word;
      highlightMark2.textContent = highlight.translation;
      fragment.appendChild(highlightMark2);

      currentPos = pos + highlight.translation.length;
    }

    // 添加剩余文本
    if (currentPos < fullText.length) {
      fragment.appendChild(document.createTextNode(fullText.slice(currentPos)));
    }

    container.appendChild(fragment);
  }

  /**
   * 模式3: 全文翻译（译文替换原文模式）
   * 用译文替换原文内容，同时保留 DOM 结构（链接、样式、事件等）
   * 并在译文中标注生词的原文
   */
  private static applyFullTranslateModeNonInvasive(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    if (!result.fullText) {
      this.applyWordOnlyFallback(paragraph, result);
      return;
    }

    // 保存原始文本
    this.saveOriginalText(paragraph);

    // 英语词汇包装仍保留原节点，但不能把等级、词卡目标和焦点转移到中文片段。
    this.suspendVocabularyHighlights(paragraph);
    // 即使纯文本段落，也只替换有资格的文本节点，以便安全恢复同一原文节点。
    this.replaceTextPreservingDom(paragraph, result);

    // 在译文中标注生词（译文后附加原文）
    if (result.words && result.words.length > 0) {
      this.annotateWordsInTranslation(paragraph, result);
    }

    paragraph.classList.add('not-translator-processed');
    paragraph.classList.add('not-translator-full-translated');
  }

  /** 全文期间暂停旧英语装饰与交互，恢复属性复用同一批安全撤销预检。 */
  private static suspendVocabularyHighlights(paragraph: HTMLElement): void {
    const names = ['class', 'title', 'tabindex', 'role', 'aria-haspopup', 'data-word', 'data-level', 'data-difficulty', 'data-confidence'];
    for (const mark of paragraph.querySelectorAll<HTMLElement>('mark.not-translator-vocab-highlight')) {
      if (isInExcludedArea(mark)) continue;
      const attributes = names.map(name => [name, mark.getAttribute(name)] as const);
      mark.classList.replace('not-translator-vocab-highlight', 'not-translator-inactive-vocabulary');
      names.slice(1).forEach(name => mark.removeAttribute(name));
      const inactive = names.map(name => [name, mark.getAttribute(name)] as const);
      const canRestore = () => paragraph.contains(mark) && !isInExcludedArea(mark)
        && inactive.every(([name, value]) => mark.getAttribute(name) === value);
      const restore = () => attributes.forEach(([name, value]) => {
        if (value === null) mark.removeAttribute(name);
        else mark.setAttribute(name, value);
      });
      this.restorations.set(paragraph, [...(this.restorations.get(paragraph) || []), { canRestore, restore }]);
    }
  }

  /**
   * 在译文内部标注生词
   * 将译文中的生词用 span 包裹，并附加原文标注
   * 样式与对照翻译中的高亮译文保持一致
   */
  private static annotateWordsInTranslation(
    container: HTMLElement,
    result: TranslationResult
  ): void {
    // 去重后长词义优先，不能把短词插入已有标注或按多义分隔符猜测正文位置。
    const words = [...new Map(result.words
      .filter(word => word.original.trim() && word.translation.trim())
      .map(word => [JSON.stringify([word.original.toLowerCase(), word.translation]), word])).values()];
    const sortedWords = [...words].sort((a, b) => b.translation.length - a.translation.length);
    const unmatched: TranslatedWord[] = [];
    for (const word of sortedWords) {
      const ambiguous = words.some(other => other !== word && other.translation === word.translation);
      if (!ambiguous && this.wrapTranslationWord(container, word)) continue;
      unmatched.push(word);
    }
    if (unmatched.length > 0) this.appendWordGlossary(container, unmatched);
  }

  /**
   * 在译文中包裹单个生词
   * 格式：<span class="highlighted-translation">译文<span class="原文标注">原文</span></span>
   * 使用与对照翻译相同的样式类，确保样式一致
   *
   * 改进：保留DOM结构，不破坏链接、按钮等元素
   */
  private static wrapTranslationWord(
    container: HTMLElement,
    word: TranslatedWord
  ): boolean {
    const translation = word.translation;
    // 单字和多义列表容易误中其他词，保守放入独立对照，不改写正文。
    if (translation.length < 2 || /[;；,，/、|]/.test(translation)) return false;
    const walker = createTranslatableTextWalker(container);
    const nodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      if (!node.parentElement?.closest('.not-translator-highlighted-translation, [onclick]')) nodes.push(node);
    }

    let matched = false;
    for (const textNode of nodes) {
      const parts = (textNode.textContent || '').split(translation);
      if (parts.length < 2) continue;
      const fragment = document.createDocumentFragment();
      parts.forEach((part, index) => {
        if (index > 0) fragment.appendChild(this.createTranslationWordMark(word));
        fragment.appendChild(document.createTextNode(part));
      });
      this.replaceTextNode(container, textNode, fragment);
      matched = true;
    }
    return matched;
  }

  /** 正文标注和未匹配难词对照共享安全文本及交互数据。 */
  private static createTranslationWordMark(word: TranslatedWord): HTMLElement {
    const mark = document.createElement('mark');
    mark.className = 'not-translator-highlighted-translation';
    mark.dataset.difficulty = String(word.difficulty);
    mark.dataset.original = word.original;
    mark.dataset.word = word.original;
    mark.dataset.translation = word.translation;
    if (word.isPhrase) mark.dataset.isPhrase = 'true';
    mark.title = `${word.original} — ${word.translation}`;
    mark.tabIndex = 0;
    mark.setAttribute('role', 'button');
    mark.setAttribute('aria-haspopup', 'dialog');
    mark.textContent = word.translation;
    const annotation = document.createElement('span');
    annotation.className = 'not-translator-inline-translation';
    annotation.textContent = word.original;
    mark.appendChild(annotation);
    return mark;
  }

  /**
   * 保留 DOM 结构的文本替换
   * 使用 TreeWalker 遍历文本节点，逐个替换文本内容
   */
  private static replaceTextPreservingDom(
    paragraph: HTMLElement,
    result: TranslationResult
  ): void {
    const walker = createTranslatableTextWalker(paragraph);

    // 收集所有文本节点及其原始长度（用于后续按比例分配）
    const textNodesInfo: Array<{ node: Text; originalLength: number }> = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      // 独立空白也属于原文，全文分配时必须一起替换，不能夹进中文译文。
      if (node.textContent) {
        textNodesInfo.push({
          node,
          originalLength: node.textContent.length
        });
      }
    }

    if (textNodesInfo.length === 0) return;
    // 全文必须逐字保留，逐词/逐句结果只作难词标注，不能替代 fullText。
    const fullText = result.fullText || '';
    const totalOriginalLength = textNodesInfo.reduce((sum, info) => sum + info.originalLength, 0);
    let translationPos = 0;
    for (const [index, { node, originalLength }] of textNodesInfo.entries()) {
      // ponytail: 只按长度保留元素结构，不猜测跨节点语义；词义被切开时使用段末对照。
      const endPos = index === textNodesInfo.length - 1
        ? fullText.length
        : Math.min(translationPos + Math.round(originalLength / totalOriginalLength * fullText.length), fullText.length);
      this.replaceTextNode(paragraph, node, document.createTextNode(fullText.slice(translationPos, endPos)));
      translationPos = endPos;
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
    dataIndex?: number,
    position?: [number, number]
  ): boolean {
    const targetText = word.original;
    if (!targetText.trim() || !word.translation.trim()) return false;
    if (position && (!Number.isInteger(position[0]) || position[0] < 0 || position[1] - position[0] !== targetText.length)) return false;
    const source = getTranslatableText(paragraph);
    const walker = createTranslatableTextWalker(paragraph);
    const nodes: Array<{ node: Text; offset: number }> = [];
    let node: Text | null;
    let offset = 0;
    while ((node = walker.nextNode() as Text | null)) {
      if (!node.parentElement?.closest(`.${CSS_CLASSES.HIGHLIGHT}`)) nodes.push({ node, offset });
      offset += node.textContent?.length || 0;
    }

    let matched = false;
    for (const { node: textNode, offset: start } of nodes) {
      const text = textNode.textContent || '';
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      let index = text.toLowerCase().indexOf(targetText.toLowerCase());
      while (index !== -1) {
        const end = index + targetText.length;
        // 拒绝词内子串后继续查找，模型偏移不影响真实正文匹配。
        if ((!position || start + index === position[0]) &&
            !/[\p{L}\p{N}_]/u.test(source[start + index - 1] || '') && !/[\p{L}\p{N}_]/u.test(source[start + end] || '')) {
          fragment.appendChild(document.createTextNode(text.slice(cursor, index)));
          const mark = document.createElement('mark');
          mark.className = CSS_CLASSES.HIGHLIGHT;
          mark.title = `${word.original} — ${word.translation}`;
          mark.tabIndex = 0;
          mark.setAttribute('role', 'button');
          mark.setAttribute('aria-haspopup', 'dialog');
          mark.dataset.difficulty = String(word.difficulty);
          mark.dataset.translation = word.translation;
          mark.dataset.word = word.original;
          if (word.isPhrase) mark.dataset.isPhrase = 'true';
          if (dataIndex !== undefined) {
            mark.dataset.index = String(dataIndex);
            mark.classList.add('not-translator-highlighted-word');
          }
          mark.textContent = text.slice(index, end);
          if (showInlineTranslation) {
            const annotation = document.createElement('span');
            annotation.className = 'not-translator-inline-translation';
            annotation.textContent = word.translation;
            mark.appendChild(annotation);
          }
          fragment.appendChild(mark);
          cursor = end;
        }
        index = text.toLowerCase().indexOf(targetText.toLowerCase(), end);
      }
      if (cursor > 0) {
        fragment.appendChild(document.createTextNode(text.slice(cursor)));
        this.replaceTextNode(paragraph, textNode, fragment);
        matched = true;
      }
    }
    return matched;
  }

  /**
   * 清除段落中的翻译
   */
  static clearTranslation(paragraph: HTMLElement): void {
    this.clearTranslationContent(paragraph);
  }

  /** 只撤销本文件生成的文本节点，绝不反序列化旧 HTML 重建保护节点。 */
  private static replaceTextNode(paragraph: HTMLElement, original: Text, replacement: Node): void {
    const parent = original.parentElement;
    if (!parent) return;
    const nodes = replacement.nodeType === Node.DOCUMENT_FRAGMENT_NODE
      ? Array.from(replacement.childNodes) : [replacement];
    const snapshots = nodes.map(node => node.cloneNode(true));
    original.replaceWith(replacement);
    // 先模拟已通过预检的子节点撤销，避免把自有语法嵌套误判为父标记被外部改写。
    const canRestore = (children: ReadonlyMap<Node, readonly Node[]>) => paragraph.contains(parent) && !isInExcludedArea(parent)
      && nodes.every((node, index) => (children.get(parent) || Array.from(parent.childNodes)).includes(node)
        && this.snapshotRestoredNode(node, children).isEqualNode(snapshots[index]));
    const previewRestore = (children: Map<Node, readonly Node[]>) => {
      children.set(parent, (children.get(parent) || Array.from(parent.childNodes)).flatMap(node =>
        node === nodes[0] ? [original] : nodes.includes(node) ? [] : [node]));
    };
    const restore = () => {
      parent.replaceChild(original, nodes[0]);
      nodes.slice(1).forEach(node => parent.removeChild(node));
    };
    this.restorations.set(paragraph, [...(this.restorations.get(paragraph) || []), { canRestore, previewRestore, restore }]);
  }

  /** 克隆仅用于比对；未登记的属性、正文或保护节点变化仍完整参与预检。 */
  private static snapshotRestoredNode(node: Node, children: ReadonlyMap<Node, readonly Node[]>): Node {
    const snapshot = node.cloneNode(false);
    for (const child of children.get(node) || Array.from(node.childNodes)) {
      snapshot.appendChild(this.snapshotRestoredNode(child, children));
    }
    return snapshot;
  }

  /** 资格或正文失效时只废弃元数据，不碰当前正文及生成节点。 */
  private static discardTranslationState(paragraph: HTMLElement): void {
    this.results.delete(paragraph);
    this.restorations.delete(paragraph);
    delete paragraph.dataset.originalHtml;
    delete paragraph.dataset.originalText;
  }

  private static clearTranslationContent(paragraph: HTMLElement): boolean {
    const saved = this.results.get(paragraph);
    const restorations = this.restorations.get(paragraph) || [];
    this.discardTranslationState(paragraph);
    if (!paragraph.isConnected || isInExcludedArea(paragraph)) return false;
    // 无标注或新增正文也要核验；仅抽取可译正文，保护区域实时变化不影响恢复。
    if (saved && getTranslatableText(paragraph) !== saved.text) return false;

    // 必须全部预检通过再写回，避免后面的失败导致正文只恢复一半。
    const reversed = [...restorations].reverse();
    const restoredChildren = new Map<Node, readonly Node[]>();
    const restored = reversed.every(entry => {
      if (!entry.canRestore(restoredChildren)) return false;
      entry.previewRestore?.(restoredChildren);
      return true;
    });
    // 预检失败只废弃旧结果，不能让已完成段落退回待翻译态或删掉当前节点。
    if (!restored) return false;
    reversed.forEach(entry => entry.restore());
    if (paragraph.classList.contains('not-translator-processed')) {
      let sibling = paragraph.nextElementSibling;
      while (sibling?.matches('.not-translator-translation-line, .not-translator-full-translation')) {
        const next = sibling.nextElementSibling;
        sibling.remove();
        sibling = next;
      }
      paragraph.querySelectorAll(this.EXCLUDED_SNAPSHOT_SELECTOR).forEach(node => node.remove());
    }
    paragraph.classList.remove('not-translator-fade-out', 'not-translator-processed', 'not-translator-full-translated');
    return restored;
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
    // 批次分发会先单独保存快照，同样不能采集已失去正文资格的内容。
    if (!element.isConnected || isInExcludedArea(element)) return;
    if (!element.dataset.originalText) {
      element.dataset.originalText = element.textContent || '';
    }
    if (!element.dataset.originalHtml) {
      element.dataset.originalHtml = this.snapshotOriginalHtml(element);
    }
  }

  /**
   * 生成排除扩展临时节点后的 HTML 快照
   * 并发批次时序下短暂存在于段落子树内的错误通知不应进入快照：
   * 通过克隆移除后读取，既不原地修改原文 DOM，也避免恢复时复活临时节点。
   * （段落级 spinner 注入已移除：翻译进行中段落保持零临时节点，进度由悬浮按钮显示。）
   */
  private static readonly EXCLUDED_SNAPSHOT_SELECTOR = '.not-translator-error-notification';

  private static snapshotOriginalHtml(element: HTMLElement): string {
    if (!element.querySelector(this.EXCLUDED_SNAPSHOT_SELECTOR)) {
      return element.innerHTML;
    }
    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(this.EXCLUDED_SNAPSHOT_SELECTOR).forEach(node => node.remove());
    return clone.innerHTML;
  }
}
