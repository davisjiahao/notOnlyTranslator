import type {
  TranslationRequest,
  TranslationResult,
  UserSettings,
} from '@/shared/types';
import {
  TRANSLATION_PROMPT_TEMPLATE,
  EXAM_DISPLAY_NAMES,
  API_ENDPOINTS,
} from '@/shared/constants';
import { generateCacheKey, normalizeText } from '@/shared/utils';
import { StorageManager } from './storage';

/**
 * Translation Service - handles LLM API calls for translation
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

    if (!apiKey) {
      throw new Error('API key not configured. Please set your API key in settings.');
    }

    // Build prompt
    const prompt = this.buildPrompt(request);
    console.log('TranslationService: Prompt built, length:', prompt.length);

    // Call LLM API
    let result: TranslationResult;

    console.log('TranslationService: Calling API provider:', settings.apiProvider);
    if (settings.apiProvider === 'openai') {
      result = await this.callOpenAI(prompt, apiKey, settings);
    } else if (settings.apiProvider === 'anthropic') {
      result = await this.callAnthropic(prompt, apiKey, settings);
    } else if (settings.apiProvider === 'custom') {
      result = await this.callCustomAPI(prompt, apiKey, settings);
    } else {
      throw new Error('Invalid API provider');
    }

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
   * Call OpenAI API
   */
  private static async callOpenAI(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const apiUrl = settings.customApiUrl || API_ENDPOINTS.OPENAI;
    const modelName = settings.customModelName || 'gpt-4o-mini';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'system',
            content:
              'You are an English learning assistant. Always respond with valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'OpenAI API request failed');
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    return this.parseResponse(content);
  }

  /**
   * Call Anthropic API
   */
  private static async callAnthropic(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<TranslationResult> {
    const apiUrl = settings.customApiUrl || API_ENDPOINTS.ANTHROPIC;
    const modelName = settings.customModelName || 'claude-3-haiku-20240307';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: prompt + '\n\nPlease respond with valid JSON only.',
          },
        ],
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'Anthropic API request failed');
    }

    const data = await response.json();
    const content = data.content[0]?.text;

    if (!content) {
      throw new Error('Empty response from Anthropic');
    }

    return this.parseResponse(content);
  }

  /**
   * Call Custom API (OpenAI-compatible format)
   */
  private static async callCustomAPI(
    prompt: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<TranslationResult> {
    if (!settings.customApiUrl) {
      throw new Error('Custom API URL not configured');
    }

    const modelName = settings.customModelName || 'gpt-3.5-turbo';
    console.log('TranslationService.callCustomAPI:', {
      url: settings.customApiUrl,
      model: modelName,
      promptLength: prompt.length
    });

    const requestBody = {
      model: modelName,
      messages: [
        {
          role: 'system',
          content:
            'You are an English learning assistant. Always respond with valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    };
    console.log('TranslationService: Sending request...');

    const response = await fetch(settings.customApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    console.log('TranslationService: Response status:', response.status, response.statusText);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('TranslationService: API error:', errorText);
      throw new Error(`Custom API request failed: ${errorText}`);
    }

    const data = await response.json();
    console.log('TranslationService: API response data:', JSON.stringify(data).substring(0, 500));

    const content = data.choices?.[0]?.message?.content || data.content?.[0]?.text;

    if (!content) {
      console.error('TranslationService: Empty content in response');
      throw new Error('Empty response from custom API');
    }

    console.log('TranslationService: Content to parse:', content.substring(0, 300));
    return this.parseResponse(content);
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

      return result;
    } catch (error) {
      console.error('Failed to parse LLM response:', error);
      throw new Error('Failed to parse translation response');
    }
  }

  /**
   * Quick translate a single word/phrase (no caching)
   */
  static async quickTranslate(
    text: string,
    apiKey: string,
    settings: UserSettings
  ): Promise<string> {
    const prompt = `Translate the following English word or phrase to Chinese. Only respond with the translation, nothing else.\n\n${text}`;

    if (settings.apiProvider === 'openai') {
      const apiUrl = settings.customApiUrl || API_ENDPOINTS.OPENAI;
      const modelName = settings.customModelName || 'gpt-4o-mini';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 100,
        }),
      });

      if (!response.ok) {
        throw new Error('Translation request failed');
      }

      const data = await response.json();
      return data.choices[0]?.message?.content || '';
    } else if (settings.apiProvider === 'anthropic') {
      const apiUrl = settings.customApiUrl || API_ENDPOINTS.ANTHROPIC;
      const modelName = settings.customModelName || 'claude-3-haiku-20240307';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 100,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error('Translation request failed');
      }

      const data = await response.json();
      return data.content[0]?.text || '';
    } else {
      // Custom API
      if (!settings.customApiUrl) {
        throw new Error('Custom API URL not configured');
      }

      const modelName = settings.customModelName || 'gpt-3.5-turbo';

      const response = await fetch(settings.customApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 100,
        }),
      });

      if (!response.ok) {
        throw new Error('Translation request failed');
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || data.content?.[0]?.text || '';
    }
  }
}
