import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/background/storage', () => ({
  StorageManager: {
    getUserProfile: vi.fn(),
    getSettings: vi.fn(),
    getApiKey: vi.fn(),
  },
}));

vi.mock('@/background/enhancedCache', () => ({
  enhancedCache: {
    generateHash: vi.fn((text: string) => `hash:${text}`),
    getBatch: vi.fn(),
    fuzzyGet: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/background/frequencyManager', () => ({
  frequencyManager: {
    hasPotentialUnknownWords: vi.fn().mockReturnValue(true),
  },
}));

vi.mock('@/background/translationApi', () => ({
  TranslationApiService: {
    callWithSystem: vi.fn(),
    quickTranslate: vi.fn(),
  },
}));

import { BatchTranslationService } from '@/background/batchTranslation';
import { enhancedCache } from '@/background/enhancedCache';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import type { ApiProvider, UserProfile, UserSettings } from '@/shared/types';

const profile: UserProfile = {
  examType: 'cet4',
  estimatedVocabulary: 4000,
  knownWords: [],
  unknownWords: [],
  levelConfidence: 0.8,
  createdAt: 1,
  updatedAt: 1,
};

function settingsFor(provider: ApiProvider): UserSettings {
  return {
    enabled: true,
    autoHighlight: true,
    vocabHighlightEnabled: true,
    phraseTranslationEnabled: true,
    grammarTranslationEnabled: true,
    translationMode: 'bilingual',
    showDifficulty: true,
    highlightColor: '#ffff00',
    fontSize: 14,
    apiProvider: provider,
    blacklist: [],
    apiConfigs: [],
    hoverDelay: 300,
    theme: 'system',
  };
}

describe('BatchTranslationService 供应商策略', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(StorageManager.getUserProfile).mockResolvedValue(profile);
    vi.mocked(StorageManager.getApiKey).mockResolvedValue('');
    vi.mocked(enhancedCache.getBatch).mockImplementation(async (hashes) => ({
      hits: new Map(),
      misses: hashes,
    }));
    vi.mocked(enhancedCache.fuzzyGet).mockResolvedValue(null);
    vi.mocked(enhancedCache.set).mockResolvedValue(undefined);
  });

  it('免费 Google 翻译在无 API Key 时应该完成批量翻译', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsFor('free_google_translate'));
    vi.mocked(TranslationApiService.quickTranslate).mockResolvedValue('你好世界');

    const response = await BatchTranslationService.translateBatch({
      paragraphs: [{ id: 'p1', text: 'Hello world', elementPath: '#p1' }],
      mode: 'bilingual',
      pageUrl: 'https://example.com',
      userLevel: profile,
    });

    expect(TranslationApiService.quickTranslate).toHaveBeenCalledWith(
      'Hello world',
      '',
      expect.objectContaining({ apiProvider: 'free_google_translate' })
    );
    expect(response.results[0].result.fullText).toBe('你好世界');
  });

  it('Ollama 在无 API Key 时应该继续调用结构化批量接口', async () => {
    vi.mocked(StorageManager.getSettings).mockResolvedValue(settingsFor('ollama'));
    vi.mocked(TranslationApiService.callWithSystem).mockResolvedValue(JSON.stringify({
      paragraphs: [{ id: '0', words: [], sentences: [], fullText: '你好世界' }],
    }));

    const response = await BatchTranslationService.translateBatch({
      paragraphs: [{ id: 'p1', text: 'Hello world', elementPath: '#p1' }],
      mode: 'bilingual',
      pageUrl: 'https://example.com',
      userLevel: profile,
    });

    expect(TranslationApiService.callWithSystem).toHaveBeenCalled();
    expect(response.results[0].result.fullText).toBe('你好世界');
  });
});
