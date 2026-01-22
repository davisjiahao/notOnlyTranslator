import type {
  Message,
  MessageResponse,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';
import { debounce } from '@/shared/utils';
import { Highlighter } from './highlighter';
import { Tooltip } from './tooltip';
import { MarkerService } from './marker';
import { TranslationDisplay } from './translationDisplay';

/**
 * Content Script - main entry point for page interaction
 */
class NotOnlyTranslator {
  private highlighter: Highlighter;
  private tooltip: Tooltip;
  private marker: MarkerService;
  private settings: UserSettings | null = null;
  private isEnabled: boolean = true;
  private observer: MutationObserver | null = null;

  constructor() {
    console.log('NotOnlyTranslator: Content script loaded, starting initialization...');

    this.highlighter = new Highlighter();
    this.marker = new MarkerService();
    this.tooltip = new Tooltip({
      onMarkKnown: (word) => this.handleMarkKnown(word),
      onMarkUnknown: (word, translation) =>
        this.handleMarkUnknown(word, translation),
      onAddToVocabulary: (word, translation) =>
        this.handleAddToVocabulary(word, translation),
    });

    this.init();
  }

  /**
   * Initialize the content script
   */
  private async init(): Promise<void> {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      await new Promise<void>((resolve) => {
        document.addEventListener('DOMContentLoaded', () => resolve());
      });
    }

    // Load settings with retry
    let retryCount = 0;
    const maxRetries = 3;
    while (retryCount < maxRetries) {
      await this.loadSettings();
      if (this.settings) {
        break;
      }
      retryCount++;
      console.log(`NotOnlyTranslator: Retrying settings load (${retryCount}/${maxRetries})...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (!this.settings) {
      console.error('NotOnlyTranslator: Failed to load settings after retries');
      return;
    }

    if (!this.settings.enabled) {
      console.log('NotOnlyTranslator: Extension is disabled');
      return;
    }

    // Setup event listeners
    this.setupEventListeners();

    // Setup message listener for background script
    this.setupMessageListener();

    // Setup mutation observer for dynamic content
    this.setupMutationObserver();

    // Initial page scan (debounced)
    this.scanPage();

    console.log('NotOnlyTranslator initialized with settings:', this.settings);
  }

  /**
   * Load settings from background
   */
  private async loadSettings(): Promise<void> {
    try {
      const response = await this.sendMessage({ type: 'GET_SETTINGS' });
      if (response.success && response.data) {
        this.settings = response.data as UserSettings;
        this.isEnabled = this.settings.enabled;

        // Apply highlight color
        document.documentElement.style.setProperty(
          '--not-translator-highlight-color',
          this.settings.highlightColor
        );
        console.log('NotOnlyTranslator: Settings loaded successfully');
      } else {
        console.warn('NotOnlyTranslator: Failed to load settings:', response.error);
      }
    } catch (error) {
      console.error('NotOnlyTranslator: Error loading settings:', error);
    }
  }

  /**
   * Setup event listeners for user interactions
   */
  private setupEventListeners(): void {
    // Click on highlighted words
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;

      if (target.classList.contains(CSS_CLASSES.HIGHLIGHT)) {
        e.preventDefault();
        e.stopPropagation();
        this.showTooltipForHighlight(target);
      }
    });

    // Double-click to translate selection
    document.addEventListener('dblclick', async () => {
      if (!this.settings?.enabled) return;

      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0 && selectedText.length < 100) {
        // Wait a bit for selection to stabilize
        await new Promise((resolve) => setTimeout(resolve, 100));

        const range = selection?.getRangeAt(0);
        if (range) {
          const rect = range.getBoundingClientRect();
          const tempElement = document.createElement('span');
          tempElement.style.position = 'absolute';
          tempElement.style.left = `${rect.left}px`;
          tempElement.style.top = `${rect.top}px`;
          document.body.appendChild(tempElement);

          await this.translateSelection(selectedText, tempElement);
          document.body.removeChild(tempElement);
        }
      }
    });
  }

  /**
   * Setup message listener for background script messages
   */
  private setupMessageListener(): void {
    chrome.runtime.onMessage.addListener(
      (message: Message & { type: string }, _sender, sendResponse) => {
        switch (message.type) {
          case 'SHOW_TRANSLATION':
            this.handleShowTranslation(message.payload as { text: string });
            sendResponse({ success: true });
            break;

          case 'WORD_MARKED':
            this.handleWordMarked(
              message.payload as { word: string; isKnown: boolean }
            );
            sendResponse({ success: true });
            break;

          case 'ADDED_TO_VOCABULARY':
            this.handleAddedToVocabulary(
              message.payload as { word: string; translation: string }
            );
            sendResponse({ success: true });
            break;

          case 'SETTINGS_UPDATED':
            this.loadSettings();
            sendResponse({ success: true });
            break;

          case 'TOGGLE_ENABLED':
            this.toggleEnabled();
            sendResponse({ success: true });
            break;

          default:
            sendResponse({ success: false, error: 'Unknown message type' });
        }
        return true;
      }
    );
  }

  /**
   * Setup mutation observer for dynamic content
   */
  private setupMutationObserver(): void {
    const debouncedScan = debounce(() => this.scanPage(), 1000);

    this.observer = new MutationObserver((mutations) => {
      // Check if any meaningful content was added
      const hasNewContent = mutations.some((mutation) => {
        return Array.from(mutation.addedNodes).some((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            return (
              el.textContent &&
              el.textContent.length > 50 &&
              !el.classList.contains(CSS_CLASSES.TOOLTIP) &&
              !el.classList.contains(CSS_CLASSES.HIGHLIGHT)
            );
          }
          return false;
        });
      });

      if (hasNewContent && this.settings?.autoHighlight) {
        debouncedScan();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Scan page for content to translate
   */
  private async scanPage(): Promise<void> {
    if (!this.isEnabled) {
      console.log('NotOnlyTranslator: Scan skipped - extension disabled');
      return;
    }
    if (!this.settings?.autoHighlight) {
      console.log('NotOnlyTranslator: Scan skipped - autoHighlight disabled');
      return;
    }

    const mode = this.settings?.translationMode || 'inline-only';
    console.log(`NotOnlyTranslator: Starting scan with mode: ${mode}`);

    // Get paragraphs to translate
    const paragraphs = this.getParagraphs();
    console.log(`NotOnlyTranslator: Found ${paragraphs.length} paragraphs to scan`);

    for (const paragraph of paragraphs) {
      // Skip already processed paragraphs
      if (TranslationDisplay.isProcessed(paragraph)) continue;

      const text = paragraph.textContent || '';
      if (text.length < 50) continue;

      try {
        console.log(`NotOnlyTranslator: Translating paragraph (${text.length} chars):`, text.substring(0, 100) + '...');

        // Save original text before modifying
        TranslationDisplay.saveOriginalText(paragraph);

        const result = await this.translateText(text);

        console.log('NotOnlyTranslator: Translation result received:', {
          wordsCount: result.words?.length || 0,
          sentencesCount: result.sentences?.length || 0,
          hasFullText: !!result.fullText,
          fullTextPreview: result.fullText?.substring(0, 100) || 'N/A',
          words: result.words?.slice(0, 3) || []
        });

        // Apply translation based on mode
        if (result.words.length > 0 || result.fullText) {
          console.log(`NotOnlyTranslator: Applying translation to paragraph with mode: ${mode}`);
          TranslationDisplay.applyTranslation(paragraph, result, mode);

          // Setup click handlers for highlighted words in the paragraph
          this.setupParagraphClickHandlers(paragraph);
          console.log('NotOnlyTranslator: Translation applied successfully');
        } else {
          console.log('NotOnlyTranslator: No words or fullText in result, skipping paragraph');
        }
      } catch (error) {
        console.error('NotOnlyTranslator: Failed to translate content:', error);
      }
    }
    console.log('NotOnlyTranslator: Scan completed');
  }

  /**
   * Setup click handlers for highlighted words in a paragraph
   */
  private setupParagraphClickHandlers(paragraph: HTMLElement): void {
    const highlightedWords = paragraph.querySelectorAll(`.${CSS_CLASSES.HIGHLIGHT}`);

    highlightedWords.forEach((element) => {
      element.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const target = e.target as HTMLElement;
        const word = target.textContent?.trim() || '';
        const translation = target.dataset.translation || '';
        const difficulty = parseInt(target.dataset.difficulty || '5', 10);

        // Show tooltip for more details
        if (translation) {
          this.tooltip.showWord(target, {
            original: word,
            translation,
            position: [0, 0],
            difficulty,
            isPhrase: false,
          });
        } else {
          // Fetch translation if not available
          this.showTooltipForHighlight(target);
        }
      });
    });

    // Setup hover effect for bilingual mode - link original and translation highlights
    this.setupBilingualHoverEffects(paragraph);
  }

  /**
   * Setup hover effects for bilingual mode to link original and translation highlights
   */
  private setupBilingualHoverEffects(paragraph: HTMLElement): void {
    const originalHighlights = paragraph.querySelectorAll('.not-translator-highlighted-word');

    originalHighlights.forEach((original) => {
      const index = original.getAttribute('data-index');
      const corresponding = paragraph.querySelector(`.not-translator-highlighted-translation[data-index="${index}"]`);

      if (corresponding) {
        original.addEventListener('mouseenter', () => {
          corresponding.classList.add('not-translator-hover-linked');
        });
        original.addEventListener('mouseleave', () => {
          corresponding.classList.remove('not-translator-hover-linked');
        });

        corresponding.addEventListener('mouseenter', () => {
          original.classList.add('not-translator-hover-linked');
        });
        corresponding.addEventListener('mouseleave', () => {
          original.classList.remove('not-translator-hover-linked');
        });
      }
    });
  }

  /**
   * Get paragraphs to translate
   */
  private getParagraphs(): HTMLElement[] {
    const contentAreas = this.getContentAreas();
    const paragraphs: HTMLElement[] = [];

    for (const area of contentAreas) {
      // Get all paragraph-like elements
      const elements = area.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, figcaption');
      elements.forEach((el) => {
        // Skip if already processed or has no meaningful content
        if (!TranslationDisplay.isProcessed(el) && el.textContent && el.textContent.trim().length >= 50) {
          paragraphs.push(el);
        }
      });

      // If no specific elements found, treat the whole area as one paragraph
      if (paragraphs.length === 0 && area.textContent && area.textContent.trim().length >= 50) {
        paragraphs.push(area);
      }
    }

    return paragraphs;
  }

  /**
   * Get content areas to scan
   */
  private getContentAreas(): HTMLElement[] {
    // Try to find main content areas
    const selectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.article-content',
      '.entry-content',
      '#content',
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        return Array.from(elements);
      }
    }

    // Fallback to body
    return [document.body];
  }

  /**
   * Translate text using background service
   */
  private async translateText(text: string, context?: string): Promise<TranslationResult> {
    const mode = this.settings?.translationMode || 'inline-only';

    console.log('NotOnlyTranslator: Sending TRANSLATE_TEXT message to background');
    const response = await this.sendMessage({
      type: 'TRANSLATE_TEXT',
      payload: {
        text,
        context: context || '',
        mode,
      },
    });

    console.log('NotOnlyTranslator: Received response from background:', {
      success: response.success,
      error: response.error,
      hasData: !!response.data,
      dataType: typeof response.data,
      dataPreview: response.data ? JSON.stringify(response.data).substring(0, 200) : 'N/A'
    });

    if (!response.success) {
      throw new Error(response.error || 'Translation failed');
    }

    return response.data as TranslationResult;
  }

  /**
   * Show tooltip for a highlighted word
   */
  private showTooltipForHighlight(element: HTMLElement): void {
    const word = element.dataset.word || element.textContent || '';
    const translation = element.dataset.translation || '';
    const difficulty = parseInt(element.dataset.difficulty || '5', 10);
    const isPhrase = element.dataset.isPhrase === 'true';

    if (translation) {
      this.tooltip.showWord(element, {
        original: word,
        translation,
        position: [0, 0],
        difficulty,
        isPhrase,
      });
    } else {
      // Need to fetch translation
      this.tooltip.showLoading(element);
      this.translateSelection(word, element);
    }
  }

  /**
   * Translate a selection and show tooltip
   */
  private async translateSelection(
    text: string,
    targetElement: HTMLElement
  ): Promise<void> {
    try {
      this.tooltip.showLoading(targetElement);

      const result = await this.translateText(text);

      if (result.words.length > 0) {
        this.tooltip.showWord(targetElement, result.words[0]);
      } else if (result.sentences.length > 0) {
        this.tooltip.showSentence(targetElement, result.sentences[0]);
      } else {
        this.tooltip.showError(targetElement, '未找到需要翻译的内容');
      }
    } catch (error) {
      this.tooltip.showError(
        targetElement,
        error instanceof Error ? error.message : '翻译失败'
      );
    }
  }

  /**
   * Handle mark as known
   */
  private async handleMarkKnown(word: string): Promise<void> {
    try {
      await this.marker.markKnown(word);
      this.highlighter.markAsKnown(word);
    } catch (error) {
      console.error('Failed to mark as known:', error);
    }
  }

  /**
   * Handle mark as unknown
   */
  private async handleMarkUnknown(
    word: string,
    translation: string
  ): Promise<void> {
    try {
      const context = this.marker.getSelectionContext();
      await this.marker.markUnknown(word, translation, context);
      this.highlighter.markAsUnknown(word);
    } catch (error) {
      console.error('Failed to mark as unknown:', error);
    }
  }

  /**
   * Handle add to vocabulary
   */
  private async handleAddToVocabulary(
    word: string,
    translation: string
  ): Promise<void> {
    try {
      const context = this.marker.getSelectionContext();
      await this.marker.addToVocabulary(word, translation, context);
      this.highlighter.markAsUnknown(word);
    } catch (error) {
      console.error('Failed to add to vocabulary:', error);
    }
  }

  /**
   * Handle show translation message from context menu
   */
  private handleShowTranslation(payload: { text: string }): void {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Create temporary element for positioning
    const tempElement = document.createElement('span');
    tempElement.style.position = 'absolute';
    tempElement.style.left = `${rect.left + window.scrollX}px`;
    tempElement.style.top = `${rect.bottom + window.scrollY}px`;
    document.body.appendChild(tempElement);

    this.translateSelection(payload.text, tempElement).then(() => {
      // Remove temp element after a delay
      setTimeout(() => {
        if (document.body.contains(tempElement)) {
          document.body.removeChild(tempElement);
        }
      }, 100);
    });
  }

  /**
   * Handle word marked message
   */
  private handleWordMarked(payload: { word: string; isKnown: boolean }): void {
    if (payload.isKnown) {
      this.highlighter.markAsKnown(payload.word);
    } else {
      this.highlighter.markAsUnknown(payload.word);
    }
  }

  /**
   * Handle added to vocabulary message
   */
  private handleAddedToVocabulary(payload: {
    word: string;
    translation: string;
  }): void {
    this.highlighter.markAsUnknown(payload.word);
  }

  /**
   * Toggle enabled state
   */
  private toggleEnabled(): void {
    this.isEnabled = !this.isEnabled;

    if (!this.isEnabled) {
      this.highlighter.clearAllHighlights();
      this.tooltip.hide();
      // Clear all translation displays
      this.clearAllTranslations();
    } else {
      this.scanPage();
    }
  }

  /**
   * Clear all translations from the page
   */
  private clearAllTranslations(): void {
    const processedElements = document.querySelectorAll<HTMLElement>('.not-translator-processed');
    processedElements.forEach((element) => {
      TranslationDisplay.clearTranslation(element);
    });
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

  /**
   * Cleanup
   */
  destroy(): void {
    this.observer?.disconnect();
    this.highlighter.clearAllHighlights();
    this.tooltip.destroy();
  }
}

// For CRXJS - the onExecute function is called when the content script is injected
let translator: NotOnlyTranslator | null = null;

export function onExecute() {
  if (!translator) {
    translator = new NotOnlyTranslator();

    // Cleanup on unload
    window.addEventListener('unload', () => {
      translator?.destroy();
      translator = null;
    });
  }
}

// Also auto-initialize for non-CRXJS environments
if (typeof chrome !== 'undefined' && chrome.runtime) {
  onExecute();
}

export { NotOnlyTranslator };
