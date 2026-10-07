import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import VocabularyExportImport from '@/options/components/VocabularyExportImport';
import type { UnknownWordEntry } from '@/shared/types';

vi.mock('@/shared/utils', () => ({ logger: { error: vi.fn() } }));

const sendMessage = vi.fn();
const existingWord: UnknownWordEntry = {
  word: 'apple',
  translation: '原有释义',
  context: 'original context',
  markedAt: 1000,
  reviewCount: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('chrome', { runtime: { sendMessage } });
  sendMessage.mockResolvedValue({ success: true, data: { imported: 1, skipped: 0 } });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function selectFile(name: string, content: string): void {
  const file = new File([content], name);
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  fireEvent.change(screen.getByLabelText('选择要导入的 JSON 或 CSV 文件'), {
    target: { files: [file] },
  });
}

function openImport(words: UnknownWordEntry[] = []): ReturnType<typeof vi.fn> {
  const onImportComplete = vi.fn();
  render(<VocabularyExportImport words={words} onImportComplete={onImportComplete} />);
  fireEvent.click(screen.getByRole('button', { name: '导入词汇' }));
  return onImportComplete;
}

describe('词汇 CSV 导出', () => {
  it('公式内容强制为文本且包含裸回车的字段整体引用', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:test');
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    sendMessage.mockResolvedValueOnce({ success: true, data: null });
    render(<VocabularyExportImport words={[
      { ...existingWord, word: '-ing', translation: ' =1+1', context: 'first\rforged' },
      { ...existingWord, word: "'cause", translation: '因为' },
    ]} onImportComplete={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '导出词汇' }));
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: '导出', exact: true }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(1));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(blob);
    });
    expect(text).toContain('"\' =1+1"');
    expect(text).toContain('"first\rforged"');
    expect(text).toContain('csvEncoding');
    expect(text).toContain('"\'-ing"');
    expect(text).toContain("''cause,因为");
  });
});

