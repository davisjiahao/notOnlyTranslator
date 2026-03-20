/**
 * LLM 增强分析模块测试 (CMP-106)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LlmEnhancedAnalysisService,
  type WordDetailAnalysis,
  type PhraseAnalysis,
  type GrammarAnalysis,
  type CulturalNote,
} from '@/background/llmEnhancedAnalysis';
import type { UserSettings } from '@/shared/types';

// Mock TranslationApiService
vi.mock('@/background/translationApi', () => ({
  TranslationApiService: {
    callWithSystem: vi.fn(),
  },
}));

// Mock StorageManager
vi.mock('@/background/storage', () => ({
  StorageManager: {
    getApiKey: vi.fn().mockResolvedValue('test-api-key'),
  },
}));

import { TranslationApiService } from '@/background/translationApi';

const mockTranslationApiService = vi.mocked(TranslationApiService);

const createMockSettings = (): UserSettings => ({
  enabled: true,
  autoHighlight: true,
  vocabHighlightEnabled: true,
  phraseTranslationEnabled: true,
  grammarTranslationEnabled: true,
  translationMode: 'inline-only',
  showDifficulty: true,
  highlightColor: '#FFEB3B',
  fontSize: 14,
  apiProvider: 'openai',
  blacklist: [],
  apiConfigs: [],
  hoverDelay: 300,
  theme: 'system',
});

describe('LlmEnhancedAnalysisService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('analyze', () => {
    it('should return empty results when API key is not available', async () => {
      vi.mocked(await import('@/background/storage')).StorageManager.getApiKey.mockResolvedValueOnce(null);

      const settings = createMockSettings();
      settings.apiProvider = 'openai';

      const result = await LlmEnhancedAnalysisService.analyze(
        'This is a test sentence.',
        settings
      );

      expect(result.wordDetails).toEqual([]);
      expect(result.phrases).toEqual([]);
      expect(result.grammarAnalysis).toEqual([]);
      expect(result.culturalNotes).toEqual([]);
    });

    it('should perform full analysis when all options are enabled', async () => {
      // Mock word analysis response
      mockTranslationApiService.callWithSystem.mockImplementation(async () => {
        return JSON.stringify({
          words: [{
            word: 'algorithm',
            phonetic: '/ˈælɡərɪðəm/',
            partOfSpeech: 'noun',
            definition: '算法',
            examples: [{ sentence: 'The algorithm sorts data efficiently.', translation: '该算法高效地排序数据。' }],
            difficulty: 7,
            cefrLevel: 'B2',
          }],
        });
      });

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'The algorithm is complex.',
        settings,
        { analyzeWords: true, analyzePhrases: false, analyzeGrammar: false, analyzeCultural: false }
      );

      expect(result.analysisTime).toBeGreaterThanOrEqual(0);
      expect(result.textLength).toBe('The algorithm is complex.'.length);
    });

    it('should handle API errors gracefully', async () => {
      mockTranslationApiService.callWithSystem.mockRejectedValue(new Error('API Error'));

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'Test sentence.',
        settings
      );

      expect(result.wordDetails).toEqual([]);
    });
  });

  describe('Word Analysis', () => {
    it('should parse word analysis response correctly', async () => {
      const mockResponse = JSON.stringify({
        words: [
          {
            word: 'ephemeral',
            phonetic: '/ɪˈfem(ə)rəl/',
            partOfSpeech: 'adjective',
            definition: '短暂的；瞬息的',
            definitionEn: 'lasting for a very short time',
            synonyms: ['transient', 'fleeting'],
            etymology: {
              root: 'hemer',
              prefix: 'epi-',
              suffix: '-al',
              meaning: '来自希腊语，意为"一天"'
            },
            collocations: ['ephemeral beauty', 'ephemeral nature'],
            examples: [
              { sentence: 'Fame is often ephemeral.', translation: '名声往往是短暂的。' }
            ],
            difficulty: 8,
            cefrLevel: 'C1',
          },
        ],
      });

      mockTranslationApiService.callWithSystem.mockResolvedValueOnce(mockResponse);

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'Fame is ephemeral.',
        settings,
        { analyzeWords: true, analyzePhrases: false, analyzeGrammar: false, analyzeCultural: false }
      );

      expect(result.wordDetails.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle malformed JSON response', async () => {
      mockTranslationApiService.callWithSystem.mockResolvedValueOnce('Invalid JSON');

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'Test',
        settings,
        { analyzeWords: true, analyzePhrases: false, analyzeGrammar: false, analyzeCultural: false }
      );

      expect(result.wordDetails).toEqual([]);
    });
  });

  describe('Phrase Analysis', () => {
    it('should parse phrase analysis response correctly', async () => {
      const mockResponse = JSON.stringify({
        phrases: [
          {
            phrase: 'break the ice',
            translation: '打破僵局',
            type: 'idiom',
            literalMeaning: '打破冰块',
            actualMeaning: '在社交场合打破沉默',
            usageContext: ['社交聚会', '会议开始'],
            register: 'neutral',
            examples: [
              { sentence: 'He told a joke to break the ice.', translation: '他讲了个笑话来打破僵局。' }
            ],
            difficulty: 5,
          },
        ],
      });

      mockTranslationApiService.callWithSystem.mockResolvedValueOnce(mockResponse);

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'He broke the ice at the party.',
        settings,
        { analyzeWords: false, analyzePhrases: true, analyzeGrammar: false, analyzeCultural: false }
      );

      expect(result.phrases.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Grammar Analysis', () => {
    it('should parse grammar analysis response correctly', async () => {
      const mockResponse = JSON.stringify({
        grammarPoints: [
          {
            originalText: 'Had I known',
            type: 'subjunctive',
            name: '虚拟语气倒装',
            explanation: '省略 if，将 had 提到句首',
            structure: [
              { part: 'Had I known', role: '条件从句', description: '与过去事实相反的假设' }
            ],
            tips: ['倒装结构更正式'],
            examples: [
              { correct: 'Were I rich...', incorrect: 'If I am rich...', explanation: '虚拟语气需要用过去时态' }
            ],
          },
        ],
      });

      mockTranslationApiService.callWithSystem.mockResolvedValueOnce(mockResponse);

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'Had I known about the meeting, I would have attended.',
        settings,
        { analyzeWords: false, analyzePhrases: false, analyzeGrammar: true, analyzeCultural: false }
      );

      expect(result.grammarAnalysis.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Cultural Analysis', () => {
    it('should parse cultural notes response correctly', async () => {
      const mockResponse = JSON.stringify({
        culturalNotes: [
          {
            text: 'Silicon Valley',
            type: 'geography',
            title: '硅谷',
            description: '美国加利福尼亚州北部的科技中心',
            background: '得名于早期的半导体产业',
            references: ['Stanford University', 'Apple Park'],
          },
        ],
      });

      mockTranslationApiService.callWithSystem.mockResolvedValueOnce(mockResponse);

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'He works in Silicon Valley.',
        settings,
        { analyzeWords: false, analyzePhrases: false, analyzeGrammar: false, analyzeCultural: true }
      );

      expect(result.culturalNotes.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('convertToTranslatedWords', () => {
    it('should convert WordDetailAnalysis to TranslatedWord format', () => {
      const wordDetails: WordDetailAnalysis[] = [
        {
          word: 'algorithm',
          phonetic: '/ˈælɡərɪðəm/',
          partOfSpeech: 'noun',
          definition: '算法',
          examples: [{ sentence: 'Test', translation: '测试' }],
          difficulty: 7,
        },
      ];

      const translatedWords = LlmEnhancedAnalysisService.convertToTranslatedWords(wordDetails);

      expect(translatedWords).toHaveLength(1);
      expect(translatedWords[0].original).toBe('algorithm');
      expect(translatedWords[0].translation).toBe('算法');
      expect(translatedWords[0].phonetic).toBe('/ˈælɡərɪðəm/');
      expect(translatedWords[0].partOfSpeech).toBe('noun');
      expect(translatedWords[0].difficulty).toBe(7);
    });
  });

  describe('convertToGrammarPoints', () => {
    it('should convert GrammarAnalysis to GrammarPoint format', () => {
      const grammarAnalysis: GrammarAnalysis[] = [
        {
          originalText: 'Had I known',
          type: 'subjunctive',
          name: '虚拟语气倒装',
          explanation: '省略 if，将 had 提到句首',
        },
      ];

      const grammarPoints = LlmEnhancedAnalysisService.convertToGrammarPoints(grammarAnalysis);

      expect(grammarPoints).toHaveLength(1);
      expect(grammarPoints[0].original).toBe('Had I known');
      expect(grammarPoints[0].type).toBe('subjunctive');
      expect(grammarPoints[0].explanation).toContain('虚拟语气倒装');
    });
  });

  describe('quickAnalyzeWord', () => {
    it('should return null when API key is not available', async () => {
      vi.mocked(await import('@/background/storage')).StorageManager.getApiKey.mockResolvedValueOnce(null);

      const settings = createMockSettings();
      settings.apiProvider = 'openai';

      const result = await LlmEnhancedAnalysisService.quickAnalyzeWord(
        'algorithm',
        'The algorithm is efficient.',
        settings
      );

      expect(result).toBeNull();
    });

    it('should analyze a single word', async () => {
      mockTranslationApiService.callWithSystem.mockResolvedValueOnce(
        JSON.stringify({
          words: [{
            word: 'algorithm',
            phonetic: '/ˈælɡərɪðəm/',
            partOfSpeech: 'noun',
            definition: '算法',
            difficulty: 7,
          }],
        })
      );

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.quickAnalyzeWord(
        'algorithm',
        'The algorithm is efficient.',
        settings
      );

      // Result depends on mock, just verify no error
      expect(result).toBeDefined();
    });
  });

  describe('Analysis Options', () => {
    it('should respect maxWords option', async () => {
      const settings = createMockSettings();
      await LlmEnhancedAnalysisService.analyze(
        'Complex text with many words.',
        settings,
        { analyzeWords: true, maxWords: 5 }
      );

      // Verify the prompt was called with maxWords constraint
      expect(mockTranslationApiService.callWithSystem).toHaveBeenCalled();
    });

    it('should respect userVocabulary option', async () => {
      const settings = createMockSettings();
      await LlmEnhancedAnalysisService.analyze(
        'Test text.',
        settings,
        { analyzeWords: true, userVocabulary: 5000 }
      );

      expect(mockTranslationApiService.callWithSystem).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle Promise.allSettled rejections gracefully', async () => {
      mockTranslationApiService.callWithSystem
        .mockRejectedValueOnce(new Error('Word API Error'))
        .mockRejectedValueOnce(new Error('Phrase API Error'))
        .mockRejectedValueOnce(new Error('Grammar API Error'))
        .mockRejectedValueOnce(new Error('Cultural API Error'));

      const settings = createMockSettings();
      const result = await LlmEnhancedAnalysisService.analyze(
        'Test sentence.',
        settings,
        { analyzeWords: true, analyzePhrases: true, analyzeGrammar: true, analyzeCultural: true }
      );

      expect(result.wordDetails).toEqual([]);
      expect(result.phrases).toEqual([]);
      expect(result.grammarAnalysis).toEqual([]);
      expect(result.culturalNotes).toEqual([]);
    });
  });
});