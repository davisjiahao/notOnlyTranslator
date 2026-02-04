import type {
  TranslationRequest,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import {
  TRANSLATION_PROMPT_TEMPLATE,
  EXAM_DISPLAY_NAMES,
} from '@/shared/constants';
import {
  generateCacheKey,
  normalizeText,
} from '@/shared/utils';
import { StorageManager } from './storage';
import { TranslationApiService } from './translationApi';

/**
 * Translation Service - handles LLM API calls for translation
 * 使用 TranslationApiService 统一处理多供应商 API 调用
 */
export class TranslationService {
  /**
   * Translate text based on user level
   */
  static async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { text, mode } = request;
    console.log('TranslationService.translate called:', { textLength: text?.length, mode });

    // Check cache first
    const cacheKey = generateCacheKey(text, mode);
    const cached = await StorageManager.getCachedTranslation(cacheKey);
    if (cached) {
      console.log('TranslationService: Returning cached result');
      return cached;
    }

    // Get settings for API config
    const settings = await StorageManager.getSettings();
    const apiKey = await StorageManager.getApiKey();
    console.log('TranslationService: Settings loaded:', {
      apiProvider: settings.apiProvider,
      hasApiKey: !!apiKey,
      customApiUrl: settings.customApiUrl,
      customModelName: settings.customModelName
    });

    // Ollama 不需要 API Key
    if (!apiKey && settings.apiProvider !== 'ollama') {
      throw new Error('API key not configured. Please set your API key in settings.');
    }

    // Build prompt
    const prompt = this.buildPrompt(request);
    console.log('TranslationService: Prompt built, length:', prompt.length);

    // 使用统一 API 服务调用 LLM
    console.log('TranslationService: Calling API provider:', settings.apiProvider);
    const content = await TranslationApiService.call(prompt, apiKey, settings);
    const result = this.parseResponse(content);

    console.log('TranslationService: API call completed, result:', {
      wordsCount: result.words?.length,
      hasFullText: !!result.fullText
    });

    // Cache result
    await StorageManager.cacheTranslation(cacheKey, result);

    return result;
  }

  /**
   * Build prompt for LLM
   */
  private static buildPrompt(request: TranslationRequest): string {
    const { text, context, userLevel } = request;

    return TRANSLATION_PROMPT_TEMPLATE
      .replace('{vocabulary_size}', userLevel.estimatedVocabulary.toString())
      .replace(/{exam_level}/g, EXAM_DISPLAY_NAMES[userLevel.examType])
      .replace('{text}', normalizeText(text))
      .replace('{context}', normalizeText(context));
  }

  /**
   * Parse LLM response into TranslationResult
   */
  private static parseResponse(content: string): TranslationResult {
    try {
      // Extract JSON from response (handle potential markdown wrapping)
      let jsonStr = content;
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1];
      }

      const parsed = JSON.parse(jsonStr.trim());

      // Validate and normalize result
      const result: TranslationResult = {
        words: [],
        sentences: [],
        grammarPoints: [],
        fullText: parsed.fullText ? String(parsed.fullText) : undefined,
      };

      if (Array.isArray(parsed.words)) {
        result.words = parsed.words.map((w: Record<string, unknown>) => ({
          original: String(w.original || ''),
          translation: String(w.translation || ''),
          position: Array.isArray(w.position) ? w.position : [0, 0],
          difficulty: Number(w.difficulty) || 5,
          isPhrase: Boolean(w.isPhrase),
        }));
      }

      if (Array.isArray(parsed.sentences)) {
        result.sentences = parsed.sentences.map((s: Record<string, unknown>) => ({
          original: String(s.original || ''),
          translation: String(s.translation || ''),
          grammarNote: s.grammarNote ? String(s.grammarNote) : undefined,
        }));
      }

      if (Array.isArray(parsed.grammarPoints)) {
        result.grammarPoints = parsed.grammarPoints.map((g: Record<string, unknown>) => ({
          original: String(g.original || ''),
          explanation: String(g.explanation || ''),
          type: String(g.type || '语法点'),
          position: Array.isArray(g.position) ? g.position as [number, number] : [0, 0],
        }));
      }

      return result;
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      throw new Error('Failed to parse translation response');
    }
  }

  /**
   * Quick translate a single word/phrase (no caching)
   * 使用 TranslationApiService 统一处理
   */
  static async quickTranslate(
    text: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    return TranslationApiService.quickTranslate(text, apiKey, settings);
  }
}
