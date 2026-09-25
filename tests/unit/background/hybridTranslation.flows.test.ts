import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HybridTranslationService } from '@/background/hybridTranslation';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { enhancedCache } from '@/background/enhancedCache';
import { TextComplexityAnalyzer } from '@/background/textComplexityAnalyzer';
import { LlmEnhancedAnalysisService } from '@/background/llmEnhancedAnalysis';
import { TransportError } from '@/shared/utils/translationErrors';
import { logger } from '@/shared/utils';
import type { TranslationRequest, UserSettings } from '@/shared/types';

vi.mock('@/background/storage', () => ({ StorageManager: { getSettings: vi.fn(), getApiKey: vi.fn() } }));
vi.mock('@/background/translationApi', () => ({ TranslationApiService: { callWithSystem: vi.fn(), quickTranslate: vi.fn(), quickTranslateWithSystem: vi.fn() } }));
vi.mock('@/background/enhancedCache', () => ({ enhancedCache: { initialize: vi.fn(), get: vi.fn(), set: vi.fn() } }));
vi.mock('@/background/llmEnhancedAnalysis', () => ({ LlmEnhancedAnalysisService: { analyze: vi.fn(), convertToTranslatedWords: vi.fn(), convertToGrammarPoints: vi.fn() } }));
vi.mock('@/background/textComplexityAnalyzer', () => ({ TextComplexityAnalyzer: { analyze: vi.fn() } }));
vi.mock('@/shared/performance', () => ({ MetricType: { API_RESPONSE_TIME: 'api', CACHE_OPERATION: 'cache', TRANSLATION_TOTAL_TIME: 'total' }, recordMetric: vi.fn() }));

const request = { text: 'An intricate yet readable sentence.', mode: 'bilingual', userLevel: { estimatedVocabulary: 3000 } } as TranslationRequest;
const settings = { apiProvider: 'openai', phraseTranslationEnabled: true, grammarTranslationEnabled: true, apiConfigs: [{ id: 'traditional', name: 'DeepL', provider: 'deepl', apiKey: 'fake-traditional' }] } as UserSettings;
const llmResponse = JSON.stringify({ words: [{ original: 'intricate', translation: '精巧', difficulty: 8 }, { original: 'a phrase', translation: '短语', isPhrase: true }], sentences: [{ original: request.text, translation: '完整译文' }], grammarPoints: [{ original: 'yet', explanation: '转折' }], fullText: '完整译文' });

beforeEach(() => {
  vi.resetAllMocks();
  HybridTranslationService.updateConfig({ defaultEngine: 'hybrid', enableSmartRouting: false, traditionalProvider: 'deepl', traditionalApiKey: undefined, enableParallelTranslation: false, enableEnhancedAnalysis: false, fallbackStrategy: 'traditional_first' });
  vi.mocked(StorageManager.getSettings).mockResolvedValue(settings);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('fake-llm');
  vi.mocked(enhancedCache.get).mockResolvedValue(null);
  vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('传统译文');
  vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(llmResponse);
  vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({ level: 'medium', score: 50, wordCount: 5, clauseCount: 1 } as ReturnType<typeof TextComplexityAnalyzer.analyze>);
});

