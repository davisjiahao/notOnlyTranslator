import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateFeedbackForm,
  createFeedback,
  submitFeedback,
  submitQuickFeedback,
  getFeedbackHints,
  getFeedbackCategoryLabel,
  getRatingLabel
} from '@/shared/feedback/collector';
import type { FeedbackFormData, FeedbackCategory } from '@/shared/feedback/types';

// Mock chrome API
global.chrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn()
    },
    sync: {
      get: vi.fn(),
      set: vi.fn()
    }
  }
} as unknown as typeof chrome;

describe('Feedback Collector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateFeedbackForm', () => {
    it('应该验证有效的反馈表单', () => {
      const validData: FeedbackFormData = {
        category: 'bug',
        rating: 4,
        title: '这是一个有效的标题',
        description: '这是一个足够长的描述，满足最小长度要求。'
      };

      const result = validateFeedbackForm(validData);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('应该验证缺少标题的表单', () => {
      const invalidData: FeedbackFormData = {
        category: 'bug',
        rating: 4,
        title: '',
        description: '这是一个有效的描述'
      };

      const result = validateFeedbackForm(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('请填写反馈标题');
    });

    it('应该验证标题太短的情况', () => {
      const invalidData: FeedbackFormData = {
        category: 'bug',
        rating: 4,
        title: '短',
        description: '这是一个有效的描述'
      };

      const result = validateFeedbackForm(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('标题至少'))).toBe(true);
    });

    it('应该验证缺少描述的表单', () => {
      const invalidData: FeedbackFormData = {
        category: 'feature',
        rating: 3,
        title: '有效的标题',
        description: ''
      };

      const result = validateFeedbackForm(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('请填写详细描述');
    });

    it('应该验证描述太短的情况', () => {
      const invalidData: FeedbackFormData = {
        category: 'ux',
        rating: 5,
        title: '有效的标题',
        description: '短描述'
      };

      const result = validateFeedbackForm(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('描述至少'))).toBe(true);
    });

    it('应该验证无效的评分', () => {
      const invalidData: FeedbackFormData = {
        category: 'bug',
        rating: 0,
        title: '有效的标题',
        description: '这是一个有效的描述，满足最小长度要求。'
      };

      const result = validateFeedbackForm(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('请选择评分（1-5星）');
    });

    it('应该验证无效的邮箱格式', () => {
      const invalidData: FeedbackFormData = {
        category: 'other',
        rating: 3,
        title: '有效的标题',
        description: '这是一个有效的描述，满足最小长度要求。',
        email: 'invalid-email'
      };

      const result = validateFeedbackForm(invalidData);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('请输入有效的邮箱地址');
    });

    it('应该接受有效的邮箱格式', () => {
      const validData: FeedbackFormData = {
        category: 'other',
        rating: 3,
        title: '有效的标题',
        description: '这是一个有效的描述，满足最小长度要求。',
        email: 'user@example.com'
      };

      const result = validateFeedbackForm(validData);
      expect(result.valid).toBe(true);
    });

    it('应该接受空邮箱（可选）', () => {
      const validData: FeedbackFormData = {
        category: 'performance',
        rating: 3,
        title: '有效的标题',
        description: '这是一个有效的描述，满足最小长度要求。',
        email: ''
      };

      const result = validateFeedbackForm(validData);
      expect(result.valid).toBe(true);
    });
  });

  describe('createFeedback', () => {
    it('应该创建有效的反馈对象', async () => {
      const formData: FeedbackFormData = {
        category: 'bug',
        rating: 4,
        title: 'Bug报告',
        description: '发现了问题'
      };

      // Mock getAnonymousUserId
      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);

      const feedback = await createFeedback(formData);

      expect(feedback).toMatchObject({
        category: 'bug',
        rating: 4,
        title: 'Bug报告',
        description: '发现了问题',
        status: 'pending',
        synced: false
      });
      expect(feedback.id).toBeDefined();
      expect(feedback.createdAt).toBeGreaterThan(0);
      expect(feedback.browserInfo).toBeDefined();
    });

    it('应该包含邮箱信息', async () => {
      const formData: FeedbackFormData = {
        category: 'feature',
        rating: 5,
        title: '功能建议',
        description: '建议添加新功能',
        email: 'user@example.com'
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);

      const feedback = await createFeedback(formData);
      expect(feedback.email).toBe('user@example.com');
    });

    it('应该包含页面URL', async () => {
      const formData: FeedbackFormData = {
        category: 'ux',
        rating: 3,
        title: '体验问题',
        description: '界面不够友好'
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);

      const feedback = await createFeedback(formData, 'https://example.com/page');
      expect(feedback.pageUrl).toBe('https://example.com/page');
    });
  });

  describe('submitFeedback', () => {
    it('应该成功提交有效反馈', async () => {
      const formData: FeedbackFormData = {
        category: 'bug',
        rating: 4,
        title: 'Bug报告',
        description: '发现了问题，详细描述一下。'
      };

      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);
      vi.mocked(chrome.storage.local.get).mockResolvedValue({ userFeedbacks: [] });

      const result = await submitFeedback(formData);

      expect(result.success).toBe(true);
      expect(result.feedbackId).toBeDefined();
    });

    it('应该返回验证错误', async () => {
      const invalidData: FeedbackFormData = {
        category: 'bug',
        rating: 0, // 无效评分
        title: '', // 缺少标题
        description: '' // 缺少描述
      };

      const result = await submitFeedback(invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('submitQuickFeedback', () => {
    it('应该快速提交评分反馈', async () => {
      vi.mocked(chrome.storage.local.get).mockResolvedValue({});
      vi.mocked(chrome.storage.local.set).mockResolvedValue(undefined);

      const result = await submitQuickFeedback(5, 'bug');

      expect(result.success).toBe(true);
    });
  });

  describe('getFeedbackHints', () => {
    it('应该返回Bug类型的提示', () => {
      const hints = getFeedbackHints('bug');
      expect(hints).toHaveLength(4);
      expect(hints[0]).toContain('具体步骤');
    });

    it('应该返回功能建议类型的提示', () => {
      const hints = getFeedbackHints('feature');
      expect(hints).toHaveLength(3);
      expect(hints[0]).toContain('解决什么问题');
    });

    it('应该返回体验问题类型的提示', () => {
      const hints = getFeedbackHints('ux');
      expect(hints).toHaveLength(3);
      expect(hints[0]).toContain('页面');
    });

    it('应该返回性能问题类型的提示', () => {
      const hints = getFeedbackHints('performance');
      expect(hints).toHaveLength(3);
      expect(hints[0]).toContain('场景');
    });

    it('应该返回其他类型的默认提示', () => {
      const hints = getFeedbackHints('other');
      expect(hints).toHaveLength(2);
      expect(hints[0]).toContain('详细描述');
    });
  });

  describe('getFeedbackCategoryLabel', () => {
    it('应该返回正确的类别标签', () => {
      expect(getFeedbackCategoryLabel('bug')).toBe('Bug 反馈');
      expect(getFeedbackCategoryLabel('feature')).toBe('功能建议');
      expect(getFeedbackCategoryLabel('ux')).toBe('体验问题');
      expect(getFeedbackCategoryLabel('performance')).toBe('性能问题');
      expect(getFeedbackCategoryLabel('other')).toBe('其他');
    });
  });

  describe('getRatingLabel', () => {
    it('应该返回正确的评分标签', () => {
      expect(getRatingLabel(1)).toBe('非常不满意');
      expect(getRatingLabel(2)).toBe('不满意');
      expect(getRatingLabel(3)).toBe('一般');
      expect(getRatingLabel(4)).toBe('满意');
      expect(getRatingLabel(5)).toBe('非常满意');
    });

    it('应该返回未评分标签', () => {
      expect(getRatingLabel(0)).toBe('未评分');
      expect(getRatingLabel(6)).toBe('未评分');
    });
  });
});
