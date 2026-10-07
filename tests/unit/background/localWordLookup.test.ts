/**
 * LocalWordLookup 本地单词查询链测试
 *
 * 覆盖本地优先翻译的核心纯逻辑：
 * - 词形归一化与变体链（books → book）
 * - 查词链：用户生词本（语境匹配）→ 语境释义缓存 → 离线词典
 * - 语境释义缓存不得只按词跨语境混用
 * - 候选词本地筛选、位置计算与验证
 * - 已知词（knownWords）手动查词不被拒绝
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserProfile, UnknownWordEntry } from '@/shared/types';
import {
  normalizeWord,
  getWordVariants,
  setOfflineWordSource,
  resetOfflineWordSource,
  lookupWord,
  storeWordSense,
  clearWordSenseCache,
  resolveLocalCandidates,
  buildLocalTranslationResult,
  markLocalSource,
} from '@/background/localWordLookup';

// 测试用离线词典 fixture（注入，不依赖真实数据资产）
const FIXTURE_DICT: Record<string, { translation: string; phonetic?: string; forms?: string[] }> = {
  book: { translation: '书；预订', phonetic: '/bʊk/', forms: ['books', 'booking', 'booked'] },
  house: { translation: '房子', phonetic: '/haʊs/' },
  bank: { translation: '银行；岸' },
};

function makeEntry(word: string, context: string, translation: string): UnknownWordEntry {
  return { word, context, translation, markedAt: Date.now(), reviewCount: 0 };
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    examType: 'cet4',
    // 默认超大词汇量（C2）：关闭难度通道，使测试只依赖确定性的生词本/knownWords 通道
    estimatedVocabulary: 99999,
    knownWords: ['house', 'car'],
    unknownWords: [],
    levelConfidence: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  setOfflineWordSource({ lookup: (lemma) => FIXTURE_DICT[lemma] });
  clearWordSenseCache();
});

it('标记本地来源时返回新对象，不修改传入结果', () => {
  const original = Object.freeze({ words: [], sentences: [] });
  const result = markLocalSource(original);
  expect(result).toEqual({ words: [], sentences: [], _source: 'local' });
  expect(result).not.toBe(original);
  expect(original).not.toHaveProperty('_source');
});

describe('normalizeWord / getWordVariants', () => {
  it('归一化去掉标点并转小写', () => {
    expect(normalizeWord('Hello,')).toBe('hello');
    expect(normalizeWord('  World! ')).toBe('world');
    expect(normalizeWord('')).toBe('');
  });

  it('变体链包含原词与常见屈折还原', () => {
    expect(getWordVariants('books')).toContain('book');
    expect(getWordVariants('running')).toContain('run');
    expect(getWordVariants('book')).toEqual(['book']);
    // 变体链首项始终是归一化原词
    expect(getWordVariants('BOOKS')[0]).toBe('books');
  });
});

describe('lookupWord 查词链', () => {
  it('生词本命中：返回条目释义并保留原文原样', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('ubiquitous', 'the ubiquitous smartphone era', '无处不在的')],
    });

    const hit = await lookupWord('Ubiquitous,', { userProfile: profile, context: 'the ubiquitous smartphone era' });

    expect(hit).not.toBeNull();
    expect(hit!.word).toBe('ubiquitous');
    expect(hit!.original).toBe('Ubiquitous,');
    expect(hit!.translation).toBe('无处不在的');
    expect(hit!.source).toBe('user_vocab');
    expect(hit!.inUserVocab).toBe(true);
  });

  it('生词本同词多条目时按完整语境选择', async () => {
    const profile = makeProfile({
      unknownWords: [
        makeEntry('bank', 'he sat by the river bank', '河岸'),
        makeEntry('bank', 'opened a bank account', '银行'),
      ],
    });

    const riverHit = await lookupWord('bank', { userProfile: profile, context: 'he sat by the river bank' });
    expect(riverHit!.translation).toBe('河岸');

    const moneyHit = await lookupWord('bank', { userProfile: profile, context: 'opened a bank account' });
    expect(moneyHit!.translation).toBe('银行');
  });

  it('生词本仅目标词重叠时不冒充语境匹配，回退词典通用义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'sat by the river bank', '河岸')],
    });

    const hit = await lookupWord('bank', {
      userProfile: profile,
      context: 'opened a bank account',
    });

    expect(hit).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('仅共享 city 等背景词时不沿用相反的多义词释义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'She sat on the river bank in the city', '河岸')],
    });
    const context = 'She opened an account at the city bank';

    expect(await lookupWord('bank', { userProfile: profile, context }))
      .toMatchObject({ source: 'dictionary', translation: '银行；岸' });
    const candidate = resolveLocalCandidates(context, profile, { context }).candidates
      .find((item) => item.lemma === 'bank');
    expect(candidate).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('相同的邻近背景词不能证明多义词义项一致', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'She walked beside the river bank yesterday.', '河岸')],
    });
    expect(await lookupWord('bank', {
      userProfile: profile, context: 'She visited the city bank yesterday.',
    })).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('完整语境完全一致时保留用户保存的义项，即使关键词不在邻近窗口', async () => {
    const context = 'The bank of the river';
    const profile = makeProfile({ unknownWords: [makeEntry('bank', context, '河岸')] });
    expect(await lookupWord('bank', { userProfile: profile, context }))
      .toMatchObject({ source: 'user_vocab', translation: '河岸' });
  });

  it('多处目标词不同义时不把后一次的旧义赋给首次出现的词', () => {
    const profile = makeProfile({ unknownWords: [makeEntry('bank', 'sat by the river bank', '河岸')] });
    const text = 'The bank approved a loan. We later walked by the river bank.';
    expect(resolveLocalCandidates(text, profile, { context: text }).candidates.find((item) => item.lemma === 'bank'))
      .toMatchObject({ position: [4, 8], source: 'dictionary', translation: '银行；岸' });
  });

  it('重复的远处背景词不能充当两个语境证据', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'The river bank is beyond the city city', '河岸')],
    });

    expect(await lookupWord('bank', {
      userProfile: profile,
      context: 'She opened an account at the city bank',
    })).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('手动查词只提供目标词时不复用旧句子的消歧释义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'sat by the river bank', '河岸')],
    });

    const hit = await lookupWord('bank', { userProfile: profile, context: 'bank' });

    expect(hit).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('仅有冠词与目标词重叠时不复用生词本释义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'the bank of the river', '河岸')],
    });

    const hit = await lookupWord('bank', {
      userProfile: profile,
      context: 'the bank approved a loan',
    });

    expect(hit).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('共享代词也不足以复用多义词的旧释义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'His house is on the river bank', '河岸')],
    });

    const hit = await lookupWord('bank', {
      userProfile: profile,
      context: 'His bank account was closed',
    });

    expect(hit).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('目标词的复数词形重叠也不足以复用旧释义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'The banks lined the river bank', '河岸')],
    });

    const hit = await lookupWord('bank', {
      userProfile: profile,
      context: 'The banks approved a bank loan',
    });

    expect(hit).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('连字符目标词分词重叠也不足以复用旧释义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('run-down', 'The run-down old shed', '破败')],
    });

    const hit = await lookupWord('run-down', {
      userProfile: profile,
      context: 'A run-down new house',
    });

    expect(hit).toBeNull();
  });

  it('跨语境且词典未收录时返回未命中，不伪装成已有通用释义', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('quasar', 'the distant quasar', '遥远的类星体')],
    });

    const hit = await lookupWord('quasar', {
      userProfile: profile,
      context: 'quasar appeared in the document',
    });

    expect(hit).toBeNull();
  });

  it('缺少语境时仍能按词查询生词本', async () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'sat by the river bank', '河岸')],
    });

    const hit = await lookupWord('bank', { userProfile: profile });
    const blankContext = await lookupWord('bank', { userProfile: profile, context: '  ' });

    expect(hit).toMatchObject({ source: 'user_vocab', translation: '河岸' });
    expect(blankContext).toMatchObject({ source: 'user_vocab', translation: '河岸' });
  });

  it('语境释义缓存键不保存页面语境明文', () => {
    const set = vi.spyOn(Map.prototype, 'set');
    try {
      storeWordSense('bank', 'sensitive memo from the page', '银行');
      expect(JSON.stringify(set.mock.calls)).not.toContain('sensitive memo');
    } finally {
      set.mockRestore();
    }
  });

  it('语境释义缓存键不保存传入的作用域明文', () => {
    const set = vi.spyOn(Map.prototype, 'set');
    try {
      storeWordSense('bank', 'The bank approved a loan.', '银行', 'sensitive-profile-token');
      expect(JSON.stringify(set.mock.calls)).not.toContain('sensitive-profile-token');
    } finally {
      set.mockRestore();
    }
  });

  it('语境释义缓存：同语境命中、跨语境不命中（不得只按词混用）', async () => {
    storeWordSense('bank', 'sat by the river bank', '河岸');

    const sameCtx = await lookupWord('bank', { context: 'sat by the river bank' });
    expect(sameCtx).not.toBeNull();
    expect(sameCtx!.source).toBe('sense_cache');
    expect(sameCtx!.translation).toBe('河岸');

    // 换语境后不得返回上一语境的释义（应落到词典通用义项）
    const otherCtx = await lookupWord('bank', { context: 'opened a bank account' });
    expect(otherCtx).not.toBeNull();
    expect(otherCtx!.source).toBe('dictionary');
    expect(otherCtx!.translation).toBe(FIXTURE_DICT.bank.translation);
  });

  it('中文语境不同的同词不共享模型消歧释义', async () => {
    storeWordSense('bank', 'bank 河边', '河岸', 'same-user');

    expect(await lookupWord('bank', { context: 'bank 河边', cacheScope: 'same-user' }))
      .toMatchObject({ source: 'sense_cache', translation: '河岸' });
    expect(await lookupWord('bank', { context: 'bank 银行', cacheScope: 'same-user' }))
      .toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('同一语境的模型释义不跨配置或用户作用域复用', async () => {
    storeWordSense('bank', 'The bank approved a loan.', '银行', 'profile-a/provider-a');

    expect(await lookupWord('bank', {
      context: 'The bank approved a loan.', cacheScope: 'profile-a/provider-a',
    })).toMatchObject({ source: 'sense_cache', translation: '银行' });
    expect(await lookupWord('bank', {
      context: 'The bank approved a loan.', cacheScope: 'profile-b/provider-a',
    })).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
    expect(await lookupWord('bank', {
      context: 'The bank approved a loan.', cacheScope: 'profile-a/provider-b',
    })).toMatchObject({ source: 'dictionary', translation: '银行；岸' });
    expect(await lookupWord('bank', { context: 'The bank approved a loan.' }))
      .toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('已知词（knownWords）手动查词不被拒绝，落到离线词典', async () => {
    const profile = makeProfile({ knownWords: ['house', 'car'] });

    const hit = await lookupWord('house', { userProfile: profile });

    expect(hit).not.toBeNull();
    expect(hit!.translation).toBe('房子');
    expect(hit!.source).toBe('dictionary');
    expect(hit!.inUserVocab).toBe(false);
    expect(hit!.phonetic).toBe('/haʊs/');
  });

  it('词典屈折变形反查：BOOKS 命中 book 条目', async () => {
    const hit = await lookupWord('BOOKS');

    expect(hit).not.toBeNull();
    expect(hit!.word).toBe('book');
    expect(hit!.translation).toBe('书；预订');
    expect(hit!.source).toBe('dictionary');
  });

  it.each([['went', 'go'], ['ran', 'run'], ['children', 'child']])('真实离线词典将不规则词形 %s 还原为 %s', async (form, lemma) => {
    resetOfflineWordSource();
    const base = await lookupWord(lemma);
    const hit = await lookupWord(form);
    expect(base).not.toBeNull();
    expect(hit).toMatchObject({ word: lemma, translation: base!.translation, source: 'dictionary' });
  });

  it('完全未命中返回 null（保留明确 fallback，不伪装成功）', async () => {
    setOfflineWordSource(null);
    const hit = await lookupWord('zzzqqq');
    expect(hit).toBeNull();
  });
});

describe('resolveLocalCandidates 候选筛选与位置验证', () => {
  it('生词本词强制入选并带本地释义，位置计算且与原文切片一致', () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('ubiquitous', 'the ubiquitous smartphone', '无处不在的')],
    });
    const text = 'The ubiquitous smartphone changed everything.';

    const resolution = resolveLocalCandidates(text, profile);

    const ubi = resolution.candidates.find((c) => c.lemma === 'ubiquitous');
    expect(ubi).toBeDefined();
    expect(ubi!.original).toBe('ubiquitous');
    expect(ubi!.position).toEqual([4, 14]);
    expect(text.slice(4, 14)).toBe('ubiquitous');
    expect(ubi!.translation).toBe('无处不在的');
    // 全部候选位置都应通过切片验证
    for (const c of resolution.candidates) {
      expect(text.slice(c.position[0], c.position[1]).toLowerCase()).toBe(c.lemma);
    }
    expect(resolution.needsContext).toHaveLength(0);
    expect(resolution.result.words.length).toBeGreaterThanOrEqual(1);
  });

  it('跨语境时未知词仍强制入选，但不沿用旧生词本义项', () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('bank', 'sat by the river bank', '河岸')],
    });
    const text = 'The bank approved a loan.';

    const resolution = resolveLocalCandidates(text, profile, { context: text });
    const bank = resolution.candidates.find((candidate) => candidate.lemma === 'bank');

    expect(bank).toMatchObject({ translation: '银行；岸', source: 'dictionary' });
  });

  it('本地候选词只采纳相同配置及用户作用域的模型释义', () => {
    const text = 'The bank approved a loan.';
    const profile = makeProfile({ unknownWords: [makeEntry('bank', 'river bank', '河岸')] });
    storeWordSense('bank', text, '银行', 'profile-a/provider-a');

    const matching = resolveLocalCandidates(text, profile, { context: text, cacheScope: 'profile-a/provider-a' });
    expect(matching.candidates.find((candidate) => candidate.lemma === 'bank'))
      .toMatchObject({ source: 'sense_cache', translation: '银行' });

    const other = resolveLocalCandidates(text, profile, { context: text, cacheScope: 'profile-b/provider-a' });
    expect(other.candidates.find((candidate) => candidate.lemma === 'bank'))
      .toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('标记复数未知词后，单数词仍入选但不借用不匹配的旧释义', () => {
    const profile = makeProfile({ unknownWords: [makeEntry('banks', 'sat by the river banks', '河岸')] });
    const text = 'The bank approved a loan.';
    const result = resolveLocalCandidates(text, profile, { context: text });

    expect(result.candidates.find((candidate) => candidate.lemma === 'bank'))
      .toMatchObject({ source: 'dictionary', translation: '银行；岸' });
  });

  it('knownWords 优先级最高：即使难度超纲也排除', () => {
    const profile = makeProfile({
      estimatedVocabulary: 3000, // B1 用户
      knownWords: ['internationalization'],
    });
    const text = 'The internationalization of markets.';

    const resolution = resolveLocalCandidates(text, profile);

    expect(resolution.candidates.find((c) => c.lemma === 'internationalization')).toBeUndefined();
  });

  it('难度通道：B1 用户的超难词入选且无本地释义时进入 needsContext', () => {
    const profile = makeProfile({
      estimatedVocabulary: 3000, // B1 用户
      knownWords: [],
    });
    const text = 'The internationalization of markets accelerated.';

    const resolution = resolveLocalCandidates(text, profile);

    const hard = resolution.candidates.find((c) => c.lemma === 'internationalization');
    expect(hard).toBeDefined();
    expect(hard!.difficulty).toBeGreaterThanOrEqual(7);
    expect(hard!.difficulty).toBeLessThanOrEqual(10);
    expect(hard!.translation).toBeUndefined();
    expect(resolution.needsContext.map((c) => c.lemma)).toContain('internationalization');
    expect(text.slice(hard!.position[0], hard!.position[1]).toLowerCase()).toBe('internationalization');
  });

  it('超纲词在离线词典命中时获得通用义项，不进 needsContext', () => {
    const profile = makeProfile({
      estimatedVocabulary: 3000,
      knownWords: [],
      unknownWords: [makeEntry('book', 'reading a book', '书；预订')],
    });
    const text = 'He wanted to book a flight with the internationalization of travel agencies.';
    // book 既有生词本释义；internationalization 无词典条目 → needsContext
    const resolution = resolveLocalCandidates(text, profile);

    const book = resolution.candidates.find((c) => c.lemma === 'book');
    expect(book).toBeDefined();
    expect(book!.translation).toContain('书');
    expect(resolution.needsContext.map((c) => c.lemma)).not.toContain('book');

    const hard = resolution.candidates.find((c) => c.lemma === 'internationalization');
    expect(hard).toBeDefined();
    expect(resolution.needsContext.map((c) => c.lemma)).toContain('internationalization');
  });

  it('重复出现的候选词按原形去重，位置取首次出现并保留原样大小写', () => {
    const profile = makeProfile({
      estimatedVocabulary: 3000,
      knownWords: [],
    });
    const text = 'Internationalization internationalization spread.';

    const resolution = resolveLocalCandidates(text, profile);

    const hits = resolution.candidates.filter((c) => c.lemma === 'internationalization');
    expect(hits).toHaveLength(1);
    expect(hits[0].original).toBe('Internationalization');
    expect(hits[0].position).toEqual([0, 20]);
    expect(text.slice(0, 20)).toBe('Internationalization');
  });

  it('空文本与纯中文文本返回空候选，不抛错', () => {
    const profile = makeProfile();
    expect(resolveLocalCandidates('', profile).candidates).toEqual([]);
    expect(resolveLocalCandidates('这是一段中文内容。', profile).candidates).toEqual([]);
  });
});

describe('真实离线词典集成（ECDICT 常用/考试子集）', () => {
  beforeEach(() => {
    // 恢复默认真实词典源（外层 beforeEach 注入的 fixture 被覆盖）
    resetOfflineWordSource();
    clearWordSenseCache();
  });

  it('真实词条可查：apple 命中并含中文释义', async () => {
    const hit = await lookupWord('apple');

    expect(hit).not.toBeNull();
    expect(hit!.word).toBe('apple');
    expect(hit!.translation).toContain('苹果');
    expect(hit!.source).toBe('dictionary');
  });

  it('继承键不误命中：constructor/toString/valueOf 视为未命中', async () => {
    // data[lemma] 直接索引会命中 Object.prototype 继承键，导致无释义误认本地成功
    for (const word of ['constructor', 'toString', 'valueOf']) {
      const hit = await lookupWord(word);
      expect(hit).toBeNull();
    }
  });

  it('屈折变形经 forms 反查还原：apples → apple', async () => {
    const hit = await lookupWord('apples');

    expect(hit).not.toBeNull();
    expect(hit!.word).toBe('apple');
  });

  it('真实词典命中使超纲候选不进 needsContext（B1 用户 + international）', () => {
    const profile = makeProfile({ estimatedVocabulary: 3000, knownWords: [] });
    const text = 'The international cooperation survived.';

    const resolution = resolveLocalCandidates(text, profile);

    const hit = resolution.candidates.find((c) => c.lemma === 'international');
    expect(hit).toBeDefined();
    expect(hit!.translation).toBeTruthy();
    expect(resolution.needsContext).toHaveLength(0);
    // 位置切片验证对真实文本同样成立
    expect(text.slice(hit!.position[0], hit!.position[1]).toLowerCase()).toBe('international');
  });
});

describe('buildLocalTranslationResult', () => {
  it('构建仅含已释义候选的结果，来源标记为 local', () => {
    const profile = makeProfile({
      unknownWords: [makeEntry('ubiquitous', 'the ubiquitous smartphone', '无处不在的')],
    });
    const text = 'The ubiquitous smartphone changed everything.';

    const resolution = resolveLocalCandidates(text, profile);
    const result = buildLocalTranslationResult(text, resolution.candidates);

    expect(result.words).toHaveLength(1);
    expect(result.words[0]).toMatchObject({
      original: 'ubiquitous',
      translation: '无处不在的',
      position: [4, 14],
      isPhrase: false,
    });
    expect(result.sentences).toEqual([]);
    expect(result._source).toBe('local');
  });
});
