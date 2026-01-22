import type { TranslatedWord } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';

/**
 * Highlighter - handles text highlighting in the page
 */
export class Highlighter {
  private highlightedElements: Map<string, HTMLElement[]> = new Map();

  /**
   * Highlight words in a text node
   */
  highlightWords(
    container: HTMLElement,
    words: TranslatedWord[]
  ): void {
    if (!words.length) return;

    // Create a map for quick lookup
    const wordMap = new Map<string, TranslatedWord>();
    words.forEach((w) => {
      wordMap.set(w.original.toLowerCase(), w);
    });

    // Walk through all text nodes
    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip if already processed or in script/style
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          const tagName = parent.tagName.toLowerCase();
          if (
            tagName === 'script' ||
            tagName === 'style' ||
            tagName === 'noscript' ||
            tagName === 'textarea' ||
            tagName === 'input' ||
            parent.classList.contains(CSS_CLASSES.HIGHLIGHT)
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          // Check if text contains any words to highlight
          const text = node.textContent?.toLowerCase() || '';
          for (const word of wordMap.keys()) {
            if (text.includes(word)) {
              return NodeFilter.FILTER_ACCEPT;
            }
          }

          return NodeFilter.FILTER_SKIP;
        },
      }
    );

    const nodesToProcess: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      nodesToProcess.push(node as Text);
    }

    // Process collected nodes
    nodesToProcess.forEach((textNode) => {
      this.processTextNode(textNode, wordMap);
    });
  }

  /**
   * Process a single text node to highlight words
   */
  private processTextNode(
    textNode: Text,
    wordMap: Map<string, TranslatedWord>
  ): void {
    const text = textNode.textContent || '';
    if (!text.trim()) return;

    const parent = textNode.parentNode;
    if (!parent) return;

    // Find all word matches in the text
    const matches: Array<{
      start: number;
      end: number;
      word: TranslatedWord;
    }> = [];

    for (const [, word] of wordMap) {
      // Use word boundary matching
      const regex = new RegExp(`\\b${this.escapeRegex(word.original)}\\b`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        matches.push({
          start: match.index,
          end: match.index + match[0].length,
          word: { ...word, original: match[0] }, // Preserve original case
        });
      }
    }

    if (!matches.length) return;

    // Sort matches by position
    matches.sort((a, b) => a.start - b.start);

    // Remove overlapping matches
    const filteredMatches: typeof matches = [];
    let lastEnd = 0;
    for (const match of matches) {
      if (match.start >= lastEnd) {
        filteredMatches.push(match);
        lastEnd = match.end;
      }
    }

    // Create document fragment with highlighted spans
    const fragment = document.createDocumentFragment();
    let currentIndex = 0;

    for (const match of filteredMatches) {
      // Add text before the match
      if (match.start > currentIndex) {
        fragment.appendChild(
          document.createTextNode(text.slice(currentIndex, match.start))
        );
      }

      // Create highlighted span
      const span = document.createElement('span');
      span.className = CSS_CLASSES.HIGHLIGHT;
      span.textContent = match.word.original;
      span.dataset.word = match.word.original;
      span.dataset.translation = match.word.translation;
      span.dataset.difficulty = String(match.word.difficulty);
      span.dataset.isPhrase = String(match.word.isPhrase);

      fragment.appendChild(span);

      // Track highlighted elements
      const key = match.word.original.toLowerCase();
      if (!this.highlightedElements.has(key)) {
        this.highlightedElements.set(key, []);
      }
      this.highlightedElements.get(key)!.push(span);

      currentIndex = match.end;
    }

    // Add remaining text
    if (currentIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(currentIndex)));
    }

    // Replace original text node
    parent.replaceChild(fragment, textNode);
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Mark a word as known (update highlight style)
   */
  markAsKnown(word: string): void {
    const elements = this.highlightedElements.get(word.toLowerCase());
    if (elements) {
      elements.forEach((el) => {
        el.classList.remove(CSS_CLASSES.UNKNOWN);
        el.classList.add(CSS_CLASSES.KNOWN);
      });
    }
  }

  /**
   * Mark a word as unknown (update highlight style)
   */
  markAsUnknown(word: string): void {
    const elements = this.highlightedElements.get(word.toLowerCase());
    if (elements) {
      elements.forEach((el) => {
        el.classList.remove(CSS_CLASSES.KNOWN);
        el.classList.add(CSS_CLASSES.UNKNOWN);
      });
    }
  }

  /**
   * Remove highlight from a word
   */
  removeHighlight(word: string): void {
    const elements = this.highlightedElements.get(word.toLowerCase());
    if (elements) {
      elements.forEach((el) => {
        const text = document.createTextNode(el.textContent || '');
        el.parentNode?.replaceChild(text, el);
      });
      this.highlightedElements.delete(word.toLowerCase());
    }
  }

  /**
   * Clear all highlights
   */
  clearAllHighlights(): void {
    for (const word of this.highlightedElements.keys()) {
      this.removeHighlight(word);
    }
    this.highlightedElements.clear();
  }

  /**
   * Get all highlighted words
   */
  getHighlightedWords(): string[] {
    return Array.from(this.highlightedElements.keys());
  }

  /**
   * Check if a word is highlighted
   */
  isHighlighted(word: string): boolean {
    return this.highlightedElements.has(word.toLowerCase());
  }
}
