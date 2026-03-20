import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import FlashcardReview from '@/options/components/FlashcardReview';
import type { ReviewReminder, MasteryUpdateResult } from '@/shared/types/mastery';

// Mock logger
vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock review words data
const mockReviewWords: ReviewReminder[] = [
  {
    word: 'serendipity',
    masteryLevel: 0.6,
    daysOverdue: 0,
    context: 'The discovery was a serendipity.',
    translation: '意外发现美好事物的能力',
  },
  {
    word: 'ephemeral',
    masteryLevel: 0.4,
    daysOverdue: 2,
    context: 'Fashions are ephemeral.',
    translation: '短暂的，瞬息的',
  },
  {
    word: 'ubiquitous',
    masteryLevel: 0.7,
    daysOverdue: 0,
    context: 'Smartphones are now ubiquitous.',
    translation: '无处不在的',
  },
];

const mockMasteryUpdateResult: MasteryUpdateResult = {
  newMasteryLevel: 0.75,
  newConfidence: 0.8,
  nextReviewInterval: 3,
  levelUpgraded: false,
  newLevel: 'B2',
};

describe('FlashcardReview', () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSendMessage = vi.fn();
    Object.defineProperty(global, 'chrome', {
      value: {
        runtime: {
          sendMessage: mockSendMessage,
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('应该显示加载状态', async () => {
      // 延迟响应以测试加载状态
      mockSendMessage.mockImplementation(() => new Promise(() => {}));

      render(<FlashcardReview isSaving={false} />);

      expect(screen.getByText('加载复习单词...')).toBeInTheDocument();
      expect(document.querySelector('.animate-spin')).toBeInTheDocument();
    });

    it('加载完成后应该隐藏加载状态', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        data: mockReviewWords,
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.queryByText('加载复习单词...')).not.toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('没有复习单词时应该显示空状态', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        data: [],
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.getByText('没有需要复习的单词')).toBeInTheDocument();
      });

      expect(screen.getByText('太棒了！你当前的单词都还没到复习时间。继续浏览网页学习新单词吧。')).toBeInTheDocument();
    });

    it('空状态时应该显示庆祝图标', async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        data: [],
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.getByText('🎉')).toBeInTheDocument();
      });
    });
  });

  describe('card display', () => {
    beforeEach(async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        data: mockReviewWords,
      });
    });

    it('应该显示第一个单词', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        // 使用 text-4xl 类来定位卡片正面的单词（背面是 text-2xl）
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });
    });

    it('应该显示进度信息', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.getByText('卡片 1 / 3')).toBeInTheDocument();
        expect(screen.getByText('33%')).toBeInTheDocument();
      });
    });

    it('应该显示掌握度进度条', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.getByText('掌握度:')).toBeInTheDocument();
        expect(screen.getByText('60%')).toBeInTheDocument();
      });
    });

    it('逾期单词应该显示逾期提示', async () => {
      // 使用第二个单词（有逾期）
      mockSendMessage.mockResolvedValue({
        success: true,
        data: [mockReviewWords[1]],
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.getByText('已逾期 2 天')).toBeInTheDocument();
      });
    });

    it('未逾期单词不应该显示逾期提示', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.queryByText(/已逾期/)).not.toBeInTheDocument();
      });
    });

    it('应该显示翻转提示', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.getByText('点击卡片或按空格键查看释义')).toBeInTheDocument();
      });
    });
  });

  describe('card flip', () => {
    beforeEach(async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        data: mockReviewWords,
      });
    });

    it('点击卡片应该翻转显示释义', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 点击卡片 - 使用 cursor-pointer 类找到卡片容器
      const card = document.querySelector('.cursor-pointer');
      fireEvent.click(card!);

      // 应该显示释义
      await waitFor(() => {
        expect(screen.getByText('意外发现美好事物的能力')).toBeInTheDocument();
      });

      // 应该显示上下文
      expect(screen.getByText(/The discovery was a serendipity./)).toBeInTheDocument();
    });

    it('按空格键应该翻转卡片', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 按空格键
      fireEvent.keyDown(window, { code: 'Space' });

      // 应该显示释义
      await waitFor(() => {
        expect(screen.getByText('意外发现美好事物的能力')).toBeInTheDocument();
      });
    });

    it('翻转后应该显示评分按钮', async () => {
      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 翻转卡片
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('你对这个单词的掌握程度如何？（按数字键 1-5）')).toBeInTheDocument();
      });

      // 评分按钮应该显示
      expect(screen.getByText('完全忘记')).toBeInTheDocument();
      expect(screen.getByText('模糊记忆')).toBeInTheDocument();
      expect(screen.getByText('想起来')).toBeInTheDocument();
      expect(screen.getByText('比较熟练')).toBeInTheDocument();
      expect(screen.getByText('完全掌握')).toBeInTheDocument();
    });
  });

  describe('rating buttons', () => {
    beforeEach(async () => {
      mockSendMessage.mockImplementation((message: { type: string }) => {
        if (message.type === 'GET_REVIEW_WORDS') {
          return Promise.resolve({
            success: true,
            data: mockReviewWords,
          });
        }
        if (message.type === 'MARK_WORD_KNOWN') {
          return Promise.resolve({
            success: true,
            data: { masteryResult: mockMasteryUpdateResult },
          });
        }
        return Promise.resolve({ success: false });
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 翻转卡片
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('完全忘记')).toBeInTheDocument();
      });
    });

    it('点击评分按钮应该发送 MARK_WORD_KNOWN 消息', async () => {
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );

      fireEvent.click(rating5Button!);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          type: 'MARK_WORD_KNOWN',
          payload: {
            word: 'serendipity',
            context: 'The discovery was a serendipity.',
            translation: '意外发现美好事物的能力',
            isKnown: true,
            wordDifficulty: 3,
          },
        });
      });
    });

    it('评分 1-2 应该标记为不认识', async () => {
      const rating1Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('1')
      );

      fireEvent.click(rating1Button!);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'MARK_WORD_KNOWN',
            payload: expect.objectContaining({
              isKnown: false,
              wordDifficulty: 8,
            }),
          })
        );
      });
    });

    it('评分 3-4 应该标记为认识', async () => {
      const rating3Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('3')
      );

      fireEvent.click(rating3Button!);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'MARK_WORD_KNOWN',
            payload: expect.objectContaining({
              isKnown: true,
              wordDifficulty: 3,
            }),
          })
        );
      });
    });

    it('评分 5 应该标记为认识且难度最低', async () => {
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );

      fireEvent.click(rating5Button!);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'MARK_WORD_KNOWN',
            payload: expect.objectContaining({
              isKnown: true,
              wordDifficulty: 3,
            }),
          })
        );
      });
    });
  });

  describe('keyboard shortcuts', () => {
    beforeEach(async () => {
      mockSendMessage.mockImplementation((message: { type: string }) => {
        if (message.type === 'GET_REVIEW_WORDS') {
          return Promise.resolve({
            success: true,
            data: mockReviewWords,
          });
        }
        if (message.type === 'MARK_WORD_KNOWN') {
          return Promise.resolve({
            success: true,
            data: { masteryResult: mockMasteryUpdateResult },
          });
        }
        return Promise.resolve({ success: false });
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });
    });

    it('未翻转时数字键不应该触发评分', async () => {
      // 卡片未翻转，按数字键
      fireEvent.keyDown(window, { key: '5' });

      // 不应该发送 MARK_WORD_KNOWN
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MARK_WORD_KNOWN' })
      );
    });

    it('翻转后按数字键 1-5 应该触发评分', async () => {
      // 先翻转卡片
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('完全忘记')).toBeInTheDocument();
      });

      // 按数字键 5
      fireEvent.keyDown(window, { key: '5' });

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'MARK_WORD_KNOWN',
          })
        );
      });
    });

    it('应该显示键盘快捷键提示', async () => {
      await waitFor(() => {
        expect(screen.getByText('空格')).toBeInTheDocument();
        expect(screen.getByText('1-5')).toBeInTheDocument();
        expect(screen.getByText('翻转卡片')).toBeInTheDocument();
        expect(screen.getByText('评分')).toBeInTheDocument();
      });
    });
  });

  describe('skip button', () => {
    beforeEach(async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        data: mockReviewWords,
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });
    });

    it('应该显示跳过按钮', async () => {
      expect(screen.getByText('跳过')).toBeInTheDocument();
    });

    it('点击跳过应该显示下一个单词', async () => {
      fireEvent.click(screen.getByText('跳过'));

      await waitFor(() => {
        const nextWordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(nextWordElement?.textContent).toBe('ephemeral');
      });
    });

    it('跳过应该更新进度', async () => {
      fireEvent.click(screen.getByText('跳过'));

      await waitFor(() => {
        expect(screen.getByText('卡片 2 / 3')).toBeInTheDocument();
      });
    });
  });

  describe('completion state', () => {
    beforeEach(async () => {
      mockSendMessage.mockImplementation((message: { type: string }) => {
        if (message.type === 'GET_REVIEW_WORDS') {
          return Promise.resolve({
            success: true,
            data: [mockReviewWords[0]], // 只有一个单词
          });
        }
        if (message.type === 'MARK_WORD_KNOWN') {
          return Promise.resolve({
            success: true,
            data: { masteryResult: mockMasteryUpdateResult },
          });
        }
        return Promise.resolve({ success: false });
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 翻转卡片
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('完全忘记')).toBeInTheDocument();
      });
    });

    it('完成所有单词后应该显示完成界面', async () => {
      // 评分
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      // 等待 800ms 延迟后的状态更新
      await waitFor(() => {
        expect(screen.getByText('复习完成！')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('完成界面应该显示统计信息', async () => {
      // 评分
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      // 等待 800ms 延迟后的状态更新
      await waitFor(() => {
        expect(screen.getByText('总复习数')).toBeInTheDocument();
        expect(screen.getByText('熟练掌握')).toBeInTheDocument();
        expect(screen.getByText('平均评分')).toBeInTheDocument();
        expect(screen.getByText('掌握率')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('完成界面应该有再来一轮按钮', async () => {
      // 评分
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      // 等待 800ms 延迟后的状态更新
      await waitFor(() => {
        expect(screen.getByText('再来一轮')).toBeInTheDocument();
      }, { timeout: 2000 });
    });

    it('点击再来一轮应该重新加载单词', async () => {
      // 评分
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      // 等待 800ms 延迟后的状态更新
      await waitFor(() => {
        expect(screen.getByText('再来一轮')).toBeInTheDocument();
      }, { timeout: 2000 });

      // 点击再来一轮
      fireEvent.click(screen.getByText('再来一轮'));

      // 应该重新加载
      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'GET_REVIEW_WORDS',
        payload: { limit: 20 },
      });
    });
  });

  describe('statistics tracking', () => {
    beforeEach(async () => {
      mockSendMessage.mockImplementation((message: { type: string }) => {
        if (message.type === 'GET_REVIEW_WORDS') {
          return Promise.resolve({
            success: true,
            data: [mockReviewWords[0]],
          });
        }
        if (message.type === 'MARK_WORD_KNOWN') {
          return Promise.resolve({
            success: true,
            data: { masteryResult: mockMasteryUpdateResult },
          });
        }
        return Promise.resolve({ success: false });
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 翻转并评分
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('完全忘记')).toBeInTheDocument();
      });
    });

    it('应该正确计算平均评分', async () => {
      // 评分 5
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      // 等待 800ms 延迟后的状态更新
      await waitFor(() => {
        expect(screen.getByText('复习完成！')).toBeInTheDocument();
      }, { timeout: 2000 });

      // 平均评分应该是 5
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('评分 4-5 应该计入熟练掌握', async () => {
      // 评分 5 (熟练掌握)
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      await waitFor(() => {
        expect(screen.getByText('复习完成！')).toBeInTheDocument();
      });

      // 熟练掌握应该是 1
      const masteredCount = screen.getAllByText('1').find(el =>
        el.closest('.text-center')?.textContent?.includes('熟练掌握')
      );
      expect(masteredCount).toBeDefined();
    });

    it('应该显示评分分布', async () => {
      // 评分 5
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      await waitFor(() => {
        expect(screen.getByText('评分分布')).toBeInTheDocument();
      });

      // 评分分布标签
      expect(screen.getAllByText('完全掌握').length).toBeGreaterThan(0);
    });
  });

  describe('error handling', () => {
    it('加载失败时不应该崩溃', async () => {
      mockSendMessage.mockRejectedValue(new Error('Network error'));

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        expect(screen.getByText('没有需要复习的单词')).toBeInTheDocument();
      });
    });

    it('MARK_WORD_KNOWN 失败时不应该中断流程', async () => {
      mockSendMessage.mockImplementation((message: { type: string }) => {
        if (message.type === 'GET_REVIEW_WORDS') {
          return Promise.resolve({
            success: true,
            data: mockReviewWords,
          });
        }
        if (message.type === 'MARK_WORD_KNOWN') {
          return Promise.reject(new Error('Update failed'));
        }
        return Promise.resolve({ success: false });
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 翻转卡片
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('完全忘记')).toBeInTheDocument();
      });

      // 评分 - 使用 find 查找包含数字 5 的按钮
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      // 等待错误处理完成
      await waitFor(() => {
        // 组件不应该崩溃，当前单词应该仍然显示
        const currentWordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(currentWordElement?.textContent).toBe('serendipity');
      });

      // 验证跳过按钮恢复可点击状态（isSubmitting 被重置为 false）
      const skipButton = screen.getByText('跳过');
      expect(skipButton).not.toBeDisabled();
    });
  });

  describe('mastery update result display', () => {
    beforeEach(async () => {
      mockSendMessage.mockImplementation((message: { type: string }) => {
        if (message.type === 'GET_REVIEW_WORDS') {
          return Promise.resolve({
            success: true,
            data: mockReviewWords,
          });
        }
        if (message.type === 'MARK_WORD_KNOWN') {
          return Promise.resolve({
            success: true,
            data: {
              masteryResult: {
                ...mockMasteryUpdateResult,
                levelUpgraded: true,
                newLevel: 'C1',
              },
            },
          });
        }
        return Promise.resolve({ success: false });
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 翻转卡片
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('完全忘记')).toBeInTheDocument();
      });
    });

    it('应该显示下次复习时间', async () => {
      // 评分
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      await waitFor(() => {
        expect(screen.getByText('下次复习:')).toBeInTheDocument();
      });

      // 应该显示格式化的间隔
      expect(screen.getByText('3 天后')).toBeInTheDocument();
    });

    it('升级时应该显示升级提示', async () => {
      // 评分
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      await waitFor(() => {
        expect(screen.getByText(/升级!/)).toBeInTheDocument();
      });
    });
  });

  describe('progress bar', () => {
    beforeEach(async () => {
      mockSendMessage.mockResolvedValue({
        success: true,
        data: mockReviewWords,
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });
    });

    it('应该正确计算进度百分比', async () => {
      // 第一张卡片，共 3 张
      expect(screen.getByText('卡片 1 / 3')).toBeInTheDocument();
      expect(screen.getByText('33%')).toBeInTheDocument();
    });

    it('跳过卡片应该更新进度', async () => {
      fireEvent.click(screen.getByText('跳过'));

      await waitFor(() => {
        expect(screen.getByText('卡片 2 / 3')).toBeInTheDocument();
        expect(screen.getByText('67%')).toBeInTheDocument();
      });
    });
  });

  describe('time formatting', () => {
    beforeEach(async () => {
      mockSendMessage.mockImplementation((message: { type: string }) => {
        if (message.type === 'GET_REVIEW_WORDS') {
          return Promise.resolve({
            success: true,
            data: mockReviewWords,
          });
        }
        if (message.type === 'MARK_WORD_KNOWN') {
          return Promise.resolve({
            success: true,
            data: {
              masteryResult: {
                ...mockMasteryUpdateResult,
                nextReviewInterval: 0.5, // 半天
              },
            },
          });
        }
        return Promise.resolve({ success: false });
      });

      render(<FlashcardReview isSaving={false} />);

      await waitFor(() => {
        const wordElement = document.querySelector('.text-4xl.text-gray-800');
        expect(wordElement?.textContent).toBe('serendipity');
      });

      // 翻转卡片
      fireEvent.keyDown(window, { code: 'Space' });

      await waitFor(() => {
        expect(screen.getByText('完全忘记')).toBeInTheDocument();
      });
    });

    it('应该正确格式化小于1天的间隔', async () => {
      // 评分
      const rating5Button = screen.getAllByRole('button').find(
        btn => btn.textContent?.includes('5')
      );
      fireEvent.click(rating5Button!);

      await waitFor(() => {
        expect(screen.getByText('今天')).toBeInTheDocument();
      });
    });
  });
});
