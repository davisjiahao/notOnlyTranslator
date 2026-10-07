import { test, expect } from '../fixtures/local-first-extension';
import type { UserProfile } from '../../src/shared/types';
import type { MasteryProfile, WordMasteryStats } from '../../src/shared/types/mastery';

// 多页面完整旅程设置有界时限，不增加自动重试或任意等待。
test.setTimeout(120000);

// 使用真实后台与隔离存储；仅第三项显式拦截失败响应，不调用外部模型。
test('学习快照跨入口一致，历史不足明确说明，窄屏深色可读', async ({ extContext, extensionId, seedUserState, sendRuntimeMessage }, testInfo) => {
  await seedUserState({ knownWords: ['book', 'tree'], estimatedVocabulary: 4500 });
  await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'free_google_translate', theme: 'dark' } });
  const worker = extContext.serviceWorkers()[0];
  await worker.evaluate(async () => {
    const now = Date.now();
    const entries = [0.9, 0.5, 0.2].map((masteryLevel, index) => ({
      word: `sample${index}`, translation: '示例', context: 'A sample.', markedAt: now - 2 * 86400000,
      lastReviewAt: now, reviewCount: 2, masteryLevel, confidence: 0.6,
      knownCount: 2, unknownCount: 1, nextReviewAt: now + (index === 0 ? 86400000 : -86400000), estimatedLevel: 'B1' as const,
    }));
    await chrome.storage.local.set({ masteryProfile: { userId: 'fixture', wordMastery: Object.fromEntries(entries.map(entry => [entry.word, entry])), stats: {}, estimatedOverallLevel: 'B1', lastUpdatedAt: now } });
  });
  const options = await extContext.newPage();
  await options.emulateMedia({ reducedMotion: 'reduce' });
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html?tab=statistics`);
  await expect(options.getByText('到期待复习：2 词')).toBeVisible();
  await expect(options.getByText('尚未记录历史词汇量', { exact: false })).toBeVisible();
  await expect(options.getByRole('table', { name: '可追溯词条记录' })).toBeVisible();
  const snapshot = options.locator('section').filter({ has: options.getByRole('heading', { name: '当前掌握度', exact: true }) });
  await expect(snapshot.getByText('3', { exact: true })).toBeVisible();
  await expect(snapshot.getByText('1', { exact: true })).toHaveCount(3);
  await expect(options.locator('.recharts-wrapper')).toHaveCount(0);
  await options.screenshot({ path: testInfo.outputPath('round3-statistics-dark.png'), fullPage: true });

  const popup = await extContext.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
  await popup.getByText('学习概览', { exact: true }).click();
  const review = popup.getByRole('button', { name: '开始复习 (2)' });
  await expect(review).toBeVisible();
  const opened = extContext.waitForEvent('page');
  await review.click();
  const reviewPage = await opened;
  await expect(reviewPage).toHaveURL(/tab=review/);
  await expect(reviewPage.getByText('卡片 1 / 2')).toBeVisible();

  await options.setViewportSize({ width: 390, height: 844 });
  await options.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect.poll(() => options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(options.locator('html')).toHaveClass('dark');
  await options.screenshot({ path: testInfo.outputPath('round3-statistics-narrow-large.png'), fullPage: true });
});

test('网页收藏到筛选复习、确认前撤销、保存结果与移除恢复', async ({ extContext, extensionId, seedUserState, openTestPage, sendRuntimeMessage, readLocalWordLists }, testInfo) => {
  await seedUserState();
  await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', payload: { autoHighlight: false, apiProvider: 'free_google_translate' } });
  const site = await openTestPage();
  await site.locator('#lookup-apple').dblclick();
  await site.getByRole('button', { name: '将 apple 加入生词本', exact: true }).click();
  await expect.poll(async () => (await readLocalWordLists()).unknownWords.some(entry => entry.word === 'apple')).toBe(true);
  await sendRuntimeMessage({ type: 'ADD_TO_VOCABULARY', payload: { word: 'book', translation: '书', context: 'A book.', markedAt: 1, reviewCount: 0 } });
  const before = (await sendRuntimeMessage<UserProfile>({ type: 'GET_USER_PROFILE' })).data!;
  const options = await extContext.newPage();
  await options.emulateMedia({ reducedMotion: 'reduce' });
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html?tab=vocabulary`);
  await options.getByRole('textbox', { name: '搜索单词或翻译' }).fill('apple');
  await options.getByRole('button', { name: '复习筛选结果（1）' }).click();
  const card = options.getByRole('button', { name: '点击或按空格查看释义' });
  await expect(card).toBeFocused();
  await options.keyboard.press('Space');
  await options.keyboard.press('5');
  await options.getByRole('button', { name: '撤销本题评分' }).click();
  await expect(options.getByRole('button', { name: '查看释义' })).toBeFocused();
  expect((await sendRuntimeMessage<UserProfile>({ type: 'GET_USER_PROFILE' })).data?.estimatedVocabulary).toBe(before.estimatedVocabulary);
  expect((await readLocalWordLists()).knownWords).not.toContain('apple');
  await options.keyboard.press('4');
  await options.setViewportSize({ width: 390, height: 844 });
  await options.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect.poll(() => options.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await options.screenshot({ path: testInfo.outputPath('round3-review-narrow.png'), fullPage: true });
  await options.getByRole('button', { name: '确认保存评分' }).click();
  await expect(options.getByRole('status')).toContainText('评分已保存');
  await expect(options.getByRole('button', { name: '查看本轮结果' })).toBeFocused();
  expect((await readLocalWordLists()).knownWords).toContain('apple');
  const overview = await sendRuntimeMessage<{ profile: MasteryProfile; stats: WordMasteryStats }>({ type: 'GET_MASTERY_OVERVIEW' });
  expect(overview.data?.profile.wordMastery.apple.knownCount).toBe(1);
  await options.keyboard.press('Enter');
  await expect(options.getByRole('heading', { name: '本轮已结束' })).toBeFocused();
  await expect(options.getByRole('status')).toContainText('已保存 1 个评分，跳过 0 个');
  await options.getByRole('button', { name: '返回生词本' }).click();
  await expect(options.getByText('未找到匹配的词汇')).toBeVisible();
  await options.getByRole('button', { name: '清除筛选' }).click();
  await options.getByRole('button', { name: '移除：book' }).click();
  await options.getByRole('button', { name: '撤销移除' }).click();
  await expect(options.getByRole('button', { name: '移除：book' })).toBeVisible();
  expect((await readLocalWordLists()).unknownWords.find(entry => entry.word === 'book')?.markedAt).toBe(1);
});

