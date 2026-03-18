import { useState } from 'react';
import { type QuotaAlert } from '@/shared/types/quota';

interface QuotaAlertBannerProps {
  alert: QuotaAlert;
  onAction?: () => void;
  onDismiss?: () => void;
}

/**
 * 配额警告横幅组件
 * 在页面顶部显示配额警告
 */
export function QuotaAlertBanner({ alert, onAction, onDismiss }: QuotaAlertBannerProps) {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible || alert.level === 'none') {
    return null;
  }

  const styles = {
    exhausted: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-800',
      icon: 'text-red-500',
      button: 'bg-red-600 hover:bg-red-700',
    },
    critical: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      text: 'text-orange-800',
      icon: 'text-orange-500',
      button: 'bg-orange-600 hover:bg-orange-700',
    },
    low: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      text: 'text-yellow-800',
      icon: 'text-yellow-500',
      button: 'bg-yellow-600 hover:bg-yellow-700',
    },
  };

  const style = styles[alert.level];

  return (
    <div className={`${style.bg} ${style.border} border px-4 py-3 rounded-lg shadow-sm`}>
      <div className="flex items-start gap-3">
        {/* 图标 */}
        <div className={`${style.icon} flex-shrink-0 mt-0.5`}>
          {alert.level === 'exhausted' && (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          )}
          {alert.level === 'critical' && (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
          {alert.level === 'low' && (
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          )}
        </div>

        {/* 消息 */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${style.text}`}>
            {alert.message}
          </p>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {alert.action && (
            <button
              onClick={onAction}
              className={`${style.button} text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors`}
            >
              {alert.action}
            </button>
          )}
          {onDismiss && (
            <button
              onClick={() => {
                setIsVisible(false);
                onDismiss();
              }}
              className={`${style.text} opacity-60 hover:opacity-100 transition-opacity`}
              aria-label="关闭"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 配额指示器组件
 * 显示在工具栏或小空间中
 */
interface QuotaIndicatorProps {
  remaining: number;
  total: number;
  showLabel?: boolean;
}

export function QuotaIndicator({ remaining, total, showLabel = true }: QuotaIndicatorProps) {
  const percentage = total > 0 ? Math.round((remaining / total) * 100) : 0;

  const getColor = () => {
    if (remaining <= 5) return 'bg-red-500';
    if (remaining <= 20) return 'bg-orange-500';
    if (percentage <= 30) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getTextColor = () => {
    if (remaining <= 5) return 'text-red-600';
    if (remaining <= 20) return 'text-orange-600';
    if (percentage <= 30) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="flex items-center gap-2">
      {showLabel && (
        <span className="text-sm text-gray-500">
          剩余额度
        </span>
      )}
      <div className="flex items-center gap-1.5">
        <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${getColor()}`}
            style={{ width: `${percentage}%` }}
          />
        </div>
        <span className={`text-sm font-medium ${getTextColor()}`}>
          {remaining}
        </span>
      </div>
    </div>
  );
}

/**
 * 配额耗尽弹窗
 */
interface QuotaExhaustedModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigureApi: () => void;
  onInviteFriends: () => void;
}

export function QuotaExhaustedModal({
  isOpen,
  onClose,
  onConfigureApi,
  onInviteFriends,
}: QuotaExhaustedModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in">
        {/* 图标 */}
        <div className="w-20 h-20 mx-auto bg-gradient-to-br from-red-100 to-orange-100 rounded-full flex items-center justify-center mb-4">
          <span className="text-4xl">⚡</span>
        </div>

        <h2 className="text-xl font-bold text-center text-gray-800 mb-2">
          免费额度已用完
        </h2>

        <p className="text-gray-600 text-center mb-6">
          您的免费翻译额度已用完。您可以配置自己的 API Key 继续使用，或者邀请朋友获得额外奖励额度。
        </p>

        {/* 选项卡片 */}
        <div className="space-y-3 mb-6">
          <button
            onClick={onConfigureApi}
            className="w-full p-4 border-2 border-blue-200 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                🔑
              </div>
              <div className="text-left">
                <div className="font-semibold text-gray-800">配置 API Key</div>
                <div className="text-sm text-gray-500">使用自己的 OpenAI/Anthropic API</div>
              </div>
            </div>
          </button>

          <button
            onClick={onInviteFriends}
            className="w-full p-4 border-2 border-green-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition-all group"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center text-2xl group-hover:scale-110 transition-transform">
                🎁
              </div>
              <div className="text-left">
                <div className="font-semibold text-gray-800">邀请好友</div>
                <div className="text-sm text-gray-500">每成功邀请一位好友，双方各得 50 次额度</div>
              </div>
            </div>
          </button>
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="w-full py-3 text-gray-500 hover:text-gray-700 transition-colors"
        >
          稍后再说
        </button>
      </div>
    </div>
  );
}
