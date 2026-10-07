import { test, expect } from '../fixtures/local-first-extension';

test('过期设置页导入保留后台最新学习记录并去重', async ({
  extContext, extensionId, seedUserState, sendRuntimeMessage, readLocalWordLists,
}) => {
  await seedUserState();
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html?tab=vocabulary`);
  const welcome = page.getByRole('dialog', { name: '欢迎使用 NotOnlyTranslator' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: '稍后再说' }).click();
  await expect(page.getByRole('button', { name: '导入词汇' })).toBeVisible();

  const previous = {
    word: 'apple', translation: '原有释义', context: '真实复习语境',
    markedAt: 1000, reviewCount: 3, lastReviewAt: 2000,
  };
  const response = await sendRuntimeMessage({ type: 'ADD_TO_VOCABULARY', payload: previous });
  expect(response.success, response.error).toBe(true);

  await page.getByRole('button', { name: '导入词汇' }).click();
  await page.getByLabel('选择要导入的 JSON 或 CSV 文件').setInputFiles({
    name: 'words.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify([
      { word: ' APPLE ', translation: '不能覆盖' },
      { word: 'book', translation: '书' },
      { word: 'BOOK', translation: '不能覆盖首条' },
    ])),
  });
  await expect.poll(async () => (await readLocalWordLists()).unknownWords.length).toBe(2);
  const stored = await readLocalWordLists();
  expect(stored.unknownWords).toEqual([
    previous,
    expect.objectContaining({ word: 'book', translation: '书' }),
  ]);
});

test('已知词不会通过批量导入变为生词', async ({
  seedUserState, sendRuntimeMessage, readLocalWordLists,
}) => {
  await seedUserState({ knownWords: ['apple'] });
  const response = await sendRuntimeMessage({
    type: 'IMPORT_VOCABULARY',
    payload: [{ word: 'apple', translation: '苹果' }],
  });
  expect(response).toMatchObject({ success: true, data: { imported: 0, skipped: 1 } });
  expect(await readLocalWordLists()).toEqual({ knownWords: ['apple'], unknownWords: [] });
});
