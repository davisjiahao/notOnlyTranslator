/**
 * LLM 增强分析模块 (CMP-106)
 * 提供生词、短语、语法、文化背景的深度分析功能
 */

import type { TranslatedWord, UserSettings, GrammarPoint } from '@/shared/types';
import { logger } from '@/shared/utils';
import { TranslationApiService } from './translationApi';

/**
 * 生词详细释义
 */
export interface WordDetailAnalysis {
  /** 原词 */
  word: string;
  /** 音标 */
  phonetic: string;
  /** 词性 */
  partOfSpeech: string;
  /** 中文释义 */
  definition: string;
  /** 英文释义 */
  definitionEn?: string;
  /** 同义词 */
  synonyms?: string[];
  /** 反义词 */
  antonyms?: string[];
  /** 词根词缀分析 */
  etymology?: {
    root: string;
    prefix?: string;
    suffix?: string;
    meaning: string;
  };
  /** 搭配用法 */
  collocations?: string[];
  /** 例句 */
  examples: Array<{
    sentence: string;
    translation: string;
  }>;
  /** 难度等级 (1-10) */
  difficulty: number;
  /** CEFR 等级 */
  cefrLevel?: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
}

/**
 * 短语用法分析
 */
export interface PhraseAnalysis {
  /** 短语原文 */
  phrase: string;
  /** 翻译 */
  translation: string;
  /** 短语类型 */
  type: 'idiom' | 'phrasal_verb' | 'collocation' | 'cliché' | 'proverb' | 'other';
  /** 字面意思 */
  literalMeaning?: string;
  /** 实际含义 */
  actualMeaning: string;
  /** 使用场景 */
  usageContext: string[];
  /** 语体风格 */
  register: 'formal' | 'informal' | 'neutral' | 'slang';
  /** 例句 */
  examples: Array<{
    sentence: string;
    translation: string;
  }>;
  /** 相关短语 */
  relatedPhrases?: string[];
  /** 难度等级 */
  difficulty: number;
}

/**
 * 语法结构解析
 */
export interface GrammarAnalysis {
  /** 原句片段 */
  originalText: string;
  /** 语法类型 */
  type: string;
  /** 语法名称 */
  name: string;
  /** 详细解释 */
  explanation: string;
  /** 结构分解 */
  structure?: Array<{
    part: string;
    role: string;
    description: string;
  }>;
  /** 常见错误 */
  commonErrors?: string[];
  /** 使用建议 */
  tips?: string[];
  /** 例句 */
  examples?: Array<{
    correct: string;
    incorrect?: string;
    explanation: string;
  }>;
}

/**
 * 文化背景说明
 */
export interface CulturalNote {
  /** 相关文本 */
  text: string;
  /** 文化类型 */
  type: 'history' | 'literature' | 'politics' | 'sports' | 'entertainment' | 'geography' | 'custom' | 'other';
  /** 标题 */
  title: string;
  /** 详细说明 */
  description: string;
  /** 背景知识 */
  background?: string;
  /** 相关链接或参考 */
  references?: string[];
}

/**
 * LLM 增强分析完整结果
 */
export interface LlmEnhancedAnalysisResult {
  /** 生词详细释义列表 */
  wordDetails: WordDetailAnalysis[];
  /** 短语用法分析列表 */
  phrases: PhraseAnalysis[];
  /** 语法结构解析列表 */
  grammarAnalysis: GrammarAnalysis[];
  /** 文化背景说明列表 */
  culturalNotes: CulturalNote[];
  /** 分析耗时（毫秒） */
  analysisTime: number;
  /** 分析文本长度 */
  textLength: number;
}

/**
 * 分析选项
 */
export interface AnalysisOptions {
  /** 是否分析生词 */
  analyzeWords: boolean;
  /** 是否分析短语 */
  analyzePhrases: boolean;
  /** 是否分析语法 */
  analyzeGrammar: boolean;
  /** 是否分析文化背景 */
  analyzeCultural: boolean;
  /** 用户词汇量 */
  userVocabulary: number;
  /** 最大分析词数 */
  maxWords?: number;
  /** 最大分析短语数 */
  maxPhrases?: number;
}

