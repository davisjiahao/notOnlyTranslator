import { describe, it, expect, beforeEach } from 'vitest';
import {
  TranslationPromptBuilder,
  PromptVersionManager,
  PROMPT_VERSIONS,
  promptVersionManager,
  type PromptTemplate,
  type PromptVariables,
} from '@/shared/prompts';
import type { UserProfile, UserSettings } from '@/shared/types';

describe('Prompt Management System', () => {
  describe('TranslationPromptBuilder', () => {
    const mockUserProfile: UserProfile = {
      examType: 'cet4',
      examScore: 425,
      estimatedVocabulary: 4500,
      levelConfidence: 0.5,
      knownWords: ['hello', 'world'],
      unknownWords: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockSettings: UserSettings = {
      enabled: true,
      autoHighlight: true,
      vocabHighlightEnabled: true,
      phraseTranslationEnabled: true,
      grammarTranslationEnabled: true,
      translationMode: 'inline-only',
      showDifficulty: true,
      highlightColor: '#fef08a',
      fontSize: 14,
      apiProvider: 'openai',
      customApiUrl: '',
      customModelName: '',
      blacklist: [],
      apiConfigs: [],
      hoverDelay: 500,
      theme: 'system',
      promptVersion: 'v1.0.0',
    };

    describe('constructor', () => {
      it('should initialize with single paragraph mode', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world context',
          mockSettings
        );

        expect(builder).toBeDefined();
      });

      it('should initialize with batch mode when paragraphs provided', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          '',
          '',
          mockSettings,
          '[PARA_0]\nFirst paragraph\n\n[PARA_1]\nSecond paragraph'
        );

        expect(builder).toBeDefined();
      });

      it('should handle empty settings gracefully', () => {
        const partialSettings = { ...mockSettings, phraseTranslationEnabled: undefined } as unknown as UserSettings;
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'test',
          '',
          partialSettings
        );

        expect(builder).toBeDefined();
      });
    });

    describe('buildSystemPrompt', () => {
      it('should include vocabulary size in system prompt', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          '',
          mockSettings
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('4500');
        expect(systemPrompt).toContain('词汇量');
      });

      it('should include exam level in system prompt', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          '',
          mockSettings
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('CET-4');
      });

      it('should include output schema description', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          '',
          mockSettings
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain('JSON');
        expect(userPrompt).toContain('schema');
      });

      it('should include phrase translation instructions when enabled', () => {
        const settingsWithPhrases = { ...mockSettings, phraseTranslationEnabled: true };
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          '',
          settingsWithPhrases
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('短语/习语');
      });

      it('should include grammar instructions when enabled', () => {
        const settingsWithGrammar = { ...mockSettings, grammarTranslationEnabled: true };
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          '',
          settingsWithGrammar
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('语法');
      });
    });

    describe('buildUserPrompt', () => {
      it('should include text in user prompt', () => {
        const text = 'This is a test sentence.';
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          text,
          '',
          mockSettings
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain(text);
      });

      it('should include context when provided', () => {
        const text = 'Test';
        const context = 'This is the surrounding context';
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          text,
          context,
          mockSettings
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain('上下文');
        expect(userPrompt).toContain(context);
      });

      it('should handle batch mode with paragraphs', () => {
        const paragraphs = '[PARA_0]\nFirst paragraph\n\n[PARA_1]\nSecond paragraph';
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          '',
          '',
          mockSettings,
          paragraphs
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain('PARA_0');
        expect(userPrompt).toContain('First paragraph');
        expect(userPrompt).toContain('PARA_1');
        expect(userPrompt).toContain('Second paragraph');
      });
    });

    describe('build', () => {
      it('should return both system and user prompts', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          '',
          mockSettings
        );

        const result = builder.build();

        expect(result).toHaveProperty('systemPrompt');
        expect(result).toHaveProperty('userPrompt');
        expect(result.systemPrompt).toBeTruthy();
        expect(result.userPrompt).toBeTruthy();
      });

      it('should include output schema in user prompt when built', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Test',
          '',
          mockSettings
        );

        const { userPrompt } = builder.build();

        expect(userPrompt).toContain('words');
        expect(userPrompt).toContain('original');
        expect(userPrompt).toContain('translation');
      });
    });

    describe('difficulty calculation', () => {
      it('should calculate appropriate difficulty range for CET-4 level', () => {
        const cet4Profile: UserProfile = {
          ...mockUserProfile,
          examType: 'cet4',
          estimatedVocabulary: 4500,
        };

        const builder = new TranslationPromptBuilder(
          cet4Profile,
          'Test',
          '',
          mockSettings
        );

        const systemPrompt = builder.buildSystemPrompt();
        expect(systemPrompt).toContain('4500');
      });

      it('should calculate appropriate difficulty range for CET-6 level', () => {
        const cet6Profile: UserProfile = {
          ...mockUserProfile,
          examType: 'cet6',
          estimatedVocabulary: 6000,
        };

        const builder = new TranslationPromptBuilder(
          cet6Profile,
          'Test',
          '',
          mockSettings
        );

        const systemPrompt = builder.buildSystemPrompt();
        expect(systemPrompt).toContain('6000');
      });

      it('should calculate appropriate difficulty range for advanced levels', () => {
        const greProfile: UserProfile = {
          ...mockUserProfile,
          examType: 'gre',
          estimatedVocabulary: 12000,
        };

        const builder = new TranslationPromptBuilder(
          greProfile,
          'Test',
          '',
          mockSettings
        );

        const systemPrompt = builder.buildSystemPrompt();
        expect(systemPrompt).toContain('12000');
      });
    });
  });

  describe('PromptVersionManager', () => {
    let manager: PromptVersionManager;

    beforeEach(() => {
      manager = new PromptVersionManager();
    });

    describe('getCurrentVersion', () => {
      it('should return default version v1.0.0', () => {
        expect(manager.getCurrentVersion()).toBe('v1.0.0');
      });
    });

    describe('setCurrentVersion', () => {
      it('should set valid version', () => {
        const result = manager.setCurrentVersion('v2.0.0-beta');
        expect(result).toBe(true);
        expect(manager.getCurrentVersion()).toBe('v2.0.0-beta');
      });

      it('should reject invalid version', () => {
        const result = manager.setCurrentVersion('v999.0.0');
        expect(result).toBe(false);
        expect(manager.getCurrentVersion()).toBe('v1.0.0');
      });

      it('should accept v1.0.0', () => {
        manager.setCurrentVersion('v2.0.0-beta');
        const result = manager.setCurrentVersion('v1.0.0');
        expect(result).toBe(true);
        expect(manager.getCurrentVersion()).toBe('v1.0.0');
      });
    });

    describe('getTemplate', () => {
      it('should return v1.0.0 template by default', () => {
        const template = manager.getTemplate();

        expect(template).toBeDefined();
        expect(template.version).toBe('v1.0.0');
        expect(template.systemPrompt).toBeTruthy();
        expect(template.userPromptTemplate).toBeTruthy();
      });

      it('should return v2.0.0-beta template when specified', () => {
        const template = manager.getTemplate('v2.0.0-beta');

        expect(template).toBeDefined();
        expect(template.version).toBe('v2.0.0-beta');
      });

      it('should throw error for unknown version', () => {
        expect(() => manager.getTemplate('v999.0.0')).toThrow();
      });

      it('should include outputSchema in template', () => {
        const template = manager.getTemplate();

        expect(template.outputSchema).toBeDefined();
        expect(template.outputSchema.type).toBe('object');
      });
    });

    describe('listVersions', () => {
      it('should return array of available versions', () => {
        const versions = manager.listVersions();

        expect(Array.isArray(versions)).toBe(true);
        expect(versions).toContain('v1.0.0');
      });

      it('should include all registered versions', () => {
        manager.setCurrentVersion('v2.0.0-beta');
        const versions = manager.listVersions();

        expect(versions.length).toBeGreaterThanOrEqual(2);
        expect(versions).toContain('v1.0.0');
        expect(versions).toContain('v2.0.0-beta');
      });
    });

    describe('hasVersion', () => {
      it('should return true for v1.0.0', () => {
        expect(manager.hasVersion('v1.0.0')).toBe(true);
      });

      it('should return true for v2.0.0-beta', () => {
        expect(manager.hasVersion('v2.0.0-beta')).toBe(true);
      });

      it('should return false for unknown version', () => {
        expect(manager.hasVersion('v999.0.0')).toBe(false);
      });
    });

    describe('registerVersion', () => {
      it('should register new version', () => {
        const newTemplate: PromptTemplate = {
          version: 'v3.0.0',
          name: 'Test Version',
          description: 'Test template',
          systemPrompt: 'System prompt',
          userPromptTemplate: 'User prompt',
          outputSchema: { type: 'object' },
        };

        manager.registerVersion(newTemplate);

        expect(manager.hasVersion('v3.0.0')).toBe(true);
        expect(manager.listVersions()).toContain('v3.0.0');
      });

      it('should allow switching to registered version', () => {
        const newTemplate: PromptTemplate = {
          version: 'v3.0.0',
          name: 'Test Version',
          description: 'Test template',
          systemPrompt: 'System prompt',
          userPromptTemplate: 'User prompt',
          outputSchema: { type: 'object' },
        };

        manager.registerVersion(newTemplate);
        const result = manager.setCurrentVersion('v3.0.0');

        expect(result).toBe(true);
        expect(manager.getCurrentVersion()).toBe('v3.0.0');
      });
    });
  });

  describe('PROMPT_VERSIONS constant', () => {
    it('should contain v1.0.0 template', () => {
      expect(PROMPT_VERSIONS).toHaveProperty('v1.0.0');
      expect(PROMPT_VERSIONS['v1.0.0'].version).toBe('v1.0.0');
    });

    it('should contain v2.0.0-beta template', () => {
      expect(PROMPT_VERSIONS).toHaveProperty('v2.0.0-beta');
      expect(PROMPT_VERSIONS['v2.0.0-beta'].version).toBe('v2.0.0-beta');
    });

    it('should have valid schema definitions', () => {
      const v1Template = PROMPT_VERSIONS['v1.0.0'];

      expect(v1Template.outputSchema).toBeDefined();
      expect(v1Template.outputSchema.properties).toBeDefined();
      expect(v1Template.outputSchema.properties.words).toBeDefined();
    });

    it('should have complete prompt templates', () => {
      Object.values(PROMPT_VERSIONS).forEach((template) => {
        expect(template.systemPrompt).toBeTruthy();
        expect(template.userPromptTemplate).toBeTruthy();
        expect(template.version).toBeTruthy();
        expect(template.outputSchema).toBeDefined();
      });
    });
  });

  describe('promptVersionManager singleton', () => {
    it('should be defined and usable', () => {
      expect(promptVersionManager).toBeDefined();
      expect(promptVersionManager.getCurrentVersion()).toBe('v1.0.0');
    });

    it('should have default versions available', () => {
      const versions = promptVersionManager.listVersions();
      expect(versions).toContain('v1.0.0');
    });

    it('should be able to get v1.0.0 template', () => {
      const template = promptVersionManager.getTemplate('v1.0.0');
      expect(template).toBeDefined();
      expect(template.version).toBe('v1.0.0');
    });
  });

  describe('Integration: TranslationPromptBuilder with PromptVersionManager', () => {
    const mockUserProfile: UserProfile = {
      examType: 'cet4',
      examScore: 425,
      estimatedVocabulary: 4500,
      levelConfidence: 0.5,
      knownWords: [],
      unknownWords: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const mockSettings: UserSettings = {
      enabled: true,
      autoHighlight: true,
      vocabHighlightEnabled: true,
      phraseTranslationEnabled: true,
      grammarTranslationEnabled: true,
      translationMode: 'inline-only',
      showDifficulty: true,
      highlightColor: '#fef08a',
      fontSize: 14,
      apiProvider: 'openai',
      customApiUrl: '',
      customModelName: '',
      blacklist: [],
      apiConfigs: [],
      hoverDelay: 500,
      theme: 'system',
      promptVersion: 'v1.0.0',
    };

    it('should use prompt version from settings when available', () => {
      const settingsWithVersion = { ...mockSettings, promptVersion: 'v2.0.0-beta' };

      // Verify the version manager has this version
      expect(promptVersionManager.hasVersion('v2.0.0-beta')).toBe(true);

      // Get template using the version from settings
      const template = promptVersionManager.getTemplate(settingsWithVersion.promptVersion);
      expect(template.version).toBe('v2.0.0-beta');
    });

    it('should build prompts that work with version manager templates', () => {
      const builder = new TranslationPromptBuilder(
        mockUserProfile,
        'Hello world',
        '',
        mockSettings
      );

      const { systemPrompt, userPrompt } = builder.build();
      const v1Template = promptVersionManager.getTemplate('v1.0.0');

      // Both should contain similar core instructions
      expect(systemPrompt).toContain('翻译');
      expect(v1Template.systemPrompt).toContain('翻译');
    });
  });
});
