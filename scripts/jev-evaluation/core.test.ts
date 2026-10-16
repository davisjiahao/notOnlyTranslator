import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildRequest, evaluate, getThreshold, parseResponse, validateSamples,
} from './core.ts';
import type { Sample } from './core.ts';

const MODEL = 'jev-1.13.0';
const sample = (overrides: Partial<Sample> = {}): Sample => ({
  id: 's1', groupId: 'g1', split: 'calibration', sentence: 'They opened the bank.',
  target: 'bank', occurrence: 0, expected: false, category: 'common',
  rationale: '此处为常见的银行义。', ...overrides,
});
const many = (count: number, overrides: Partial<Sample> = {}): Sample[] =>
  Array.from({ length: count }, (_, index) => sample({ id: `s${index}`, groupId: `g${index}`, ...overrides }));
const response = (entries: readonly [string, number][] = [['s1', 0.7]]) => ({
  model: MODEL,
  answers: Object.fromEntries(entries.map(([id, noul]) => [id, { type: 'noul', noul }])),
  usage: { input_tokens: 100, output_tokens: 2 },
});
const scoresFor = (samples: readonly Sample[], score: number) =>
  Object.fromEntries(samples.map(({ id }) => [id, score]));

describe('validateSamples', () => {
  it('接受单样本和200项数据并返回独立对象', () => {
    const original = Object.freeze(sample());
    const validated = validateSamples(Object.freeze([original]));
    assert.deepEqual(validated, [original]);
    assert.notEqual(validated[0], original);
    assert.equal(validateSamples(many(200)).length, 200);
  });

  it('严格拒绝空值、数组边界、缺失字段、额外字段及错误类型', () => {
    for (const invalid of [null, undefined, {}, [], many(201), [null], new Array(1)]) {
      assert.throws(() => validateSamples(invalid));
    }
    const valid = sample();
    for (const key of Object.keys(valid)) {
      const missing = Object.fromEntries(Object.entries(valid).filter(([name]) => name !== key));
      assert.throws(() => validateSamples([missing]));
    }
    for (const override of [
      { id: '' }, { id: '__proto__' }, { id: 'a\nb' }, { id: 'x'.repeat(129) },
      { groupId: '' }, { split: 'test' }, { sentence: '' }, { sentence: 42 },
      { target: '' }, { target: ' bank' }, { target: ' ' }, { rationale: ' ' },
      { expected: 1 }, { category: 'unknown' }, { occurrence: Number.MAX_SAFE_INTEGER + 1 }, { occurrence: -1 },
      { occurrence: 1.5 }, { occurrence: NaN }, { occurrence: Infinity }, { occurrence: '1' },
      { extra: true },
    ]) {
      assert.throws(() => validateSamples([{ ...valid, ...override }]));
    }
  });

  it('拒绝与rubric冲突的类别标签，避免常见义阴性漏入common FPR', () => {
    for (const invalid of [
      sample({ category: 'sense', expected: false }),
      sample({ category: 'advanced', expected: false }),
      sample({ category: 'common', expected: true }),
    ]) {
      assert.throws(() => validateSamples([invalid]), { message: 'INVALID_SAMPLE' });
      assert.throws(() => getThreshold([invalid], { s1: 0.9 }), { message: 'INVALID_SAMPLE' });
      assert.throws(() => evaluate([invalid], { s1: 0.9 }, 0.5), { message: 'INVALID_SAMPLE' });
    }
  });

  it('拒绝重复ID和跨split的同组，允许同组两个语境', () => {
    assert.throws(() => validateSamples([sample(), sample()]));
    assert.throws(() => validateSamples([sample(), sample({ id: 's2', split: 'holdout' })]));
    assert.equal(validateSamples([sample(), sample({ id: 's2' })]).length, 2);
  });

  it('拒绝不存在、大小写不符及词内子串目标', () => {
    for (const sentence of ['They went home.', 'They opened the Bank.', 'The banker left.', 'The bank2 left.', 'The _bank left.', 'The ébank left.', 'The banḱ left.']) {
      assert.throws(() => validateSamples([sample({ sentence })]));
    }
    assert.throws(() => validateSamples([sample({ occurrence: 1 })]));
  });
});

