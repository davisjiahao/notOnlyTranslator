import { describe, expect, it } from 'vitest';
import { buildJevRequest, parseJevResponse, JEV_MODEL, JEV_PROMPT } from '@/shared/utils/jevProtocol';

const items = [{ id: 'j0', sentence: 'bank', target: 'bank', start: 0, end: 4 }];
const response = (model: string) => ({ model, answers: { j0: { type: 'noul', noul: 0.5 } } });

describe('Jev 可配置模型协议', () => {
  it('未传模型保持冻结默认模型、问题结构和 B1 提示词', () => {
    const request = buildJevRequest(items);
    expect(request.model).toBe(JEV_MODEL);
    expect(JSON.parse(request.state)).toEqual({ items: [{ ...items[0], learnerLevel: 'B1' }] });
    expect(request.questions).toEqual({ j0: { type: 'noul', instructions: `${JEV_PROMPT} Evaluate the item whose id is "j0".` } });
    expect(parseJevResponse(response(JEV_MODEL), ['j0'])).toEqual({ j0: 0.5 });
  });

  it('自定义模型仍使用 systemone/noul 协议，响应必须匹配本次请求模型', () => {
    const request = buildJevRequest(items, 'jev-custom');
    expect(request.model).toBe('jev-custom');
    expect(request.questions.j0.type).toBe('noul');
    expect(parseJevResponse(response('jev-custom'), ['j0'], 'jev-custom')).toEqual({ j0: 0.5 });
    expect(() => parseJevResponse(response(JEV_MODEL), ['j0'], 'jev-custom')).toThrow('INVALID_JEV_RESPONSE');
    expect(() => parseJevResponse(response('jev-custom'), ['j0'])).toThrow('INVALID_JEV_RESPONSE');
    expect(() => parseJevResponse({ model: 'jev-custom', choices: [{ message: { content: '0.5' } }] }, ['j0'], 'jev-custom')).toThrow('INVALID_JEV_RESPONSE');
  });

  it.each([null, 1, '', ' ', 'm'.repeat(129), 'model\n', 'model\u0085'])('非法模型在协议边界拒绝 %#', model => {
    expect(() => buildJevRequest(items, model as string)).toThrow('INVALID_JEV_REQUEST');
    expect(() => parseJevResponse(response(model as string), ['j0'], model as string)).toThrow('INVALID_JEV_RESPONSE');
  });

  it('自定义模型长度也计入请求 32KiB 上限', () => {
    const baseBytes = new TextEncoder().encode(JSON.stringify(buildJevRequest(items))).byteLength;
    const boundary = [{ ...items[0], sentence: `bank ${' '.repeat(32 * 1024 - baseBytes - 1)}` }];
    expect(() => buildJevRequest(boundary)).not.toThrow();
    expect(() => buildJevRequest(boundary, 'm'.repeat(128))).toThrow('JEV_REQUEST_TOO_LARGE');
  });
});
