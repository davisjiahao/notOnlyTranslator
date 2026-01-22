import type { Message, MessageResponse, UnknownWordEntry } from '@/shared/types';

/**
 * Marker Service - handles word marking and communication with background
 */
export class MarkerService {
  /**
   * Mark a word as known
   */
  async markKnown(word: string, difficulty: number = 5): Promise<void> {
    const response = await this.sendMessage({
      type: 'MARK_WORD_KNOWN',
      payload: { word, difficulty },
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to mark word as known');
    }
  }

  /**
   * Mark a word as unknown and add to vocabulary
   */
  async markUnknown(
    word: string,
    translation: string,
    context: string = ''
  ): Promise<void> {
    const entry: UnknownWordEntry = {
      word,
      translation,
      context,
      markedAt: Date.now(),
      reviewCount: 0,
    };

    const response = await this.sendMessage({
      type: 'MARK_WORD_UNKNOWN',
      payload: entry,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to mark word as unknown');
    }
  }

  /**
   * Add word to vocabulary (synonym for markUnknown)
   */
  async addToVocabulary(
    word: string,
    translation: string,
    context: string = ''
  ): Promise<void> {
    const entry: UnknownWordEntry = {
      word,
      translation,
      context,
      markedAt: Date.now(),
      reviewCount: 0,
    };

    const response = await this.sendMessage({
      type: 'ADD_TO_VOCABULARY',
      payload: entry,
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to add word to vocabulary');
    }
  }

  /**
   * Remove word from vocabulary
   */
  async removeFromVocabulary(word: string): Promise<void> {
    const response = await this.sendMessage({
      type: 'REMOVE_FROM_VOCABULARY',
      payload: { word },
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to remove word from vocabulary');
    }
  }

  /**
   * Get context around a selection
   */
  getSelectionContext(maxLength: number = 100): string {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return '';
    }

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;

    // Get text content of the container
    const fullText =
      container.nodeType === Node.TEXT_NODE
        ? container.parentElement?.textContent || ''
        : (container as HTMLElement).textContent || '';

    // Find position of selection in full text
    const selectedText = selection.toString();
    const selectionIndex = fullText.indexOf(selectedText);

    if (selectionIndex === -1) {
      return fullText.slice(0, maxLength * 2);
    }

    // Extract context around selection
    const start = Math.max(0, selectionIndex - maxLength);
    const end = Math.min(
      fullText.length,
      selectionIndex + selectedText.length + maxLength
    );

    return fullText.slice(start, end);
  }

  /**
   * Send message to background script
   */
  private async sendMessage(message: Message): Promise<MessageResponse> {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response: MessageResponse) => {
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: chrome.runtime.lastError.message,
          });
        } else {
          resolve(response || { success: false, error: 'No response' });
        }
      });
    });
  }
}