describe('buildRequest', () => {
  it('构建同一state的独立问题，隔离标签、理由和划分信息', () => {
    const samples = [sample(), sample({ id: 's2', expected: true, category: 'sense', rationale: '未公开标签理由' })];
    const request = buildRequest(samples);
    assert.equal(request.model, MODEL);
    assert.deepEqual(JSON.parse(request.state), {
      items: samples.map(({ id, sentence, target }) => ({ id, sentence, target, start: 16, end: 20, learnerLevel: 'B1' })),
    });
    assert.deepEqual(Object.keys(request.questions), ['s1', 's2']);
    for (const id of ['s1', 's2']) {
      assert.equal(request.questions[id].type, 'noul');
      assert.match(request.questions[id].instructions, /B1/);
      assert.ok(request.questions[id].instructions.includes(JSON.stringify(id)));
    }
    const serialized = JSON.stringify(request);
    for (const secret of ['expected', 'rationale', 'split', 'category', 'groupId', '未公开标签理由']) {
      assert.ok(!serialized.includes(secret));
    }
    assert.deepEqual(buildRequest([sample({ expected: true, category: 'advanced', rationale: '更改标签' })]), buildRequest([sample()]));
  });

  it('通过UTF16定位重复词的第二次完整出现并跳过词内子串', () => {
    const sentence = '😀 bank banker bank.';
    const request = buildRequest([sample({ sentence, occurrence: 1 })]);
    const item = JSON.parse(request.state).items[0];
    assert.equal(item.start, 15);
    assert.equal(item.end, 19);
    assert.equal(sentence.slice(item.start, item.end), 'bank');
  });

  it('精确处理多词短语、正则特殊字符和句子边界', () => {
    for (const [sentence, target, start] of [
      ['take off now', 'take off', 0], ['Use C++ today.', 'C++', 4], ['(bank)', 'bank', 1],
      ['bank', 'bank', 0], ['café is open', 'café', 0],
    ] as const) {
      const item = JSON.parse(buildRequest([sample({ sentence, target })]).state).items[0];
      assert.deepEqual([item.start, item.end], [start, start + target.length]);
    }
  });

  it('接受1至16项并拒绝超量、空请求和非固定模型', () => {
    assert.equal(Object.keys(buildRequest(many(16)).questions).length, 16);
    assert.equal(Object.keys(buildRequest([sample()]).questions).length, 1);
    assert.throws(() => buildRequest([]));
    assert.throws(() => buildRequest(many(17)));
    assert.throws(() => buildRequest([sample()], 'jev-latest'));
    assert.throws(() => buildRequest([sample()], ''));
  });

  it('按完整序列化UTF8字节执行32KiB上限，包含多字节及转义字符', () => {
    const base = sample({ sentence: 'bank ' });
    const overhead = new TextEncoder().encode(JSON.stringify(buildRequest([base]))).byteLength;
    const fill = 32 * 1024 - overhead;
    const boundary = sample({ sentence: `${base.sentence}${'a'.repeat(fill)}` });
    assert.equal(new TextEncoder().encode(JSON.stringify(buildRequest([boundary]))).byteLength, 32 * 1024);
    assert.throws(() => buildRequest([sample({ sentence: `${boundary.sentence}a` })]));
    assert.throws(() => buildRequest([sample({ sentence: `bank ${'中'.repeat(Math.ceil(fill / 3))}` })]));
    assert.throws(() => buildRequest([sample({ sentence: `bank ${'"'.repeat(fill)}` })]));
  });
});

