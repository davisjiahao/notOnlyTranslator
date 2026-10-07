import { test, expect } from '../fixtures/local-first-extension';
import type { UserProfile, UserSettings } from '../../src/shared/types';

// 使用隔离扩展与拒绝外网的 fixture，不触发付费翻译或写入用户浏览器数据。
test('高亮键盘激活、分层关闭、标词撤销和焦点返回', async ({ seedUserState, openTestPage }, testInfo) => {
  await seedUserState(); // hoverDelay=0：禁用悬停也必须保留键盘入口。
  const site = await openTestPage();
  const word = site.locator('#para-alpha .not-translator-vocab-highlight').first();
  await expect(word).toBeVisible();
  await word.focus();
  await site.keyboard.press('Enter');
  const dialog = site.getByRole('dialog', { name: /词典与翻译/ });
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole('button', { name: /为不认识/ })).toBeVisible();
  await site.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '快捷键帮助' })).toBeFocused();
  await site.keyboard.press('Enter');
  await expect(site.getByRole('button', { name: '关闭快捷键帮助' })).toBeFocused();
  await site.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '快捷键帮助' })).toBeFocused();
  await site.keyboard.press('Escape');
  await expect(word).toBeFocused();
  await expect(dialog).toHaveCount(0);
  await site.keyboard.press('Space');
  await expect(dialog).toBeFocused();
  await site.keyboard.press('u');
  const undo = dialog.getByRole('button', { name: /撤销对/ });
  await expect(undo).toBeFocused();
  await expect(dialog).toHaveCSS('opacity', '1');
  await site.screenshot({ path: testInfo.outputPath('round2-tooltip-keyboard.png') });
  await site.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(word).toBeFocused();
});

