import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ApiKeyWizard from '@/options/components/ApiKeyWizard';
import { getModels, testConnection } from '@/shared/services/modelService';

vi.mock('@/shared/services/modelService', () => ({ getModels: vi.fn(), testConnection: vi.fn() }));
vi.mock('@/shared/utils', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(testConnection).mockResolvedValue({ success: true });
  vi.mocked(getModels).mockResolvedValue([{ id: 'qwen3:4b', name: 'Qwen3 local', isRecommended: true }]);
});

function start(provider: RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: '开始设置' }));
  fireEvent.click(screen.getByRole('radio', { name: provider }));
  fireEvent.click(screen.getByRole('button', { name: '下一步' }));
}

describe('本地模型配置反馈', () => {
  it('Ollama 无密钥时仍加载已安装模型', async () => {
    render(<ApiKeyWizard onComplete={vi.fn()} />);
    start(/Ollama/);
    fireEvent.click(screen.getByRole('button', { name: /^(下一步|测试连接)$/ }));
    await waitFor(() => expect(getModels).toHaveBeenCalledWith('ollama', '', undefined, undefined));
    await expect(screen.findByRole('radio', { name: /Qwen3 local/ })).resolves.toBeTruthy();
  });

  it('Ollama 无密钥可完成连接、选模和保存', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined);
    render(<ApiKeyWizard onComplete={onComplete} />);
    start(/Ollama/);
    fireEvent.click(screen.getByRole('button', { name: /^(下一步|测试连接)$/ }));
    fireEvent.click(await screen.findByRole('button', { name: '完成设置' }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith({
      provider: 'ollama', apiKey: '', apiUrl: undefined, modelName: 'qwen3:4b', secondaryApiKey: undefined,
    }));
  });

  it('连接失败时展示错误，而不是留在当前页没有提示', async () => {
    vi.mocked(testConnection).mockResolvedValue({ success: false, error: '无法连接本地模型服务' });
    render(<ApiKeyWizard onComplete={vi.fn()} />);
    start(/^OpenAI/);
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: 'sk-fixture' } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('连接测试失败，请检查服务地址、模型和 API 密钥');
  });

  it.each(['response', 'throw'])('连接错误 %s 不在告警中回显密钥', async source => {
    const secret = 'sk-SYNTHETIC-CONNECTION-KEY';
    if (source === 'response') vi.mocked(testConnection).mockResolvedValue({ success: false, error: `Incorrect API key: ${secret}` });
    else vi.mocked(testConnection).mockRejectedValue(new TypeError(`Failed at endpoint?key=${secret}`));
    render(<ApiKeyWizard onComplete={vi.fn()} />);
    start(/^OpenAI/);
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: secret } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent(secret);
  });

  it('修改配置后清除上一轮连接错误', async () => {
    vi.mocked(testConnection).mockResolvedValue({ success: false, error: '连接失败' });
    render(<ApiKeyWizard onComplete={vi.fn()} />);
    start(/^OpenAI/);
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: 'sk-first' } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await screen.findByRole('alert');
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: 'sk-new' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('保存失败时给出明确重试提示', async () => {
    render(<ApiKeyWizard onComplete={vi.fn().mockRejectedValue(new Error('private failure'))} />);
    start(/^OpenAI/);
    fireEvent.change(screen.getByPlaceholderText(/sk-/i), { target: { value: 'sk-fixture' } });
    fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
    fireEvent.click(await screen.findByRole('button', { name: '完成设置' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存配置失败，请重试');
  });
});
