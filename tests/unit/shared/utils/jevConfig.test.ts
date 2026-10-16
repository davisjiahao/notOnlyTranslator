import { describe, expect, it } from 'vitest';
import { DEFAULT_JEV_CONFIG, resolveJevConfig, getJevPermissionOrigin, isCalibratedJevConfig } from '@/shared/utils/jevConfig';

const defaults = {
  provider: 'typesafe' as const, apiUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', threshold: 0.26,
};

describe('resolveJevConfig', () => {
  it('旧设置缺失配置时返回完整默认配置的新副本', () => {
    expect(DEFAULT_JEV_CONFIG).toEqual(defaults);
    expect(resolveJevConfig()).toEqual(defaults);
    expect(resolveJevConfig()).not.toBe(DEFAULT_JEV_CONFIG);
    expect(resolveJevConfig()).not.toBe(resolveJevConfig());
    expect(Object.isFrozen(DEFAULT_JEV_CONFIG)).toBe(true);
  });

  it.each(['typesafe', 'custom'] as const)('允许 %s 修改端点、模型和阈值，并规范化但不修改输入', provider => {
    const input = Object.freeze({ provider, apiUrl: ' HTTPS://CUSTOM.EXAMPLE:443/v1/../systemone ', model: ' jev-custom ', threshold: 0.7 });
    expect(resolveJevConfig(input)).toEqual({ provider, apiUrl: 'https://custom.example/systemone', model: 'jev-custom', threshold: 0.7 });
    expect(input.apiUrl).toBe(' HTTPS://CUSTOM.EXAMPLE:443/v1/../systemone ');
    expect(input.model).toBe(' jev-custom ');
  });

  it.each([0, 1])('允许概率边界 %s', threshold => {
    expect(resolveJevConfig({ ...defaults, threshold }).threshold).toBe(threshold);
  });

  it('接受长度上限和 Unicode 模型，返回键顺序固定', () => {
    const apiUrl = `https://custom.example/${'x'.repeat(2048 - 'https://custom.example/'.length)}`;
    const model = '模'.repeat(128);
    expect(resolveJevConfig({ threshold: 1, model, apiUrl, provider: 'custom' })).toEqual({ provider: 'custom', apiUrl, model, threshold: 1 });
    expect(Object.keys(resolveJevConfig(defaults))).toEqual(['provider', 'apiUrl', 'model', 'threshold']);
    expect(resolveJevConfig(Object.assign(Object.create(null), defaults))).toEqual(defaults);
  });

  it.each([
    null, false, [], 'default', 1, {}, { ...defaults, provider: 'openai' }, { ...defaults, provider: undefined },
    { apiUrl: defaults.apiUrl, model: defaults.model, threshold: defaults.threshold },
    { ...defaults, extra: true }, { ...defaults, apiKey: 'do-not-reflect' }, { ...defaults, [Symbol('extra')]: true },
    Object.create(defaults),
  ])('拒绝非配置对象、缺字段和额外字段 %#', value => {
    expect(() => resolveJevConfig(value)).toThrow('INVALID_JEV_CONFIG');
  });

  it.each([
    undefined, null, 1, '', ' ', 'http://custom.example/systemone', 'file:///systemone', 'not a URL',
    'https://custom.example', 'https://custom.example/', 'https://custom.example/v1/..',
    'https://user@custom.example/systemone', 'https://user:password@custom.example/systemone',
    'https://@custom.example/systemone', 'https://*.custom.example/systemone',
    'https://custom.example/systemone?key=secret', 'https://custom.example/systemone?',
    'https://custom.example/systemone#fragment', 'https://custom.example/systemone#',
    'https://custom.example/\nsystemone', 'https://custom.example/\u007fsystemone',
    'https:\\custom.example\\systemone', `https://custom.example/${'x'.repeat(2048)}`,
  ])('拒绝非法 URL 且错误不反射输入 %#', apiUrl => {
    expect(() => resolveJevConfig({ ...defaults, apiUrl })).toThrow(new Error('INVALID_JEV_CONFIG'));
  });

  it.each([undefined, null, 1, '', '  ', 'x'.repeat(129), 'jev\nmodel', 'jev\tmodel', 'jev\u0000model', 'jev\u0085model'])('拒绝非法 model %#', model => {
    expect(() => resolveJevConfig({ ...defaults, model })).toThrow('INVALID_JEV_CONFIG');
  });

  it.each([undefined, null, '0.26', NaN, Infinity, -Infinity, -0.01, 1.01])('拒绝非法 threshold %#', threshold => {
    expect(() => resolveJevConfig({ ...defaults, threshold })).toThrow('INVALID_JEV_CONFIG');
  });
});

describe('Jev 配置派生信息', () => {
  it('权限只申请精确 HTTPS 主机，Chrome 匹配模式不包含端口和 API 路径', () => {
    expect(getJevPermissionOrigin(defaults)).toBe('https://api.typesafe.ai/*');
    expect(getJevPermissionOrigin({ ...defaults, apiUrl: 'https://CUSTOM.EXAMPLE:8443/custom/path' })).toBe('https://custom.example/*');
    expect(getJevPermissionOrigin({ ...defaults, apiUrl: 'https://[::1]:8443/systemone' })).toBe('https://[::1]/*');
    expect(() => getJevPermissionOrigin({ ...defaults, apiUrl: 'http://custom.example/systemone' })).toThrow('INVALID_JEV_CONFIG');
  });

  it('仅完整规范默认配置标为已校准，custom 即使其他字段一致仍未校准', () => {
    expect(isCalibratedJevConfig(defaults)).toBe(true);
    expect(isCalibratedJevConfig({ ...defaults, apiUrl: 'HTTPS://API.TYPESAFE.AI:443/v1/systemone', model: ' jev-1.13.0 ' })).toBe(true);
    for (const changes of [{ provider: 'custom' as const }, { apiUrl: 'https://custom.example/systemone' }, { model: 'jev-new' }, { threshold: 0.27 }]) {
      expect(isCalibratedJevConfig({ ...defaults, ...changes })).toBe(false);
    }
  });

  it.each([
    { ...defaults, apiUrl: '' }, { ...defaults, apiUrl: 'http://custom.example/systemone' },
    { ...defaults, model: '' }, { ...defaults, threshold: NaN }, { ...defaults, threshold: 2 },
  ])('非法表单草稿返回未校准，严格解析仍拒绝 %#', config => {
    expect(isCalibratedJevConfig(config)).toBe(false);
    expect(() => resolveJevConfig(config)).toThrow('INVALID_JEV_CONFIG');
  });
});