describe('词汇导入', () => {
  it('跳过已存在和文件内重复的词，保留原学习记录', async () => {
    sendMessage.mockResolvedValueOnce({ success: true, data: { imported: 1, skipped: 2 } });
    const onImportComplete = openImport([existingWord]);
    selectFile('vocabulary.json', JSON.stringify({ words: [
      { word: ' APPLE ', translation: '覆盖释义' },
      { word: 'Book', translation: '书' },
      { word: 'book', translation: '重复释义' },
    ] }));

    expect(await screen.findByRole('status')).toHaveTextContent('成功导入 1 个词汇，跳过 2 个');
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: expect.arrayContaining([
        expect.objectContaining({ word: 'apple', translation: '覆盖释义' }),
        expect.objectContaining({ word: 'book', translation: '书' }),
      ]),
    });
    expect(onImportComplete).toHaveBeenCalledTimes(1);
  });

  it('导入请求要求后台再次检查重复词，避免页面快照过期覆盖学习记录', async () => {
    openImport();
    selectFile('vocabulary.json', JSON.stringify([{ word: 'apple', translation: '苹果' }]));

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: [expect.objectContaining({ word: 'apple', translation: '苹果' })],
    });
  });

  it('CSV 中逗号和双引号保留在释义中', async () => {
    openImport();
    selectFile('vocabulary.csv', 'word,translation,context\nbook,"书, ""手册""","Read, and learn"');

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: [expect.objectContaining({
        word: 'book',
        translation: '书, "手册"',
        context: 'Read, and learn',
      })],
    });
  });

  it.each([
    ['不是词汇列表', JSON.stringify({ words: { word: 'apple' } })],
    ['缺少单词', JSON.stringify([{ translation: '苹果' }])],
    ['错误数字字段', JSON.stringify([{ word: 'apple', translation: '苹果', reviewCount: 'not a number' }])],
  ])('%s 时不写入存储', async (_label, content) => {
    const onImportComplete = openImport();
    selectFile('invalid.json', content);

    expect(await screen.findByRole('status')).toHaveTextContent('数据格式无效');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(onImportComplete).not.toHaveBeenCalled();
  });

  it('恢复原档案也失败时明确提示部分更新', async () => {
    sendMessage.mockResolvedValueOnce({
      success: false, error: '导入失败，部分档案可能已更新，请从备份恢复',
    });
    openImport();
    selectFile('vocabulary.json', JSON.stringify([{ word: 'apple', translation: '苹果' }]));
    expect(await screen.findByRole('status')).toHaveTextContent('部分档案可能已更新');
  });

  it('存储写入失败时显示错误，不伪装成跳过', async () => {
    sendMessage.mockResolvedValueOnce({ success: false, error: '存储失败' });
    const onImportComplete = openImport();
    selectFile('vocabulary.json', JSON.stringify([{ word: 'apple', translation: '苹果' }]));

    expect(await screen.findByRole('status')).toHaveTextContent('导入失败');
    expect(onImportComplete).not.toHaveBeenCalled();
  });

  it('自有安全 CSV 重导入还原原有连字符和单引号词条', async () => {
    sendMessage.mockResolvedValueOnce({ success: true, data: { imported: 2, skipped: 0 } });
    openImport();
    selectFile('vocabulary.csv', [
      'word,translation,context,csvEncoding',
      '"\'-ing",后缀,"\'- example",safe-v1',
      '"\'\'cause",因为,"\'\' original",safe-v1',
    ].join('\n'));
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: [
        expect.objectContaining({ word: '-ing', context: '- example' }),
        expect.objectContaining({ word: "'cause", context: "' original" }),
      ],
    });
  });

  it('自有 CSV 重导入保留释义和语境的首尾空白及空白后的单引号', async () => {
    openImport();
    selectFile('vocabulary.csv', 'word,translation,context,csvEncoding\nbook," alpha "," \'cause ",safe-v1');

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: [expect.objectContaining({ word: 'book', translation: ' alpha ', context: " 'cause " })],
    });
  });

  it('自有 CSV 重导入保留引号内语境的 CRLF', async () => {
    openImport();
    selectFile('vocabulary.csv', 'word,translation,context,csvEncoding\r\nbook,书,"first\r\nsecond",safe-v1');
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: [expect.objectContaining({ word: 'book', context: 'first\r\nsecond' })],
    });
  });

  it('自有 CSV 的安全前缀不占用释义长度上限', async () => {
    openImport();
    const translation = `=${'a'.repeat(9999)}`;
    selectFile('vocabulary.csv', `word,translation,csvEncoding\nbook,"'${translation}",safe-v1`);

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: [expect.objectContaining({ word: 'book', translation })],
    });
  });

  it('解码后超出释义长度上限的自有 CSV 不会写入', async () => {
    openImport();
    selectFile('vocabulary.csv', `word,translation,csvEncoding\nbook,"'=${'a'.repeat(10000)}",safe-v1`);
    expect(await screen.findByRole('status')).toHaveTextContent('数据格式无效');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('CSV 的跨行语境仍属于同一词条', async () => {
    openImport();
    selectFile('vocabulary.csv', 'word,translation,context\nbook,书,"first line\nhello, world"');

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'IMPORT_VOCABULARY',
      payload: [expect.objectContaining({ word: 'book', context: 'first line\nhello, world' })],
    });
  });

  it.each([
    ['重复词头', 'word,translation,word\nbook,书,apple'],
    ['闭引号后拼接文字', 'word,translation\n"book"x,书'],
  ])('CSV %s 时不发送任何导入消息', async (_label, csv) => {
    openImport();
    selectFile('vocabulary.csv', csv);
    expect(await screen.findByRole('status')).toHaveTextContent('数据格式无效');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('超过最大词条数时在构造词条对象前终止解析', async () => {
    openImport();
    const createRecord = vi.spyOn(Object, 'fromEntries');
    selectFile('vocabulary.csv', `word,translation\n${'w,t\n'.repeat(5001)}`);
    expect(await screen.findByRole('status')).toHaveTextContent('数据格式无效');
    expect(createRecord).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('CSV 缺少必需列时拒绝导入', async () => {
    openImport();
    selectFile('vocabulary.csv', 'word,context\nbook,example');

    expect(await screen.findByRole('status')).toHaveTextContent('数据格式无效');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('异常日期及无效复习次数不会破坏词表导出', async () => {
    openImport();
    selectFile('vocabulary.csv', 'word,translation,markedAt,reviewCount\nbook,书,invalid,1oops');

    expect(await screen.findByRole('status')).toHaveTextContent('数据格式无效');
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('过大的文件在读取前拒绝', async () => {
    openImport();
    const file = new File(['x'], 'vocabulary.json');
    const readFile = vi.fn();
    Object.defineProperties(file, { size: { value: 11 * 1024 * 1024 }, text: { value: readFile } });
    fireEvent.change(screen.getByLabelText('选择要导入的 JSON 或 CSV 文件'), {
      target: { files: [file] },
    });

    expect(await screen.findByRole('status')).toHaveTextContent('文件过大');
    expect(readFile).not.toHaveBeenCalled();
  });
});
