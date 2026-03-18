import { useState } from 'react';
import FeedbackModal from './FeedbackModal';
import type { FeedbackCategory } from '../../../shared/feedback';

interface FeedbackButtonProps {
  variant?: 'default' | 'minimal' | 'icon';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  initialCategory?: FeedbackCategory;
  label?: string;
}

/**
 * 反馈按钮组件
 * 点击后打开反馈弹窗
 */
export default function FeedbackButton({
  variant = 'default',
  size = 'md',
  className = '',
  initialCategory = 'other',
  label
}: FeedbackButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const sizeClasses = {
    sm: {
      default: 'px-3 py-1.5 text-xs',
      minimal: 'px-2 py-1 text-xs',
      icon: 'p-1'
    },
    md: {
      default: 'px-4 py-2 text-sm',
      minimal: 'px-3 py-1.5 text-sm',
      icon: 'p-2'
    },
    lg: {
      default: 'px-5 py-2.5 text-base',
      minimal: 'px-4 py-2 text-base',
      icon: 'p-2.5'
    }
  };

  const iconSizes = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5'
  };

  const handleOpen = () => setIsModalOpen(true);
  const handleClose = () => setIsModalOpen(false);

  // 图标
  const FeedbackIcon = (
    <svg
      className={iconSizes[size]}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
      />
    </svg>
  );

  // 根据变体渲染不同的按钮样式
  if (variant === 'icon') {
    return (
      <>
        <button
          onClick={handleOpen}
          className={`
            ${sizeClasses[size].icon}
            text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200
            rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500
            ${className}
          `}
          title="意见反馈"
          aria-label="意见反馈"
        >
          {FeedbackIcon}
        </button>
        <FeedbackModal
          isOpen={isModalOpen}
          onClose={handleClose}
          initialCategory={initialCategory}
        />
      </>
    );
  }

  if (variant === 'minimal') {
    return (
      <>
        <button
          onClick={handleOpen}
          className={`
            ${sizeClasses[size].minimal}
            text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200
            underline-offset-2 hover:underline
            transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 rounded
            ${className}
          `}
        >
          {label || '意见反馈'}
        </button>
        <FeedbackModal
          isOpen={isModalOpen}
          onClose={handleClose}
          initialCategory={initialCategory}
        />
      </>
    );
  }

  // 默认样式
  return (
    <>
      <button
        onClick={handleOpen}
        className={`
          ${sizeClasses[size].default}
          inline-flex items-center gap-2
          text-gray-600 dark:text-gray-300
          bg-gray-100 dark:bg-gray-800
          hover:bg-gray-200 dark:hover:bg-gray-700
          rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500
          ${className}
        `}
      >
        {FeedbackIcon}
        <span>{label || '意见反馈'}</span>
      </button>
      <FeedbackModal
        isOpen={isModalOpen}
        onClose={handleClose}
        initialCategory={initialCategory}
      />
    </>
  );
}
