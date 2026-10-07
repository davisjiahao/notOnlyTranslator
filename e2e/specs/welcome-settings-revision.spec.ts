import type { ApiConfig, Message, MessageResponse, UserSettings } from '../../src/shared/types';
import { test, expect } from '../fixtures/local-first-extension';

const existingConfig: ApiConfig = {
  id: 'welcome-existing', name: '已有离线配置', provider: 'openai',
  apiKey: 'sk-welcome-existing-local-only', tested: false, createdAt: 1,
};

test.beforeEach(async ({ extContext, seedUserState }) => {
  await seedUserState();
  await extContext.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:') return;
    localStorage.setItem('not_onboarding_experiment_group', 'B');
    localStorage.removeItem('not_onboarding_completed');
    localStorage.removeItem('not_onboarding_skipped');
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    // 只替换外部连通性测试；设置读取、保存和冲突均经过真实后台。
    chrome.runtime.sendMessage = ((message: Message) => message.type === 'TEST_API_CONNECTION'
      ? Promise.resolve({ success: true })
      : sendMessage(message)) as typeof chrome.runtime.sendMessage;
  });
});

for (const caller of ['popup', 'options'] as const) {
  test(`${caller} 欢迎引导在真实后台版本校验下完成首次配置`, async ({ extContext, extensionId }) => {
    const page = await extContext.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/${caller}/index.html`);
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: caller === 'popup' ? '开始配置' : '开始设置', exact: true }).click();
    await dialog.getByLabel(caller === 'popup' ? 'API Key' : 'API 密钥', { exact: true }).fill('sk-welcome-e2e-local-only');
    await dialog.getByRole('button', { name: caller === 'popup' ? '完成配置' : '测试并保存', exact: true }).click();

    await expect(dialog.getByRole('heading', { name: caller === 'popup' ? '配置成功！' : '设置完成！' })).toBeVisible();
    const response = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }) as Promise<MessageResponse<UserSettings>>);
    expect(response).toMatchObject({ success: true, data: {
      apiConfigsRevision: 1,
      apiConfigs: [expect.objectContaining({ apiKey: 'sk-welcome-e2e-local-only', tested: true })],
    } });
    expect(response.data?.activeApiConfigId).toBe(response.data?.apiConfigs?.[0].id);
  });
}

test('popup 免费试用只切换提供商并保留并发更新的配置', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  const trial = page.getByRole('button', { name: '无需 API Key，立即体验' });
  await expect(trial).toBeVisible();
  const update = await page.evaluate(config => chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
    payload: { apiConfigs: [config], activeApiConfigId: config.id, theme: 'dark' },
  }), existingConfig);
  expect(update.success).toBe(true);

  await trial.click();

  await expect(page.getByRole('heading', { name: '已开启免费翻译' })).toBeVisible();
  const stored = await page.evaluate(() => chrome.storage.sync.get('settings'));
  expect(stored.settings).toMatchObject({
    apiProvider: 'free_google_translate', apiConfigs: [existingConfig],
    activeApiConfigId: existingConfig.id, apiConfigsRevision: 1, theme: 'dark',
  });
});

test('popup 旧快照保存被真实后台拒绝后不得进入成功状态', async ({ extContext, extensionId }) => {
  const page = await extContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await page.getByRole('button', { name: '开始配置', exact: true }).click();
  await page.getByLabel('API Key', { exact: true }).fill('sk-welcome-conflict-local-only');
  const update = await page.evaluate(config => chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS', expectedApiConfigsRevision: 0,
    payload: { apiConfigs: [config], activeApiConfigId: config.id },
  }), existingConfig);
  expect(update.success).toBe(true);

  await page.getByRole('button', { name: '完成配置', exact: true }).click();

  await expect(page.getByRole('alert')).toContainText('保存失败');
  await expect(page.getByRole('button', { name: '完成配置', exact: true })).toBeEnabled();
  await expect(page.getByRole('heading', { name: '配置成功！' })).toHaveCount(0);
  const stored = await page.evaluate(() => chrome.storage.sync.get('settings'));
  expect(stored.settings).toMatchObject({ apiConfigs: [existingConfig], apiConfigsRevision: 1 });
});
