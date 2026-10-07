import type { UserSettings } from '../../src/shared/types';
import { test, expect } from '../fixtures/local-first-extension';

const hybridTranslation: NonNullable<UserSettings['hybridTranslation']> = {
  enabled: true,
  defaultEngine: 'traditional',
  traditionalProvider: 'deepl',
  traditionalApiKey: 'DEEPL_ONLY_LOCAL_E2E_KEY',
  simpleTextThreshold: 20,
  enableSmartRouting: true,
  priority: 'balanced',
};

test('断网设置页切换传统提供商清空旧密钥，同提供商编辑可保存并在刷新后保留', async ({
  extContext, extensionId, seedUserState, sendRuntimeMessage,
}) => {
  await seedUserState();
  const response = await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', expectedHybridCredentialsRevision: 0, payload: { hybridTranslation } });
  expect(response.success, response.error).toBe(true);
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/options/index.html?tab=engine`);
  const welcome = page.getByRole('dialog', { name: '欢迎使用 NotOnlyTranslator' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: '稍后再说' }).click();
  await expect(page.getByLabel('DeepL API 密钥')).toHaveValue(hybridTranslation.traditionalApiKey!);

  await page.getByRole('button', { name: /Google Translate/ }).click();
  await expect(page.getByLabel('Google Translate API 密钥')).toHaveValue('');
  const readHybrid = async () => (await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' })).data?.hybridTranslation;
  await expect.poll(readHybrid).toMatchObject({ traditionalProvider: 'google_translate', traditionalApiKey: '' });

  await page.getByLabel('Google Translate API 密钥').fill('GOOGLE_ONLY_LOCAL_E2E_KEY');
  await page.getByRole('button', { name: '保存传统翻译密钥' }).click();
  await expect.poll(readHybrid).toMatchObject({
    traditionalProvider: 'google_translate', traditionalApiKey: 'GOOGLE_ONLY_LOCAL_E2E_KEY',
  });
  await page.getByRole('button', { name: /Google Translate/ }).click();
  await expect(page.getByLabel('Google Translate API 密钥')).toHaveValue('GOOGLE_ONLY_LOCAL_E2E_KEY');
  await page.reload();
  await expect(page.getByLabel('Google Translate API 密钥')).toHaveValue('GOOGLE_ONLY_LOCAL_E2E_KEY');

  await page.getByRole('button', { name: /^DeepL/ }).click();
  await expect.poll(readHybrid).toMatchObject({ traditionalProvider: 'deepl', traditionalApiKey: '' });
});

test('断网后台 UPDATE_SETTINGS 拦截绕过 UI 的旧传统密钥改归属', async ({
  seedUserState, sendRuntimeMessage,
}) => {
  await seedUserState();
  const initial = await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', expectedHybridCredentialsRevision: 0, payload: { hybridTranslation } });
  expect(initial.success, initial.error).toBe(true);

  const changed = await sendRuntimeMessage({
    type: 'UPDATE_SETTINGS', expectedHybridCredentialsRevision: 1,
    payload: { hybridTranslation: { ...hybridTranslation, traditionalProvider: 'google_translate' } },
  });
  expect(changed.success, changed.error).toBe(true);
  const settings = await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' });
  expect(settings.data?.hybridTranslation).toMatchObject({
    traditionalProvider: 'google_translate', traditionalApiKey: '',
  });
});