describe('混合翻译真实公开流程', () => {
  it('传统路径从 apiConfigs 取密钥并返回译文及生词', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'traditional' });
    const result = await HybridTranslationService.translate(request);
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(request.text, 'fake-traditional', expect.objectContaining({ apiProvider: 'deepl' }), undefined);
    expect(result.fullText).toBe('传统译文');
    expect(result.words).toEqual(expect.arrayContaining([expect.objectContaining({ original: 'intricate' })]));
  });

  it('传统密钥缺失时只调用 LLM，解析结果并写缓存', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'traditional' });
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...settings, apiConfigs: [] });
    const result = await HybridTranslationService.translate(request);
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
    expect(result.fullText).toBe('完整译文');
    expect(enhancedCache.set).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ fullText: '完整译文' }), request.mode, expect.any(String), 'llm');
  });

  it('缓存命中时不读取密钥或发送网络请求', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'llm' });
    const cached = { words: [], sentences: [], fullText: '缓存译文' };
    vi.mocked(enhancedCache.get).mockResolvedValue(cached);
    expect(await HybridTranslationService.translate(request)).toBe(cached);
    expect(StorageManager.getApiKey).not.toHaveBeenCalled();
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
  });

  it('传统请求失败时回退 LLM，取消或超时不回退', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'traditional' });
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValueOnce(new Error('offline'));
    expect((await HybridTranslationService.translate(request)).fullText).toBe('完整译文');
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValueOnce(TransportError.timeout(30));
    await expect(HybridTranslationService.translate(request)).rejects.toMatchObject({ kind: 'timeout' });
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
  });

  it('并行首个失败时等待另一端成功，而非再次读取已失败的 Promise', async () => {
    HybridTranslationService.updateConfig({ enableParallelTranslation: true });
    vi.mocked(StorageManager.getSettings).mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error('offline'));
    expect((await HybridTranslationService.translate(request)).fullText).toBe('完整译文');
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(1);
  });

  it('并行 LLM 先成功时立即返回 LLM 结果', async () => {
    HybridTranslationService.updateConfig({ enableParallelTranslation: true });
    vi.mocked(TranslationApiService.quickTranslate).mockImplementation(() => new Promise(() => {}));
    expect((await HybridTranslationService.translate(request)).fullText).toBe('完整译文');
  });

  it('增强分析失败不丢失传统译文；取消仍立即抛出', async () => {
    HybridTranslationService.updateConfig({ enableEnhancedAnalysis: true });
    vi.mocked(LlmEnhancedAnalysisService.analyze).mockRejectedValueOnce(new Error('offline'));
    expect((await HybridTranslationService.translate(request)).fullText).toBe('传统译文');
    vi.mocked(LlmEnhancedAnalysisService.analyze).mockRejectedValueOnce(TransportError.cancelled());
    await expect(HybridTranslationService.translate(request)).rejects.toMatchObject({ kind: 'cancelled' });
  });

  it('提供商异常及用户正文不进入公共错误日志', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'traditional' });
    const errors = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const sensitive = 'SYNTH-PRIVATE-USER-TEXT';
    vi.mocked(TranslationApiService.quickTranslate).mockRejectedValueOnce(new Error(sensitive));
    await HybridTranslationService.translate({ ...request, text: sensitive });
    expect(errors.mock.calls.flat().map(String).join(' ')).not.toContain(sensitive);
    errors.mockRestore();
  });

  it('配置更新日志不输出传统 API 密钥', () => {
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    HybridTranslationService.updateConfig({ traditionalApiKey: 'SYNTH-SECRET-123456' });
    expect(info.mock.calls.flat().map(value => JSON.stringify(value)).join(' ')).not.toContain('SYNTH-SECRET-123456');
    info.mockRestore();
  });

  it('quickTranslate 无传统密钥时走 LLM；无两种密钥时拒绝请求', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...settings, apiConfigs: [] });
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('词义');
    expect(await HybridTranslationService.quickTranslate('word')).toBe('词义');
    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith('word', 'fake-llm', expect.objectContaining({ apiProvider: 'openai' }), undefined);
    vi.mocked(StorageManager.getApiKey).mockResolvedValue(null);
    await expect(HybridTranslationService.quickTranslate('word')).rejects.toThrow('No API key configured');
  });

  it('智能路由对简单文本选择传统，对复杂文本选择 LLM', async () => {
    HybridTranslationService.updateConfig({ enableSmartRouting: true });
    vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValueOnce({ level: 'simple', score: 20 } as ReturnType<typeof TextComplexityAnalyzer.analyze>)
      .mockReturnValueOnce({ level: 'complex', score: 80 } as ReturnType<typeof TextComplexityAnalyzer.analyze>);
    expect((await HybridTranslationService.translate(request)).fullText).toBe('传统译文');
    expect((await HybridTranslationService.translate(request)).fullText).toBe('完整译文');
  });

  it('简单分析只合并匹配词汇，保留原始对象中的字段', async () => {
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'intricate', translation: '旧义', difficulty: 8 }] }));
    vi.mocked(TranslationApiService.quickTranslateWithSystem).mockResolvedValue(JSON.stringify({ words: [{ original: 'INTRICATE', translation: '新义', phonetic: '/new/', difficulty: 8 }] }));
    const result = await HybridTranslationService.translate(request);
    expect(result.words).toEqual([expect.objectContaining({ original: 'intricate', translation: '新义', phonetic: '/new/' })]);
    expect(TranslationApiService.quickTranslateWithSystem).toHaveBeenCalledTimes(1);
  });

  it('增强分析将词汇、语法、短语与文化注释合入传统译文', async () => {
    HybridTranslationService.updateConfig({ enableEnhancedAnalysis: true });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'intricate', translation: '旧义', difficulty: 8 }] }));
    vi.mocked(LlmEnhancedAnalysisService.analyze).mockResolvedValue({
      analysisTime: 30,
      wordDetails: [{ original: 'intricate' }, { original: 'unique' }],
      grammarAnalysis: [{ original: 'yet' }],
      phrases: [{ phrase: 'yet readable', translation: '仍然易读', difficulty: 8, examples: [{ sentence: 'Yet readable.' }] }],
      culturalNotes: [{ title: '文化', text: '例子', description: '说明' }],
    } as Awaited<ReturnType<typeof LlmEnhancedAnalysisService.analyze>>);
    vi.mocked(LlmEnhancedAnalysisService.convertToTranslatedWords).mockReturnValue([
      { original: 'intricate', translation: '新义', phonetic: '/new/', position: [0, 0], difficulty: 8 },
      { original: 'unique', translation: '独特', position: [0, 0], difficulty: 7 },
    ]);
    vi.mocked(LlmEnhancedAnalysisService.convertToGrammarPoints).mockReturnValue([
      { original: 'yet', explanation: '转折', type: 'grammar', position: [0, 0] },
    ]);
    const result = await HybridTranslationService.translate(request);
    expect(result.words).toEqual(expect.arrayContaining([
      expect.objectContaining({ original: 'intricate', phonetic: '/new/' }),
      expect.objectContaining({ original: 'unique' }),
      expect.objectContaining({ original: 'yet readable', isPhrase: true }),
    ]));
    expect(result.grammarPoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ original: 'yet' }),
      expect.objectContaining({ type: 'cultural' }),
    ]));
  });

  it('传统路径中非取消故障依次回退，最终返回原文', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValueOnce(settings).mockRejectedValue(new Error('offline'));
    vi.mocked(enhancedCache.initialize).mockRejectedValue(new Error('offline'));
    const warning = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const result = await HybridTranslationService.translate(request);
    expect(result).toMatchObject({ fullText: request.text, sentences: [{ original: request.text, translation: request.text }] });
    expect(warning.mock.calls.flat().map(String).join(' ')).not.toContain('offline');
    warning.mockRestore();
  });

  it('用户禁用短语及语法时不将其加入 LLM 结果', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'llm' });
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...settings, phraseTranslationEnabled: false, grammarTranslationEnabled: false });
    const result = await HybridTranslationService.translate(request);
    expect(result.words).toEqual([expect.objectContaining({ original: 'intricate' })]);
    expect(result.grammarPoints).toEqual([]);
    expect(result.sentences).toEqual([expect.objectContaining({ translation: '完整译文' })]);
  });

  it('LLM 回应非 JSON 时拒绝写入缓存', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'llm' });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue('SYNTH-PRIVATE-RESPONSE');
    await expect(HybridTranslationService.translate(request)).rejects.toThrow('Failed to parse translation response');
    expect(enhancedCache.set).not.toHaveBeenCalled();
  });

  it('没有 LLM 密钥时不请求远程模型，本地 Ollama 则允许空密钥', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'llm' });
    vi.mocked(StorageManager.getApiKey).mockResolvedValue(null);
    await expect(HybridTranslationService.translate(request)).rejects.toThrow('API key not configured');
    expect(TranslationApiService.callWithSystem).not.toHaveBeenCalled();
    vi.mocked(StorageManager.getSettings).mockResolvedValue({ ...settings, apiProvider: 'ollama' });
    expect((await HybridTranslationService.translate(request)).fullText).toBe('完整译文');
    expect(TranslationApiService.callWithSystem).toHaveBeenCalledWith(expect.any(String), expect.any(String), '', expect.objectContaining({ apiProvider: 'ollama' }), undefined, undefined);
  });

  it('并行两端均失败时明确报错，避免无限等待', async () => {
    HybridTranslationService.updateConfig({ enableParallelTranslation: true });
    vi.mocked(StorageManager.getSettings).mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error('traditional offline'));
    vi.mocked(enhancedCache.initialize).mockRejectedValue(new Error('llm offline'));
    await expect(HybridTranslationService.translate(request)).rejects.toThrow('Both traditional and LLM translation failed');
  });

  it('复杂文本传统翻译先结束时，仍等待 LLM 结果', async () => {
    HybridTranslationService.updateConfig({ enableParallelTranslation: true });
    vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({ level: 'complex', score: 80 } as ReturnType<typeof TextComplexityAnalyzer.analyze>);
    let complete!: (value: string) => void;
    vi.mocked(TranslationApiService.callWithSystem).mockImplementation((_system, user) =>
      user.includes('Analyze these English words')
        ? Promise.resolve('{"words":[]}')
        : new Promise(resolve => { complete = resolve; })
    );
    const pending = HybridTranslationService.translate(request);
    await vi.waitFor(() => expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 0));
    complete(llmResponse);
    expect((await pending).fullText).toBe('完整译文');
  });

  it('传统词汇分析出错时仍保留已取得译文', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'traditional' });
    vi.mocked(TranslationApiService.callWithSystem).mockRejectedValue(new Error('analysis offline'));
    expect(await HybridTranslationService.translate(request)).toMatchObject({ fullText: '传统译文', words: [] });
  });

  it.each(['not-json', '{"words":null}', '{"words":[]}'])('传统译文遇到生词分析响应 %s 仍可用', async content => {
    HybridTranslationService.updateConfig({ defaultEngine: 'traditional' });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(content);
    expect((await HybridTranslationService.translate(request)).words).toEqual([]);
  });

  it('生词分析中缺失可选字段时提供默认值', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'traditional' });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(JSON.stringify({ words: [{ original: 'intricate', translation: '精巧', difficulty: null, examples: ['例句'] }, { original: 'unique', translation: '独特', isPhrase: true }] }));
    const result = await HybridTranslationService.translate(request);
    expect(result.words).toEqual([
      expect.objectContaining({ original: 'intricate', difficulty: 5, examples: ['例句'] }),
      expect.objectContaining({ original: 'unique', isPhrase: true, difficulty: 5 }),
    ]);
  });

  it('LLM 缺少可选字段时返回默认词汇位置、句子与语法位置', async () => {
    HybridTranslationService.updateConfig({ defaultEngine: 'llm' });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(JSON.stringify({ words: [{ original: 'word', translation: '词义', position: [3] }], sentences: [{}], grammarPoints: [{}] }));
    const result = await HybridTranslationService.translate(request);
    expect(result.words).toEqual([expect.objectContaining({ position: [0, 0], difficulty: 5, isPhrase: false })]);
    expect(result.sentences).toEqual([expect.objectContaining({ original: '', translation: '' })]);
    expect(result.grammarPoints).toEqual([expect.objectContaining({ type: '语法点', position: [0, 0] })]);
  });

  it('增强分析重复短语不重复添加，无语法时不捏造文化点', async () => {
    HybridTranslationService.updateConfig({ enableEnhancedAnalysis: true });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'intricate', translation: '旧义', difficulty: 8 }] }));
    vi.mocked(LlmEnhancedAnalysisService.analyze).mockResolvedValue({
      analysisTime: 1, wordDetails: [], grammarAnalysis: [],
      phrases: [{ phrase: 'intricate', translation: '短语', difficulty: 8 }, { phrase: 'new phrase', translation: '新短语', difficulty: 8 }, { phrase: 'NEW PHRASE', translation: '重复短语', difficulty: 8 }],
      culturalNotes: [{ title: '文化', text: '例子', description: '说明' }],
    } as Awaited<ReturnType<typeof LlmEnhancedAnalysisService.analyze>>);
    const result = await HybridTranslationService.translate(request);
    expect(result.words.map(word => word.original)).toEqual(['intricate', 'new phrase']);
    expect(result.grammarPoints).toBeUndefined();
  });

  it('并行复杂文本 LLM 后续故障时保留先成功的传统译文', async () => {
    HybridTranslationService.updateConfig({ enableParallelTranslation: true });
    vi.mocked(TextComplexityAnalyzer.analyze).mockReturnValue({ level: 'complex', score: 80 } as ReturnType<typeof TextComplexityAnalyzer.analyze>);
    let failLlm!: (error: Error) => void;
    vi.mocked(TranslationApiService.callWithSystem).mockImplementation((_system, user) =>
      user.includes('Analyze these English words') ? Promise.resolve('{"words":[]}') : new Promise((_resolve, reject) => { failLlm = reject; })
    );
    const pending = HybridTranslationService.translate(request);
    await vi.waitFor(() => expect(TranslationApiService.callWithSystem).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 0));
    failLlm(new Error('offline'));
    expect((await pending).fullText).toBe('传统译文');
  });

  it('增强分析更新已有词而保留缺失字段，去除重复语法点', async () => {
    HybridTranslationService.updateConfig({ enableEnhancedAnalysis: true });
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'intricate', translation: '旧义', difficulty: 8, phonetic: '/old/', examples: ['旧例'] }] }));
    vi.mocked(LlmEnhancedAnalysisService.analyze).mockResolvedValue({
      analysisTime: 1, wordDetails: [{ original: 'intricate' }], grammarAnalysis: [{ original: 'yet' }], phrases: [], culturalNotes: [],
    } as Awaited<ReturnType<typeof LlmEnhancedAnalysisService.analyze>>);
    vi.mocked(LlmEnhancedAnalysisService.convertToTranslatedWords).mockReturnValue([
      { original: 'INTRICATE', translation: '新义', position: [0, 0], difficulty: 8 },
    ]);
    vi.mocked(LlmEnhancedAnalysisService.convertToGrammarPoints).mockReturnValue([
      { original: 'yet', explanation: '一次', type: 'grammar', position: [0, 0] },
      { original: 'yet', explanation: '重复', type: 'grammar', position: [0, 0] },
    ]);
    const result = await HybridTranslationService.translate(request);
    expect(result.words).toEqual([expect.objectContaining({ original: 'intricate', phonetic: '/old/', examples: ['旧例'] })]);
    expect(result.grammarPoints).toEqual([expect.objectContaining({ original: 'yet', explanation: '一次' })]);
  });

  it('增强分析无 LLM 密钥时不调用外部模型，仍返回传统译文', async () => {
    HybridTranslationService.updateConfig({ enableEnhancedAnalysis: true });
    vi.mocked(StorageManager.getApiKey).mockResolvedValue(null);
    const result = await HybridTranslationService.translate(request);
    expect(result.fullText).toBe('传统译文');
    expect(LlmEnhancedAnalysisService.analyze).not.toHaveBeenCalled();
  });

  it('简易分析在 LLM 快译失败时保留原词义', async () => {
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValueOnce(JSON.stringify({ words: [{ original: 'intricate', translation: '旧义', difficulty: 8 }] }));
    vi.mocked(TranslationApiService.quickTranslateWithSystem).mockRejectedValueOnce(new Error('offline'));
    const result = await HybridTranslationService.translate(request);
    expect(result.words).toEqual([expect.objectContaining({ original: 'intricate', translation: '旧义' })]);
  });

  it('LLM 优先回退策略在传统请求失败后只重新尝试 LLM', async () => {
    HybridTranslationService.updateConfig({ fallbackStrategy: 'llm_first' });
    vi.mocked(StorageManager.getSettings).mockResolvedValueOnce(settings).mockRejectedValueOnce(new Error('traditional offline'));
    const result = await HybridTranslationService.translate(request);
    expect(result.fullText).toBe('完整译文');
    expect(TranslationApiService.quickTranslate).not.toHaveBeenCalled();
  });

  it('开始前取消请求不访问配置，也不进入回退策略', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(HybridTranslationService.translate(request, { signal: controller.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(StorageManager.getSettings).not.toHaveBeenCalled();
  });
});