/**
 * 默认分析选项
 */
const DEFAULT_OPTIONS: AnalysisOptions = {
  analyzeWords: true,
  analyzePhrases: true,
  analyzeGrammar: true,
  analyzeCultural: false, // 文化背景分析默认关闭，按需启用
  userVocabulary: 3000,
  maxWords: 10,
  maxPhrases: 5,
};

/**
 * LLM 增强分析服务
 * 提供生词、短语、语法、文化背景的深度分析
 */
export class LlmEnhancedAnalysisService {
  /**
   * 执行完整的增强分析
   */
  static async analyze(
    text: string,
    settings: UserSettings,
    options: Partial<AnalysisOptions> = {}
  ): Promise<LlmEnhancedAnalysisResult> {
    const startTime = performance.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };

    logger.info('LlmEnhancedAnalysisService: Starting analysis', {
      textLength: text.length,
      options: opts,
    });

    const result: LlmEnhancedAnalysisResult = {
      wordDetails: [],
      phrases: [],
      grammarAnalysis: [],
      culturalNotes: [],
      analysisTime: 0,
      textLength: text.length,
    };

    try {
      // 并行执行各项分析
      const analyses = await Promise.allSettled([
        opts.analyzeWords ? this.analyzeWords(text, settings, opts) : Promise.resolve([]),
        opts.analyzePhrases ? this.analyzePhrases(text, settings, opts) : Promise.resolve([]),
        opts.analyzeGrammar ? this.analyzeGrammar(text, settings) : Promise.resolve([]),
        opts.analyzeCultural ? this.analyzeCultural(text, settings) : Promise.resolve([]),
      ]);

      // 合并结果
      if (analyses[0].status === 'fulfilled') {
        result.wordDetails = analyses[0].value;
      }
      if (analyses[1].status === 'fulfilled') {
        result.phrases = analyses[1].value;
      }
      if (analyses[2].status === 'fulfilled') {
        result.grammarAnalysis = analyses[2].value;
      }
      if (analyses[3].status === 'fulfilled') {
        result.culturalNotes = analyses[3].value;
      }

      result.analysisTime = performance.now() - startTime;

      logger.info('LlmEnhancedAnalysisService: Analysis complete', {
        wordCount: result.wordDetails.length,
        phraseCount: result.phrases.length,
        grammarCount: result.grammarAnalysis.length,
        culturalCount: result.culturalNotes.length,
        duration: `${result.analysisTime.toFixed(2)}ms`,
      });

      return result;
    } catch (error) {
      logger.error('LlmEnhancedAnalysisService: Analysis failed', error);
      result.analysisTime = performance.now() - startTime;
      return result;
    }
  }

  /**
   * 分析生词详细释义
   */
  private static async analyzeWords(
    text: string,
    settings: UserSettings,
    options: AnalysisOptions
  ): Promise<WordDetailAnalysis[]> {
    const apiKey = await this.getApiKey(settings);
    if (!apiKey && settings.apiProvider !== 'ollama') {
      return [];
    }

    const prompt = this.buildWordAnalysisPrompt(text, options);

    try {
      const content = await TranslationApiService.callWithSystem(
        this.getSystemPrompt('word_analysis'),
        prompt,
        apiKey || '',
        settings
      );

      return this.parseWordAnalysisResponse(content);
    } catch (error) {
      logger.error('Word analysis failed:', error);
      return [];
    }
  }

  /**
   * 分析短语用法
   */
  private static async analyzePhrases(
    text: string,
    settings: UserSettings,
    options: AnalysisOptions
  ): Promise<PhraseAnalysis[]> {
    const apiKey = await this.getApiKey(settings);
    if (!apiKey && settings.apiProvider !== 'ollama') {
      return [];
    }

    const prompt = this.buildPhraseAnalysisPrompt(text, options);

    try {
      const content = await TranslationApiService.callWithSystem(
        this.getSystemPrompt('phrase_analysis'),
        prompt,
        apiKey || '',
        settings
      );

      return this.parsePhraseAnalysisResponse(content);
    } catch (error) {
      logger.error('Phrase analysis failed:', error);
      return [];
    }
  }

  /**
   * 分析语法结构
   */
  private static async analyzeGrammar(
    text: string,
    settings: UserSettings
  ): Promise<GrammarAnalysis[]> {
    const apiKey = await this.getApiKey(settings);
    if (!apiKey && settings.apiProvider !== 'ollama') {
      return [];
    }

    const prompt = this.buildGrammarAnalysisPrompt(text);

    try {
      const content = await TranslationApiService.callWithSystem(
        this.getSystemPrompt('grammar_analysis'),
        prompt,
        apiKey || '',
        settings
      );

      return this.parseGrammarAnalysisResponse(content);
    } catch (error) {
      logger.error('Grammar analysis failed:', error);
      return [];
    }
  }

  /**
   * 分析文化背景
   */
  private static async analyzeCultural(
    text: string,
    settings: UserSettings
  ): Promise<CulturalNote[]> {
    const apiKey = await this.getApiKey(settings);
    if (!apiKey && settings.apiProvider !== 'ollama') {
      return [];
    }

    const prompt = this.buildCulturalAnalysisPrompt(text);

    try {
      const content = await TranslationApiService.callWithSystem(
        this.getSystemPrompt('cultural_analysis'),
        prompt,
        apiKey || '',
        settings
      );

      return this.parseCulturalAnalysisResponse(content);
    } catch (error) {
      logger.error('Cultural analysis failed:', error);
      return [];
    }
  }

  /**
   * 获取 API Key
   */
  private static async getApiKey(_settings: UserSettings): Promise<string | null> {
    // 从 storage 获取 API Key
    const { StorageManager } = await import('./storage');
    return StorageManager.getApiKey();
  }

  /**
   * 获取系统提示词
   */
  private static getSystemPrompt(type: 'word_analysis' | 'phrase_analysis' | 'grammar_analysis' | 'cultural_analysis'): string {
    const prompts = {
      word_analysis: `你是一位专业的英语词汇教师，擅长深入分析英语单词。
你的任务是分析文本中的重点词汇，提供详细的释义、词根词缀、搭配和例句。
始终返回有效的 JSON 格式数据。`,

      phrase_analysis: `你是一位专业的英语短语和习语专家。
你的任务是识别和分析文本中的短语、习语和固定搭配，解释其含义和用法。
始终返回有效的 JSON 格式数据。`,

      grammar_analysis: `你是一位专业的英语语法教师。
你的任务是分析文本中的语法结构，解释复杂的语法现象，帮助学习者理解。
始终返回有效的 JSON 格式数据。`,

      cultural_analysis: `你是一位熟悉英语国家文化的文化顾问。
你的任务是识别文本中的文化元素，提供相关的文化背景知识。
始终返回有效的 JSON 格式数据。`,
    };

    return prompts[type];
  }

  /**
   * 构建生词分析提示词
   */
  private static buildWordAnalysisPrompt(text: string, options: AnalysisOptions): string {
    return `请分析以下英文文本中的重点词汇。

文本："""
${text}
"""

要求：
1. 选择 ${options.maxWords || 10} 个对该级别学习者最有价值的词汇
2. 学习者词汇量约为 ${options.userVocabulary} 词
3. 优先选择：专业术语、高级词汇、常见但用法多样的词

返回 JSON 格式：
\`\`\`json
{
  "words": [
    {
      "word": "vocabulary",
      "phonetic": "/vəˈkæbjʊləri/",
      "partOfSpeech": "noun",
      "definition": "词汇；词汇量",
      "definitionEn": "the body of words used in a particular language",
      "synonyms": ["lexicon", "word stock"],
      "antonyms": [],
      "etymology": {
        "root": "voc",
        "prefix": "",
        "suffix": "-ary",
        "meaning": "来自拉丁语 vocare（呼叫）+ -ary（集合），指'被呼叫出来的词的集合'"
      },
      "collocations": ["build vocabulary", "expand vocabulary", "limited vocabulary"],
      "examples": [
        {
          "sentence": "Reading is a great way to expand your vocabulary.",
          "translation": "阅读是扩大词汇量的好方法。"
        }
      ],
      "difficulty": 6,
      "cefrLevel": "B2"
    }
  ]
}
\`\`\`

只返回 JSON，不要添加其他说明。`;
  }

  /**
   * 构建短语分析提示词
   */
  private static buildPhraseAnalysisPrompt(text: string, options: AnalysisOptions): string {
    return `请分析以下英文文本中的短语和习语。

文本："""
${text}
"""

要求：
1. 识别 ${options.maxPhrases || 5} 个重要短语或习语
2. 包括：习语、动词短语、固定搭配、谚语等
3. 解释字面意思和实际含义的差异

返回 JSON 格式：
\`\`\`json
{
  "phrases": [
    {
      "phrase": "break the ice",
      "translation": "打破僵局",
      "type": "idiom",
      "literalMeaning": "打破冰块",
      "actualMeaning": "在社交场合打破沉默，开始交谈",
      "usageContext": ["社交聚会", "会议开始", "初次见面"],
      "register": "neutral",
      "examples": [
        {
          "sentence": "He told a joke to break the ice at the party.",
          "translation": "他在聚会上讲了个笑话来打破僵局。"
        }
      ],
      "relatedPhrases": ["break the silence", "cut the ice"],
      "difficulty": 5
    }
  ]
}
\`\`\`

type 可选值：idiom（习语）, phrasal_verb（动词短语）, collocation（搭配）, cliché（陈词滥调）, proverb（谚语）, other
register 可选值：formal, informal, neutral, slang

只返回 JSON，不要添加其他说明。`;
  }

  /**
   * 构建语法分析提示词
   */
  private static buildGrammarAnalysisPrompt(text: string): string {
    return `请分析以下英文文本中的语法结构。

文本："""
${text}
"""

要求：
1. 识别复杂的语法结构（从句、非谓语动词、虚拟语气等）
2. 解释每个语法点的结构和用法
3. 提供常见错误和使用建议

返回 JSON 格式：
\`\`\`json
{
  "grammarPoints": [
    {
      "originalText": "Had I known about the meeting, I would have attended.",
      "type": "subjunctive",
      "name": "虚拟语气倒装",
      "explanation": "这是虚拟语气的倒装形式，省略了连词 if，将 had 提到句首",
      "structure": [
        {
          "part": "Had I known",
          "role": "条件从句",
          "description": "倒装的条件从句，表示与过去事实相反的假设"
        },
        {
          "part": "I would have attended",
          "role": "主句",
          "description": "表示假设情况下的结果"
        }
      ],
      "commonErrors": [
        "错误：If I had known...（这是正常语序，不是错误，但要注意倒装时不需要 if）",
        "错误：Had I know...（had 后应接过去分词 known）"
      ],
      "tips": [
        "倒装结构更正式、更有文学色彩",
        "注意 had/should/were 可以用于倒装"
      ],
      "examples": [
        {
          "correct": "Were I rich, I would travel the world.",
          "incorrect": "If I am rich, I will travel the world.",
          "explanation": "were I 是 be 动词的倒装形式，表示现在的虚拟"
        }
      ]
    }
  ]
}
\`\`\`

只返回 JSON，不要添加其他说明。`;
  }

  /**
   * 构建文化背景分析提示词
   */
  private static buildCulturalAnalysisPrompt(text: string): string {
    return `请分析以下英文文本中的文化元素。

文本："""
${text}
"""

要求：
1. 识别需要文化背景知识才能完全理解的内容
2. 包括：历史事件、文学作品、政治人物、体育赛事、地理名称等
3. 提供简洁但有用的文化背景说明

返回 JSON 格式：
\`\`\`json
{
  "culturalNotes": [
    {
      "text": "Silicon Valley",
      "type": "geography",
      "title": "硅谷",
      "description": "美国加利福尼亚州北部的一个地区，是全球高科技产业的中心",
      "background": "得名于该地区早期集中的半导体和计算机芯片制造商。现在包括苹果、谷歌、Meta等众多科技巨头总部",
      "references": ["Stanford University", "Apple Park", "Googleplex"]
    }
  ]
}
\`\`\`

type 可选值：history（历史）, literature（文学）, politics（政治）, sports（体育）, entertainment（娱乐）, geography（地理）, custom（习俗）, other

只返回 JSON，不要添加其他说明。`;
  }

  /**
   * 解析生词分析响应
   */
  private static parseWordAnalysisResponse(content: string): WordDetailAnalysis[] {
    try {
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed.words)) {
        return [];
      }

      return parsed.words.map((w: Record<string, unknown>) => ({
        word: String(w.word || ''),
        phonetic: String(w.phonetic || ''),
        partOfSpeech: String(w.partOfSpeech || ''),
        definition: String(w.definition || ''),
        definitionEn: w.definitionEn ? String(w.definitionEn) : undefined,
        synonyms: Array.isArray(w.synonyms) ? w.synonyms.map(String) : undefined,
        antonyms: Array.isArray(w.antonyms) ? w.antonyms.map(String) : undefined,
        etymology: w.etymology ? {
          root: String((w.etymology as Record<string, unknown>).root || ''),
          prefix: (w.etymology as Record<string, unknown>).prefix ? String((w.etymology as Record<string, unknown>).prefix) : undefined,
          suffix: (w.etymology as Record<string, unknown>).suffix ? String((w.etymology as Record<string, unknown>).suffix) : undefined,
          meaning: String((w.etymology as Record<string, unknown>).meaning || ''),
        } : undefined,
        collocations: Array.isArray(w.collocations) ? w.collocations.map(String) : undefined,
        examples: Array.isArray(w.examples) ? w.examples.map((e: Record<string, unknown>) => ({
          sentence: String(e.sentence || ''),
          translation: String(e.translation || ''),
        })) : [],
        difficulty: Number(w.difficulty) || 5,
        cefrLevel: w.cefrLevel as WordDetailAnalysis['cefrLevel'],
      }));
    } catch (error) {
      logger.error('Failed to parse word analysis response:', error);
      return [];
    }
  }

  /**
   * 解析短语分析响应
   */
  private static parsePhraseAnalysisResponse(content: string): PhraseAnalysis[] {
    try {
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed.phrases)) {
        return [];
      }

      return parsed.phrases.map((p: Record<string, unknown>) => ({
        phrase: String(p.phrase || ''),
        translation: String(p.translation || ''),
        type: (p.type as PhraseAnalysis['type']) || 'other',
        literalMeaning: p.literalMeaning ? String(p.literalMeaning) : undefined,
        actualMeaning: String(p.actualMeaning || ''),
        usageContext: Array.isArray(p.usageContext) ? p.usageContext.map(String) : [],
        register: (p.register as PhraseAnalysis['register']) || 'neutral',
        examples: Array.isArray(p.examples) ? p.examples.map((e: Record<string, unknown>) => ({
          sentence: String(e.sentence || ''),
          translation: String(e.translation || ''),
        })) : [],
        relatedPhrases: Array.isArray(p.relatedPhrases) ? p.relatedPhrases.map(String) : undefined,
        difficulty: Number(p.difficulty) || 5,
      }));
    } catch (error) {
      logger.error('Failed to parse phrase analysis response:', error);
      return [];
    }
  }

  /**
   * 解析语法分析响应
   */
  private static parseGrammarAnalysisResponse(content: string): GrammarAnalysis[] {
    try {
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed.grammarPoints)) {
        return [];
      }

      return parsed.grammarPoints.map((g: Record<string, unknown>) => ({
        originalText: String(g.originalText || ''),
        type: String(g.type || ''),
        name: String(g.name || ''),
        explanation: String(g.explanation || ''),
        structure: Array.isArray(g.structure) ? g.structure.map((s: Record<string, unknown>) => ({
          part: String(s.part || ''),
          role: String(s.role || ''),
          description: String(s.description || ''),
        })) : undefined,
        commonErrors: Array.isArray(g.commonErrors) ? g.commonErrors.map(String) : undefined,
        tips: Array.isArray(g.tips) ? g.tips.map(String) : undefined,
        examples: Array.isArray(g.examples) ? g.examples.map((e: Record<string, unknown>) => ({
          correct: String(e.correct || ''),
          incorrect: e.incorrect ? String(e.incorrect) : undefined,
          explanation: String(e.explanation || ''),
        })) : undefined,
      }));
    } catch (error) {
      logger.error('Failed to parse grammar analysis response:', error);
      return [];
    }
  }

  /**
   * 解析文化背景分析响应
   */
  private static parseCulturalAnalysisResponse(content: string): CulturalNote[] {
    try {
      const jsonStr = this.extractJson(content);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed.culturalNotes)) {
        return [];
      }

      return parsed.culturalNotes.map((c: Record<string, unknown>) => ({
        text: String(c.text || ''),
        type: (c.type as CulturalNote['type']) || 'other',
        title: String(c.title || ''),
        description: String(c.description || ''),
        background: c.background ? String(c.background) : undefined,
        references: Array.isArray(c.references) ? c.references.map(String) : undefined,
      }));
    } catch (error) {
      logger.error('Failed to parse cultural analysis response:', error);
      return [];
    }
  }

  /**
   * 从内容中提取 JSON
   */
  private static extractJson(content: string): string {
    // 尝试提取 ```json ... ``` 块
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      return jsonMatch[1].trim();
    }

    // 尝试直接解析
    const startIndex = content.indexOf('{');
    const endIndex = content.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1) {
      return content.slice(startIndex, endIndex + 1);
    }

    return content;
  }

  /**
   * 将分析结果转换为 TranslatedWord 格式
   * 用于与现有系统集成
   */
  static convertToTranslatedWords(wordDetails: WordDetailAnalysis[]): TranslatedWord[] {
    return wordDetails.map(w => ({
      original: w.word,
      translation: w.definition,
      position: [0, 0] as [number, number],
      difficulty: w.difficulty,
      isPhrase: false,
      phonetic: w.phonetic,
      partOfSpeech: w.partOfSpeech,
      examples: w.examples?.map(e => e.sentence),
    }));
  }

  /**
   * 将语法分析结果转换为 GrammarPoint 格式
   */
  static convertToGrammarPoints(grammarAnalysis: GrammarAnalysis[]): GrammarPoint[] {
    return grammarAnalysis.map(g => ({
      original: g.originalText,
      explanation: `${g.name}：${g.explanation}`,
      position: [0, 0] as [number, number],
      type: g.type,
    }));
  }

  /**
   * 快速分析单个词汇
   */
  static async quickAnalyzeWord(
    word: string,
    context: string,
    settings: UserSettings
  ): Promise<WordDetailAnalysis | null> {
    const apiKey = await this.getApiKey(settings);
    if (!apiKey && settings.apiProvider !== 'ollama') {
      return null;
    }

    const prompt = `请详细分析单词 "${word}" 在以下上下文中的用法。

上下文："""
${context}
"""

返回 JSON 格式：
\`\`\`json
{
  "word": "${word}",
  "phonetic": "/.../",
  "partOfSpeech": "...",
  "definition": "中文释义",
  "definitionEn": "English definition",
  "synonyms": ["..."],
  "examples": [
    {
      "sentence": "...",
      "translation": "..."
    }
  ],
  "difficulty": 1-10,
  "cefrLevel": "A1-C2"
}
\`\`\`

只返回 JSON。`;

    try {
      const content = await TranslationApiService.callWithSystem(
        this.getSystemPrompt('word_analysis'),
        prompt,
        apiKey || '',
        settings
      );

      const results = this.parseWordAnalysisResponse(content);
      return results.length > 0 ? results[0] : null;
    } catch (error) {
      logger.error('Quick word analysis failed:', error);
      return null;
    }
  }
}

export default LlmEnhancedAnalysisService;