/**
 * 反馈系统常量和验证规则测试
 */
import { describe, it, expect } from 'vitest';
import {
  FEEDBACK_STORAGE_KEY,
  FEEDBACK_CONFIG_KEY,
  DEFAULT_FEEDBACK_CONFIG,
  RATING_CONFIG,
  FEEDBACK_VALIDATION,
  FEEDBACK_API_ENDPOINTS,
  EXTENSION_VERSION,
} from '@/shared/feedback/constants';

describe('反馈系统常量', () => {
  it('should define storage keys', () => {
    expect(FEEDBACK_STORAGE_KEY).toBe('userFeedbacks');
    expect(FEEDBACK_CONFIG_KEY).toBe('feedbackConfig');
  });

  it('should have default config with required fields', () => {
    expect(DEFAULT_FEEDBACK_CONFIG.maxEntries).toBe(100);
    expect(DEFAULT_FEEDBACK_CONFIG.autoSync).toBe(true);
    expect(DEFAULT_FEEDBACK_CONFIG.syncInterval).toBe(5 * 60 * 1000);
  });

  it('should have rating config with valid range', () => {
    expect(RATING_CONFIG.min).toBe(1);
    expect(RATING_CONFIG.max).toBe(5);
    expect(RATING_CONFIG.labels).toHaveLength(5);
  });

  it('should have validation rules for title', () => {
    expect(FEEDBACK_VALIDATION.title.required).toBe(true);
    expect(FEEDBACK_VALIDATION.title.minLength).toBe(5);
    expect(FEEDBACK_VALIDATION.title.maxLength).toBe(100);
  });

  it('should have validation rules for description', () => {
    expect(FEEDBACK_VALIDATION.description.required).toBe(true);
    expect(FEEDBACK_VALIDATION.description.minLength).toBe(10);
    expect(FEEDBACK_VALIDATION.description.maxLength).toBe(2000);
  });

  it('should have email validation pattern', () => {
    expect(FEEDBACK_VALIDATION.email.required).toBe(false);
    expect(FEEDBACK_VALIDATION.email.pattern).toBeInstanceOf(RegExp);
  });

  it('email pattern should match valid emails', () => {
    const pattern = FEEDBACK_VALIDATION.email.pattern;
    expect(pattern.test('test@example.com')).toBe(true);
    expect(pattern.test('user.name@domain.org')).toBe(true);
    expect(pattern.test('a@b.co')).toBe(true);
  });

  it('email pattern should reject invalid emails', () => {
    const pattern = FEEDBACK_VALIDATION.email.pattern;
    expect(pattern.test('invalid')).toBe(false);
    expect(pattern.test('@missing.com')).toBe(false);
    expect(pattern.test('no@domain')).toBe(false);
    expect(pattern.test('spaces @email.com')).toBe(false);
  });

  it('should define API endpoints', () => {
    expect(FEEDBACK_API_ENDPOINTS.submit).toBe('/api/feedback/submit');
    expect(FEEDBACK_API_ENDPOINTS.list).toBe('/api/feedback/list');
    expect(FEEDBACK_API_ENDPOINTS.update).toBe('/api/feedback/update');
    expect(FEEDBACK_API_ENDPOINTS.delete).toBe('/api/feedback/delete');
  });

  it('should define extension version', () => {
    expect(EXTENSION_VERSION).toBe('1.0.0');
  });
});
