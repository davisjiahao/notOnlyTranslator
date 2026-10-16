import type { JevConfig, JevStatus, Message, MessageResponse, UserProfile } from '@/shared/types';
import { JEV_REASON_LABELS, JEV_RUNTIME_REASON_LABELS } from '@/shared/utils/jev';
import { DEFAULT_JEV_CONFIG, getJevPermissionOrigin, resolveJevConfig } from '@/shared/utils/jevConfig';
import { getLastJevAssessment } from './jevTranslation';
import { getJevApiKey, saveJevApiKey, clearJevApiKey, isTrustedJevSender } from './jevCredentials';
import { assessJevCandidates, collectJevCandidates, resetJevRecognition } from './jevRecognition';
import { StorageManager } from './storage';

const SAFE_ERRORS = new Set(['INVALID_JEV_API_KEY', 'INVALID_JEV_CONFIG', 'JEV_CREDENTIALS_UNAVAILABLE', 'JEV_CREDENTIALS_CHANGED']);
const SAFE_REASONS = new Set([...Object.keys(JEV_REASON_LABELS), ...Object.keys(JEV_RUNTIME_REASON_LABELS)]);

function lastAssessment(): JevStatus['lastAssessment'] {
  const status = getLastJevAssessment();
  if (!status || !['legacy', 'jev'].includes(status.provider) ||
    !Number.isFinite(status.at) || status.at < 0) return undefined;
  return { provider: status.provider, at: status.at,
    ...(status.reason === undefined ? {} : { reason: SAFE_REASONS.has(status.reason) ? status.reason : 'unavailable' }),
  };
}

let generation = 0;

export function invalidateJevOperations(): void {
  generation += 1;
  resetJevRecognition();
}

function assertCurrent(started: number): void {
  if (started !== generation) throw new Error('JEV_CREDENTIALS_CHANGED');
}

async function readConfig(started: number): Promise<JevConfig> {
  const settings = await StorageManager.getSettings();
  assertCurrent(started);
  return resolveJevConfig(settings.jevConfig);
}

const unavailable = (error: unknown) => error instanceof Error && SAFE_ERRORS.has(error.message)
  ? error.message : 'JEV_OPERATION_FAILED';

async function testConnection(): Promise<MessageResponse> {
  const started = generation;
  const config = await readConfig(started);
  assertCurrent(started);
  const permitted = await chrome.permissions.contains({ origins: [getJevPermissionOrigin(config)] });
  assertCurrent(started);
  if (!permitted) return { success: false, error: 'JEV_HOST_PERMISSION_REQUIRED' };
  const key = await getJevApiKey(config);
  assertCurrent(started);
  if (!key) return { success: false, error: 'JEV_KEY_REQUIRED' };
  const profile: UserProfile = {
    examType: 'cet4', estimatedVocabulary: 3000, levelConfidence: 1,
    knownWords: [], unknownWords: [], createdAt: 0, updatedAt: 0,
  };
  resetJevRecognition();
  await assessJevCandidates(collectJevCandidates('She bought a book.', profile), key, { config });
  assertCurrent(started);
  const current = await getJevApiKey(config);
  assertCurrent(started);
  if (current !== key) return { success: false, error: 'JEV_CREDENTIALS_CHANGED' };
  return { success: true, data: { connected: true, model: config.model } };
}

async function saveKey(payload: unknown): Promise<MessageResponse> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
    Object.keys(payload).some(key => !['apiKey', 'config'].includes(key)) ||
    !Object.prototype.hasOwnProperty.call(payload, 'apiKey') ||
    typeof (payload as { apiKey?: unknown }).apiKey !== 'string') {
    return { success: false, error: 'INVALID_JEV_API_KEY' };
  }
  const fields = payload as { apiKey: string; config?: unknown };
  // 调用方快照必须匹配；旧消息仅兼容原默认归属，不能把迟到密钥绑定新端点。
  const requested = Object.prototype.hasOwnProperty.call(fields, 'config') ? resolveJevConfig(fields.config) : undefined;
  const readStarted = generation;
  const config = await readConfig(readStarted);
  assertCurrent(readStarted);
  if (requested ? JSON.stringify(requested) !== JSON.stringify(config) :
    config.provider !== DEFAULT_JEV_CONFIG.provider || config.apiUrl !== DEFAULT_JEV_CONFIG.apiUrl) {
    throw new Error('JEV_CREDENTIALS_CHANGED');
  }
  invalidateJevOperations();
  const started = generation;
  await saveJevApiKey(fields.apiKey, config);
  assertCurrent(started);
  resetJevRecognition();
  return { success: true, data: { hasKey: true } };
}

export async function handleJevMessage(message: Message, sender: chrome.runtime.MessageSender): Promise<MessageResponse> {
  if (!isTrustedJevSender(sender)) return { success: false, error: 'JEV_UNTRUSTED_SENDER' };
  try {
    switch (message.type) {
      case 'GET_JEV_STATUS': {
        const started = generation;
        const config = await readConfig(started);
        assertCurrent(started);
        const hasKey = Boolean(await getJevApiKey(config));
        assertCurrent(started);
        const recent = lastAssessment();
        return { success: true, data: { hasKey, model: config.model, ...(recent ? { lastAssessment: recent } : {}) } };
      }
      case 'SET_JEV_API_KEY':
        return await saveKey(message.payload);
      case 'DELETE_JEV_API_KEY':
        invalidateJevOperations();
        await clearJevApiKey();
        resetJevRecognition();
        return { success: true, data: { hasKey: false } };
      case 'TEST_JEV_CONNECTION':
        return await testConnection();
      default:
        return { success: false, error: 'INVALID_JEV_MESSAGE' };
    }
  } catch (error) { return { success: false, error: unavailable(error) }; }
}
