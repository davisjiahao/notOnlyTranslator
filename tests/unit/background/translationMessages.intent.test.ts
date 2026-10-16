/**
 * 翻译消息路由的 intent 校验测试
 *
 * 契约要点：TRANSLATE_TEXT 的 intent 仅允许 'reading' | 'lookup'，缺失保留旧行为；
 * 非法值按输入无效拒绝。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Message } from '@/shared/types';

vi.mock('@/background/storage', () => ({
  StorageManager: { getUserProfile: vi.fn() },
}));
vi.mock('@/background/translation', () => ({
  TranslationService: { translate: vi.fn(async () => ({ words: [], sentences: [] })) },
}));
vi.mock('@/background/inflightBatchDedup', () => ({
  translateBatchWithJoin: vi.fn(),
}));
vi.mock('@/background/pendingRequestQueue', () => ({
  pendingRequestQueue: { add: vi.fn(async () => undefined), trackCleanup: vi.fn() },
}));

import { handleTranslationMessage } from '@/background/translationMessages';
import { TranslationService } from '@/background/translation';
import { StorageManager } from '@/background/storage';
import { DEFAULT_USER_PROFILE } from '@/shared/constants';

const sender = {} as chrome.runtime.MessageSender;

const message = (intent: unknown): Message => ({
  type: 'TRANSLATE_TEXT',
  requestId: 'req-1',
  payload: {
    text: 'The serendipitous encounter changed her perspective entirely.',
    context: '',
    mode: 'inline-only',
    ...(intent === undefined ? {} : { intent }),
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue(DEFAULT_USER_PROFILE as never);
});

afterEach(() => { vi.restoreAllMocks(); });

describe('TRANSLATE_TEXT intent 校验', () => {
  it.each(['reading', 'lookup'] as const)('合法 intent %s 透传给翻译服务', async intent => {
    const response = await handleTranslationMessage(message(intent), sender);
    expect(response.success).toBe(true);
    expect(TranslationService.translate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(TranslationService.translate).mock.calls.at(-1)![0]).toMatchObject({ intent });
  });

  it.each(['bogus', 123, null, true])('非法 intent %j 拒绝', async intent => {
    const response = await handleTranslationMessage(message(intent), sender);
    expect(response.success).toBe(false);
    expect(response.error).toBe('翻译输入无效或超出长度限制');
    expect(TranslationService.translate).not.toHaveBeenCalled();
  });

  it('缺失 intent：保留旧行为', async () => {
    const response = await handleTranslationMessage(message(undefined), sender);
    expect(response.success).toBe(true);
    expect(vi.mocked(TranslationService.translate).mock.calls.at(-1)![0].intent).toBeUndefined();
  });
});
