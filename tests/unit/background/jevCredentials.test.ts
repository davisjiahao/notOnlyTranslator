import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import manifest from '../../../public/manifest.json';
import { clearJevApiKey, getJevApiKey, isTrustedJevSender, saveJevApiKey } from '@/background/jevCredentials';

type EventRequest = {
  result?: unknown;
  error: Error;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked: (() => void) | null;
  onupgradeneeded: (() => void) | null;
};
const request = (): EventRequest => ({
  error: new Error('synthetic-secret'), onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null,
});
const token = 'jev-synthetic-secret';
const extensionId = 'test-extension';
const optionsUrl = `chrome-extension://${extensionId}/${manifest.options_ui.page}`;

function installDatabase() {
  let records: Record<string, unknown> = {};
  let pending: (() => void) | undefined;
  let failAt: 'open' | 'open-throw' | 'blocked' | 'transaction' | 'operation' | 'request' | 'abort' | 'delete' | 'delete-blocked' | null = null;
  let pauseCommit = false;
  const close = vi.fn();
  const createObjectStore = vi.fn();
  const operation = vi.fn();
  const open = vi.fn(() => {
    if (failAt === 'open-throw') throw new Error(token);
    const opening = request();
    const database = {
      objectStoreNames: { contains: () => false }, createObjectStore, close,
      onversionchange: null as (() => void) | null,
      transaction: (_store: string, _mode: string) => {
        if (failAt === 'transaction') throw new Error(token);
        let next = records;
        const transaction = {
          oncomplete: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onabort: null as (() => void) | null,
          objectStore: () => ({
            get: (key: string) => perform('get', key),
            put: (value: string, key: string) => perform('put', key, value),
          }),
        };
        const perform = (kind: string, key: string, value?: string) => {
          if (failAt === 'operation') throw new Error(token);
          operation(kind, key, value);
          const reading = { ...request(), result: kind === 'get' ? records[key] : key };
          if (kind === 'put') next = { ...records, [key]: value };
          queueMicrotask(() => {
            if (failAt === 'request') { reading.onerror?.(); transaction.onerror?.(); return; }
            reading.onsuccess?.();
            pending = () => {
              if (failAt === 'abort') { transaction.onabort?.(); return; }
              records = next;
              transaction.oncomplete?.();
            };
            if (!pauseCommit) pending();
          });
          return reading;
        };
        return transaction;
      },
    };
    queueMicrotask(() => {
      if (failAt === 'open') { opening.onerror?.(); return; }
      if (failAt === 'blocked') { opening.onblocked?.(); return; }
      opening.result = database;
      opening.onupgradeneeded?.();
      opening.onsuccess?.();
    });
    return opening;
  });
  const deleteDatabase = vi.fn(() => {
    const deleting = request();
    queueMicrotask(() => {
      if (failAt === 'delete') { deleting.onerror?.(); return; }
      if (failAt === 'delete-blocked') { deleting.onblocked?.(); return; }
      records = {};
      deleting.onsuccess?.();
    });
    return deleting;
  });
  vi.stubGlobal('indexedDB', { open, deleteDatabase });
  return {
    open, deleteDatabase, close, createObjectStore, operation,
    fail: (value: typeof failAt) => { failAt = value; },
    pause: () => { pauseCommit = true; },
    commit: () => { pending?.(); },
    seed: (value: unknown) => { records = { apiKey: value }; },
  };
}