test('故障注入：加载和评分失败不伪装成功，重试后保存并刷新统计', async ({ extContext, extensionId, seedUserState, sendRuntimeMessage, readLocalWordLists }, testInfo) => {
  await seedUserState({ knownWords: ['apple'] });
  await sendRuntimeMessage({ type: 'UPDATE_SETTINGS', payload: { apiProvider: 'free_google_translate' } });
  await sendRuntimeMessage({ type: 'ADD_TO_VOCABULARY', payload: { word: 'apple', translation: '苹果', context: 'An apple.', markedAt: 1000, reviewCount: 0 } });
  const options = await extContext.newPage();
  await options.addInitScript(() => {
    const fault = window as unknown as { blockedMessages: string[] };
    fault.blockedMessages = ['GET_VOCABULARY', 'MARK_WORD_KNOWN'];
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (async (message: { type: string }) => fault.blockedMessages.includes(message.type)
      ? { success: false, error: '显式测试故障' } : send(message)) as typeof chrome.runtime.sendMessage;
  });
  const unblock = (types: string[]) => options.evaluate(value => { (window as unknown as { blockedMessages: string[] }).blockedMessages = value; }, types);
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html?tab=vocabulary`);
  await expect(options.getByRole('alert')).toContainText('加载生词本失败');
  await unblock(['MARK_WORD_KNOWN']);
  await options.getByRole('button', { name: '重试加载' }).click();
  await options.getByRole('button', { name: '开始复习（1）' }).click();
  await options.getByRole('button', { name: '点击或按空格查看释义' }).click();
  await options.getByRole('button', { name: /^1 -/ }).click();
  await options.getByRole('button', { name: '确认保存评分' }).click();
  await expect(options.getByRole('alert')).toContainText('未确认保存成功');
  await expect(options.getByText('卡片 1 / 1')).toBeVisible();
  await expect(options.getByText('本轮已结束')).toHaveCount(0);
  await options.screenshot({ path: testInfo.outputPath('round3-review-save-error.png') });
  await unblock([]);
  await options.getByRole('button', { name: '确认保存评分' }).click();
  await options.getByRole('button', { name: '查看本轮结果' }).click();
  await expect(options.getByRole('status')).toContainText('已保存 1 个评分，跳过 0 个');
  expect((await readLocalWordLists()).unknownWords[0].markedAt).toBe(1000);
  await unblock(['GET_MASTERY_OVERVIEW']);
  await options.getByRole('tab', { name: '学习统计', exact: true }).click();
  await expect(options.getByRole('alert')).toContainText('加载学习数据失败');
  await expect(options.getByText('跟踪词汇', { exact: true })).toHaveCount(0);
  await unblock([]);
  await options.getByRole('button', { name: '刷新数据' }).click();
  await expect(options.getByText('跟踪词汇', { exact: true })).toBeVisible();
  await expect(options.getByText('所选范围没有可追溯记录')).toBeVisible();
});
