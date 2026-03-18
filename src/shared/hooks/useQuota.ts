/**
 * 配额提醒 Hook
 * EXP-003: API 试用配额机制实验
 *
 * 用于在翻译过程中检查配额并显示提醒
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  getQuotaStatus,
  consumeQuota,
  hasEnoughQuota,
  initializeNewUserQuota,
} from '@/shared/analytics/quota';
import type { QuotaAlert as QuotaAlertType } from '@/shared/types/quota';

interface UseQuotaReturn {
  /** 总配额 */
  total: number;
  /** 已使用配额 */
  used: number;
  /** 剩余配额 */
  remaining: number;
  /** 是否加载中 */
  loading: boolean;
  /** 是否有足够配额 */
  hasQuota: boolean;
  /** 配额警告 */
  alert?: QuotaAlertType;
  /** 消耗配额 */
  consume: (context?: string) => Promise<boolean>;
  /** 刷新配额状态 */
  refresh: () => Promise<void>;
  /** 初始化免费配额（首次使用） */
  initializeQuota: () => Promise<void>;
}

/**
 * 配额管理 Hook
 *
 * @example
 * ```tsx
 * function TranslationPage() {
 *   const { hasQuota, consume, alert, remaining } = useQuota();
 *
 *   const handleTranslate = async () => {
 *     if (!hasQuota) {
 *       showQuotaExhaustedModal();
 *       return;
 *     }
 *
 *     const success = await consume('translation');
 *     if (success) {
 *       // 执行翻译
 *     }
 *   };
 * }
 * ```
 */
export function useQuota(): UseQuotaReturn {
  const [total, setTotal] = useState(0);
  const [used, setUsed] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState<QuotaAlertType | undefined>(undefined);
  const initializedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const status = await getQuotaStatus();
      setTotal(status.total);
      setUsed(status.used);
      setRemaining(status.remaining);
      setAlert(status.alert);
    } catch (error) {
      console.error('[useQuota] Failed to refresh:', error);
    }
  }, []);

  const initializeQuota = useCallback(async () => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    try {
      await initializeNewUserQuota();
      await refresh();
    } catch (error) {
      console.error('[useQuota] Failed to initialize:', error);
    }
  }, [refresh]);

  const consume = useCallback(async (context: string = 'translation'): Promise<boolean> => {
    try {
      const result = await consumeQuota(context);

      if (result.success) {
        setRemaining(result.remaining);
        setUsed(prev => prev + 1);
        setAlert(result.alert);
      } else {
        setAlert(result.alert);
      }

      return result.success;
    } catch (error) {
      console.error('[useQuota] Failed to consume:', error);
      return false;
    }
  }, []);

  // 初始加载
  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return {
    total,
    used,
    remaining,
    loading,
    hasQuota: remaining > 0,
    alert,
    consume,
    refresh,
    initializeQuota,
  };
}

/**
 * 简单的配额检查 Hook
 * 仅用于检查是否有配额，不管理状态
 */
export function useQuotaCheck(): () => Promise<boolean> {
  return useCallback(async () => {
    return hasEnoughQuota();
  }, []);
}

/**
 * 配额警告 Hook
 * 订阅配额警告，用于全局显示
 */
export function useQuotaAlert(): QuotaAlertType | undefined {
  const [alert, setAlert] = useState<QuotaAlertType | undefined>(undefined);

  useEffect(() => {
    const checkAlert = async () => {
      try {
        const status = await getQuotaStatus();
        setAlert(status.alert);
      } catch (error) {
        console.error('[useQuotaAlert] Failed to check:', error);
      }
    };

    checkAlert();

    // 每30秒检查一次
    const interval = setInterval(checkAlert, 30000);
    return () => clearInterval(interval);
  }, []);

  return alert;
}
