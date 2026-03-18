import { useState } from 'react';
import { RATING_CONFIG } from '../../../shared/feedback';

interface RatingStarsProps {
  rating: number;
  onChange: (rating: number) => void;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  disabled?: boolean;
}

/**
 * 评分星星组件
 * 支持1-5星评分，可交互选择
 */
export default function RatingStars({
  rating,
  onChange,
  size = 'md',
  showLabel = true,
  disabled = false
}: RatingStarsProps) {
  const [hoverRating, setHoverRating] = useState(0);

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8'
  };

  const containerClasses = {
    sm: 'gap-1',
    md: 'gap-1.5',
    lg: 'gap-2'
  };

  const currentRating = hoverRating || rating;

  const handleClick = (value: number) => {
    if (!disabled) {
      onChange(value);
    }
  };

  const handleMouseEnter = (value: number) => {
    if (!disabled) {
      setHoverRating(value);
    }
  };

  const handleMouseLeave = () => {
    setHoverRating(0);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`flex ${containerClasses[size]}`}
        onMouseLeave={handleMouseLeave}
      >
        {Array.from({ length: RATING_CONFIG.max }, (_, index) => {
          const value = index + 1;
          const isFilled = value <= currentRating;
          const isHovered = value <= hoverRating && hoverRating > 0;

          return (
            <button
              key={value}
              type="button"
              onClick={() => handleClick(value)}
              onMouseEnter={() => handleMouseEnter(value)}
              disabled={disabled}
              className={`
                ${sizeClasses[size]}
                transition-all duration-200 ease-out
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:scale-110'}
                ${isFilled ? 'text-yellow-400' : 'text-gray-300 dark:text-gray-600'}
                ${isHovered ? 'text-yellow-300' : ''}
                focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 rounded-sm
              `}
              aria-label={`${value}星`}
            >
              <svg
                viewBox="0 0 24 24"
                fill={isFilled ? 'currentColor' : 'none'}
                stroke="currentColor"
                strokeWidth={isFilled ? 0 : 2}
                className="w-full h-full"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                />
              </svg>
            </button>
          );
        })}
      </div>

      {showLabel && rating > 0 && (
        <span className="text-sm text-gray-600 dark:text-gray-400 font-medium">
          {RATING_CONFIG.labels[rating - 1]}
        </span>
      )}
    </div>
  );
}
