import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserProfile, UserSettings } from '@/shared/types';

vi.mock('@/background/translationRequest', async () => ({
  ...await vi.importActual<typeof import('@/background/translationRequest')>('@/background/translationRequest'),
  executeTransportRequest: vi.fn(async () => '{"words":[],"phrases":[],"grammarPoints":[],"culturalNotes":[]}'),
}));
vi.mock('@/shared/utils', async () => ({
  ...await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils'),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/background/textComplexityAnalyzer', () => ({
  TextComplexityAnalyzer: { analyze: vi.fn(() => ({ level: 'medium', score: 50, wordCount: 7, clauseCount: 1 })) },
}));

import { LlmEnhancedAnalysisService } from '@/background/llmEnhancedAnalysis';
import { HybridTranslationService } from '@/background/hybridTranslation';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { executeTransportRequest } from '@/background/translationRequest';

const configA: UserSettings = {
  ...DEFAULT_SETTINGS,
  apiConfigs: [{ id: 'a', name: 'A', provider: 'custom', apiUrl: 'https://a.example/v1', modelName: 'model-a', apiKey: 'KEY_A' }],
  activeApiConfigId: 'a',
};
const configB: UserSettings = {
  ...DEFAULT_SETTINGS,
  apiConfigs: [{ id: 'b', name: 'B', provider: 'custom', apiUrl: 'https://b.example/v1', modelName: 'model-b', apiKey: 'KEY_B' }],
  activeApiConfigId: 'b',
};
const profile: UserProfile = {
  examType: 'cet4', estimatedVocabulary: 3000, knownWords: [], unknownWords: [],
  levelConfidence: 0.5, createdAt: 0, updatedAt: 0,
};
const text = 'The complex algorithm deserves careful analysis.';
const branches = ['analyzeWords', 'analyzePhrases', 'analyzeGrammar', 'analyzeCultural'] as const;

type AnalysisBranch = typeof branches[number];

function onlyBranch(branch: AnalysisBranch) {
  return {
    analyzeWords: branch === 'analyzeWords',
    analyzePhrases: branch === 'analyzePhrases',
    analyzeGrammar: branch === 'analyzeGrammar',
    analyzeCultural: branch === 'analyzeCultural',
  };
}

function switchSettings(first: UserSettings, second: UserSettings) {
  let reads = 0;
  const get = vi.fn(async (key: string | string[]) => {
    if (Array.isArray(key)) {
      const settings = reads++ === 0 ? first : second;
      return { settings, apiKey: settings.apiConfigs[0]?.apiKey ?? 'LEGACY_KEY' };
    }
    if (key === 'settings') return { settings: reads++ === 0 ? first : second };
    if (key === 'apiKey') return { apiKey: 'LEGACY_KEY' };
    return {};
  });
  vi.stubGlobal('chrome', { storage: { sync: { get } } });
  return { get, reads: () => reads };
}

function expectOnlyARequests(count: number) {
  const calls = vi.mocked(executeTransportRequest).mock.calls;
  expect(calls).toHaveLength(count);
  for (const [url, init] of calls) {
    expect(url).toBe('https://a.example/v1');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer KEY_A' });
  }
}

describe('增强分析与 Hybrid 使用相同的配置及密钥快照', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('测试不允许真实网络请求'); }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(branches)('%s：A 配置读取后切到 B，仍只向 A 端点发送 A 密钥', async branch => {
    const storage = switchSettings(configA, configB);
    const snapshot = await StorageManager.getSettings();
    await LlmEnhancedAnalysisService.analyze(text, snapshot, onlyBranch(branch));
    expectOnlyARequests(1);
    expect(storage.reads()).toBe(1);
  });

  it.each(branches)('%s：A 端点没有密钥时不借用 B 或旧密钥', async branch => {
    const withoutKey = { ...configA, apiConfigs: [{ ...configA.apiConfigs[0], apiKey: '' }] };
    const storage = switchSettings(withoutKey, configB);
    await LlmEnhancedAnalysisService.analyze(text, await StorageManager.getSettings(), onlyBranch(branch));
    expect(executeTransportRequest).not.toHaveBeenCalled();
    expect(storage.reads()).toBe(1);
    expect(storage.get).not.toHaveBeenCalledWith('apiKey');
  });

  it('快速词汇分析也使用 A 密钥，不向 B 端点误发', async () => {
    const storage = switchSettings(configA, configB);
    await LlmEnhancedAnalysisService.quickAnalyzeWord('algorithm', text, await StorageManager.getSettings());
    expectOnlyARequests(1);
    expect(storage.reads()).toBe(1);
  });

  it('快速词汇分析在 A 无密钥时不借用 B 或旧密钥', async () => {
    const withoutKey = { ...configA, apiConfigs: [{ ...configA.apiConfigs[0], apiKey: '' }] };
    const storage = switchSettings(withoutKey, configB);
    expect(await LlmEnhancedAnalysisService.quickAnalyzeWord('algorithm', text, await StorageManager.getSettings())).toBeNull();
    expect(executeTransportRequest).not.toHaveBeenCalled();
    expect(storage.reads()).toBe(1);
    expect(storage.get).not.toHaveBeenCalledWith('apiKey');
  });

  it('旧版配置切换至 B 后无法确认旧密钥归属，停止外发', async () => {
    const legacy = { ...DEFAULT_SETTINGS, apiConfigs: [] };
    const storage = switchSettings(legacy, configB);
    await LlmEnhancedAnalysisService.analyze(text, await StorageManager.getSettings(), onlyBranch('analyzeWords'));
    expect(executeTransportRequest).not.toHaveBeenCalled();
    expect(storage.get).toHaveBeenNthCalledWith(2, ['settings', 'apiKey', 'legacyApiKeyInvalidated']);
    expect(storage.get).not.toHaveBeenCalledWith('apiKey');
    expect(storage.reads()).toBe(2);
  });

  it('四分支并发处理缺失可选字段的响应时仍使用同一密钥', async () => {
    const storage = switchSettings(configA, configB);
    vi.mocked(executeTransportRequest).mockResolvedValue(JSON.stringify({
      words: [{}], phrases: [{}], grammarPoints: [{}], culturalNotes: [{}],
    }));
    const result = await LlmEnhancedAnalysisService.analyze(text, await StorageManager.getSettings(), {
      analyzeWords: true, analyzePhrases: true, analyzeGrammar: true, analyzeCultural: true,
    });
    expect(result.wordDetails[0]).toMatchObject({ word: '', examples: [], difficulty: 5 });
    expect(result.phrases[0]).toMatchObject({ phrase: '', usageContext: [], examples: [], difficulty: 5 });
    expect(result.grammarAnalysis[0]).toMatchObject({ originalText: '', explanation: '' });
    expect(result.culturalNotes[0]).toMatchObject({ text: '', description: '' });
    expectOnlyARequests(4);
    expect(storage.reads()).toBe(1);
  });

  it('Hybrid 传统翻译完成后切到 B，增强分析四分支仍使用 A 密钥', async () => {
    const storage = switchSettings({
      ...configA,
      hybridTranslation: {
        ...DEFAULT_SETTINGS.hybridTranslation!, traditionalProvider: 'youdao', traditionalApiKey: 'TRAD_A',
      },
    }, configB);
    const previousConfig = HybridTranslationService.getConfig();
    HybridTranslationService.updateConfig({
      defaultEngine: 'hybrid', enableSmartRouting: false, enableParallelTranslation: false,
      traditionalApiKey: 'TRAD_A', enableEnhancedAnalysis: true,
      enhancedAnalysisOptions: { analyzeWords: true, analyzePhrases: true, analyzeGrammar: true, analyzeCultural: true },
    });
    const traditional = vi.spyOn(TranslationApiService, 'quickTranslate').mockResolvedValue('传统译文');
    try {
      await HybridTranslationService.translate({ text, userLevel: profile, mode: 'bilingual' });
      expect(traditional).toHaveBeenCalledWith(text, 'TRAD_A', expect.any(Object), undefined);
      expectOnlyARequests(5);
      expect(storage.reads()).toBe(1);
    } finally {
      HybridTranslationService.updateConfig(previousConfig);
    }
  });
});
