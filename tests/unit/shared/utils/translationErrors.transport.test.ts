/**
 * TransportError 与错误分类扩展测试
 *
 * 覆盖：timeout / cancelled / unavailable 三类传输错误的可区分性，
 * 以及 classifyTranslationError 对传输层结构化错误的分类。
 */

import { describe, it, expect } from 'vitest';
import {
  classifyTranslationError,
  TranslationErrorType,
  TransportError,
} from '@/shared/utils/translationErrors';

describe('TransportError', () => {
  it('三种错误类型可区分：timeout / cancelled / unavailable', () => {
    const timeout = TransportError.timeout(5000);
    const cancelled = TransportError.cancelled();
    const unavailable = TransportError.unavailable('服务不可用 (HTTP 503)', 503);

    expect(timeout.kind).toBe('timeout');
    expect(cancelled.kind).toBe('cancelled');
    expect(unavailable.kind).toBe('unavailable');

    expect(timeout.statusCode).toBeUndefined();
    expect(unavailable.statusCode).toBe(503);
    expect(timeout.message).toContain('5000');
  });

  it('timeout 与 cancelled 不可自动重试，unavailable 可重试', () => {
    expect(TransportError.timeout(1000).retryable).toBe(false);
    expect(TransportError.cancelled().retryable).toBe(false);
    expect(TransportError.unavailable('服务过载', 503).retryable).toBe(true);
  });
});

describe('classifyTranslationError — TransportError 分支', () => {
  it('cancelled → REQUEST_CANCELLED 且不可重试', () => {
    const info = classifyTranslationError(TransportError.cancelled());
    expect(info.type).toBe(TranslationErrorType.REQUEST_CANCELLED);
    expect(info.retryable).toBe(false);
  });

  it('timeout → TIMEOUT', () => {
    const info = classifyTranslationError(TransportError.timeout(3000));
    expect(info.type).toBe(TranslationErrorType.TIMEOUT);
  });

  it('输出耗尽 → INVALID_RESPONSE，提示调整文本或模型且不可原样重试', () => {
    const info = classifyTranslationError(TransportError.outputLimit());

    expect(info).toMatchObject({
      type: TranslationErrorType.INVALID_RESPONSE,
      title: '模型输出被截断',
      message: '模型输出预算耗尽，未返回完整译文，请缩短文本或使用非思考模型',
      retryable: false,
      action: 'open_settings',
    });
    expect(info.retryDelay).toBeUndefined();
  });

  it('unavailable 503 → SERVICE_UNAVAILABLE 且可重试', () => {
    const info = classifyTranslationError(TransportError.unavailable('服务不可用 (HTTP 503)', 503));
    expect(info.type).toBe(TranslationErrorType.SERVICE_UNAVAILABLE);
    expect(info.retryable).toBe(true);
  });

  it('unavailable 429 → RATE_LIMIT', () => {
    const info = classifyTranslationError(TransportError.unavailable('请求过于频繁 (HTTP 429)', 429));
    expect(info.type).toBe(TranslationErrorType.RATE_LIMIT);
  });

  it('unavailable 401 → INVALID_API_KEY', () => {
    const info = classifyTranslationError(TransportError.unavailable('未授权 (HTTP 401)', 401));
    expect(info.type).toBe(TranslationErrorType.INVALID_API_KEY);
  });

  it('unavailable 无状态码（网络失败）→ NETWORK_ERROR', () => {
    const info = classifyTranslationError(TransportError.unavailable('网络请求失败'));
    expect(info.type).toBe(TranslationErrorType.NETWORK_ERROR);
    expect(info.retryable).toBe(true);
  });
});
