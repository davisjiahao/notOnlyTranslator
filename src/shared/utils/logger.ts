/**
 * 统一日志服务
 *
 * 根据构建环境控制日志输出：
 * - 开发环境：输出所有日志
 * - 生产环境：仅输出 warn 和 error
 *
 * 使用方式：
 * ```typescript
 * import { logger } from '@/shared/utils/logger';
 *
 * logger.debug('调试信息', { data });
 * logger.info('普通信息');
 * logger.warn('警告信息');
 * logger.error('错误信息', error);
 * ```
 */

// 判断是否为开发环境
// Vite 会在构建时替换 import.meta.env.DEV
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

// 日志前缀，便于在控制台过滤
const PREFIX = '[NOT]';

/**
 * 格式化日志参数，处理对象和错误
 */
function formatArgs(args: unknown[]): unknown[] {
  return args.map(arg => {
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}`;
    }
    return arg;
  });
}

/**
 * 日志服务对象
 */
export const logger = {
  /**
   * 调试日志 - 仅在开发环境输出
   * 用于详细的调试信息，如函数入参、中间状态等
   */
  debug: (...args: unknown[]): void => {
    if (isDev) {
      console.log(PREFIX, '[DEBUG]', ...formatArgs(args));
    }
  },

  /**
   * 信息日志 - 仅在开发环境输出
   * 用于一般性信息，如流程开始/结束、状态变化等
   */
  info: (...args: unknown[]): void => {
    if (isDev) {
      console.log(PREFIX, '[INFO]', ...formatArgs(args));
    }
  },

  /**
   * 警告日志 - 始终输出
   * 用于非致命问题，如降级处理、配置缺失等
   */
  warn: (...args: unknown[]): void => {
    console.warn(PREFIX, '[WARN]', ...formatArgs(args));
  },

  /**
   * 错误日志 - 始终输出
   * 用于错误和异常情况
   */
  error: (...args: unknown[]): void => {
    console.error(PREFIX, '[ERROR]', ...formatArgs(args));
  },
};

export default logger;
