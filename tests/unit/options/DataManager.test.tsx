import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import DataManager from '@/options/components/DataManager';
import { clearAllData, getStorageStats, importFromJSON, validateImportData } from '@/shared/utils/dataExport';

vi.mock('@/shared/utils/dataExport', () => ({
  exportToJSON: vi.fn(),
  importFromJSON: vi.fn(),
  exportVocabularyToCSV: vi.fn(),
  clearAllData: vi.fn(),
  getStorageStats: vi.fn(),
  validateImportData: vi.fn(),
  DEFAULT_IMPORT_OPTIONS: {
    overwrite: false,
    importProfile: true,
    importSettings: true,
    importMastery: true,
    importCache: false,
    mergeVocabulary: true,
  },
}));
vi.mock('@/shared/utils', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(clearAllData).mockResolvedValue(undefined);
  vi.mocked(getStorageStats).mockResolvedValue({
    syncUsed: 512,
    localUsed: 2048,
    syncQuota: 1024,
    localQuota: 1048576,
  });
});

afterEach(() => cleanup());

async function showAdvanced(): Promise<void> {
  render(<DataManager />);
  fireEvent.click(screen.getByRole('tab', { name: '高级选项' }));
  await screen.findByRole('button', { name: '清除所有数据' });
}

describe('数据管理', () => {
  it('导入设置旁始终提醒联网服务可变化，且仍可自行取消选择', () => {
    render(<DataManager />);
    fireEvent.click(screen.getByRole('tab', { name: '导入数据' }));
    const checkbox = screen.getByRole('checkbox', { name: '导入用户设置' });
    expect(checkbox).toBeChecked();
    expect(checkbox).toHaveAttribute('aria-describedby', 'import-settings-warning');
    expect(screen.getByText(/导入设置可切换联网服务；导入后先检查提供商和翻译模式，敏感页面勿自动翻译/))
      .toBeVisible();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(screen.getByText(/导入设置可切换联网服务/)).toBeVisible();
    expect(importFromJSON).not.toHaveBeenCalled();
  });

  it('预览按所选类别校验，切换导入设置后立即更新当前文件结果', async () => {
    const backup = { version: '1.0.0', settings: { enabled: true, customApiUrl: 'http://localhost:7777/delete' } };
    vi.mocked(validateImportData).mockImplementation((_data, options) => options?.importSettings === false
      ? { valid: true, errors: [], warnings: [] }
      : { valid: false, errors: ['备份中的自定义 API 端点不可导入'], warnings: [] });
    render(<DataManager />);
    fireEvent.click(screen.getByRole('tab', { name: '导入数据' }));
    const file = new File([JSON.stringify(backup)], 'backup.json');
    const readFile = vi.fn().mockResolvedValue(JSON.stringify(backup));
    Object.defineProperty(file, 'text', { value: readFile });
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
    expect(await screen.findByText('文件验证失败')).toBeInTheDocument();
    expect(validateImportData).toHaveBeenLastCalledWith(backup, expect.objectContaining({ importSettings: true }));

    const checkbox = screen.getByRole('checkbox', { name: '导入用户设置' });
    fireEvent.click(checkbox);
    expect(await screen.findByText('文件验证通过')).toBeInTheDocument();
    expect(validateImportData).toHaveBeenLastCalledWith(backup, expect.objectContaining({ importSettings: false }));
    fireEvent.click(checkbox);
    expect(await screen.findByText('文件验证失败')).toBeInTheDocument();
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it('取消第一轮确认不会删除任何数据', async () => {
    await showAdvanced();
    fireEvent.click(screen.getByRole('button', { name: '清除所有数据' }));
    expect(clearAllData).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('确定要清除所有数据吗');

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(clearAllData).not.toHaveBeenCalled();
  });

  it('只有经过两次明确确认才清除数据', async () => {
    await showAdvanced();
    fireEvent.click(screen.getByRole('button', { name: '清除所有数据' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(clearAllData).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('再次确认');

    fireEvent.click(screen.getByRole('button', { name: '确定清除' }));
    await waitFor(() => expect(clearAllData).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toHaveTextContent('数据已清除，请刷新页面');
  });

  it('清除失败时显示错误且不显示成功', async () => {
    vi.mocked(clearAllData).mockRejectedValueOnce(new Error('存储拒绝写入'));
    await showAdvanced();
    fireEvent.click(screen.getByRole('button', { name: '清除所有数据' }));
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    fireEvent.click(screen.getByRole('button', { name: '确定清除' }));

    expect(await screen.findByRole('status')).toHaveTextContent('清除失败');
    expect(screen.queryByText('数据已清除，请刷新页面')).toBeNull();
  });

  it('高级选项显示同步和本地存储统计', async () => {
    await showAdvanced();
    await waitFor(() => expect(getStorageStats).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('progressbar', { name: /同步存储使用/ })).toHaveAttribute('aria-valuenow', '512');
    expect(screen.getByRole('progressbar', { name: /本地存储使用/ })).toHaveAttribute('aria-valuenow', '2048');
  });

  it('超大备份在读取前拒绝，避免解析阶段耗尽内存', async () => {
    render(<DataManager />);
    fireEvent.click(screen.getByRole('tab', { name: '导入数据' }));
    const file = new File(['x'], 'large.json');
    const readFile = vi.fn();
    Object.defineProperties(file, { size: { value: 17 * 1024 * 1024 }, text: { value: readFile } });
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
    expect(await screen.findByText('文件验证失败')).toBeInTheDocument();
    expect(screen.getByText(/文件过大/)).toBeInTheDocument();
    expect(readFile).not.toHaveBeenCalled();
  });

  it('读取备份失败时不向预览回显底层错误内容', async () => {
    render(<DataManager />);
    fireEvent.click(screen.getByRole('tab', { name: '导入数据' }));
    const file = new File(['x'], 'backup.json');
    Object.defineProperty(file, 'text', {
      value: () => Promise.reject(new Error('SECRET_SENTINEL')),
    });
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });
    expect(await screen.findByText('文件验证失败')).toBeInTheDocument();
    expect(screen.getByText(/文件解析失败/)).not.toHaveTextContent('SECRET_SENTINEL');
    expect(document.body).not.toHaveTextContent('SECRET_SENTINEL');
  });

  it('预览损坏备份文件时报告解析失败，且不执行导入', async () => {
    render(<DataManager />);
    fireEvent.click(screen.getByRole('tab', { name: '导入数据' }));
    const file = new File(['{broken'], 'backup.json');
    Object.defineProperty(file, 'text', { value: () => Promise.resolve('{broken') });
    fireEvent.change(screen.getByLabelText('选择文件'), { target: { files: [file] } });

    expect(await screen.findByText('文件验证失败')).toBeInTheDocument();
    expect(validateImportData).not.toHaveBeenCalled();
    expect(importFromJSON).not.toHaveBeenCalled();
  });
});
