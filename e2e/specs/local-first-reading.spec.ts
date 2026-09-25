import type { Page } from '@playwright/test';
import type { TranslationResult } from '../../src/shared/types';
import { test, expect } from '../fixtures/local-first-extension';

const VOCAB_MARK = 'mark.not-translator-vocab-highlight';
const WORDS = {
  known: 'democratization',
  peer: 'interdisciplinary',
  restore: 'counterintuitive',
} as const;

function vocabMark(page: Page, word: string) {
  return page.locator(`${VOCAB_MARK}[data-word="${word}"]`);
}

async function expectReady(page: Page): Promise<void> {
  await expect(page.locator('body')).toHaveAttribute('data-extension-loaded', 'true');
  await expect(vocabMark(page, WORDS.peer)).toHaveCount(1);
}

test.describe('本地优先阅读回归', () => {
  test('本地管线高亮超水平词汇，常见词不高亮', async ({ seedUserState, openTestPage }) => {
    await seedUserState();
    const page = await openTestPage();
    await expectReady(page);
    await expect(vocabMark(page, WORDS.known)).toHaveCount(1);
    await expect(vocabMark(page, WORDS.restore)).toHaveCount(1);
    await expect(vocabMark(page, WORDS.peer)).toHaveAttribute('data-level', 'B2');
    await expect(page.locator(`#para-simple ${VOCAB_MARK}`)).toHaveCount(0);
  });

  test('已存入 storage 的已知词在初始扫描时不高亮', async ({ seedUserState, openTestPage }) => {
    await seedUserState({ knownWords: [WORDS.known] });
    const page = await openTestPage();
    await expectReady(page);
    await expect(page.locator(`[data-word="${WORDS.known}"]`)).toHaveCount(0);
    await expect(page.locator('#para-alpha')).toContainText(WORDS.known);
  });

  test('MARK_WORD_KNOWN 跨页面还原普通文本且 reload 后保持', async ({
    seedUserState, openTestPage, sendRuntimeMessage, readLocalWordLists,
  }) => {
    await seedUserState();
    const pageA = await openTestPage();
    const pageB = await openTestPage();
    for (const page of [pageA, pageB]) {
      await expect(vocabMark(page, WORDS.known)).toHaveCount(1);
    }

    const response = await sendRuntimeMessage({
      type: 'MARK_WORD_KNOWN',
      payload: { word: WORDS.known, context: 'Synthetic E2E reading passage', translation: '民主化' },
    });
    expect(response.success, response.error).toBe(true);

    for (const page of [pageA, pageB]) {
      await expect(page.locator(`[data-word="${WORDS.known}"]`)).toHaveCount(0);
      await expect(page.locator('#para-alpha')).toContainText(WORDS.known);
      await expect(vocabMark(page, WORDS.peer)).toHaveCount(1);
    }
    await expect.poll(async () => (await readLocalWordLists()).knownWords).toContain(WORDS.known);

    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await expectReady(pageA);
    await expect(pageA.locator(`[data-word="${WORDS.known}"]`)).toHaveCount(0);
  });

  test('MARK_WORD_UNKNOWN 跨页面恢复高亮且 reload 后保持', async ({
    seedUserState, openTestPage, sendRuntimeMessage, readLocalWordLists,
  }) => {
    await seedUserState({ knownWords: [WORDS.restore, 'apple'] });
    const pageA = await openTestPage();
    const pageB = await openTestPage();
    for (const page of [pageA, pageB]) {
      await expectReady(page);
      await expect(vocabMark(page, WORDS.restore)).toHaveCount(0);
      await expect(vocabMark(page, 'apple')).toHaveCount(0);
    }

    // apple 本身不超出 A2 等级，显式标记未知仍应强制高亮。
    for (const word of [WORDS.restore, 'apple']) {
      const response = await sendRuntimeMessage({
        type: 'MARK_WORD_UNKNOWN',
        payload: {
          word,
          context: 'Synthetic E2E reading passage',
          translation: '',
          markedAt: Date.now(),
          reviewCount: 0,
        },
      });
      expect(response.success, response.error).toBe(true);
      for (const page of [pageA, pageB]) {
        await expect(vocabMark(page, word)).toHaveCount(1);
      }
    }
    await expect.poll(async () => (await readLocalWordLists()).unknownWords.map(entry => entry.word))
      .toEqual(expect.arrayContaining([WORDS.restore, 'apple']));
    expect((await readLocalWordLists()).knownWords).not.toContain(WORDS.restore);
    expect((await readLocalWordLists()).knownWords).not.toContain('apple');

    await pageB.reload({ waitUntil: 'domcontentloaded' });
    await expect(pageB.locator('body')).toHaveAttribute('data-extension-loaded', 'true');
    await expect(vocabMark(pageB, WORDS.restore)).toHaveCount(1);
    await expect(vocabMark(pageB, 'apple')).toHaveCount(1);
  });

  test('动态插入段落中的新单词会被高亮', async ({ seedUserState, openTestPage }) => {
    await seedUserState();
    const page = await openTestPage();
    await expectReady(page);
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'para-dynamic';
      paragraph.textContent =
        'The committee described the findings as counterintuitive, noting that repeated ' +
        'measurements under identical conditions produced divergent outcomes.';
      document.querySelector('#spa-root')!.appendChild(paragraph);
    });
    const dynamicWord = page.locator(`#para-dynamic ${VOCAB_MARK}[data-word="${WORDS.restore}"]`);
    await expect(dynamicWord).toHaveCount(1);
    await expect(vocabMark(page, WORDS.restore)).toHaveCount(2);
    await expect(page.locator(`${VOCAB_MARK} ${VOCAB_MARK}`)).toHaveCount(0);
  });

  test('SPA 导航替换内容后新段落仍会高亮', async ({ seedUserState, openTestPage }) => {
    await seedUserState();
    const page = await openTestPage();
    await expectReady(page);
    await page.evaluate(() => {
      history.pushState({ view: 'second' }, '', '/local-first-reading.html?view=second');
      const paragraph = document.createElement('p');
      paragraph.id = 'para-spa';
      paragraph.textContent =
        'A counterintuitive pattern emerged from the longitudinal survey data, prompting ' +
        'the editorial board to commission an independent replication study.';
      document.querySelector('#content')!.replaceChildren(paragraph);
    });
    await expect(page).toHaveURL(/view=second/);
    await expect(page.locator('#para-alpha')).toHaveCount(0);
    await expect(vocabMark(page, WORDS.known)).toHaveCount(0);
    await expect(page.locator(`#para-spa ${VOCAB_MARK}[data-word="${WORDS.restore}"]`)).toHaveCount(1);
  });

  for (const word of ['apple', 'apples']) {
    test(`断网时真实后台查询 ${word} 返回本地中文释义`, async ({
      seedUserState, sendRuntimeMessage,
    }) => {
      await seedUserState();
      const response = await sendRuntimeMessage<TranslationResult>({
        type: 'TRANSLATE_TEXT',
        payload: { text: word, context: '', mode: 'inline-only' },
      });
      expect(response.success, response.error).toBe(true);
      expect(response.data?._source).toBe('local');
      expect(response.data?.words[0].original).toBe(word);
      expect(response.data?.words[0].translation).toContain('苹果');
      expect(response.data?.fullText).toBe(response.data?.words[0].translation);
    });
  }

  test('断网双击 apple 后真实页面弹窗显示中文释义', async ({ seedUserState, openTestPage }) => {
    await seedUserState();
    const page = await openTestPage();
    await expectReady(page);
    await page.locator('#lookup-apple').dblclick();
    const tooltip = page.locator('.not-translator-tooltip-visible');
    await expect(tooltip).toBeVisible();
    await expect(tooltip.locator('.not-translator-tooltip-translation')).toContainText('苹果');
  });
});
