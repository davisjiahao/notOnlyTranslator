import type { JevConfig } from '@/shared/types';
import { JEV_MODEL, JEV_THRESHOLD } from './jevProtocol';

export const DEFAULT_JEV_CONFIG: Readonly<JevConfig> = Object.freeze({
  provider: 'typesafe',
  apiUrl: 'https://api.typesafe.ai/v1/systemone',
  model: JEV_MODEL,
  threshold: JEV_THRESHOLD,
});

const FIELDS = ['provider', 'apiUrl', 'model', 'threshold'];
const invalid = () => new Error('INVALID_JEV_CONFIG');

/** 仅接收完整白名单配置，返回顺序固定的新对象用于缓存和凭据绑定。 */
export function resolveJevConfig(value?: unknown): JevConfig {
  if (value === undefined) return { ...DEFAULT_JEV_CONFIG };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Reflect.ownKeys(value).length !== FIELDS.length ||
    !FIELDS.every(field => Object.prototype.hasOwnProperty.call(value, field))) throw invalid();
  const { provider, apiUrl, model, threshold } = value as Record<string, unknown>;
  if ((provider !== 'typesafe' && provider !== 'custom') || typeof apiUrl !== 'string' ||
    typeof model !== 'string' || !model.trim() || model.trim().length > 128 || /\p{Cc}/u.test(model) ||
    typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw invalid();
  const address = apiUrl.trim();
  if (!address || address.length > 2048 || /[?#\\]|\p{Cc}/u.test(apiUrl) || !/^https:\/\//i.test(address)) throw invalid();
  let url: URL;
  try { url = new URL(address); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || /^https:\/\/[^/]*@/i.test(address) ||
    url.hostname.includes('*') || url.search || url.hash || url.pathname === '/' || !url.pathname || url.href.length > 2048) throw invalid();
  return { provider, apiUrl: url.href, model: model.trim(), threshold };
}

export function getJevPermissionOrigin(config: JevConfig): string {
  // Chrome 主机匹配模式按主机授权，不包含端口和 API 路径。
  return `https://${new URL(resolveJevConfig(config).apiUrl).hostname}/*`;
}

export function isCalibratedJevConfig(config: JevConfig): boolean {
  try {
    const resolved = resolveJevConfig(config);
    return resolved.provider === DEFAULT_JEV_CONFIG.provider && resolved.apiUrl === DEFAULT_JEV_CONFIG.apiUrl &&
      resolved.model === DEFAULT_JEV_CONFIG.model && resolved.threshold === DEFAULT_JEV_CONFIG.threshold;
  } catch { return false; }
}