describe('parseResponse', () => {
  it('按请求ID而非响应顺序返回概率并保留有限的用量', () => {
    assert.deepEqual(parseResponse(response([['s2', 1], ['s1', 0]]), ['s1', 's2']), {
      model: MODEL, scores: { s1: 0, s2: 1 }, usage: { input_tokens: 100, output_tokens: 2 },
    });
    assert.equal(parseResponse({ model: MODEL, answers: response().answers }, ['s1']).usage, null);
    assert.equal(parseResponse({ ...response(), usage: null }, ['s1']).usage, null);
    assert.deepEqual(parseResponse({ ...response(), usage: { input_tokens: 0, output_tokens: 0 } }, ['s1']).usage, { input_tokens: 0, output_tokens: 0 });
  });

  it('拒绝缺失输入输出计数、小数和超出安全整数的用量', () => {
    const complete = { input_tokens: 100, output_tokens: 2 };
    for (const usage of [{}, { input_tokens: 100 }, { output_tokens: 2 },
      { ...complete, input_tokens: 0.5 }, { ...complete, output_tokens: 1.2 },
      { ...complete, input_tokens: Number.MAX_SAFE_INTEGER + 1 },
      { ...complete, output_tokens: Number.MAX_SAFE_INTEGER + 1 },
      { ...complete, input_tokens: -1 }, { ...complete, output_tokens: NaN },
      { ...complete, output_tokens: '2' },
      Object.create(complete)]) {
      assert.throws(() => parseResponse({ ...response(), usage }, ['s1']));
    }
  });

  it('仅投影输入输出计数，丢弃可能反射敏感信息的任意用量字段', () => {
    const sentinel = 'jev_secret_sentinel_never_echo_20261013';
    for (const extra of [{ [sentinel]: 1 }, { 'untrusted-key': sentinel }]) {
      const usage = { input_tokens: 100, output_tokens: 2, ...extra };
      const parsed = parseResponse({ ...response(), usage }, ['s1']);
      assert.deepEqual(parsed.usage, { input_tokens: 100, output_tokens: 2 });
      assert.equal(JSON.stringify(parsed).includes(sentinel), false);
    }
  });

  it('拒绝缺失、多余、重复及非法请求ID和错误模型', () => {
    for (const ids of [[], ['s1', 's1'], [''], ['__proto__'], many(17).map(({ id }) => id)]) {
      assert.throws(() => parseResponse(response(), ids));
    }
    for (const raw of [null, [], {}, { ...response(), model: 'jev-latest' }, { ...response(), answers: [] },
      response([]), response([['s2', 0.7]]), response([['s1', 0.7], ['s2', 0.4]])]) {
      assert.throws(() => parseResponse(raw, ['s1']));
    }
    const inherited = Object.create({ s1: { type: 'noul', noul: 0.7 } });
    assert.throws(() => parseResponse({ ...response(), answers: inherited }, ['s1']));
  });

  it('拒绝错误答案结构、概率越界、字符串、非有限值和非法用量', () => {
    for (const value of [-0.1, 1.01, NaN, Infinity, -Infinity, '0.7', null, undefined]) {
      assert.throws(() => parseResponse({ ...response(), answers: { s1: { type: 'noul', noul: value } } }, ['s1']));
    }
    for (const answer of [null, [], {}, { type: 'text', noul: 0.7 }, { type: 'noul', probability: 0.7 }]) {
      assert.throws(() => parseResponse({ ...response(), answers: { s1: answer } }, ['s1']));
    }
    for (const usage of [[], '100', { input_tokens: -1 }, { input_tokens: NaN }, { input_tokens: '100' }, { 'bad-key': 1 }]) {
      assert.throws(() => parseResponse({ ...response(), usage }, ['s1']));
    }
  });
});

describe('getThreshold', () => {
  it('在common FPR约束内最大化召回，并允许5%的准确边界', () => {
    const negatives = many(20);
    const positives = [0.4, 0.6, 0.8, 0.9].map((_, index) => sample({ id: `p${index}`, groupId: `pg${index}`, expected: true, category: 'advanced' }));
    const samples = [...negatives, ...positives];
    const scores = { ...scoresFor(negatives, 0.1), s0: 0.7, p0: 0.4, p1: 0.6, p2: 0.8, p3: 0.9 };
    assert.equal(getThreshold(samples, scores), 0.4);
  });

  it('同召回率选择较高的观测阈值，阈值相等仍判正', () => {
    const negatives = many(20);
    const samples = [...negatives, sample({ id: 'p', groupId: 'pg', expected: true, category: 'sense' })];
    const scores = { ...scoresFor(negatives, 0.1), s0: 0.6, p: 0.8 };
    assert.equal(getThreshold(samples, scores), 0.8);
    assert.equal(evaluate(samples, scores, 0.8).overall.TP, 1);
  });

  it('拒绝holdout样本，且不读取额外的holdout分数', () => {
    const calibration = [sample(), sample({ id: 'p', expected: true, category: 'advanced' })];
    assert.equal(getThreshold(calibration, { s1: 0.1, p: 0.8, holdout: 0 }), 0.8);
    assert.equal(getThreshold(calibration, { s1: 0.1, p: 0.8, holdout: 1 }), 0.8);
    assert.throws(() => getThreshold([...calibration, sample({ id: 'h', groupId: 'h', split: 'holdout' })], { s1: 0.1, p: 0.8, h: 0.9 }));
  });

  it('无非退化可行阈值、无正样本或无common负样本时返回null', () => {
    const positive = sample({ id: 'p', expected: true, category: 'advanced' });
    assert.equal(getThreshold([sample(), positive], { s1: 0.9, p: 0.5 }), null);
    assert.equal(getThreshold([sample(), positive], { s1: 1, p: 1 }), null);
    assert.equal(getThreshold([sample()], { s1: 0.1 }), null);
    assert.equal(getThreshold([positive], { p: 0.9 }), null);
    assert.equal(getThreshold([sample({ category: 'sense', expected: true }), positive], { s1: 0.1, p: 0.9 }), null);
  });

  it('拒绝缺失、继承及非法样本分数', () => {
    for (const scores of [{}, { s1: '0.7' }, { s1: NaN }, { s1: 1.01 }, Object.create({ s1: 0.7 }), null]) {
      assert.throws(() => getThreshold([sample()], scores as Record<string, number>));
    }
  });
});

