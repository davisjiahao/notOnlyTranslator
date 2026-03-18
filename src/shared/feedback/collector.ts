// 反馈收集器模块
import type {
  Feedback,
  FeedbackFormData,
  FeedbackCategory,
  FeedbackSubmitResult,
  BrowserInfo
} from './types';
import { saveFeedback } from './storage';
import { FEEDBACK_VALIDATION, EXTENSION_VERSION } from './constants';

/**
 * 生成唯一ID
 */
function generateId(): string {
  return `fb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取浏览器信息
 */
function getBrowserInfo(): BrowserInfo {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    screenResolution: `${window.screen.width}x${window.screen.height}`,
    viewportSize: `${window.innerWidth}x${window.innerHeight}`
  };
}

/**
 * 获取匿名用户ID
 */
async function getAnonymousUserId(): Promise<string> {
  try {
    const result = await chrome.storage.local.get('anonymousUserId');
    if (result.anonymousUserId) {
      return result.anonymousUserId;
    }

    // 生成新的匿名ID
    const newId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await chrome.storage.local.set({ anonymousUserId: newId });
    return newId;
  } catch (error) {
    console.error('获取用户ID失败:', error);
    return 'unknown';
  }
}

/**
 * 验证反馈表单数据
 */
export function validateFeedbackForm(data: FeedbackFormData): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 验证标题
  if (FEEDBACK_VALIDATION.title.required) {
    if (!data.title || data.title.trim().length === 0) {
      errors.push('请填写反馈标题');
    } else if (data.title.trim().length < FEEDBACK_VALIDATION.title.minLength) {
      errors.push(`标题至少需要 ${FEEDBACK_VALIDATION.title.minLength} 个字符`);
    } else if (data.title.trim().length > FEEDBACK_VALIDATION.title.maxLength) {
      errors.push(`标题不能超过 ${FEEDBACK_VALIDATION.title.maxLength} 个字符`);
    }
  }

  // 验证描述
  if (FEEDBACK_VALIDATION.description.required) {
    if (!data.description || data.description.trim().length === 0) {
      errors.push('请填写详细描述');
    } else if (data.description.trim().length < FEEDBACK_VALIDATION.description.minLength) {
      errors.push(`描述至少需要 ${FEEDBACK_VALIDATION.description.minLength} 个字符`);
    } else if (data.description.trim().length > FEEDBACK_VALIDATION.description.maxLength) {
      errors.push(`描述不能超过 ${FEEDBACK_VALIDATION.description.maxLength} 个字符`);
    }
  }

  // 验证评分
  if (data.rating < 1 || data.rating > 5) {
    errors.push('请选择评分（1-5星）');
  }

  // 验证邮箱（如果填写了）
  if (data.email && data.email.trim().length > 0) {
    if (!FEEDBACK_VALIDATION.email.pattern.test(data.email)) {
      errors.push('请输入有效的邮箱地址');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 创建反馈对象
 */
export async function createFeedback(
  formData: FeedbackFormData,
  pageUrl?: string
): Promise<Feedback> {
  const userId = await getAnonymousUserId();

  return {
    id: generateId(),
    category: formData.category,
    rating: formData.rating,
    title: formData.title.trim(),
    description: formData.description.trim(),
    email: formData.email?.trim() || undefined,
    createdAt: Date.now(),
    pageUrl: pageUrl || window.location.href,
    browserInfo: getBrowserInfo(),
    extensionVersion: EXTENSION_VERSION,
    userId,
    status: 'pending',
    synced: false
  };
}

/**
 * 提交反馈（本地存储）
 */
export async function submitFeedback(
  formData: FeedbackFormData,
  pageUrl?: string
): Promise<FeedbackSubmitResult> {
  try {
    // 验证表单
    const validation = validateFeedbackForm(formData);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.errors.join('；')
      };
    }

    // 创建反馈对象
    const feedback = await createFeedback(formData, pageUrl);

    // 保存到本地存储
    await saveFeedback(feedback);

    // 触发同步（异步执行，不阻塞返回）
    syncFeedbackToServer(feedback.id).catch(error => {
      console.error('反馈同步失败:', error);
    });

    return {
      success: true,
      feedbackId: feedback.id
    };
  } catch (error) {
    console.error('提交反馈失败:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : '提交反馈时发生未知错误'
    };
  }
}

/**
 * 同步反馈到服务器（预留接口，未来对接后端）
 */
async function syncFeedbackToServer(feedbackId: string): Promise<void> {
  // 当前版本仅本地存储，未来可扩展为同步到后端服务器
  // const feedback = await getFeedbackById(feedbackId);
  // if (!feedback) return;
  // const response = await fetch('/api/feedback', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(feedback)
  // });
  // if (response.ok) {
  //   await markFeedbacksAsSynced([feedbackId]);
  // }

  // 当前版本：标记为已同步（模拟）
  const { markFeedbacksAsSynced } = await import('./storage');
  await markFeedbacksAsSynced([feedbackId]);
}

/**
 * 快速反馈（简化版，用于快速提交评分）
 */
export async function submitQuickFeedback(
  rating: number,
  category: FeedbackCategory = 'other',
  description?: string
): Promise<FeedbackSubmitResult> {
  return submitFeedback({
    category,
    rating,
    title: `快速${category === 'bug' ? 'Bug' : '反馈'} - ${rating}星`,
    description: description || '用户通过快速反馈功能提交'
  });
}

/**
 * 初始化反馈收集器
 */
export function initFeedbackCollector(): void {
  // 监听浏览器信息变化（如窗口大小改变）
  window.addEventListener('resize', () => {
    // 浏览器信息会在创建反馈时实时获取，无需持久化
  });
}

/**
 * 获取反馈提交建议
 */
export function getFeedbackHints(category: FeedbackCategory): string[] {
  const hints: Record<FeedbackCategory, string[]> = {
    bug: [
      '请描述Bug发生的具体步骤',
      '预期结果是什么？实际结果是什么？',
      '这个问题是每次都发生还是偶尔发生？',
      '请提供相关的页面URL（如果适用）'
    ],
    feature: [
      '这个功能会解决什么问题？',
      '您期望这个功能如何工作？',
      '是否有其他产品实现了类似功能？'
    ],
    ux: [
      '您在哪个页面或功能遇到了困惑？',
      '您期望的操作流程是什么？',
      '是否有具体的改进建议？'
    ],
    performance: [
      '问题发生在什么场景下？（如：翻译长文本时）',
      '您的网络环境如何？',
      '问题出现的频率是？'
    ],
    other: [
      '请详细描述您的问题或建议',
      '如果有相关截图，可以发送到我们的邮箱'
    ]
  };

  return hints[category] || hints.other;
}

/**
 * 获取反馈类别标签
 */
export function getFeedbackCategoryLabel(category: FeedbackCategory): string {
  const labels: Record<FeedbackCategory, string> = {
    bug: 'Bug 反馈',
    feature: '功能建议',
    ux: '体验问题',
    performance: '性能问题',
    other: '其他'
  };
  return labels[category];
}

/**
 * 获取评分标签
 */
export function getRatingLabel(rating: number): string {
  const labels = ['', '非常不满意', '不满意', '一般', '满意', '非常满意'];
  return labels[rating] || '未评分';
}
