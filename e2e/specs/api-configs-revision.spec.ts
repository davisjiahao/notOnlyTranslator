import type { ApiConfig, MessageResponse, UserSettings } from '../../src/shared/types';
import { test, expect } from '../fixtures/local-first-extension';

const configA: ApiConfig = {
  id: 'offline-config-a',
  name: '离线配置 A',
  provider: 'openai',
  apiKey: 'FAKE_OFFLINE_E2E_KEY_A',
  apiUrl: 'https://offline-e2e.invalid/v1/chat/completions',
  modelName: 'gpt-4o-mini',
  tested: true,
  createdAt: 1,
};
const configB: ApiConfig = {
  ...configA,
  id: 'offline-config-b',
  name: '离线配置 B',
  provider: 'anthropic',
  apiKey: 'FAKE_OFFLINE_E2E_KEY_B',
  apiUrl: 'https://offline-e2e.invalid/v1/messages',
  modelName: 'claude-3-5-haiku-latest',
};

test('离线双设置页拒绝旧 API 配置数组，删除的凭据不复活并提示重载', async ({
  extContext, extensionId, seedUserState,
}, testInfo) => {
  let httpRequests: string[] = [];
  extContext.on('request', request => {
    if (/^https?:/.test(request.url())) {
      httpRequests = [...httpRequests, `${request.method()} ${request.url()}`];
    }
  });
  await seedUserState();
  await extContext.serviceWorkers()[0].evaluate(async apiConfigs => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({
      settings: { ...settings, apiConfigs, activeApiConfigId: apiConfigs[0].id, apiConfigsRevision: 0 },
    });
  }, [configA, configB]);
  await extContext.addInitScript(() => {
    if (location.protocol === 'chrome-extension:') localStorage.setItem('not_onboarding_completed', 'true');
  });

  const [firstPage, stalePage] = await Promise.all([extContext.newPage(), extContext.newPage()]);
  const settingsUrl = `chrome-extension://${extensionId}/src/options/index.html?tab=api`;
  await Promise.all([firstPage.goto(settingsUrl), stalePage.goto(settingsUrl)]);
  for (const page of [firstPage, stalePage]) {
    await expect(page.getByRole('button', { name: `编辑配置：${configA.name}`, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `编辑配置：${configB.name}`, exact: true })).toBeVisible();
  }

  const readSettings = () => stalePage.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }) as Promise<MessageResponse<UserSettings>>
  );
  const initial = await readSettings();
  expect(initial).toMatchObject({ success: true, data: { apiConfigs: [configA, configB], apiConfigsRevision: 0 } });

  await firstPage.getByRole('button', { name: `删除配置：${configA.name}`, exact: true }).click();
  await firstPage.getByRole('button', { name: '确定删除', exact: true }).click();
  await expect(firstPage.getByRole('button', { name: `编辑配置：${configA.name}`, exact: true })).toHaveCount(0);
  await expect.poll(readSettings).toMatchObject({ success: true, data: { apiConfigs: [configB], apiConfigsRevision: 1 } });
  const afterDelete = await stalePage.evaluate(() => chrome.storage.sync.get(['settings', 'apiKey']));

  // 旧页面仍持有 [A, B]；Anthropic 使用内置模型列表，tested:true 允许仅改名直接保存。
  await expect(stalePage.getByRole('button', { name: `编辑配置：${configA.name}`, exact: true })).toBeVisible();
  await stalePage.getByRole('button', { name: `编辑配置：${configB.name}`, exact: true }).click();
  const editedName = '离线配置 B（旧窗口未保存）';
  await stalePage.getByRole('textbox', { name: '配置名称', exact: true }).fill(editedName);
  const successNotice = stalePage.getByRole('status').filter({ hasText: /设置已保存|API 配置已保存|API 密钥已保存/ });
  await expect(successNotice).toHaveCount(0);
  await stalePage.getByRole('button', { name: '保存配置', exact: true }).click();

  const conflict = stalePage.getByRole('alert');
  await expect(conflict).toContainText('本次修改未保存');
  await expect(conflict).toContainText('重新加载会丢弃未保存内容');
  await expect(successNotice).toHaveCount(0);
  await expect(stalePage.getByRole('textbox', { name: '配置名称', exact: true })).toHaveValue(editedName);
  const afterConflict = await stalePage.evaluate(() => chrome.storage.sync.get(['settings', 'apiKey']));
  expect(afterConflict).toEqual(afterDelete);
  expect(afterConflict.settings.apiConfigs).toEqual([configB]);
  expect(JSON.stringify(afterConflict)).not.toContain(configA.apiKey);
  expect(await readSettings()).toMatchObject({ success: true, data: { apiConfigs: [configB], apiConfigsRevision: 1 } });

  const screenshot = testInfo.outputPath('stale-settings-conflict.png');
  await stalePage.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach('stale-settings-conflict', { path: screenshot, contentType: 'image/png' });
  await conflict.getByRole('button', { name: '重新加载设置', exact: true }).click();
  await expect(stalePage.getByRole('button', { name: `编辑配置：${configB.name}`, exact: true })).toBeVisible();
  await expect(stalePage.getByRole('button', { name: `编辑配置：${configA.name}`, exact: true })).toHaveCount(0);
  await expect(stalePage.getByRole('alert')).toHaveCount(0);
  await expect(successNotice).toHaveCount(0);
  expect(await stalePage.evaluate(() => chrome.storage.sync.get(['settings', 'apiKey']))).toEqual(afterDelete);
  expect(httpRequests, '设置操作不应发起任何 HTTP(S) 请求，拒绝代理仍作为网络兜底').toEqual([]);
  await testInfo.attach('api-configs-revision-evidence', {
    body: JSON.stringify({ initial, afterDelete, afterConflict, httpRequests }, null, 2),
    contentType: 'application/json',
  });
});
