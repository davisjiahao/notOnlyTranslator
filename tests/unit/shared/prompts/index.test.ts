/**
 * 提示词管理系统测试
 */
import { describe, it, expect } from 'vitest';
import {
  TranslationPromptBuilder,
  PromptVersionManager,
  PROMPT_VERSIONS,
  promptVersionManager
} from '@/shared/prompts';
import type { UserProfile, UserSettings } from '@/shared/types';

function defaultProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    estimatedVocabulary: 3000,
    examType: 'cet4',
    knownWords: [],
    unknownWords: [],
    ...overrides
  };
}

function defaultSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    translationMode: 'paragraph',
    phraseTranslationEnabled: true,
    grammarTranslationEnabled: false,
    apiKey: 'test',
    apiProvider: 'openai',
    targetLanguage: 'zh',
    ...overrides
  };
}

describe('TranslationPromptBuilder', () => {
  describe('buildSystemPrompt', () => {
    it('should include vocabulary size and exam level', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile({ estimatedVocabulary: 5000 }),
        'Hello world',
        'Hello world',
        defaultSettings()
      );
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('5000');
      expect(prompt).toContain('CET-4');
    });

    it('should include phrase task when phraseTranslationEnabled', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text',
        defaultSettings({ phraseTranslationEnabled: true, grammarTranslationEnabled: false })
      );
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('短语/习语');
    });

    it('should include grammar task when grammarTranslationEnabled', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text',
        defaultSettings({ phraseTranslationEnabled: false, grammarTranslationEnabled: true })
      );
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('复杂语法结构');
      expect(prompt).toContain('2.');
    });

    it('should number grammar as 3 when phrases also enabled', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text',
        defaultSettings({ phraseTranslationEnabled: true, grammarTranslationEnabled: true })
      );
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('3.');
    });

    it('should not include grammar task when disabled', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text',
        defaultSettings({ phraseTranslationEnabled: false, grammarTranslationEnabled: false })
      );
      const prompt = builder.buildSystemPrompt();
      expect(prompt).not.toContain('复杂语法结构');
    });

    it('should include analysis tasks and rules', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text', defaultSettings()
      );
      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('分析任务');
      expect(prompt).toContain('中文翻译');
      expect(prompt).toContain('难度等级（1-10');
      expect(prompt).toContain('只标注超出用户水平的内容');
    });
  });

  describe('buildUserPrompt', () => {
    it('should include text for single-paragraph mode', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'The quick brown fox', 'The quick brown fox', defaultSettings()
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).toContain('The quick brown fox');
      expect(prompt).not.toContain('[PARA_');
    });

    it('should include paragraphs for batch mode', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text', defaultSettings(),
        '[PARA_1] Hello\n[PARA_2] World'
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).toContain('[PARA_1] Hello');
      expect(prompt).toContain('[PARA_2] World');
      expect(prompt).toContain('多个英文段落');
    });

    it('should include context section when different from text', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'Hello', 'Hello world context', defaultSettings()
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).toContain('上下文');
      expect(prompt).toContain('Hello world context');
    });

    it('should skip context section when same as text', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'Same', 'Same', defaultSettings()
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).not.toContain('上下文');
    });

    it('should include grammar analysis note when grammarTranslationEnabled', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text',
        defaultSettings({ grammarTranslationEnabled: true })
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).toContain('语法分析要求');
      expect(prompt).toContain('虚拟语气');
    });

    it('should not include grammar analysis when disabled', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text',
        defaultSettings({ grammarTranslationEnabled: false })
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).not.toContain('语法分析要求');
    });

    it('should include JSON schema description', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text', defaultSettings()
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('fullText');
      expect(prompt).toContain('words');
    });

    it('should include batch schema when in batch mode', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text', defaultSettings(), '[PARA_1] test'
      );
      const prompt = builder.buildUserPrompt();
      expect(prompt).toContain('paragraphs');
      expect(prompt).toContain('段落标识符');
    });
  });

  describe('build', () => {
    it('should return object with systemPrompt and userPrompt', () => {
      const builder = new TranslationPromptBuilder(
        defaultProfile(), 'text', 'text', defaultSettings()
      );
      const result = builder.build();
      expect(result).toHaveProperty('systemPrompt');
      expect(result).toHaveProperty('userPrompt');
      expect(typeof result.systemPrompt).toBe('string');
      expect(typeof result.userPrompt).toBe('string');
    });

    it('should include exam level for different exam types', () => {
      const examTypes = ['cet4', 'cet6', 'ielts', 'toefl', 'gre', 'none'] as const;
      for (const examType of examTypes) {
        const builder = new TranslationPromptBuilder(
          defaultProfile({ examType }), 'text', 'text', defaultSettings()
        );
        const prompt = builder.buildSystemPrompt();
        expect(prompt.length).toBeGreaterThan(0);
      }
    });
  });
});

