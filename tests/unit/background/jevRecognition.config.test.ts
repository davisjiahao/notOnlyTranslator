import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JevConfig, UserProfile } from '@/shared/types';
import { assessJevCandidates, collectJevCandidates, getJevRecognitionSignal, resetJevRecognition } from '@/background/jevRecognition';

const defaults: JevConfig = {
  provider: 'typesafe', apiUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', threshold: 0.26,
};
const custom: JevConfig = { provider: 'custom', apiUrl: 'https://custom.example/systemone', model: 'jev-custom', threshold: 0.7 };
const profile: UserProfile = {
  examType: 'custom', estimatedVocabulary: 3000, knownWords: [], unknownWords: [], levelConfidence: 0.8, createdAt: 1, updatedAt: 1,
};
const input = () => collectJevCandidates('bank bank.', profile);
const key = 'test_config_scoped_key';
const response = (init: RequestInit, scores = [0.8, 0.8]) => {
  const request = JSON.parse(init.body as string);
  return new Response(JSON.stringify({ model: request.model, answers: Object.fromEntries(Object.keys(request.questions)
    .map((id, index) => [id, { type: 'noul', noul: scores[index % scores.length] }])) }));
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetJevRecognition();
  fetchMock = vi.fn((_url: string, init: RequestInit) => Promise.resolve(response(init)));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  resetJevRecognition();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Jev 可配置识别请求', () => {
  it.each(['typesafe', 'custom'] as const)('%s 请求使用规范端点和模型，按自定义阈值含边界筛选', async provider => {
    const config = { ...custom, provider, apiUrl: ' HTTPS://CUSTOM.EXAMPLE:443/systemone ', model: ' jev-custom ' };
    fetchMock.mockImplementation((_url, init) => Promise.resolve(response(init, [0.699, 0.7])));
    const items = input();
    expect(await assessJevCandidates(items, key, { config })).toEqual([items[1]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(custom.apiUrl);
    expect(JSON.parse(init.body).model).toBe(custom.model);
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe(`Bearer ${key}`);
  });

  it.each([0, 1])('阈值 %s 包含边界，零分不会被当成缺失', async threshold => {
    fetchMock.mockImplementation((_url, init) => Promise.resolve(response(init, [0, 1])));
    const items = input();
    expect(await assessJevCandidates(items, key, { config: { ...custom, threshold } })).toEqual(threshold === 0 ? items : [items[1]]);
  });

  it.each([null, {}, { ...defaults, apiUrl: 'http://custom.example/systemone' }, { ...defaults, model: '' }, { ...defaults, threshold: NaN }, { ...defaults, apiKey: 'secret' }])('所有候选路径先拒绝非法配置 %#', async config => {
    for (const candidates of [input(), [], input().map(item => ({ ...item, forced: true }))]) {
      await expect(assessJevCandidates(candidates, key, { config: config as JevConfig })).rejects.toThrow('INVALID_JEV_CONFIG');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('非请求模型响应拒绝且不缓存', async () => {
    fetchMock.mockImplementation((_url, init) => Promise.resolve(response({
      ...init, body: JSON.stringify({ ...JSON.parse(init.body), model: defaults.model }),
    })));
    await expect(assessJevCandidates(input(), key, { config: custom })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('等价规范配置复用缓存且保持代际，旧设置与完整默认配置等价', async () => {
    await assessJevCandidates(input(), key);
    const signal = getJevRecognitionSignal();
    await assessJevCandidates(input(), key, { config: { ...defaults, apiUrl: 'HTTPS://API.TYPESAFE.AI:443/v1/systemone', model: ' jev-1.13.0 ' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(signal.aborted).toBe(false);
    expect(getJevRecognitionSignal()).toBe(signal);
  });

  it.each([
    { provider: 'custom' as const }, { apiUrl: custom.apiUrl }, { model: custom.model }, { threshold: 0.9 },
  ])('同 key 配置字段变化清空缓存并取消旧代际 %#', async changes => {
    const items = input();
    expect(await assessJevCandidates(items, key, { config: defaults })).toEqual(items);
    const signal = getJevRecognitionSignal();
    const config = { ...defaults, ...changes };
    expect(await assessJevCandidates(items, key, { config })).toEqual(config.threshold === 0.9 ? [] : items);
    expect(signal.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await assessJevCandidates(items, key, { config: defaults });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([401, 429, 500])('同 key 修改配置解除 HTTP %s 暂停或冷却', async status => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status, headers: { 'Retry-After': '30' } }));
    await expect(assessJevCandidates(input(), key, { config: defaults })).rejects.toMatchObject({ statusCode: status });
    await expect(assessJevCandidates(input(), key, { config: defaults })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await assessJevCandidates(input(), key, { config: custom })).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('配置切换取消旧在途与排队，迟到成功不得污染新缓存', async () => {
    const finishes: Array<() => void> = [];
    fetchMock.mockImplementation((_url, init) => new Promise(resolve => {
      finishes.push(() => resolve(response(init, [0.1])));
    }));
    const old = assessJevCandidates(collectJevCandidates('bank '.repeat(33), profile), key, { config: defaults });
    const rejected = expect(old).rejects.toMatchObject({ kind: 'cancelled' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fetchMock.mockImplementation((_url, init) => Promise.resolve(response(init)));
    expect(await assessJevCandidates(input(), key, { config: custom })).toHaveLength(2);
    await rejected;
    expect(fetchMock.mock.calls.slice(0, 2).every(([, init]) => init.signal.aborted)).toBe(true);
    finishes.forEach(finish => finish());
    expect(await assessJevCandidates(input(), key, { config: custom })).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('配置切换后旧失败不得暂停新配置', async () => {
    let failOld: (() => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => {
      failOld = () => resolve(new Response('{}', { status: 401 }));
    }));
    const old = assessJevCandidates(input(), key, { config: defaults });
    const rejected = expect(old).rejects.toMatchObject({ kind: 'cancelled' });
    await vi.waitFor(() => expect(failOld).toBeDefined());
    expect(await assessJevCandidates(input(), key, { config: custom })).toHaveLength(2);
    await rejected;
    failOld!();
    expect(await assessJevCandidates(collectJevCandidates('river', profile), key, { config: custom })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('旧请求超时与配置切换同轮发生时不得冷却新服务', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    const old = assessJevCandidates(input(), key, { config: defaults }).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(3000);
    const next = assessJevCandidates(input(), key, { config: custom });
    expect(await old).toMatchObject({ kind: 'timeout' });
    expect(await next).toHaveLength(2);
    expect(await assessJevCandidates(collectJevCandidates('river', profile), key, { config: custom })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('自定义端点仍限制3秒且零重试', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const pending = assessJevCandidates(input(), key, { config: custom });
    const rejected = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
