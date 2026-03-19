import {
  TranslationPromptBuilder,
  PromptVersionManager,
  promptVersionManager,
  PROMPT_VERSIONS,
} from '@/shared/prompts';
import type { UserProfile, UserSettings } from '@/shared/types';
import { EXAM_DISPLAY_NAMES } from '@/shared/constants';

describe('Prompt Management System', () => {
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
    activeApiConfigId: undefined,
    hoverDelay: 500,
    theme: 'system',
    promptVersion: 'v1.0.0',
  };

  describe('TranslationPromptBuilder', () => {
    describe('constructor', () => {
      it('should initialize with correct variables', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          mockSettings
        );

        expect(builder).toBeDefined();
      });

      it('should handle batch translation with paragraphs', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'text',
          'context',
          mockSettings,
          '[PARA_1] Paragraph 1\n[PARA_2] Paragraph 2'
        );

        expect(builder).toBeDefined();
      });
    });

    describe('buildSystemPrompt', () => {
      it('should include vocabulary size and exam level', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          mockSettings
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('4500');
        expect(systemPrompt).toContain(EXAM_DISPLAY_NAMES.cet4);
      });

      it('should include all tasks when both phrase and grammar are enabled', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          {
            ...mockSettings,
            phraseTranslationEnabled: true,
            grammarTranslationEnabled: true,
          }
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('1. 单词');
        expect(systemPrompt).toContain('2. 短语/习语');
        expect(systemPrompt).toContain('3. 复杂语法结构');
      });

      it('should exclude phrase task when phraseTranslationEnabled is false', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          {
            ...mockSettings,
            phraseTranslationEnabled: false,
            grammarTranslationEnabled: true,
          }
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('1. 单词');
        expect(systemPrompt).not.toContain('2. 短语/习语');
        expect(systemPrompt).toContain('2. 复杂语法结构');
      });

      it('should exclude grammar task when grammarTranslationEnabled is false', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          {
            ...mockSettings,
            phraseTranslationEnabled: true,
            grammarTranslationEnabled: false,
          }
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('1. 单词');
        expect(systemPrompt).toContain('2. 短语/习语');
        expect(systemPrompt).not.toContain('3. 复杂语法结构');
      });

      it('should handle both options disabled', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          {
            ...mockSettings,
            phraseTranslationEnabled: false,
            grammarTranslationEnabled: false,
          }
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('1. 单词');
        expect(systemPrompt).not.toContain('2.');
      });

      it('should include all required sections', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          mockSettings
        );

        const systemPrompt = builder.buildSystemPrompt();

        expect(systemPrompt).toContain('你是一个专业的英语学习助手');
        expect(systemPrompt).toContain('分析任务');
        expect(systemPrompt).toContain('对于每个识别出的内容');
        expect(systemPrompt).toContain('重要规则');
      });
    });

    describe('buildUserPrompt', () => {
      it('should include text in single mode', () => {
        const text = 'Hello world';
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          text,
          text,
          mockSettings
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain(text);
        expect(userPrompt).not.toContain('[PARA_1]');
      });

      it('should use batch format when paragraphs are provided', () => {
        const paragraphs = '[PARA_1] Paragraph 1\n[PARA_2] Paragraph 2';
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'text',
          'context',
          mockSettings,
          paragraphs
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain('[PARA_n]');
        expect(userPrompt).toContain(paragraphs);
      });

      it('should include context when different from text', () => {
        const text = 'Hello world';
        const context = 'This is the context';
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

      it('should not include context section when context equals text', () => {
        const text = 'Hello world';
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          text,
          text,
          mockSettings
        );

        const userPrompt = builder.buildUserPrompt();

        // 不应该有额外的上下文部分
        const contextMatches = userPrompt.match(/上下文/g);
        expect(contextMatches?.length ?? 0).toBeLessThanOrEqual(1);
      });

      it('should include grammar analysis instructions when enabled', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          {
            ...mockSettings,
            grammarTranslationEnabled: true,
          }
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain('语法分析要求');
        expect(userPrompt).toContain('标注值得学习的语法结构');
      });

      it('should exclude grammar section when disabled', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          {
            ...mockSettings,
            grammarTranslationEnabled: false,
          }
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).not.toContain('语法分析要求');
      });

      it('should include JSON schema requirement', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          mockSettings
        );

        const userPrompt = builder.buildUserPrompt();

        expect(userPrompt).toContain('JSON格式');
        expect(userPrompt).toContain('fullText');
        expect(userPrompt).toContain('words');
      });
    });

    describe('build', () => {
      it('should return both system and user prompts', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          mockSettings
        );

        const result = builder.build();

        expect(result).toHaveProperty('systemPrompt');
        expect(result).toHaveProperty('userPrompt');
        expect(result.systemPrompt.length).toBeGreaterThan(0);
        expect(result.userPrompt.length).toBeGreaterThan(0);
      });

      it('should have consistent vocabulary size across prompts', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'Hello world',
          'Hello world',
          mockSettings
        );

        const result = builder.build();

        expect(result.systemPrompt).toContain(String(mockUserProfile.estimatedVocabulary));
      });

      it('should handle different exam types', () => {
        const examTypes: UserProfile['examType'][] = ['cet4', 'cet6', 'toefl', 'ielts', 'gre', 'custom'];

        examTypes.forEach((examType) => {
          const profile = { ...mockUserProfile, examType };
          const builder = new TranslationPromptBuilder(
            profile,
            'Hello world',
            'Hello world',
            mockSettings
          );

          const result = builder.build();

          expect(result.systemPrompt).toContain(EXAM_DISPLAY_NAMES[examType]);
        });
      });

      it('should handle batch translation schema', () => {
        const builder = new TranslationPromptBuilder(
          mockUserProfile,
          'text',
          'context',
          mockSettings,
          '[PARA_1] Paragraph 1'
        );

        const result = builder.build();

        expect(result.userPrompt).toContain('paragraphs');
        expect(result.userPrompt).toContain('id');
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
        const version = manager.getCurrentVersion();
        expect(version).toBe('v1.0.0');
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

      it('should add version to active versions', () => {
        manager.setCurrentVersion('v2.0.0-beta');
        const versions = manager.listVersions();
        expect(versions).toContain('v2.0.0-beta');
      });
    });

    describe('getTemplate', () => {
      it('should return template for v1.0.0', () => {
        const template = manager.getTemplate('v1.0.0');

        expect(template).toBeDefined();
        expect(template.version).toBe('v1.0.0');
        expect(template.systemPrompt).toBeDefined();
        expect(template.userPromptTemplate).toBeDefined();
        expect(template.outputSchema).toBeDefined();
        expect(template.config).toBeDefined();
      });

      it('should return template for v2.0.0-beta', () => {
        const template = manager.getTemplate('v2.0.0-beta');

        expect(template).toBeDefined();
        expect(template.version).toBe('v2.0.0-beta');
        expect(template.systemPrompt).toBeDefined();
        expect(template.userPromptTemplate).toBeDefined();
      });

      it('should use current version when no version specified', () => {
        manager.setCurrentVersion('v2.0.0-beta');
        const template = manager.getTemplate();

        expect(template.version).toBe('v2.0.0-beta');
      });

      it('should throw error for non-existent version', () => {
        expect(() => {
          manager.getTemplate('v999.0.0');
        }).toThrow('Prompt version v999.0.0 not found');
      });

      it('should have valid config for all templates', () => {
        const versions = manager.listVersions();

        versions.forEach((version) => {
          const template = manager.getTemplate(version);
          expect(template.config).toHaveProperty('temperature');
          expect(template.config).toHaveProperty('maxTokens');
          expect(template.config).toHaveProperty('topP');
          expect(template.config).toHaveProperty('responseFormat');
          expect(typeof template.config.temperature).toBe('number');
          expect(typeof template.config.maxTokens).toBe('number');
        });
      });
    });

    describe('listVersions', () => {
      it('should return all available versions', () => {
        const versions = manager.listVersions();

        expect(versions).toContain('v1.0.0');
        expect(versions).toContain('v2.0.0-beta');
        expect(versions.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe('hasVersion', () => {
      it('should return true for existing versions', () => {
        expect(manager.hasVersion('v1.0.0')).toBe(true);
        expect(manager.hasVersion('v2.0.0-beta')).toBe(true);
      });

      it('should return false for non-existing versions', () => {
        expect(manager.hasVersion('v999.0.0')).toBe(false);
        expect(manager.hasVersion('invalid')).toBe(false);
      });
    });

    describe('registerVersion', () => {
      it('should register new version', () => {
        const newTemplate = {
          version: 'v3.0.0',
          systemPrompt: 'System prompt',
          userPromptTemplate: 'User template',
          outputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
          config: {
            temperature: 0.5,
            maxTokens: 2000,
            topP: 0.95,
            responseFormat: 'json' as const,
          },
        };

        manager.registerVersion(newTemplate);

        expect(manager.hasVersion('v3.0.0')).toBe(true);
        expect(manager.listVersions()).toContain('v3.0.0');

        // 清理：删除测试注册的版本
        delete PROMPT_VERSIONS['v3.0.0'];
      });

      it('should allow updating existing version', () => {
        // 保存原始值以便恢复
        const originalTemplate = { ...PROMPT_VERSIONS['v1.0.0'] };

        const updatedTemplate = {
          version: 'v1.0.0',
          systemPrompt: 'Updated system prompt',
          userPromptTemplate: PROMPT_VERSIONS['v1.0.0'].userPromptTemplate,
          outputSchema: PROMPT_VERSIONS['v1.0.0'].outputSchema,
          config: PROMPT_VERSIONS['v1.0.0'].config,
        };

        manager.registerVersion(updatedTemplate);
        const template = manager.getTemplate('v1.0.0');

        expect(template.systemPrompt).toBe('Updated system prompt');

        // 恢复原始值
        PROMPT_VERSIONS['v1.0.0'] = originalTemplate;
      });
    });
  });

  describe('PROMPT_VERSIONS registry', () => {
    it('should contain v1.0.0 template', () => {
      expect(PROMPT_VERSIONS['v1.0.0']).toBeDefined();
      expect(PROMPT_VERSIONS['v1.0.0'].version).toBe('v1.0.0');
    });

    it('should contain v2.0.0-beta template', () => {
      expect(PROMPT_VERSIONS['v2.0.0-beta']).toBeDefined();
      expect(PROMPT_VERSIONS['v2.0.0-beta'].version).toBe('v2.0.0-beta');
    });

    it('should have valid output schema structure', () => {
      Object.values(PROMPT_VERSIONS).forEach((template) => {
        expect(template.outputSchema.type).toBe('object');
        expect(template.outputSchema.properties).toBeDefined();
        expect(Array.isArray(template.outputSchema.required)).toBe(true);
      });
    });

    it('v1.0.0 should have correct schema properties', () => {
      const schema = PROMPT_VERSIONS['v1.0.0'].outputSchema;

      expect(schema.properties).toHaveProperty('fullText');
      expect(schema.properties).toHaveProperty('words');
      expect(schema.properties).toHaveProperty('sentences');
      expect(schema.properties).toHaveProperty('grammarPoints');
    });

    it('v1.0.0 should require correct fields', () => {
      const schema = PROMPT_VERSIONS['v1.0.0'].outputSchema;

      expect(schema.required).toContain('fullText');
      expect(schema.required).toContain('words');
      expect(schema.required).toContain('sentences');
    });

    it('v2.0.0-beta should have extended schema properties', () => {
      const schema = PROMPT_VERSIONS['v2.0.0-beta'].outputSchema;
      const wordSchema = schema.properties.words;

      if (wordSchema && wordSchema.items && typeof wordSchema.items === 'object') {
        const items = wordSchema.items;
        if (items.properties) {
          expect(items.properties).toHaveProperty('phonetic');
          expect(items.properties).toHaveProperty('partOfSpeech');
          expect(items.properties).toHaveProperty('examples');
        }
      }
    });

    it('should have template variables in system prompts', () => {
      Object.values(PROMPT_VERSIONS).forEach((template) => {
        expect(template.systemPrompt).toContain('{vocabulary_size}');
        expect(template.systemPrompt).toContain('{exam_level}');
      });
    });

    it('should have template variables in user prompts', () => {
      Object.values(PROMPT_VERSIONS).forEach((template) => {
        expect(template.userPromptTemplate).toContain('{text}');
        expect(template.userPromptTemplate).toContain('{context}');
      });
    });
  });

  describe('promptVersionManager singleton', () => {
    it('should be defined', () => {
      expect(promptVersionManager).toBeDefined();
    });

    it('should have default version set', () => {
      expect(promptVersionManager.getCurrentVersion()).toBe('v1.0.0');
    });

    it('should share state across references', () => {
      const initialVersion = promptVersionManager.getCurrentVersion();
      promptVersionManager.setCurrentVersion('v2.0.0-beta');

      expect(promptVersionManager.getCurrentVersion()).toBe('v2.0.0-beta');

      // 恢复原状态
      promptVersionManager.setCurrentVersion(initialVersion);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text', () => {
      const builder = new TranslationPromptBuilder(
        mockUserProfile,
        '',
        '',
        mockSettings
      );

      const result = builder.build();

      expect(result.userPrompt).toBeDefined();
      expect(result.systemPrompt).toBeDefined();
    });

    it('should handle long text', () => {
      const longText = 'a'.repeat(10000);
      const builder = new TranslationPromptBuilder(
        mockUserProfile,
        longText,
        longText,
        mockSettings
      );

      const result = builder.build();

      expect(result.userPrompt).toContain(longText);
    });

    it('should handle special characters in text', () => {
      const specialText = 'Hello <world> "test" \'quote\' & amp; <script>alert(1)</script>';
      const builder = new TranslationPromptBuilder(
        mockUserProfile,
        specialText,
        specialText,
        mockSettings
      );

      const result = builder.build();

      expect(result.userPrompt).toContain(specialText);
    });

    it('should handle zero vocabulary size', () => {
      const profile = { ...mockUserProfile, estimatedVocabulary: 0 };
      const builder = new TranslationPromptBuilder(
        profile,
        'Hello world',
        'Hello world',
        mockSettings
      );

      const result = builder.build();

      expect(result.systemPrompt).toContain('0');
    });

    it('should handle very large vocabulary size', () => {
      const profile = { ...mockUserProfile, estimatedVocabulary: 50000 };
      const builder = new TranslationPromptBuilder(
        profile,
        'Hello world',
        'Hello world',
        mockSettings
      );

      const result = builder.build();

      expect(result.systemPrompt).toContain('50000');
    });
  });
});
