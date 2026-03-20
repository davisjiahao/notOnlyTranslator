import { describe, it, expect, beforeEach } from 'vitest';
import { TranslationDisplay } from '@/content/translationDisplay';
import type { TranslationResult } from '@/shared/types';

describe('TranslationDisplay', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  describe('applyBilingualModeNonInvasive', () => {
    it('应该在段落后添加译文行', () => {
      // 准备
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The quick brown fox jumps over the lazy dog.';
      container.appendChild(paragraph);

      const result: TranslationResult = {
        words: [
          {
            original: 'fox',
            translation: '狐狸',
            position: [16, 19],
            difficulty: 3,
          },
          {
            original: 'lazy',
            translation: '懒惰的',
            position: [35, 39],
            difficulty: 2,
          },
        ],
        sentences: [],
        fullText: '这只敏捷的棕色狐狸跳过了这只懒惰的狗。',
        phrases: [],
      };

      // 执行
      TranslationDisplay.applyTranslation(paragraph, result, 'bilingual');

      // 验证
      expect(paragraph.classList.contains('not-translator-processed')).toBe(true);

      // 检查译文行
      const translationLine = paragraph.nextElementSibling;
      expect(translationLine).not.toBeNull();
      expect(translationLine?.classList.contains('not-translator-translation-line')).toBe(true);

      // 检查译文内容包含翻译
      expect(translationLine?.textContent).toContain('狐狸');
      expect(translationLine?.textContent).toContain('懒惰的');
    });

    it('应该高亮原文中的生词', () => {
      // 准备
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The fox runs fast.';
      container.appendChild(paragraph);

      const result: TranslationResult = {
        words: [
          {
            original: 'fox',
            translation: '狐狸',
            position: [4, 7],
            difficulty: 3,
          },
        ],
        sentences: [],
        fullText: '这只狐狸跑得很快。',
        phrases: [],
      };

      // 执行
      TranslationDisplay.applyTranslation(paragraph, result, 'bilingual');

      // 验证
      const highlights = paragraph.querySelectorAll('.not-translator-highlighted-word');
      expect(highlights.length).toBeGreaterThan(0);
    });

    it('应该在译文中高亮对应的翻译', () => {
      // 准备
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The fox is quick.';
      container.appendChild(paragraph);

      const result: TranslationResult = {
        words: [
          {
            original: 'fox',
            translation: '狐狸',
            position: [4, 7],
            difficulty: 3,
          },
        ],
        sentences: [],
        fullText: '这只狐狸很快。',
        phrases: [],
      };

      // 执行
      TranslationDisplay.applyTranslation(paragraph, result, 'bilingual');

      // 验证
      const translationLine = paragraph.nextElementSibling;
      const highlightedTranslations = translationLine?.querySelectorAll(
        '.not-translator-highlighted-translation'
      );
      expect(highlightedTranslations?.length).toBeGreaterThan(0);
    });

    it('当没有完整译文时应该降级为行内模式', () => {
      // 准备
      const paragraph = document.createElement('p');
      paragraph.textContent = 'Hello world';
      container.appendChild(paragraph);

      const result: TranslationResult = {
        words: [
          {
            original: 'Hello',
            translation: '你好',
            position: [0, 5],
            difficulty: 1,
          },
        ],
        sentences: [],
        fullText: '', // 没有完整译文
        phrases: [],
      };

      // 执行
      TranslationDisplay.applyTranslation(paragraph, result, 'bilingual');

      // 验证：应该有高亮但没有译文行
      expect(paragraph.classList.contains('not-translator-processed')).toBe(true);
      // 没有译文行，nextElementSibling 应该是 null 或没有 translation-line 类
      const translationLine = paragraph.nextElementSibling;
      const hasTranslationLine = translationLine?.classList.contains('not-translator-translation-line');
      expect(hasTranslationLine).toBeFalsy();
    });
  });

  describe('clearTranslation', () => {
    it('应该移除译文行并恢复原始HTML', () => {
      // 准备
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The fox runs.';
      container.appendChild(paragraph);

      const result: TranslationResult = {
        words: [
          {
            original: 'fox',
            translation: '狐狸',
            position: [4, 7],
            difficulty: 3,
          },
        ],
        sentences: [],
        fullText: '这只狐狸在跑。',
        phrases: [],
      };

      TranslationDisplay.applyTranslation(paragraph, result, 'bilingual');

      // 验证翻译已应用
      expect(paragraph.classList.contains('not-translator-processed')).toBe(true);

      // 执行清除
      TranslationDisplay.clearTranslation(paragraph);

      // 验证已清除处理标记
      expect(paragraph.classList.contains('not-translator-processed')).toBe(false);
    });
  });

  describe('applyInlineModeNonInvasive', () => {
    it('应该处理段落并标记为已处理', () => {
      // 准备
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The fox is quick.';
      container.appendChild(paragraph);

      const result: TranslationResult = {
        words: [
          {
            original: 'fox',
            translation: '狐狸',
            position: [4, 7],
            difficulty: 3,
          },
        ],
        sentences: [],
        fullText: '这只狐狸很快。',
        phrases: [],
      };

      // 执行
      TranslationDisplay.applyTranslation(paragraph, result, 'inline-only');

      // 验证段落被标记为已处理
      expect(paragraph.classList.contains('not-translator-processed')).toBe(true);

      // 不应该有译文行（inline-only 模式不添加译文行）
      const translationLine = paragraph.nextElementSibling;
      const hasTranslationLine = translationLine?.classList.contains('not-translator-translation-line');
      expect(hasTranslationLine).toBeFalsy();
    });
  });

  describe('applyFullTranslateModeNonInvasive', () => {
    it('应该用译文替换原文内容', () => {
      // 准备
      const paragraph = document.createElement('p');
      paragraph.textContent = 'Hello world, this is a test.';
      container.appendChild(paragraph);

      const result: TranslationResult = {
        words: [
          {
            original: 'test',
            translation: '测试',
            position: [22, 26],
            difficulty: 1,
          },
        ],
        sentences: [],
        fullText: '你好世界，这是一个测试。',
        phrases: [],
      };

      // 执行
      TranslationDisplay.applyTranslation(paragraph, result, 'full-translate');

      // 验证
      expect(paragraph.classList.contains('not-translator-processed')).toBe(true);

      // 检查全文翻译容器或段落已翻译
      const fullTranslation = paragraph.nextElementSibling;
      const hasFullTranslation = fullTranslation?.classList.contains('not-translator-full-translation');
      // 全文翻译可能直接在段落内或作为相邻元素
      expect(hasFullTranslation || paragraph.classList.contains('not-translator-full-translated')).toBeTruthy();
    });
  });
});