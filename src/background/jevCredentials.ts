import type { JevConfig } from '@/shared/types';
import { DEFAULT_JEV_CONFIG, resolveJevConfig } from '@/shared/utils/jevConfig';

const DATABASE = 'notOnlyTranslatorJevCredentials';
const STORE = 'credentials';
const KEY = 'apiKey';
const MAX_KEY_LENGTH = 4096;
const unavailable = () => new Error('JEV_CREDENTIALS_UNAVAILABLE');
let operations: Promise<unknown> = Promise.resolve();

function queue<T>(operation: () => Promise<T>): Promise<T> {
  const pending = operations.then(operation);
  operations = pending.catch(() => undefined);
  return pending;
}

function normalizeKey(key: unknown): string {
  if (typeof key !== 'string' || /[\r\n]/u.test(key)) throw new Error('INVALID_JEV_API_KEY');
  const normalized = key.trim();
  if (!normalized || normalized.length > MAX_KEY_LENGTH) throw new Error('INVALID_JEV_API_KEY');
  return normalized;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let failed = false;
    const fail = () => { failed = true; reject(unavailable()); };
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onerror = request.onblocked = fail;
      request.onupgradeneeded = () => {
        try {
          if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
        } catch { request.transaction?.abort(); fail(); }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (failed) { database.close(); return; }
        database.onversionchange = () => database.close();
        resolve(database);
      };
    } catch { fail(); }
  });
}

async function accessStore(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const fail = () => reject(unavailable());
      transaction.onerror = transaction.onabort = fail;
      const request = operation(transaction.objectStore(STORE));
      request.onerror = fail;
      // 请求成功后事务仍可能中止，只在提交完成后报告成功。
      transaction.oncomplete = () => resolve(request.result);
    });
  } catch { throw unavailable(); }
  finally { database.close(); }
}

export async function getJevApiKey(config?: JevConfig): Promise<string | null> {
  const owner = resolveJevConfig(config);
  return queue(async () => {
    const value = await accessStore('readonly', store => store.get(KEY));
    if (value === undefined) return null;
    try {
      // 旧裸字符串只归属原始默认端点，不随配置切换迁移。
      if (typeof value === 'string') {
        const key = normalizeKey(value);
        return owner.provider === DEFAULT_JEV_CONFIG.provider && owner.apiUrl === DEFAULT_JEV_CONFIG.apiUrl ? key : null;
      }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
      const record = value as Record<string, unknown>;
      if (Object.keys(record).length !== 3 || !['typesafe', 'custom'].includes(record.provider as string) ||
        typeof record.apiUrl !== 'string') throw unavailable();
      const key = normalizeKey(record.apiKey);
      return record.provider === owner.provider && record.apiUrl === owner.apiUrl ? key : null;
    } catch { throw unavailable(); }
  });
}

export async function saveJevApiKey(key: string, config?: JevConfig): Promise<void> {
  const normalized = normalizeKey(key);
  const { provider, apiUrl } = resolveJevConfig(config);
  await queue(() => accessStore('readwrite', store => store.put({ apiKey: normalized, provider, apiUrl }, KEY)));
}

export async function clearJevApiKey(): Promise<void> {
  // 专属库不复用历史数据；全量清理可直接删除，不需要先读取密钥。
  await queue(() => new Promise<void>((resolve, reject) => {
    const fail = () => reject(unavailable());
    try {
      const request = indexedDB.deleteDatabase(DATABASE);
      request.onsuccess = () => resolve();
      request.onerror = request.onblocked = fail;
    } catch { fail(); }
  }));
}

export function isTrustedJevSender(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(chrome.runtime.id) && sender.id === chrome.runtime.id &&
    sender.url === chrome.runtime.getURL('src/options/index.html');
}
