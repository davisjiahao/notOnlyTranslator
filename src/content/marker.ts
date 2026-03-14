import type { Message, MessageResponse, UnknownWordEntry } from '@/shared/types';
import { CSS_CLASSES } from '@/shared/constants';

/**
 * 标记类型
 */
export type MarkType = 'known' | 'unknown';

/**
 * 标记选项
 */
export interface MarkOptions {
  /** 是否更新UI */
  updateUI?: boolean;
  /** 是否同步到background */
  syncToBackground?: boolean;
}

/**
 * 标记回调函数
 */
export interface MarkerCallbacks {
  /** 当单词被标记时调用 */
  onMarked?: (word: string, type: MarkType) => void;
  /** 当错误发生时调用 */
  onError?: (word: string, error: string) => void;
}

/**
 * 标记条目
 */
interface MarkEntry {
  word: string;
  type: MarkType;
  timestamp: number;
}

/**
 * Marker Service - handles word marking and communication with background
 */
export class MarkerService {
  /** 已标记的单词映射 */
  private markedWords: Map<string, MarkEntry> = new Map();
  /** 回调函数 */
  private callbacks: MarkerCallbacks;
  /** 待同步的单词队列 */
  private pendingSync: Set<string> = new Set();

  /**
   * 构造函数
   */
  constructor(callbacks: MarkerCallbacks = {}) {
    this.callbacks = callbacks;
  }

  /**
   * 获取标准化的单词键
   */
  private normalizeKey(word: string): string {
    return word.toLowerCase().trim();
  }

  /**
   * 更新DOM元素的标记样式
   */
  private updateUI(word: string, type: MarkType | null): void {
    const elements = document.querySelectorAll(`[data-word="${word}"]`);
    elements.forEach(el => {
      const element = el as HTMLElement;
      if (type === null) {
        // 移除标记
        element.classList.remove(CSS_CLASSES.KNOWN, CSS_CLASSES.UNKNOWN);
      } else if (type === 'known') {
        element.classList.add(CSS_CLASSES.KNOWN);
        element.classList.remove(CSS_CLASSES.UNKNOWN);
      } else {
        element.classList.add(CSS_CLASSES.UNKNOWN);
        element.classList.remove(CSS_CLASSES.KNOWN);
      }
    });
  }

  /**
   * 标记单词为已知
   */
  async markKnown(word: string, options: MarkOptions = {}): Promise<void> {
    const { updateUI = true, syncToBackground = true } = options;

    const key = this.normalizeKey(word);
    const entry: MarkEntry = {
      word,
      type: 'known',
      timestamp: Date.now(),
    };

    this.markedWords.set(key, entry);

    // 更新UI
    if (updateUI) {
      this.updateUI(word, 'known');
    }

    // 同步到background
    if (syncToBackground) {
      this.pendingSync.add(key);
      try {
        const response = await this.sendMessage({
          type: 'MARK_WORD_KNOWN',
          payload: { word },
        });

        if (response.success) {
          this.pendingSync.delete(key);
        } else {
          this.callbacks.onError?.(word, response.error || 'Sync failed');
        }
      } catch (error) {
        this.callbacks.onError?.(word, String(error));
      }
    }

    // 调用回调
    this.callbacks.onMarked?.(word, 'known');
  }

  /**
   * 标记单词为未知
   */
  async markUnknown(
    word: string,
    translation?: string,
    options: MarkOptions & { context?: string } = {}
  ): Promise<void> {
    const { updateUI = true, syncToBackground = true, context = '' } = options;

    const key = this.normalizeKey(word);
    const entry: MarkEntry = {
      word,
      type: 'unknown',
      timestamp: Date.now(),
    };

    this.markedWords.set(key, entry);

    // 更新UI
    if (updateUI) {
      this.updateUI(word, 'unknown');
    }

    // 同步到background
    if (syncToBackground) {
      this.pendingSync.add(key);
      try {
        const entry: UnknownWordEntry = {
          word,
          translation: translation || '',
          context,
          markedAt: Date.now(),
          reviewCount: 0,
        };

        const response = await this.sendMessage({
          type: 'MARK_WORD_UNKNOWN',
          payload: { entry },
        });

        if (response.success) {
          this.pendingSync.delete(key);
        } else {
          this.callbacks.onError?.(word, response.error || 'Sync failed');
        }
      } catch (error) {
        this.callbacks.onError?.(word, String(error));
      }
    }

    // 调用回调
    this.callbacks.onMarked?.(word, 'unknown');
  }

  /**
   * 批量标记单词
   */
  async batchMark(words: string[], type: MarkType): Promise<void> {
    // 按顺序标记，确保UI正确更新
    for (const word of words) {
      if (type === 'known') {
        await this.markKnown(word);
      } else {
        await this.markUnknown(word);
      }
    }
  }

  /**
   * 检查单词是否已标记
   */
  isMarked(word: string): boolean {
    const key = this.normalizeKey(word);
    return this.markedWords.has(key);
  }

  /**
   * 获取单词的标记状态
   */
  getMarkStatus(word: string): MarkType | undefined {
    const key = this.normalizeKey(word);
    const entry = this.markedWords.get(key);
    return entry?.type;
  }

  /**
   * 获取已标记的单词数量
   */
  getMarkedCount(): number {
    return this.markedWords.size;
  }

  /**
   * 获取所有已标记的单词
   */
  getAllMarkedWords(): Array<{ word: string; type: MarkType }> {
    return Array.from(this.markedWords.values()).map(entry => ({
      word: entry.word,
      type: entry.type,
    }));
  }

  /**
   * 取消标记单词
   */
  unmark(word: string): void {
    const key = this.normalizeKey(word);
    this.markedWords.delete(key);

    // 更新UI - 移除所有标记相关的CSS类
    const elements = document.querySelectorAll(`[data-word="${word}"]`);
    elements.forEach(el => {
      const element = el as HTMLElement;
      // 移除已知和未知的CSS类
      element.classList.remove(
        'not-only-translator-known',
        'not-only-translator-unknown',
        CSS_CLASSES.KNOWN,
        CSS_CLASSES.UNKNOWN
      );
    });
  }

  /**
   * 清除所有标记
   */
  clearAllMarks(): void {
    // 复制一份单词列表用于清理UI
    const words = this.getAllMarkedWords().map(e => e.word);

    // 清除内部状态
    this.markedWords.clear();
    this.pendingSync.clear();

    // 清除UI
    words.forEach(word => this.updateUI(word, null));
  }

  /**
   * 发送消息到background script
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

/**
 * 创建MarkerService实例的工厂函数
 */
export function createMarkerService(callbacks: MarkerCallbacks = {}): MarkerService {
  return new MarkerService(callbacks);
}