test('API 键盘选择、估算保护与减少动画', async ({ extContext, extensionId, seedUserState, sendRuntimeMessage }, testInfo) => {
  await seedUserState({ estimatedVocabulary: 4500 });
  const initial = await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' });
  expect(initial).toMatchObject({ success: true, data: { apiConfigsRevision: expect.any(Number) } });
  const configured = await sendRuntimeMessage({
    type: 'UPDATE_SETTINGS',
    expectedApiConfigsRevision: initial.data!.apiConfigsRevision,
    payload: { apiProvider: 'openai', activeApiConfigId: 'first', apiConfigs: [
      { id: 'first', name: '主配置', provider: 'openai', apiKey: '', tested: true, createdAt: 1 },
      { id: 'second', name: '备用配置', provider: 'anthropic', apiKey: '', tested: true, createdAt: 2 },
    ] },
  });
  expect(configured.success).toBe(true);
  expect(await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' })).toMatchObject({
    success: true, data: { activeApiConfigId: 'first', apiConfigs: [{ id: 'first' }, { id: 'second' }] },
  });
  const popup = await extContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  const trigger = popup.getByRole('combobox', { name: /选择翻译服务配置/ });
  await trigger.focus();
  await popup.keyboard.press('ArrowUp');
  const firstId = await popup.getByRole('option', { name: /主配置/ }).getAttribute('id');
  await expect(trigger).toHaveAttribute('aria-activedescendant', firstId!);
  await popup.keyboard.press('End');
  const lastId = await popup.getByRole('option', { name: /备用配置/ }).getAttribute('id');
  await expect(trigger).toHaveAttribute('aria-activedescendant', lastId!);
  await popup.keyboard.press('Enter');
  await expect(trigger).toContainText('备用配置');
  await expect(trigger).toBeFocused();
  await popup.keyboard.press('ArrowDown');
  await popup.keyboard.press('Tab');
  await expect(popup.getByRole('listbox')).toHaveCount(0);
  expect((await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' })).data?.activeApiConfigId).toBe('second');

  const options = await extContext.newPage();
  await options.emulateMedia({ reducedMotion: 'reduce' });
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html?tab=level`);
  await expect(options.getByLabel('当前学习估算', { exact: true })).toContainText('4,500');
  await options.getByRole('spinbutton', { name: '考试分数数值' }).fill('600');
  await options.getByRole('button', { name: '保存考试信息' }).click();
  await expect(options.getByText('设置已保存', { exact: true })).toBeVisible();
  expect((await sendRuntimeMessage<UserProfile>({ type: 'GET_USER_PROFILE' })).data?.estimatedVocabulary).toBe(4500);
  await options.getByRole('checkbox', { name: /用此预览替换当前学习估算/ }).check();
  const preview = await options.getByLabel('考试推算预览').textContent();
  await options.getByRole('button', { name: '应用预览并保存' }).click();
  await expect(options.getByLabel('当前学习估算', { exact: true })).toContainText(preview!);
  await expect(options.getByRole('checkbox', { name: /用此预览替换当前学习估算/ })).not.toBeChecked();
  await options.getByRole('radio', { name: /CET-4/ }).focus();
  await expect(options.getByRole('radio', { name: /CET-4/ })).toHaveCSS('transition-duration', '0s');
  await options.screenshot({ path: testInfo.outputPath('round2-level-light.png') });
  await options.getByRole('tab', { name: '通用设置', exact: true }).click();
  await options.getByRole('radio', { name: /深色/ }).click();
  await options.getByRole('tab', { name: '英语水平', exact: true }).click();
  await expect(options.locator('html')).toHaveClass('dark');
  await options.setViewportSize({ width: 390, height: 844 });
  await options.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect.poll(() => options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await options.getByRole('button', { name: '关闭保存提示' }).click();
  await options.screenshot({ path: testInfo.outputPath('round2-level-dark-large-text.png'), fullPage: true });
});

test('减少动画仅作用于内容脚本自有元素', async ({ seedUserState, openTestPage }, testInfo) => {
  await seedUserState();
  const site = await openTestPage();
  await site.emulateMedia({ reducedMotion: 'reduce' });
  await site.locator('#lookup-apple').dblclick();
  const dialog = site.getByRole('dialog', { name: /词典与翻译/ });
  await expect(dialog.getByRole('button', { name: /为不认识/ })).toBeVisible();
  await expect(dialog).toHaveCSS('transition-duration', '0s');
  await site.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '@keyframes host-pulse { from { opacity: .5 } to { opacity: 1 } } #lookup-apple { animation: host-pulse 2s infinite; }';
    // 正常扫描会在宿主段落附加处理标记，不能因此禁用其子树的原生动画。
    document.querySelector('#para-simple')!.classList.add('not-translator-vocab-processed');
    document.head.appendChild(style);
  });
  await expect(site.locator('#lookup-apple')).toHaveCSS('animation-name', 'host-pulse');
  await site.screenshot({ path: testInfo.outputPath('round2-content-reduced-motion.png') });
});

test('免费引导完成后不重复，快捷入口与站点设置可用', async ({ extContext, extensionId, seedUserState, openTestPage, sendRuntimeMessage }, testInfo) => {
  await seedUserState();
  const initial = await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' });
  expect(initial).toMatchObject({ success: true, data: { apiConfigsRevision: expect.any(Number) } });
  const configured = await sendRuntimeMessage({
    type: 'UPDATE_SETTINGS',
    expectedApiConfigsRevision: initial.data!.apiConfigsRevision,
    payload: {
      autoHighlight: false,
      apiConfigs: [{ id: 'old', name: '旧配置', provider: 'openai', apiKey: '', tested: false, createdAt: 0 }],
    },
  });
  expect(configured.success).toBe(true);
  expect(await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' })).toMatchObject({
    success: true, data: { autoHighlight: false, apiConfigs: [{ id: 'old' }] },
  });
  const site = await openTestPage();
  const popup = await extContext.newPage();
  await popup.setViewportSize({ width: 360, height: 600 });
  await site.bringToFront();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popup.getByRole('button', { name: '无需 API Key，立即体验' }).click();
  await expect(popup.getByRole('dialog')).toHaveAccessibleName('已开启免费翻译');
  await popup.getByRole('button', { name: '开始使用', exact: true }).click();
  await expect(popup.getByText('Google 免费翻译', { exact: true })).toBeVisible();
  await popup.reload();
  await expect(popup.getByText('Google 免费翻译', { exact: true })).toBeVisible();
  await expect(popup.getByRole('dialog')).toHaveCount(0);
  await popup.getByRole('radio', { name: '双语对照' }).click();
  await expect(popup.getByRole('radio', { name: '双语对照' })).toHaveAttribute('aria-checked', 'true');
  await expect(popup.getByRole('dialog')).toHaveCount(0);

  await popup.getByRole('switch', { name: 'localhost 网站翻译' }).click();
  await popup.getByRole('button', { name: '稍后刷新' }).click();
  await expect(popup.getByRole('switch', { name: 'localhost 网站翻译' })).toHaveAttribute('aria-checked', 'false');
  const persisted = await sendRuntimeMessage<UserSettings>({ type: 'GET_SETTINGS' });
  expect(persisted.data?.blacklist).toContain('localhost');
  expect(persisted.data?.apiProvider).toBe('free_google_translate');
  await popup.screenshot({ path: testInfo.outputPath('popup-reading-first.png') });

  const opened = extContext.waitForEvent('page');
  await popup.getByRole('button', { name: '生词本 (0)' }).click();
  const vocabulary = await opened;
  await expect(vocabulary).toHaveURL(new RegExp(`/src/options/index.html\\?tab=vocabulary$`));
  await expect(vocabulary.getByRole('heading', { name: '生词本收藏', exact: true })).toBeVisible();
});

test('学习概览只有置信度说明按钮能展开说明浮层', async ({ extContext, extensionId, seedUserState, sendRuntimeMessage }) => {
  await seedUserState();
  await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'free_google_translate', autoHighlight: false } });
  const popup = await extContext.newPage();
  await popup.setViewportSize({ width: 360, height: 700 });
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  const overview = popup.getByText('学习概览', { exact: true });
  await overview.click();
  const explanation = popup.getByText('这是模型对词汇量估算的置信度，不是测试正确率；已标记认识也不等于复习掌握。', { exact: true });
  await popup.getByText('词汇量估算', { exact: true }).hover();
  await expect(explanation).toHaveCSS('opacity', '0');
  await overview.focus();
  await expect(explanation).toHaveCSS('opacity', '0');
  await popup.getByRole('button', { name: '置信度说明' }).focus();
  await expect(explanation).toHaveCSS('opacity', '1');
  await overview.focus();
  await expect(explanation).toHaveCSS('opacity', '0');
});

test('主题切换、窄窗口、键盘和保存失败反馈', async ({ extContext, extensionId, seedUserState, sendRuntimeMessage }, testInfo) => {
  await seedUserState();
  await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'free_google_translate', autoHighlight: false } });
  const options = await extContext.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html?tab=general`);
  await options.getByRole('radio', { name: /深色/ }).click();
  await expect(options.locator('html')).toHaveClass('dark');
  await options.reload();
  await expect(options.locator('html')).toHaveClass('dark');
  await options.screenshot({ path: testInfo.outputPath('options-dark.png') });
  await options.getByRole('tab', { name: '英语水平', exact: true }).click();
  const first = options.getByRole('radio', { name: 'CET-4 (大学英语四级)', exact: true });
  await expect(options.locator('html')).toHaveClass('dark');
  await first.focus();
  await options.keyboard.press('ArrowRight');
  await expect(options.getByRole('radio', { name: 'CET-6 (大学英语六级)', exact: true })).toHaveAttribute('aria-checked', 'true');
  await options.setViewportSize({ width: 390, height: 844 });
  await expect(options.getByLabel('设置页面')).toBeVisible();
  // 图表通过 ResizeObserver 异步适配宽度，等待实际布局收敛。
  await expect.poll(() => options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await options.screenshot({ path: testInfo.outputPath('options-narrow.png') });
  await options.getByLabel('设置页面').selectOption('general');
  await options.getByRole('switch', { name: '自动高亮', exact: true }).waitFor();
  await options.evaluate(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (async (message: { type: string }) => {
      if (message.type === 'UPDATE_SETTINGS') return { success: false, error: '回归测试故障注入' };
      return send(message);
    }) as typeof chrome.runtime.sendMessage;
  });
  await options.getByRole('switch', { name: '自动高亮', exact: true }).click();
  await expect(options.getByRole('alert')).toContainText('保存失败');
  await expect(options.getByRole('alert')).toHaveCSS('background-color', 'rgb(185, 28, 28)');
  await options.screenshot({ path: testInfo.outputPath('options-save-error.png') });
});