describe('evaluate', () => {
  it('保留所有混淆项和分母，空类别指标为null', () => {
    const samples = [sample(), sample({ id: 'fp' }), sample({ id: 'tp', expected: true, category: 'advanced' }), sample({ id: 'fn', expected: true, category: 'advanced' })];
    const result = evaluate(samples, { s1: 0.1, fp: 0.8, tp: 0.8, fn: 0.1 }, 0.5);
    assert.deepEqual(result.overall, {
      count: 4, TP: 1, TN: 1, FP: 1, FN: 1,
      positiveCount: 2, negativeCount: 2, predictedPositiveCount: 2,
      recall: 0.5, precision: 0.5, fpr: 0.5, errorIds: ['fp', 'fn'],
    });
    assert.equal(result.threshold, 0.5);
    assert.equal(result.categories.common.negativeCount, 2);
    assert.equal(result.categories.sense.count, 0);
    assert.equal(result.categories.sense.recall, null);
    assert.equal(result.categories.sense.precision, null);
    assert.equal(result.categories.sense.fpr, null);
    assert.equal(result.holdout.overall.count, 0);
    assert.equal(result.holdout.gates.passed, false);
  });

  it('在留出集准确判定总体召回85%、义项召回80%、常见词FPR5%的门槛', () => {
    const common = many(20, { split: 'holdout' });
    const advanced = many(10).map((row, index) => ({ ...row, id: `a${index}`, groupId: `ag${index}`, split: 'holdout' as const, expected: true, category: 'advanced' as const }));
    const sense = many(10).map((row, index) => ({ ...row, id: `m${index}`, groupId: `mg${index}`, split: 'holdout' as const, expected: true, category: 'sense' as const }));
    const samples = [...common, ...advanced, ...sense];
    const scores = { ...scoresFor(common, 0.1), ...scoresFor(advanced, 0.8), ...scoresFor(sense, 0.8), s0: 0.8, a0: 0.1, m0: 0.1, m1: 0.1 };
    const result = evaluate(samples, scores, 0.5);
    assert.deepEqual(result.holdout.gates, { recall: true, senseRecall: true, commonFpr: true, passed: true });
    assert.equal(result.holdout.overall.recall, 0.85);
    assert.equal(result.holdout.categories.sense.recall, 0.8);
    assert.equal(result.holdout.categories.common.fpr, 0.05);
    assert.equal(evaluate(samples, { ...scores, a1: 0.1 }, 0.5).holdout.gates.recall, false);
    assert.equal(evaluate(samples, { ...scores, m2: 0.1 }, 0.5).holdout.gates.senseRecall, false);
    assert.equal(evaluate(samples, { ...scores, s1: 0.8 }, 0.5).holdout.gates.commonFpr, false);
  });

  it('校准样本不会改善holdout门槛，零分母不会误判通过', () => {
    const samples = [sample({ id: 'h', groupId: 'h', split: 'holdout', expected: true, category: 'sense' }), sample({ id: 'p', expected: true, category: 'sense' }), sample()];
    const report = evaluate(samples, { h: 0.1, p: 0.9, s1: 0.1 }, 0.5);
    assert.equal(report.overall.recall, 0.5);
    assert.equal(report.holdout.overall.recall, 0);
    assert.equal(report.holdout.categories.common.fpr, null);
    assert.equal(report.holdout.gates.passed, false);
    assert.equal(evaluate([sample()], { s1: 0.1 }, 0.5).overall.precision, null);
  });

  it('拒绝缺失分数和非概率阈值', () => {
    assert.throws(() => evaluate([sample()], {}, 0.5));
    for (const threshold of [-0.1, 1.1, NaN, Infinity, null, '0.5']) {
      assert.throws(() => evaluate([sample()], { s1: 0.1 }, threshold as number));
    }
  });
});

it('通过真实构造、解析、仅校准定阈值、留出统计完成离线链路', () => {
  const calibration = [sample(), sample({ id: 'p', expected: true, category: 'sense' })];
  const holdout = [sample({ id: 'hn', groupId: 'hg', split: 'holdout' }), sample({ id: 'hp', groupId: 'hg', split: 'holdout', expected: true, category: 'sense' })];
  const samples = validateSamples([...calibration, ...holdout]);
  const request = buildRequest(samples);
  const { scores } = parseResponse(response([['s1', 0.1], ['p', 0.8], ['hn', 0.2], ['hp', 0.9]]), Object.keys(request.questions));
  const threshold = getThreshold(calibration, scores);
  assert.equal(threshold, 0.8);
  assert.equal(evaluate(samples, scores, threshold!).holdout.gates.passed, true);
});
