/**
 * ApiKeyWizard 组件测试
 *
 * 覆盖：欢迎步骤、服务商选择、密钥输入、模型选择、成功页
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockTestConnection = vi.fn();
const mockGetModels = vi.fn();

vi.mock('@/shared/services/modelService', () => ({
  testConnection: (...args: unknown[]) => mockTestConnection(...args),
  getModels: (...args: unknown[]) => mockGetModels(...args),
}));

vi.mock('@/shared/utils', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import ApiKeyWizard from '@/options/components/ApiKeyWizard';

describe('ApiKeyWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTestConnection.mockResolvedValue({ success: true });
    mockGetModels.mockResolvedValue([
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', isRecommended: true },
    ]);
  });

  describe('welcome 步骤', () => {
    it('默认渲染欢迎页', () => {
      render(<ApiKeyWizard onComplete={vi.fn()} />);
      expect(screen.getByText('设置 API 密钥')).toBeTruthy();
      expect(screen.getByText('开始设置')).toBeTruthy();
    });

    it('显示"稍后再说"按钮当提供 onSkip', () => {
      render(<ApiKeyWizard onComplete={vi.fn()} onSkip={vi.fn()} />);
      expect(screen.getByText('稍后再说')).toBeTruthy();
    });

    it('无 onSkip 时不显示跳过按钮', () => {
      render(<ApiKeyWizard onComplete={vi.fn()} />);
      expect(screen.queryByText('稍后再说')).toBeNull();
    });

    it('点击"稍后再说"调用 onSkip', () => {
      const onSkip = vi.fn();
      render(<ApiKeyWizard onComplete={vi.fn()} onSkip={onSkip} />);
      fireEvent.click(screen.getByText('稍后再说'));
      expect(onSkip).toHaveBeenCalled();
    });

    it('点击"开始设置"进入 provider 步骤', () => {
      render(<ApiKeyWizard onComplete={vi.fn()} />);
      fireEvent.click(screen.getByText('开始设置'));
      expect(screen.getByText('选择翻译服务商')).toBeTruthy();
    });
  });

  describe('provider 步骤', () => {
    function gotoProvider() {
      render(<ApiKeyWizard onComplete={vi.fn()} />);
      fireEvent.click(screen.getByText('开始设置'));
    }

    it('渲染服务商选择器', () => {
      gotoProvider();
      expect(screen.getByRole('radiogroup', { name: '选择翻译服务商' })).toBeTruthy();
    });

    it('渲染进度条', () => {
      gotoProvider();
      expect(screen.getByRole('progressbar')).toBeTruthy();
    });

    it('默认选中 openai', () => {
      gotoProvider();
      const radios = screen.getAllByRole('radio');
      const openaiRadio = radios.find((r) => r.textContent?.includes('OpenAI'));
      expect(openaiRadio).toBeTruthy();
      expect(openaiRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('点击切换选中服务商', () => {
      gotoProvider();
      const radios = screen.getAllByRole('radio');
      const deepseekRadio = radios.find((r) => r.textContent?.includes('DeepSeek'));
      if (deepseekRadio) {
        fireEvent.click(deepseekRadio);
        expect(deepseekRadio).toHaveAttribute('aria-checked', 'true');
      }
    });

    it('点击"上一步"回到 welcome', () => {
      gotoProvider();
      fireEvent.click(screen.getByText('上一步'));
      expect(screen.getByText('设置 API 密钥')).toBeTruthy();
    });

    it('点击"下一步"进入 apikey 步骤', () => {
      gotoProvider();
      fireEvent.click(screen.getByText('下一步'));
      expect(screen.queryByText('选择翻译服务商')).toBeNull();
    });
  });

  describe('apikey 步骤', () => {
    function gotoApiKey() {
      render(<ApiKeyWizard onComplete={vi.fn()} />);
      fireEvent.click(screen.getByText('开始设置'));
      fireEvent.click(screen.getByText('下一步'));
    }

    it('无 API key 时测试连接按钮禁用', () => {
      gotoApiKey();
      const nextBtn = screen.getByText('测试连接') as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(true);
    });

    it('输入 API key 后测试连接启用', () => {
      gotoApiKey();
      const input = screen.getByPlaceholderText(/sk-/i) || screen.getAllByRole('textbox')[0];
      fireEvent.change(input, { target: { value: 'sk-test-123' } });

      const nextBtn = screen.getByText('测试连接') as HTMLButtonElement;
      expect(nextBtn.disabled).toBe(false);
    });

    it('点击"上一步"回到 provider', () => {
      gotoApiKey();
      fireEvent.click(screen.getByText('上一步'));
      expect(screen.getByText('选择翻译服务商')).toBeTruthy();
    });
  });

  describe('测试连接流程', () => {
    it('测试成功后进入 model 步骤', async () => {
      render(<ApiKeyWizard onComplete={vi.fn()} />);
      fireEvent.click(screen.getByText('开始设置'));
      fireEvent.click(screen.getByText('下一步'));

      const input = screen.getByPlaceholderText(/sk-/i) || screen.getAllByRole('textbox')[0];
      fireEvent.change(input, { target: { value: 'sk-test-123' } });
      fireEvent.click(screen.getByText('测试连接'));

      await waitFor(() => {
        expect(mockTestConnection).toHaveBeenCalledWith(
          'openai',
          'sk-test-123',
          undefined,
          undefined,
          undefined
        );
      });

      await waitFor(
        () => {
          expect(screen.queryByText('选择翻译模型')).toBeTruthy();
        },
        { timeout: 2000 }
      );
    });

    it('测试失败不进入下一步', async () => {
      mockTestConnection.mockResolvedValueOnce({ success: false, error: 'Invalid key' });

      render(<ApiKeyWizard onComplete={vi.fn()} />);
      fireEvent.click(screen.getByText('开始设置'));
      fireEvent.click(screen.getByText('下一步'));

      const input = screen.getByPlaceholderText(/sk-/i) || screen.getAllByRole('textbox')[0];
      fireEvent.change(input, { target: { value: 'sk-bad' } });
      fireEvent.click(screen.getByText('测试连接'));

      await waitFor(() => {
        expect(mockTestConnection).toHaveBeenCalled();
      });

      // 不应进入 model 步骤
      await new Promise((r) => setTimeout(r, 700));
      expect(screen.queryByText('选择翻译模型')).toBeNull();
    });
  });

  describe('model 步骤', () => {
    async function gotoModel() {
      render(<ApiKeyWizard onComplete={vi.fn()} />);
      fireEvent.click(screen.getByText('开始设置'));
      fireEvent.click(screen.getByText('下一步'));

      const input = screen.getByPlaceholderText(/sk-/i) || screen.getAllByRole('textbox')[0];
      fireEvent.change(input, { target: { value: 'sk-test-123' } });
      fireEvent.click(screen.getByText('测试连接'));

      await waitFor(
        () => {
          expect(screen.queryByText('选择翻译模型')).toBeTruthy();
        },
        { timeout: 2000 }
      );
    }

    it('模型步骤渲染单选组', async () => {
      await gotoModel();
      expect(screen.getByRole('radiogroup', { name: '选择翻译模型' })).toBeTruthy();
    });

    it('显示完成设置按钮', async () => {
      await gotoModel();
      expect(screen.getByText('完成设置')).toBeTruthy();
    });

    it('点击上一步回到 apikey', async () => {
      await gotoModel();
      fireEvent.click(screen.getByText('上一步'));
      expect(screen.queryByText('选择翻译模型')).toBeNull();
    });
  });

  describe('保存配置', () => {
    it('完成设置调用 onComplete 并显示成功页', async () => {
      const onComplete = vi.fn(() => Promise.resolve());

      render(<ApiKeyWizard onComplete={onComplete} />);
      fireEvent.click(screen.getByText('开始设置'));
      fireEvent.click(screen.getByText('下一步'));

      const input = screen.getByPlaceholderText(/sk-/i) || screen.getAllByRole('textbox')[0];
      fireEvent.change(input, { target: { value: 'sk-final' } });
      fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

      await waitFor(() => expect(screen.queryByText('完成设置')).toBeTruthy(), {
        timeout: 2000,
      });

      fireEvent.click(screen.getByText('完成设置'));

      await waitFor(() => {
        expect(onComplete).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'openai',
            apiKey: 'sk-final',
          })
        );
      });

      await waitFor(() => {
        expect(screen.queryByText(/设置完成|完成/i)).toBeTruthy();
      });
    });

    it('保存失败不进入成功页', async () => {
      const onComplete = vi.fn(() => Promise.reject(new Error('save failed')));

      render(<ApiKeyWizard onComplete={onComplete} />);
      fireEvent.click(screen.getByText('开始设置'));
      fireEvent.click(screen.getByText('下一步'));

      const input = screen.getByPlaceholderText(/sk-/i) || screen.getAllByRole('textbox')[0];
      fireEvent.change(input, { target: { value: 'sk-test' } });
      fireEvent.click(screen.getByRole('button', { name: '测试连接' }));

      await waitFor(() => expect(screen.queryByText('完成设置')).toBeTruthy(), {
        timeout: 2000,
      });

      fireEvent.click(screen.getByText('完成设置'));

      await waitFor(() => expect(onComplete).toHaveBeenCalled());

      // 应保持在 model 步骤
      await new Promise((r) => setTimeout(r, 200));
      expect(screen.queryByText('完成设置')).toBeTruthy();
    });
  });
});
