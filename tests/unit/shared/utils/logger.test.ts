/**
 * 统一日志服务测试
 *
 * 测试 logger 在不同环境下的输出控制
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test the module, but the module reads import.meta.env.DEV at load time.
// Since vitest runs in dev mode by default, isDev will be true.
// We'll test the formatArgs behavior by importing the module.

import { logger } from '@/shared/utils/logger';

describe('logger', () => {
  let originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };

  beforeEach(() => {
    originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  describe('debug', () => {
    it('should call console.log in dev mode', () => {
      logger.debug('test message');

      expect(console.log).toHaveBeenCalled();
    });

    it('should include prefix and level tag', () => {
      logger.debug('test');

      expect(console.log).toHaveBeenCalledWith(
        '[NOT]',
        '[DEBUG]',
        'test'
      );
    });

    it('should handle multiple arguments', () => {
      logger.debug('message', { key: 'value' }, 42);

      expect(console.log).toHaveBeenCalledWith(
        '[NOT]',
        '[DEBUG]',
        'message',
        { key: 'value' },
        42
      );
    });

    it('should format Error objects to name: message', () => {
      const err = new TypeError('something went wrong');
      logger.debug('error occurred', err);

      expect(console.log).toHaveBeenCalledWith(
        '[NOT]',
        '[DEBUG]',
        'error occurred',
        'TypeError: something went wrong'
      );
    });
  });

  describe('info', () => {
    it('should call console.log in dev mode', () => {
      logger.info('info message');

      expect(console.log).toHaveBeenCalledWith(
        '[NOT]',
        '[INFO]',
        'info message'
      );
    });

    it('should handle Error objects', () => {
      const err = new RangeError('out of bounds');
      logger.info('info', err);

      expect(console.log).toHaveBeenCalledWith(
        '[NOT]',
        '[INFO]',
        'info',
        'RangeError: out of bounds'
      );
    });
  });

  describe('warn', () => {
    it('should call console.warn', () => {
      logger.warn('warning message');

      expect(console.warn).toHaveBeenCalledWith(
        '[NOT]',
        '[WARN]',
        'warning message'
      );
    });

    it('should format Error objects', () => {
      const err = new Error('deprecated');
      logger.warn('watch out', err);

      expect(console.warn).toHaveBeenCalledWith(
        '[NOT]',
        '[WARN]',
        'watch out',
        'Error: deprecated'
      );
    });
  });

  describe('error', () => {
    it('should call console.error', () => {
      logger.error('error message');

      expect(console.error).toHaveBeenCalledWith(
        '[NOT]',
        '[ERROR]',
        'error message'
      );
    });

    it('should format Error objects', () => {
      const err = new SyntaxError('unexpected token');
      logger.error('parse failed', err);

      expect(console.error).toHaveBeenCalledWith(
        '[NOT]',
        '[ERROR]',
        'parse failed',
        'SyntaxError: unexpected token'
      );
    });

    it('should handle non-Error values gracefully', () => {
      logger.error('issue', 'string error');

      expect(console.error).toHaveBeenCalledWith(
        '[NOT]',
        '[ERROR]',
        'issue',
        'string error'
      );
    });

    it('should handle null values', () => {
      logger.error('null issue', null);

      expect(console.error).toHaveBeenCalledWith(
        '[NOT]',
        '[ERROR]',
        'null issue',
        null
      );
    });
  });

  describe('prefix', () => {
    it('should use [NOT] prefix for all log levels', () => {
      logger.debug('d');
      logger.info('i');
      logger.warn('w');
      logger.error('e');

      expect(console.log).toHaveBeenCalledWith('[NOT]', '[DEBUG]', 'd');
      expect(console.log).toHaveBeenCalledWith('[NOT]', '[INFO]', 'i');
      expect(console.warn).toHaveBeenCalledWith('[NOT]', '[WARN]', 'w');
      expect(console.error).toHaveBeenCalledWith('[NOT]', '[ERROR]', 'e');
    });
  });
});
