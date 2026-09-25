/**
 * ApiSettings 组件测试
 *
 * 覆盖：配置列表视图、添加/编辑/删除/选择配置
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { ApiConfig } from '@/shared/types';

vi.mock('@/shared/services/modelService', () => ({
  getModels: vi.fn(() => Promise.resolve([
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', isRecommended: true },
  ])),
  testConnection: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('@/shared/utils', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import ApiSettings from '@/options/components/ApiSettings';

function makeConfig(overrides?: Partial<ApiConfig>): ApiConfig {
  return {
    id: 'cfg-1',
    name: 'My OpenAI',
    provider: 'openai',
    apiKey: 'sk-test',
    tested: true,
    createdAt: Date.now(),
    ...overrides,
  };
}

const defaultProps = {
  apiKey: '',
  provider: 'openai' as const,
  apiConfigs: [],
  isSaving: false,
  onApiKeyUpdate: vi.fn(() => Promise.resolve()),
  onProviderUpdate: vi.fn(),
  onCustomSettingsUpdate: vi.fn(),
  onApiConfigsUpdate: vi.fn(),
};

describe('ApiSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('空配置列表', () => {
    it('显示空状态', () => {
      render(<ApiSettings {...defaultProps} />);
      expect(screen.getByText('还没有配置 API')).toBeTruthy();
      expect(screen.getByText('添加您的第一个 API 配置以开始使用')).toBeTruthy();
    });

    it('显示添加按钮', () => {
      render(<ApiSettings {...defaultProps} />);
      expect(screen.getByText('+ 添加配置')).toBeTruthy();
      expect(screen.getByText('添加第一个配置')).toBeTruthy();
    });

    it('点击添加按钮切换到添加模式', async () => {
      render(<ApiSettings {...defaultProps} />);
      fireEvent.click(screen.getByText('+ 添加配置'));
      await waitFor(() => {
        expect(screen.queryByText('还没有配置 API')).toBeNull();
      });
    });
  });

  describe('配置列表', () => {
    it('渲染已测试的配置', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.getByText('My OpenAI')).toBeTruthy();
    });

    it('不显示未测试的配置', () => {
      const configs = [makeConfig({ tested: false })];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.queryByText('My OpenAI')).toBeNull();
      expect(screen.getByText('还没有配置 API')).toBeTruthy();
    });

    it('显示供应商名称', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.getByText('My OpenAI')).toBeTruthy();
    });

    it('激活配置显示"使用中"标记', () => {
      const configs = [makeConfig()];
      render(
        <ApiSettings {...defaultProps} apiConfigs={configs} activeApiConfigId="cfg-1" />
      );
      expect(screen.getByText('使用中')).toBeTruthy();
    });

    it('非激活配置不显示"使用中"', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.queryByText('使用中')).toBeNull();
    });

    it('多个配置全部渲染', () => {
      const configs = [
        makeConfig({ id: 'c1', name: 'Config A' }),
        makeConfig({ id: 'c2', name: 'Config B' }),
        makeConfig({ id: 'c3', name: 'Config C' }),
      ];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);
      expect(screen.getByText('Config A')).toBeTruthy();
      expect(screen.getByText('Config B')).toBeTruthy();
      expect(screen.getByText('Config C')).toBeTruthy();
    });
  });

  describe('选择配置', () => {
    it('点击配置调用 onFullApiConfigUpdate', async () => {
      const onFullApiConfigUpdate = vi.fn(() => Promise.resolve());
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onFullApiConfigUpdate={onFullApiConfigUpdate}
        />
      );

      fireEvent.click(screen.getByText('My OpenAI'));

      await waitFor(() => {
        expect(onFullApiConfigUpdate).toHaveBeenCalledWith(
          expect.objectContaining({
            activeId: 'cfg-1',
            provider: 'openai',
            apiKey: 'sk-test',
          })
        );
      });
    });

    it('无 onFullApiConfigUpdate 时使用兼容性回退', async () => {
      const onApiKeyUpdate = vi.fn(() => Promise.resolve());
      const onProviderUpdate = vi.fn();
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];

      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onApiKeyUpdate={onApiKeyUpdate}
          onProviderUpdate={onProviderUpdate}
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByText('My OpenAI'));

      await waitFor(() => {
        expect(onApiKeyUpdate).toHaveBeenCalledWith('sk-test');
        expect(onProviderUpdate).toHaveBeenCalledWith('openai');
        expect(onApiConfigsUpdate).toHaveBeenCalledWith(configs, 'cfg-1');
      });
    });
  });

  describe('删除配置', () => {
    it('点击删除按钮显示确认框', () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);

      const deleteBtn = screen.getByLabelText('删除配置：My OpenAI');
      fireEvent.click(deleteBtn);

      expect(screen.getByText(/确定要删除配置/)).toBeTruthy();
      expect(screen.getByText('确定删除')).toBeTruthy();
      expect(screen.getByText('取消')).toBeTruthy();
    });

    it('确认删除调用 onApiConfigsUpdate 移除配置', () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('确定删除'));

      expect(onApiConfigsUpdate).toHaveBeenCalledWith([], undefined);
    });

    it('删除激活配置时清除 activeId', () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          activeApiConfigId="cfg-1"
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('确定删除'));

      expect(onApiConfigsUpdate).toHaveBeenCalledWith([], undefined);
    });

    it('删除非激活配置时保留 activeId', () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [
        makeConfig({ id: 'cfg-1', name: 'Active' }),
        makeConfig({ id: 'cfg-2', name: 'ToDelete' }),
      ];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          activeApiConfigId="cfg-1"
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：ToDelete'));
      fireEvent.click(screen.getByText('确定删除'));

      expect(onApiConfigsUpdate).toHaveBeenCalledWith(
        [configs[0]],
        'cfg-1'
      );
    });

    it('取消删除不调用更新', () => {
      const onApiConfigsUpdate = vi.fn();
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiConfigs={configs}
          onApiConfigsUpdate={onApiConfigsUpdate}
        />
      );

      fireEvent.click(screen.getByLabelText('删除配置：My OpenAI'));
      fireEvent.click(screen.getByText('取消'));

      expect(onApiConfigsUpdate).not.toHaveBeenCalled();
      expect(screen.queryByText(/确定要删除配置/)).toBeNull();
    });
  });

  describe('编辑配置', () => {
    it('点击编辑按钮进入编辑模式', async () => {
      const configs = [makeConfig()];
      render(<ApiSettings {...defaultProps} apiConfigs={configs} />);

      fireEvent.click(screen.getByLabelText('编辑配置：My OpenAI'));

      await waitFor(() => {
        // 编辑模式下应显示表单
        expect(screen.queryByText('+ 添加配置')).toBeNull();
      });
    });
  });

  describe('旧版兼容显示', () => {
    it('无激活配置但有 apiKey 时显示当前设置', () => {
      render(<ApiSettings {...defaultProps} apiKey="sk-legacy" />);
      expect(screen.getByText('当前 API 设置')).toBeTruthy();
    });

    it('有激活配置时不显示旧版当前设置', () => {
      const configs = [makeConfig()];
      render(
        <ApiSettings
          {...defaultProps}
          apiKey="sk-legacy"
          apiConfigs={configs}
          activeApiConfigId="cfg-1"
        />
      );
      expect(screen.queryByText('当前 API 设置')).toBeNull();
    });
  });
});