let database: ReturnType<typeof installDatabase>;
beforeEach(() => {
  database = installDatabase();
  vi.stubGlobal('chrome', { runtime: { id: extensionId, getURL: (path: string) => `chrome-extension://${extensionId}/${path}` },
    storage: { local: { set: vi.fn() }, sync: { set: vi.fn() } } });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('禁止真实网络'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const defaultConfig = { provider: 'typesafe' as const, apiUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-1.13.0', threshold: 0.5 };
const customConfig = { ...defaultConfig, provider: 'custom' as const, apiUrl: 'https://recognition.example/v2/systemone', model: 'custom-jev' };

describe('Jev独立凭据库', () => {
  it('密钥绑定提供商与完整端点，模型阈值变化仍可复用且跨host/path/provider不可复用', async () => {
    await saveJevApiKey(token, customConfig);
    expect(database.operation).toHaveBeenCalledWith('put', 'apiKey', {
      apiKey: token, provider: 'custom', apiUrl: customConfig.apiUrl,
    });
    expect(await getJevApiKey(customConfig)).toBe(token);
    expect(await getJevApiKey({ ...customConfig, model: 'another', threshold: 0.8 })).toBe(token);
    expect(await getJevApiKey({ ...customConfig, apiUrl: 'https://another.example/v2/systemone' })).toBeNull();
    expect(await getJevApiKey({ ...customConfig, apiUrl: 'https://recognition.example/other' })).toBeNull();
    expect(await getJevApiKey()).toBeNull();
    await saveJevApiKey(token);
    expect(await getJevApiKey({ ...defaultConfig, provider: 'custom' })).toBeNull();
  });

  it('旧裸字符串只兼容默认provider与endpoint，重存迁移为绑定记录', async () => {
    database.seed(token);
    expect(await getJevApiKey()).toBe(token);
    expect(await getJevApiKey({ ...defaultConfig, model: 'other', threshold: 0.2 })).toBe(token);
    expect(await getJevApiKey(customConfig)).toBeNull();
    expect(await getJevApiKey({ ...defaultConfig, provider: 'custom' })).toBeNull();
    await saveJevApiKey(token);
    expect(database.operation).toHaveBeenCalledWith('put', 'apiKey', {
      apiKey: token, provider: defaultConfig.provider, apiUrl: defaultConfig.apiUrl,
    });
  });

  it('等待队列期间调用方修改配置不会改绑密钥', async () => {
    const config = { ...customConfig };
    const saving = saveJevApiKey(token, config);
    Object.assign(config, { apiUrl: 'https://other.example/systemone' });
    await saving;
    expect(await getJevApiKey(customConfig)).toBe(token);
    expect(await getJevApiKey(config)).toBeNull();
  });

  it('规范化端点后绑定，非法配置在触碰凭据库前拒绝', async () => {
    await saveJevApiKey(token, { ...customConfig, apiUrl: 'https://RECOGNITION.example:443/v2/systemone' });
    expect(await getJevApiKey(customConfig)).toBe(token);
    database.open.mockClear();
    await expect(saveJevApiKey(token, { ...customConfig, apiUrl: 'http://recognition.example/systemone' })).rejects.toThrow('INVALID_JEV_CONFIG');
    expect(database.open).not.toHaveBeenCalled();
  });
  it('首次读取为空，trim后单记录保存与替换，不写Chrome storage或网络', async () => {
    expect(await getJevApiKey()).toBeNull();
    await saveJevApiKey(`  ${token}  `);
    expect(await getJevApiKey()).toBe(token);
    await saveJevApiKey('replacement-key');
    expect(await getJevApiKey()).toBe('replacement-key');
    expect(database.open).toHaveBeenCalledWith('notOnlyTranslatorJevCredentials', 1);
    expect(database.createObjectStore).toHaveBeenCalledWith('credentials');
    expect(database.operation.mock.calls.filter(([kind]) => kind === 'put').map(([, key]) => key)).toEqual(['apiKey', 'apiKey']);
    expect(database.close).toHaveBeenCalledTimes(5);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('写请求成功不能提前完成，必须等待事务oncomplete', async () => {
    database.pause();
    let settled = false;
    const saving = saveJevApiKey(token).then(() => { settled = true; });
    await vi.waitFor(() => expect(database.operation).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(database.close).not.toHaveBeenCalled();
    database.commit();
    await saving;
    expect(settled).toBe(true);
    expect(database.close).toHaveBeenCalledOnce();
  });

  it.each(['', '   ', `${token}\r`, `${token}\n`, `a\r\nb`, 'a'.repeat(4097), null, 42])('非法key在打开库前拒绝：%j', async key => {
    await expect(saveJevApiKey(key as string)).rejects.toThrow('INVALID_JEV_API_KEY');
    expect(database.open).not.toHaveBeenCalled();
  });

  it('允许最大长度4096字符', async () => {
    await saveJevApiKey('a'.repeat(4096));
    expect(await getJevApiKey()).toHaveLength(4096);
  });

  it.each(['open', 'open-throw', 'blocked', 'transaction', 'operation', 'request', 'abort'] as const)(
    '读写%s失败仅返回固定错误且不回显凭据', async failure => {
      database.fail(failure);
      for (const run of [getJevApiKey, () => saveJevApiKey(token)]) {
        const error = await run().catch(value => value);
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('JEV_CREDENTIALS_UNAVAILABLE');
        expect(error.message).not.toContain(token);
      }
    },
  );

  it.each([null, 42, {}, '', `bad\nkey`, 'a'.repeat(4097)])('拒绝损坏的存储记录：%j', async value => {
    database.seed(value);
    await expect(getJevApiKey()).rejects.toThrow('JEV_CREDENTIALS_UNAVAILABLE');
  });

  it('clear删除整个独立库且重复清除可用', async () => {
    await saveJevApiKey(token);
    await clearJevApiKey();
    expect(database.deleteDatabase).toHaveBeenCalledWith('notOnlyTranslatorJevCredentials');
    expect(await getJevApiKey()).toBeNull();
    await clearJevApiKey();
  });

  it('clear等待在途保存提交后再删库，旧写入不能回填', async () => {
    database.pause();
    const saving = saveJevApiKey(token);
    await vi.waitFor(() => expect(database.operation).toHaveBeenCalledOnce());
    let cleared = false;
    const clearing = clearJevApiKey().then(() => { cleared = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(cleared).toBe(false);
    expect(database.deleteDatabase).not.toHaveBeenCalled();
    database.commit();
    await Promise.all([saving, clearing]);
    expect(cleared).toBe(true);
    expect(database.deleteDatabase).toHaveBeenCalledOnce();
  });

  it.each(['delete', 'delete-blocked'] as const)('整库清除%s失败只返回固定错误', async failure => {
    database.fail(failure);
    await expect(clearJevApiKey()).rejects.toThrow('JEV_CREDENTIALS_UNAVAILABLE');
  });
});

describe('Jev凭据消息来源', () => {
  it('只接受当前扩展精确options页面', () => {
    expect(manifest.options_ui.page).toBe('src/options/index.html');
    expect(isTrustedJevSender({ id: extensionId, url: optionsUrl })).toBe(true);
  });
  it.each([
    {}, { id: extensionId }, { url: optionsUrl }, { id: 'another', url: optionsUrl },
    { id: extensionId, url: 'https://example.test/' },
    { id: extensionId, url: `chrome-extension://${extensionId}/src/popup/index.html` },
    { id: extensionId, url: `${optionsUrl}?tab=api` },
    { id: extensionId, url: `${optionsUrl}#api` },
    { id: extensionId, url: `${optionsUrl}/extra` },
    { id: extensionId, url: `https://example.test/${optionsUrl}` },
  ])('拒绝不可信发送者：%j', sender => {
    expect(isTrustedJevSender(sender)).toBe(false);
  });
});