test('标词浮层不抢占网页编辑器的撤销', async ({ seedUserState, openTestPage, sendRuntimeMessage }, testInfo) => {
  await seedUserState();
  await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', payload: { autoHighlight: false } });
  const site = await openTestPage();
  await site.locator('#lookup-apple').dblclick();
  await site.getByRole('button', { name: '标记 apple 为不认识', exact: true }).waitFor();
  await site.screenshot({ path: testInfo.outputPath('content-tooltip.png') });
  const toolbar = await site.locator('.not-translator-tooltip-toolbar').boundingBox();
  const header = await site.locator('.not-translator-tooltip-header').boundingBox();
  expect(toolbar && header && toolbar.y + toolbar.height <= header.y).toBeTruthy();
  await site.getByRole('button', { name: '标记 apple 为不认识', exact: true }).click();
  const prevented = await site.evaluate(() => {
    const editor = document.createElement('textarea');
    document.body.appendChild(editor);
    editor.focus({ preventScroll: true });
    const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await expect(site.getByRole('button', { name: '撤销对「apple」的标记' })).toBeVisible();
  await site.getByRole('button', { name: '撤销对「apple」的标记' }).click();
  await expect.poll(async () => (await sendRuntimeMessage<{ word: string }[]>({ type: 'GET_VOCABULARY' })).data?.some(word => word.word === 'apple')).toBe(false);
});
