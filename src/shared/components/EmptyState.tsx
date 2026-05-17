/**
 * 统一空状态组件
 *
 * 提供一致的"无数据"视觉反馈模式：图标 + 标题 + 说明文字 + 可选操作按钮
 */

interface EmptyStateProps {
  /** 图标类型（SVG 路径名称） */
  icon: 'book' | 'chart' | 'search' | 'inbox' | 'check' | 'error' | 'translate';
  /** 主标题文字 */
  title: string;
  /** 副标题/说明文字 */
  description?: string;
  /** 可选操作按钮 */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** 自定义容器 class */
  className?: string;
  /** 自定义图标尺寸 */
  iconSize?: number;
}

/** 内置图标路径 */
const ICONS: Record<string, string> = {
  book: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
  chart: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  search: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z',
  inbox: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
  check: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  error: 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  translate: 'M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129',
};

export default function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
  iconSize = 12,
}: EmptyStateProps) {
  const iconPath = ICONS[icon] ?? ICONS.inbox;

  return (
    <div className={`text-center py-8 ${className}`} role="status" aria-live="polite">
      <div className="text-gray-400 dark:text-gray-300 mb-3">
        <svg
          className={`mx-auto w-${iconSize} h-${iconSize}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={iconPath} />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-500 dark:text-gray-300">{title}</p>
      {description && (
        <p className="text-xs text-gray-400 dark:text-gray-300 mt-1">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 rounded-lg hover:bg-primary-100 dark:hover:bg-primary-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