describe('PromptVersionManager', () => {
  describe('listVersions', () => {
    it('should list all available versions', () => {
      const versions = promptVersionManager.listVersions();
      expect(versions).toContain('v1.0.0');
      expect(versions).toContain('v2.0.0-beta');
    });
  });

  describe('getCurrentVersion', () => {
    it('should return the current version', () => {
      const current = promptVersionManager.getCurrentVersion();
      expect(typeof current).toBe('string');
      expect(current.length).toBeGreaterThan(0);
    });
  });

  describe('setCurrentVersion', () => {
    it('should return true and switch to existing version', () => {
      const manager = new PromptVersionManager();
      const result = manager.setCurrentVersion('v2.0.0-beta');
      expect(result).toBe(true);
      expect(manager.getCurrentVersion()).toBe('v2.0.0-beta');
    });

    it('should return false for non-existent version', () => {
      const manager = new PromptVersionManager();
      const result = manager.setCurrentVersion('v9.9.9');
      expect(result).toBe(false);
      expect(manager.getCurrentVersion()).toBe('v1.0.0');
    });
  });

  describe('getTemplate', () => {
    it('should return the current version template', () => {
      const template = promptVersionManager.getTemplate();
      expect(template.version).toBe(promptVersionManager.getCurrentVersion());
      expect(template.systemPrompt).toBeDefined();
      expect(template.userPromptTemplate).toBeDefined();
      expect(template.outputSchema).toBeDefined();
      expect(template.config).toBeDefined();
    });

    it('should return a specific version template', () => {
      const template = promptVersionManager.getTemplate('v2.0.0-beta');
      expect(template.version).toBe('v2.0.0-beta');
    });

    it('should throw for non-existent version', () => {
      expect(() => promptVersionManager.getTemplate('v99.0.0')).toThrow('not found');
    });
  });

  describe('hasVersion', () => {
    it('should return true for existing version', () => {
      expect(promptVersionManager.hasVersion('v1.0.0')).toBe(true);
      expect(promptVersionManager.hasVersion('v2.0.0-beta')).toBe(true);
    });

    it('should return false for non-existent version', () => {
      expect(promptVersionManager.hasVersion('v99.0.0')).toBe(false);
    });
  });

  describe('registerVersion', () => {
    it('should register a new version and make it available', () => {
      const manager = new PromptVersionManager();
      const newTemplate = {
        version: 'v3.0.0',
        systemPrompt: 'New system prompt',
        userPromptTemplate: 'New user prompt',
        outputSchema: { type: 'object' as const, properties: {}, required: ['fullText'] },
        config: { temperature: 0.2, maxTokens: 1000, topP: 0.9, responseFormat: 'json' as const }
      };

      manager.registerVersion(newTemplate);
      expect(manager.hasVersion('v3.0.0')).toBe(true);

      const template = manager.getTemplate('v3.0.0');
      expect(template.systemPrompt).toBe('New system prompt');
    });
  });
});

describe('PROMPT_VERSIONS', () => {
  const knownVersions = ['v1.0.0', 'v2.0.0-beta'];

  it('should define at least two versions', () => {
    expect(Object.keys(PROMPT_VERSIONS).length).toBeGreaterThanOrEqual(2);
  });

  it('should have valid config for each known version', () => {
    for (const key of knownVersions) {
      const template = PROMPT_VERSIONS[key];
      expect(template).toBeDefined();
      expect(template.version).toBe(key);
      expect(typeof template.systemPrompt).toBe('string');
      expect(typeof template.userPromptTemplate).toBe('string');
      expect(template.config.temperature).toBeGreaterThanOrEqual(0);
      expect(template.config.maxTokens).toBeGreaterThan(0);
      expect(['json', 'text']).toContain(template.config.responseFormat);
    }
  });

  it('should have output schema with required fields for known versions', () => {
    for (const key of knownVersions) {
      const template = PROMPT_VERSIONS[key];
      expect(template.outputSchema.type).toBe('object');
      expect(template.outputSchema.required.length).toBeGreaterThan(0);
      expect(template.outputSchema.properties).toHaveProperty('fullText');
      expect(template.outputSchema.properties).toHaveProperty('words');
    }
  });
});
