import type {
  TranslationRequest,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import { logger, generateCacheKey } from '@/shared/utils';
import { StorageManager } from './storage';
import { TranslationApiService } from './translationApi';
import { TranslationPromptBuilder, promptVersionManager } from '@/shared/prompts';

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
    logger.info('TranslationService.translate called:', { textLength: text?.length, mode });

    // Check cache first
    const cacheKey = generateCacheKey(text, mode);
    const cached = await StorageManager.getCachedTranslation(cacheKey);
    if (cached) {
      logger.info('TranslationService: Returning cached result');
      return cached;
    }

    // Get settings for API config
    const settings = await StorageManager.getSettings();
    const apiKey = await StorageManager.getApiKey();
    logger.info('TranslationService: Settings loaded:', {
      apiProvider: settings.apiProvider,
      hasApiKey: !!apiKey,
      customApiUrl: settings.customApiUrl,
      customModelName: settings.customModelName
    });

    // Ollama 不需要 API Key
    if (!apiKey && settings.apiProvider !== 'ollama') {
      throw new Error('API key not configured. Please set your API key in settings.');
    }

    // Build prompt with settings
    const { systemPrompt, userPrompt } = this.buildPrompt(request, settings);
    logger.info('TranslationService: Prompt built, system length:', systemPrompt.length, 'user length:', userPrompt.length);

    // 使用统一 API 服务调用 LLM
    logger.info('TranslationService: Calling API provider:', settings.apiProvider);
    const content = await TranslationApiService.callWithSystem(systemPrompt, userPrompt, apiKey, settings);
    const result = this.parseResponse(content, settings);

    logger.info('TranslationService: API call completed, result:', {
      wordsCount: result.words?.length,
      hasFullText: !!result.fullText
    });

    // Cache result
    await StorageManager.cacheTranslation(cacheKey, result);

    return result;
  }

  /**
   * Build prompt for LLM using TranslationPromptBuilder or PromptVersionManager
   */
  private static buildPrompt(request: TranslationRequest, settings: UserSettings): { systemPrompt: string; userPrompt: string } {
    const { text, context, userLevel } = request;
    const { promptVersion } = settings;

    // 如果用户指定了提示词版本，使用版本管理器获取模板
    if (promptVersion && promptVersionManager.hasVersion(promptVersion)) {
      const template = promptVersionManager.getTemplate(promptVersion);
      const examLevel = 'CET-4'; // 默认水平
      const vocabularySize = userLevel.estimatedVocabulary;

      // 替换模板中的变量
      const systemPrompt = template.systemPrompt
        .replace(/{vocabulary_size}/g, String(vocabularySize))
        .replace(/{exam_level}/g, examLevel);

      const userPrompt = template.userPromptTemplate
        .replace(/{text}/g, text)
        .replace(/{context}/g, context || text);

      logger.info('TranslationService: Using prompt version:', promptVersion);
      return { systemPrompt, userPrompt };
    }

    // 默认使用动态构建器
    const builder = new TranslationPromptBuilder(
      userLevel,
      text,
      context,
      settings
    );

    return builder.build();
  }

  /**
   * Parse LLM response into TranslationResult
   */
  private static parseResponse(content: string, settings: UserSettings): TranslationResult {
    const { phraseTranslationEnabled, grammarTranslationEnabled } = settings;

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

      // 处理词汇列表
      if (Array.isArray(parsed.words)) {
        result.words = parsed.words
          .map((w: Record<string, unknown>) => ({
            original: String(w.original || ''),
            translation: String(w.translation || ''),
            position: Array.isArray(w.position) && w.position.length >= 2
            ? [Number(w.position[0]), Number(w.position[1])] as [number, number]
            : [0, 0] as [number, number],
            difficulty: Number(w.difficulty) || 5,
            isPhrase: Boolean(w.isPhrase),
          }))
          // 如果禁用词组翻译，过滤掉标记为短语的条目
          .filter((w: { isPhrase: boolean }) => {
            return phraseTranslationEnabled || !w.isPhrase;
          });
      }

      if (Array.isArray(parsed.sentences)) {
        result.sentences = parsed.sentences.map((s: Record<string, unknown>) => ({
          original: String(s.original || ''),
          translation: String(s.translation || ''),
          grammarNote: s.grammarNote ? String(s.grammarNote) : undefined,
        }));
      }

      // 如果启用语法翻译，处理语法点
      if (grammarTranslationEnabled && Array.isArray(parsed.grammarPoints)) {
        result.grammarPoints = parsed.grammarPoints.map((g: Record<string, unknown>) => ({
          original: String(g.original || ''),
          explanation: String(g.explanation || ''),
          type: String(g.type || '语法点'),
          position: Array.isArray(g.position) ? g.position as [number, number] : [0, 0],
        }));
      }

      return result;
    } catch (error) {
      logger.error('Failed to parse LLM response:', error);
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
