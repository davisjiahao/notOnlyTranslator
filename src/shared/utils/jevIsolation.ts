/** 只允许出现在本机 IndexedDB 的 Jev 凭据字段，不能进入同步设置或备份。 */
export const JEV_CREDENTIAL_FIELDS = ['jevApiKey', 'jevKey', 'jevCredentials'] as const;

export function hasJevCredentialFields(value: object): boolean {
  return JEV_CREDENTIAL_FIELDS.some(field => Object.prototype.hasOwnProperty.call(value, field));
}

/** 返回去掉凭据字段的浅拷贝；没有这些字段时保持原对象。 */
export function omitJevCredentialFields<T extends object>(value: T): T {
  if (!hasJevCredentialFields(value)) return value;
  const copy = { ...value };
  for (const field of JEV_CREDENTIAL_FIELDS) {
    delete (copy as Record<string, unknown>)[field];
  }
  return copy;
}
