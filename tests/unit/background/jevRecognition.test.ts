import frozenCore from '../../../scripts/jev-evaluation/core.ts?raw';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserProfile } from '@/shared/types';
import { collectJevCandidates, assessJevCandidates, resetJevRecognition, getJevRecognitionSignal } from '@/background/jevRecognition';
import { JEV_MODEL, JEV_PROMPT, JEV_THRESHOLD, buildJevRequest, parseJevResponse } from '@/shared/utils/jevProtocol';

const profile = (changes: Partial<UserProfile> = {}): UserProfile => ({
  examType: 'custom', estimatedVocabulary: 3000, knownWords: [], unknownWords: [],
  levelConfidence: 0.8, createdAt: 1, updatedAt: 1, ...changes,
});
const key = 'test_jev_credential_never_log';
const candidates = (text = 'bank bank.') => collectJevCandidates(text, profile());
const answer = (body: string, score = 0.8) => ({
  model: JEV_MODEL,
  answers: Object.fromEntries(Object.keys(JSON.parse(body).questions).map(id => [id, { type: 'noul', noul: score }])),
  usage: { input_tokens: 10, output_tokens: 2 },
});
const ok = (data: unknown) => new Response(JSON.stringify(data));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetJevRecognition();
  fetchMock = vi.fn((_url: string, init: RequestInit) => Promise.resolve(ok(answer(init.body as string))));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  resetJevRecognition();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('collectJevCandidates', () => {
  it('按原文分句保留全部词位、常见词和重复词，位置使用UTF16', () => {
    const text = '😀 bank bank. It matters!';
    const result = candidates(text);
    expect(result.map(item => item.target)).toEqual(['bank', 'bank', 'It', 'matters']);
    expect(result.map(item => item.occurrence)).toEqual([0, 1, 0, 0]);
    expect(result[1].position).toEqual([8, 12]);
    expect(result[1].sentence).toBe('😀 bank bank. ');
    for (const item of result) {
      expect(item.sentence.slice(item.start, item.end)).toBe(item.target);
      expect(text.slice(...item.position)).toBe(item.target);
      expect(item.profileFingerprint).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it('known优先排除、unknown强制入选，大小写不影响本地覆盖', async () => {
    const data = profile({ knownWords: ['BANK'], unknownWords: [
      { word: 'bank', context: '', translation: '', markedAt: 1, reviewCount: 0 },
      { word: 'Easy', context: '', translation: '', markedAt: 1, reviewCount: 0 },
    ] });
    const result = collectJevCandidates('bank Easy easy.', data);
    expect(result.map(item => [item.target, item.forced])).toEqual([['Easy', true], ['easy', true]]);
    expect(await assessJevCandidates(result, key)).toEqual(result);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('复用既有未知词词形规则且不去重词位，已知精确词形优先', () => {
    const data = profile({ knownWords: ['BOOKS'], unknownWords: [{ word: 'book', context: '', translation: '', markedAt: 1, reviewCount: 0 }] });
    expect(collectJevCandidates('books booking booked book book.', data).map(item => [item.target, item.forced]))
      .toEqual([['booking', true], ['booked', true], ['book', true], ['book', true]]);
  });

  it('支持词内撇号、连字符和Unicode拉丁词，不从其他文字中截取词', () => {
    expect(candidates("Don't re-enter café 你好 bank2.").map(item => item.target)).toEqual(["Don't", 're-enter', 'café']);
    expect(candidates('')).toEqual([]);
    expect(candidates('123 中文')).toEqual([]);
    expect(() => collectJevCandidates(null as unknown as string, profile())).toThrow();
    expect(() => collectJevCandidates('bank', null as unknown as UserProfile)).toThrow();
  });
});

describe('Jev生产协议', () => {
  it('固定模型与阈值，PROMPT和已冻结评估核心逐字相同', () => {
    expect(frozenCore).toContain(`const PROMPT = '${JEV_PROMPT.replaceAll("'", "\\'")}';`);
    expect(JEV_MODEL).toBe('jev-1.13.0');
    expect(JEV_THRESHOLD).toBe(0.26);
    const request = buildJevRequest(candidates());
    const items = JSON.parse(request.state).items;
    expect(Object.keys(items[0]).sort()).toEqual(['id', 'sentence', 'target', 'start', 'end', 'learnerLevel'].sort());
    expect(items[0].learnerLevel).toBe('B1');
    expect(JSON.stringify(request)).not.toContain('profileFingerprint');
    expect(JSON.stringify(request)).not.toContain('forced');
    expect(request.questions[items[1].id].instructions).toBe(`${JEV_PROMPT} Evaluate the item whose id is ${JSON.stringify(items[1].id)}.`);
  });

  it('严格限制请求16项及32KiB字节并核验位置', () => {
    expect(() => buildJevRequest(candidates('bank '.repeat(17)))).toThrow();
    expect(() => buildJevRequest([])).toThrow();
    const [item] = candidates('bank');
    expect(() => buildJevRequest([{ ...item, start: 1 }])).toThrow();
    expect(() => buildJevRequest([{ ...item, sentence: `bank ${'中'.repeat(12000)}` }])).toThrow();
  });

  it('严格校验模型、ID、概率和用量，忽略任意响应额外字段', () => {
    const request = buildJevRequest(candidates('bank'));
    const raw = answer(JSON.stringify(request));
    const ids = Object.keys(request.questions);
    expect(parseJevResponse(raw, ids)).toEqual({ [ids[0]]: 0.8 });
    for (const invalid of [null, {}, { ...raw, model: 'jev-latest' }, { ...raw, answers: {} },
      { ...raw, answers: { ...raw.answers, extra: { type: 'noul', noul: 0.4 } } },
      { ...raw, answers: { [ids[0]]: { type: 'text', noul: 0.8 } } },
      { ...raw, answers: { [ids[0]]: { type: 'noul', noul: NaN } } },
      { ...raw, answers: { [ids[0]]: { type: 'noul', noul: 1.1 } } },
      { ...raw, usage: {} }, { ...raw, usage: { input_tokens: 1.5, output_tokens: 2 } }]) {
      expect(() => parseJevResponse(invalid, ids)).toThrow();
    }
    expect(parseJevResponse({ ...raw, usage: { ...raw.usage, [key]: 1 }, [key]: key }, ids)).toEqual({ [ids[0]]: 0.8 });
  });
});

describe('assessJevCandidates', () => {
  it('只读代际信号初次绑定保持有效，重置及同key重新使用可检测旧快照失效', async () => {
    const original = getJevRecognitionSignal();
    expect(getJevRecognitionSignal()).toBe(original);
    expect(original.aborted).toBe(false);
    await assessJevCandidates(candidates(), key);
    expect(original.aborted).toBe(false);
    resetJevRecognition();
    const current = getJevRecognitionSignal();
    expect(original.aborted).toBe(true);
    expect(current).not.toBe(original);
    expect(current.aborted).toBe(false);
    await assessJevCandidates(candidates(), key);
    expect(current.aborted).toBe(false);
    await assessJevCandidates(candidates(), `${key}_changed`);
    expect(current.aborted).toBe(true);
  });
  it('复用固定端点传输、按.26包含边界并保持原词位顺序', async () => {
    fetchMock.mockImplementation((_url, init) => {
      const raw = answer(init.body);
      const ids = Object.keys(raw.answers);
      return Promise.resolve(ok({ ...raw, answers: { [ids[0]]: { type: 'noul', noul: 0.259 }, [ids[1]]: { type: 'noul', noul: 0.26 } } }));
    });
    const input = candidates();
    expect(await assessJevCandidates(input, key)).toEqual([input[1]]);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${key}`);
  });

  it('Jev禁止HTTP重定向，实际请求回调只在传输开始时触发', async () => {
    const onRequest = vi.fn();
    await assessJevCandidates(candidates(), key, { onRequest });
    expect(fetchMock.mock.calls[0][1].redirect).toBe('error');
    expect(onRequest).toHaveBeenCalledTimes(1);
    await assessJevCandidates(candidates(), key, { onRequest });
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it('Jev成功响应限制64KiB，超限不解析不缓存', async () => {
    fetchMock.mockImplementation((_url, init) => Promise.resolve(new Response(JSON.stringify({ ...answer(init.body), padding: 'x'.repeat(65_537) }))));
    await expect(assessJevCandidates(candidates(), key)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('绝对截止时间优先于相对超时，截止已过不得发送请求', async () => {
    vi.useFakeTimers();
    await expect(assessJevCandidates(candidates(), key, { deadlineAt: Date.now() - 1 })).rejects.toMatchObject({ kind: 'timeout' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const result = assessJevCandidates(candidates(), key, { timeoutMs: 2000, deadlineAt: Date.now() + 20 });
    const rejected = expect(result).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('成功缓存10分钟到期后重新评估，不缓存过期分数', async () => {
    vi.useFakeTimers();
    await assessJevCandidates(candidates(), key);
    await vi.advanceTimersByTimeAsync(600_000 - 1);
    await assessJevCandidates(candidates(), key);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await assessJevCandidates(candidates(), key);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('按16项拆批，共享并发上限为2', async () => {
    const pending: Array<() => void> = [];
    let active = 0;
    let maximum = 0;
    fetchMock.mockImplementation((_url, init) => new Promise(resolve => {
      active += 1;
      maximum = Math.max(maximum, active);
      pending.push(() => { active -= 1; resolve(ok(answer(init.body))); });
    }));
    const first = assessJevCandidates(candidates('bank '.repeat(33)), key);
    const second = assessJevCandidates(candidates('river '.repeat(3)), key);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).state).map(state => JSON.parse(state).items.length)).toEqual([16, 16]);
    pending.splice(0).forEach(finish => finish());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    pending.splice(0).forEach(finish => finish());
    expect((await first).length).toBe(33);
    expect((await second).length).toBe(3);
    expect(maximum).toBe(2);
  });

  it('调用方取消同时停止排队与在途，之后其他调用能继续', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const result = assessJevCandidates(candidates('bank '.repeat(40)), key, { signal: controller.signal });
    const rejection = expect(result).rejects.toMatchObject({ kind: 'cancelled' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    controller.abort();
    await rejection;
    expect(fetchMock.mock.calls.every(([, init]) => init.signal.aborted)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation((_url, init) => Promise.resolve(ok(answer(init.body))));
    await expect(assessJevCandidates(candidates('word'), key)).resolves.toHaveLength(1);
  });

  it('预先取消不发网络，等待时间计入外层更短截止时间', async () => {
    vi.useFakeTimers();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(assessJevCandidates(candidates(), key, { signal: cancelled.signal })).rejects.toMatchObject({ kind: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const blocker = new AbortController();
    const first = assessJevCandidates(candidates('bank '.repeat(32)), key, { signal: blocker.signal }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    const waiting = assessJevCandidates(candidates('river'), key, { timeoutMs: 25 });
    const rejected = expect(waiting).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(25);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    blocker.abort();
    await first;
  });

  it('默认总截止为3秒、零重试、超时后短冷却', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const result = assessJevCandidates(candidates(), key);
    const rejected = expect(result).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(assessJevCandidates(candidates(), key)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    fetchMock.mockImplementation((_url, init) => Promise.resolve(ok(answer(init.body))));
    await expect(assessJevCandidates(candidates(), key)).resolves.toHaveLength(2);
  });

  it.each([401, 403, 451])('HTTP %s 暂停到密钥更换或显式重置', async status => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error: key }) });
    await expect(assessJevCandidates(candidates(), key)).rejects.toMatchObject({ statusCode: status });
    await expect(assessJevCandidates(candidates('river'), key)).rejects.toMatchObject({ statusCode: status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation((_url, init) => Promise.resolve(ok(answer(init.body))));
    await expect(assessJevCandidates(candidates(), `${key}_changed`)).resolves.toHaveLength(2);
    resetJevRecognition();
    await expect(assessJevCandidates(candidates(), key)).resolves.toHaveLength(2);
  });

  it('429遵守Retry-After冷却，冷却内不发请求且不重试', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '2' }), json: async () => ({}) });
    await expect(assessJevCandidates(candidates(), key)).rejects.toMatchObject({ statusCode: 429, retryAfterMs: 2000 });
    await vi.advanceTimersByTimeAsync(1999);
    await expect(assessJevCandidates(candidates(), key)).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    fetchMock.mockImplementation((_url, init) => Promise.resolve(ok(answer(init.body))));
    await expect(assessJevCandidates(candidates(), key)).resolves.toHaveLength(2);
  });

  it('成功正负判断按语境、词位、profile及key缓存，更新不复用旧结果', async () => {
    fetchMock.mockImplementation((_url, init) => Promise.resolve(ok(answer(init.body, 0.1))));
    await expect(assessJevCandidates(candidates(), key)).resolves.toEqual([]);
    await expect(assessJevCandidates(candidates(), key)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await assessJevCandidates(candidates('bank river.'), key);
    await assessJevCandidates(collectJevCandidates('bank bank.', profile({ updatedAt: 2 })), key);
    await assessJevCandidates(candidates(), `${key}_new`);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('单次超过缓存容量仍返回完整入选结果，不被淘汰影响', async () => {
    const input = candidates('bank. '.repeat(520));
    expect(await assessJevCandidates(input, key)).toEqual(input);
  });

  it('并发暂错不得覆盖已经生效的鉴权暂停', async () => {
    let failSecond: (() => void) | undefined;
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 401, json: async () => ({}) }));
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { failSecond = () => resolve({ ok: false, status: 500, json: async () => ({}) }); }));
    const first = assessJevCandidates(candidates('bank'), key).catch(error => error);
    const second = assessJevCandidates(candidates('river'), key).catch(error => error);
    expect(await first).toMatchObject({ statusCode: 401 });
    failSecond!();
    await second;
    await expect(assessJevCandidates(candidates('word'), key)).rejects.toMatchObject({ statusCode: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('并发暂错不得缩短429指定的冷却时间', async () => {
    vi.useFakeTimers();
    let failSecond: (() => void) | undefined;
    fetchMock.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 429, headers: new Headers({ 'Retry-After': '10' }), json: async () => ({}) }));
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { failSecond = () => resolve({ ok: false, status: 500, json: async () => ({}) }); }));
    const first = assessJevCandidates(candidates('bank'), key).catch(error => error);
    const second = assessJevCandidates(candidates('river'), key).catch(error => error);
    expect(await first).toMatchObject({ statusCode: 429 });
    failSecond!();
    await second;
    await vi.advanceTimersByTimeAsync(1001);
    await expect(assessJevCandidates(candidates('word'), key)).rejects.toMatchObject({ statusCode: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('显式unknown也校验词位，重复ID在发送前拒绝', async () => {
    const [item] = candidates('bank');
    await expect(assessJevCandidates([{ ...item, forced: true, start: 1 }], key)).rejects.toThrow();
    await expect(assessJevCandidates([item, item], key)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('缓存有界，超过512词位时淘汰最早成功记录', async () => {
    await assessJevCandidates(candidates('first'), key);
    for (let index = 0; index < 33; index += 1) {
      await assessJevCandidates(collectJevCandidates('bank '.repeat(16), profile({ updatedAt: index + 2 })), key);
    }
    const calls = fetchMock.mock.calls.length;
    await assessJevCandidates(candidates('first'), key);
    expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
  });

  it('key更新取消旧在途且迟到结果不得填充新缓存', async () => {
    let finish: (() => void) | undefined;
    fetchMock.mockImplementationOnce((_url, init) => new Promise(resolve => { finish = () => resolve(ok(answer(init.body, 0.1))); }));
    const old = assessJevCandidates(candidates(), key);
    const rejected = expect(old).rejects.toMatchObject({ kind: 'cancelled' });
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(await assessJevCandidates(candidates(), `${key}_new`)).toHaveLength(2);
    await rejected;
    finish!();
    expect(await assessJevCandidates(candidates(), `${key}_new`)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('无效响应和网络错误短冷却，密钥正文及响应额外字段不被回显', async () => {
    const text = 'private sentinel bank';
    fetchMock.mockRejectedValue(new Error(`${key} ${text}`));
    const error = await assessJevCandidates(candidates(text), key).catch(value => value);
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(key);
    expect(`${error.message}${JSON.stringify(error)}`).not.toContain(text);
    await expect(assessJevCandidates(candidates(), key)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resetJevRecognition();
    fetchMock.mockResolvedValue(ok({ model: JEV_MODEL, answers: { [key]: text } }));
    await expect(assessJevCandidates(candidates(), key)).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('空候选不调用API，非法key及位置在发送前拒绝', async () => {
    expect(await assessJevCandidates([], key)).toEqual([]);
    await expect(assessJevCandidates(candidates(), '')).rejects.toThrow();
    await expect(assessJevCandidates(candidates(), 'bad\nkey')).rejects.toThrow();
    await expect(assessJevCandidates([{ ...candidates()[0], end: -1 }], key)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
