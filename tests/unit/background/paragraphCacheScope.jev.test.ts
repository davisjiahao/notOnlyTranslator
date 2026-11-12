import { describe, expect, it } from 'vitest';
import { paragraphCacheScope } from '@/background/paragraphCacheScope';
import { DEFAULT_SETTINGS } from '@/shared/constants';

describe('段落策略缓存身份', () => {
  it('旧设置与显式 legacy 保持同一身份', () => {
    const old = { ...DEFAULT_SETTINGS, vocabularyAssessmentProvider: undefined };
    const legacy = { ...DEFAULT_SETTINGS, vocabularyAssessmentProvider: 'legacy' as const };
    expect(paragraphCacheScope({ settings: old, engine: 'batch' })).toBe(paragraphCacheScope({ settings: legacy, engine: 'batch' }));
  });

  it('认识词或生词变化改变段落缓存身份', () => {
    const profile = {
      examType: 'cet4' as const, examScore: 425, estimatedVocabulary: 4500, levelConfidence: 0.5,
      knownWords: ['alpha'], unknownWords: [], createdAt: 0, updatedAt: 0,
    };
    const base = paragraphCacheScope({ settings: DEFAULT_SETTINGS, userLevel: profile, engine: 'llm' });
    expect(paragraphCacheScope({
      settings: DEFAULT_SETTINGS,
      userLevel: { ...profile, knownWords: ['beta'] },
      engine: 'llm',
    })).not.toBe(base);
    expect(paragraphCacheScope({
      settings: DEFAULT_SETTINGS,
      userLevel: { ...profile, unknownWords: [{ word: 'gamma', context: '', translation: '', markedAt: 0, reviewCount: 0 }] },
      engine: 'llm',
    })).not.toBe(base);
    expect(paragraphCacheScope({
      settings: DEFAULT_SETTINGS,
      userLevel: { ...profile, knownWords: ['alpha'] },
      engine: 'llm',
    })).toBe(base);
  });

  it('Jev 请求的旧链降级与 legacy 在途身份隔离，原因不能随 join 丢失', () => {
    const legacy = { ...DEFAULT_SETTINGS, vocabularyAssessmentProvider: 'legacy' as const };
    const jev = { ...DEFAULT_SETTINGS, vocabularyAssessmentProvider: 'jev' as const };
    expect(paragraphCacheScope({ settings: jev, engine: 'batch' })).not.toBe(paragraphCacheScope({ settings: legacy, engine: 'batch' }));
  });
});
