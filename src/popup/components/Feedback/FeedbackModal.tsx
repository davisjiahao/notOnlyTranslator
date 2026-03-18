import { useState, useCallback } from 'react';
import {
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackFormData,
  validateFeedbackForm,
  submitFeedback,
  getFeedbackHints
} from '../../../shared/feedback';
import RatingStars from './RatingStars';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: FeedbackCategory;
}

/**
 * 反馈提交弹窗组件
 */
export default function FeedbackModal({
  isOpen,
  onClose,
  initialCategory = 'other'
}: FeedbackModalProps) {
  const [formData, setFormData] = useState<FeedbackFormData>({
    category: initialCategory,
    rating: 0,
    title: '',
    description: '',
    email: ''
  });

  const [errors, setErrors] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      // 重置表单状态
      setFormData({
        category: initialCategory,
        rating: 0,
        title: '',
        description: '',
        email: ''
      });
      setErrors([]);
      setSubmitResult(null);
      onClose();
    }
  }, [isSubmitting, initialCategory, onClose]);

  const handleInputChange = useCallback(
    (field: keyof FeedbackFormData, value: string | number) => {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }));
      // 清除之前的错误
      if (errors.length > 0) {
        setErrors([]);
      }
      // 清除提交结果
      if (submitResult) {
        setSubmitResult(null);
      }
    },
    [errors, submitResult]
  );

  const handleSubmit = useCallback(async () => {
    // 验证表单
    const validation = validateFeedbackForm(formData);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setIsSubmitting(true);
    setErrors([]);

    try {
      const result = await submitFeedback(formData);

      if (result.success) {
        setSubmitResult({
          success: true,
          message: '感谢您的反馈！我们会认真阅读每一条建议。'
        });
        // 3秒后自动关闭
        setTimeout(() => {
          handleClose();
        }, 3000);
      } else {
        setSubmitResult({
          success: false,
          message: result.error || '提交失败，请稍后重试'
        });
      }
    } catch (error) {
      setSubmitResult({
        success: false,
        message: '提交过程中发生错误，请稍后重试'
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [formData, handleClose]);

  // 获取当前类别的提示
  const hints = getFeedbackHints(formData.category);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={handleClose}
      />

      {/* 弹窗内容 */}
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-800 rounded-xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            意见反馈
          </h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg transition-colors disabled:opacity-50"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 提交成功状态 */}
        {submitResult?.success ? (
          <div className="px-6 py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
              提交成功！
            </h3>
            <p className="text-gray-600 dark:text-gray-400">
              {submitResult.message}
            </p>
          </div>
        ) : (
          <>
            {/* 表单内容 */}
            <div className="px-6 py-4 space-y-5">
              {/* 评分区域 */}
              <div className="text-center">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  您对本插件的满意度如何？
                </label>
                <RatingStars
                  rating={formData.rating}
                  onChange={rating => handleInputChange('rating', rating)}
                  size="lg"
                />
              </div>

              {/* 反馈类型 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  反馈类型 <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(FEEDBACK_CATEGORIES) as FeedbackCategory[]).map(category => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => handleInputChange('category', category)}
                      className={`
                        px-3 py-2 text-sm rounded-lg border transition-all text-left
                        ${formData.category === category
                          ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                          : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                        }
                      `}
                    >
                      {FEEDBACK_CATEGORIES[category].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 标题 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  标题 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={e => handleInputChange('title', e.target.value)}
                  placeholder="简要描述您的问题或建议"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  maxLength={100}
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  详细描述 <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formData.description}
                  onChange={e => handleInputChange('description', e.target.value)}
                  placeholder={hints.join('\n')}
                  rows={5}
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  maxLength={2000}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 text-right">
                  {formData.description.length}/2000
                </p>
              </div>

              {/* 邮箱（可选） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  联系邮箱 <span className="text-gray-400">（可选）</span>
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => handleInputChange('email', e.target.value)}
                  placeholder="如需回复，请留下您的邮箱"
                  className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* 错误提示 */}
              {errors.length > 0 && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <ul className="text-sm text-red-600 dark:text-red-400 space-y-1">
                    {errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 提交错误 */}
              {submitResult?.success === false && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {submitResult.message}
                  </p>
                </div>
              )}
            </div>

            {/* 底部按钮 */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
              <button
                onClick={handleClose}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || formData.rating === 0}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    提交中...
                  </>
                ) : (
                  '提交反馈'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
