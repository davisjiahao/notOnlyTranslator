import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import HybridTranslationSettings from '@/options/components/HybridTranslationSettings';
import { DEFAULT_SETTINGS } from '@/shared/constants';
import type { UserSettings } from '@/shared/types';

const settings: UserSettings & { hybridCredentialsRevision?: number } = {
  ...DEFAULT_SETTINGS,
  hybridCredentialsRevision: 7,
  hybridTranslation: {
    ...DEFAULT_SETTINGS.hybridTranslation!,
    enabled: true,
    defaultEngine: 'traditional',
    traditionalProvider: 'deepl',
    traditionalApiKey: 'DEEPL_ONLY_TEST_KEY',
  },
};

afterEach(cleanup);

describe('混合翻译设置只提交实际变更的字段', () => {
  it.each(['Google Translate', '有道翻译'])('切换至 %s 时，仅提交提供商变更与显式清键', name => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      hybridTranslationPatch: {
        traditionalProvider: name === 'Google Translate' ? 'google_translate' : 'youdao',
        traditionalApiKey: '',
      },
    }, 7);
    expect(settings.hybridTranslation?.traditionalApiKey).toBe('DEEPL_ONLY_TEST_KEY');
  });

  it('重复选择当前提供商不保存，也不回传可能过期的密钥', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /^DeepL/ }));

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it.each(['DEEPL_REPLACEMENT_KEY', '', '测试-密钥-特殊字符&='])('编辑密钥只提交用户输入，不复制其他字段：%s', async key => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.change(screen.getByLabelText('DeepL API 密钥'), { target: { value: key } });
    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存传统翻译密钥' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      hybridTranslationPatch: { traditionalApiKey: key },
    }, 7);
  });

  it('旧格式无凭据版本时，显式密钥编辑提交版本 0', async () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={{ ...settings, hybridCredentialsRevision: undefined }} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.change(screen.getByLabelText('DeepL API 密钥'), { target: { value: 'NEW_LOCAL_TEST_KEY' } });
    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存传统翻译密钥' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: { traditionalApiKey: 'NEW_LOCAL_TEST_KEY' } }, 0);
  });

  it('收到后台新快照后，密钥编辑使用新版本而不是首次渲染版本', async () => {
    const onUpdate = vi.fn(async () => undefined);
    const view = render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    view.rerender(<HybridTranslationSettings settings={{ ...settings, hybridCredentialsRevision: 9 }} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.change(screen.getByLabelText('DeepL API 密钥'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: '保存传统翻译密钥' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: { traditionalApiKey: '' } }, 9);
  });

  it('连续输入密钥只在明确保存后提交最终值，避免每个字符消耗凭据版本', async () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByLabelText('DeepL API 密钥'), { target: { value: 'NEW_' } });
    fireEvent.change(screen.getByLabelText('DeepL API 密钥'), { target: { value: 'NEW_KEY' } });
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存传统翻译密钥' })).not.toBeInTheDocument());
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: { traditionalApiKey: 'NEW_KEY' } }, 7);
  });

  it('编辑期间版本变化后保存仍使用原版本，冲突时保留密钥草稿', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('凭据已变更'));
    const view = render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByLabelText('DeepL API 密钥'), { target: { value: 'UNSAVED_KEY' } });
    view.rerender(<HybridTranslationSettings settings={{
      ...settings, hybridCredentialsRevision: 8,
      hybridTranslation: { ...settings.hybridTranslation!, traditionalApiKey: '' },
    }} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('button', { name: '保存传统翻译密钥' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('密钥未保存'));
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: { traditionalApiKey: 'UNSAVED_KEY' } }, 7);
    expect(screen.getByLabelText('DeepL API 密钥')).toHaveValue('UNSAVED_KEY');
  });

  it('提供商切换保存失败时保留未保存的密钥草稿并显示错误', async () => {
    const onUpdate = vi.fn().mockRejectedValue(new Error('凭据已变更'));
    render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.change(screen.getByLabelText('DeepL API 密钥'), { target: { value: 'UNSAVED_KEY' } });

    fireEvent.click(screen.getByRole('button', { name: /Google Translate/ }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('未保存'));
    expect(screen.getByLabelText('DeepL API 密钥')).toHaveValue('UNSAVED_KEY');
    expect(screen.getByRole('button', { name: '保存传统翻译密钥' })).toBeInTheDocument();
    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({
      hybridTranslationPatch: { traditionalProvider: 'google_translate', traditionalApiKey: '' },
    }, 7);
  });

  it.each([
    { name: '启用混合翻译', role: 'switch', updates: { enabled: false } },
    { name: '智能路由', role: 'switch', updates: { enableSmartRouting: false } },
    { name: 'LLM 大模型', role: 'button', updates: { defaultEngine: 'llm' } },
    { name: '传统翻译 使用', role: 'button', updates: { defaultEngine: 'traditional' } },
    { name: '质量优先', role: 'button', updates: { priority: 'quality' } },
    { name: '速度优先', role: 'button', updates: { priority: 'speed' } },
  ])('旧窗口调整 $name 仅提交该项，不能夹带过期密钥或提供商', ({ name, role, updates }) => {
    const hybridTranslation = Object.freeze({ ...settings.hybridTranslation!, defaultEngine: 'hybrid' as const });
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={{ ...settings, hybridTranslation }} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole(role, { name: new RegExp(name) }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: updates });
    expect(hybridTranslation.traditionalApiKey).toBe('DEEPL_ONLY_TEST_KEY');
  });

  it.each(['智能混合', '平衡模式'])('重复选择当前的 %s 不保存', name => {
    const hybridTranslation = { ...settings.hybridTranslation!, defaultEngine: 'hybrid' as const };
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={{ ...settings, hybridTranslation }} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('从传统引擎切换混合引擎仅提交引擎字段', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving={false} />);

    fireEvent.click(screen.getByRole('button', { name: /智能混合/ }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: { defaultEngine: 'hybrid' } });
  });

  it.each([5, 50])('文本阈值边界 %i 只提交阈值，显示/隐藏密钥不保存配置', threshold => {
    const hybridTranslation = { ...settings.hybridTranslation!, defaultEngine: 'hybrid' as const };
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={{ ...settings, hybridTranslation }} onUpdate={onUpdate} isSaving={false} />);
    fireEvent.click(screen.getByRole('button', { name: '显示 API 密钥' }));
    expect(screen.getByLabelText('DeepL API 密钥')).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: '隐藏 API 密钥' }));
    expect(screen.getByLabelText('DeepL API 密钥')).toHaveAttribute('type', 'password');
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('简单文本阈值'), { target: { value: String(threshold) } });

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: { simpleTextThreshold: threshold } });
  });

  it('首次启用没有混合设置的旧配置时，仅提交启用字段', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={{ ...settings, hybridTranslation: undefined }} onUpdate={onUpdate} isSaving={false} />);
    expect(screen.queryByLabelText('DeepL API 密钥')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: '启用混合翻译' }));

    expect(onUpdate).toHaveBeenCalledExactlyOnceWith({ hybridTranslationPatch: { enabled: true } });
  });

  it('保存中不能切换提供商', () => {
    const onUpdate = vi.fn(async () => undefined);
    render(<HybridTranslationSettings settings={settings} onUpdate={onUpdate} isSaving />);

    fireEvent.click(screen.getByRole('button', { name: /Google Translate/ }));

    expect(onUpdate).not.toHaveBeenCalled();
  });
});
