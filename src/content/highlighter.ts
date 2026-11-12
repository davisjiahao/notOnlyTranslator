import type { TranslatedWord } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';
import { findWordOccurrences, slicesCovering, slicesTouch, wrapCoveringSlices } from './highlightRanges';
import { getTranslatableText } from './pageScanner';

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
    const source = getTranslatableText(container);
    const occurrences = words.flatMap(word => findWordOccurrences(source, word.original, { boundary: 'ascii' })
      .map(occurrence => ({ word, occurrence })))
      .sort((a, b) => (b.occurrence.end - b.occurrence.start) - (a.occurrence.end - a.occurrence.start)
        || a.occurrence.start - b.occurrence.start);
    for (const { word, occurrence } of occurrences) {
      const slices = slicesCovering(container, occurrence.start, occurrence.end);
      if (!slices || slicesTouch(slices, `.${CSS_CLASSES.HIGHLIGHT}`)) continue;
      const marks = wrapCoveringSlices(slices, (sliceText) => this.createMark(word, occurrence.text, sliceText));
      if (!marks) continue;
      const key = occurrence.text.toLowerCase();
      const existing = this.highlightedElements.get(key) ?? [];
      this.highlightedElements.set(key, [...existing, ...marks]);
    }
  }

  /** 分段高亮共享整词数据，可见文本只保留当前切片。 */
  private createMark(word: TranslatedWord, occurrenceText: string, sliceText: string): HTMLElement {
    const mark = document.createElement('mark');
    mark.className = CSS_CLASSES.HIGHLIGHT;
    mark.textContent = sliceText;
    mark.title = `${occurrenceText} — ${word.translation}`;
    mark.tabIndex = 0;
    mark.setAttribute('role', 'button');
    mark.setAttribute('aria-haspopup', 'dialog');
    mark.dataset.word = occurrenceText;
    mark.dataset.translation = word.translation;
    mark.dataset.difficulty = String(word.difficulty);
    mark.dataset.isPhrase = String(word.isPhrase);
    return mark;
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
