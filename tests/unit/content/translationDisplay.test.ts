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

      // 缺全文时保留行内词义，并明确告知当前没有全文译文。
      expect(paragraph.classList.contains('not-translator-processed')).toBe(true);
      const translationLine = paragraph.nextElementSibling;
      expect(translationLine?.classList.contains('not-translator-translation-line')).toBe(true);
      expect(translationLine?.textContent).toBe('当前仅有词义，暂无全文译文');
      expect(paragraph.querySelector('.not-translator-inline-translation')?.textContent).toBe('你好');
    });
  });

  describe('clearTranslation', () => {
    it('未标记已处理的段落也清理淡出状态，保留原文和页面自身样式', () => {
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The fox runs.';
      paragraph.className = 'article-paragraph not-translator-fade-out';
      container.appendChild(paragraph);

      TranslationDisplay.clearTranslation(paragraph);

      expect(paragraph.classList.contains('not-translator-fade-out')).toBe(false);
      expect(paragraph.className).toBe('article-paragraph');
      expect(paragraph.textContent).toBe('The fox runs.');
    });

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

  describe('加载等待期间的快照边界', () => {
    it('error notification 存在于段落内时快照不含通知，恢复后不复活', () => {
      // 模拟并发批次时序：快照瞬间失败通知仍在被观察段落子树内
      const paragraph = document.createElement('p');
      paragraph.innerHTML = 'Hello <a href="#">world</a> and more words.';
      container.appendChild(paragraph);
      const alert = document.createElement('div');
      alert.className = 'not-translator-error-notification';
      alert.innerHTML = '<div class="not-translator-error-title">批量翻译失败</div><button type="button" data-action="dismiss">关闭</button>';
      paragraph.appendChild(alert);

      const result: TranslationResult = {
        words: [],
        sentences: [],
        fullText: '你好。',
        phrases: [],
      };
      TranslationDisplay.applyTranslation(paragraph, result, 'bilingual');
      TranslationDisplay.clearTranslation(paragraph);

      expect(paragraph.querySelector('.not-translator-error-notification')).toBeNull();
      expect(paragraph.innerHTML).toContain('<a href="#">world</a>');
      expect(paragraph.innerHTML).not.toContain('批量翻译失败');
    });

    it('saveOriginalText 快照排除段落内的 error notification', () => {
      const paragraph = document.createElement('p');
      paragraph.textContent = 'The fox runs fast.';
      container.appendChild(paragraph);
      const alert = document.createElement('div');
      alert.className = 'not-translator-error-notification';
      alert.textContent = '批量翻译失败';
      paragraph.appendChild(alert);

      TranslationDisplay.saveOriginalText(paragraph);

      expect(paragraph.dataset.originalHtml).not.toContain('not-translator-error-notification');
      // 原文 DOM 不被原地修改
      expect(paragraph.querySelector('.not-translator-error-notification')).not.toBeNull();
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