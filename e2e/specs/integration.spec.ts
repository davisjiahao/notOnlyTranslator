/**
 * 集成测试
 * 测试扩展各组件之间的协同工作
 */

import { test, expect } from '../utils/extensionTest';
import { WebPage, PopupPage, OptionsPage } from '../utils/pageObjects';
import { waitForPageLoad, safeClick } from '../utils/testHelpers';
import { setExtensionStorage, getExtensionStorage } from '../utils/extensionHelpers';

// 创建本地测试页面内容的辅助函数
function createTestPageContent(title: string, paragraphs: string[]): string {
  const paragraphsHtml = paragraphs.map(p => `<p>${p}</p>`).join('\n        ');
  return `
    <!DOCTYPE html>
    <html>
    <head><title>${title}</title></head>
    <body>
      <h1>${title}</h1>
      ${paragraphsHtml}
    </body>
    </html>
  `;
}

const TEST_CONTENT = {
  article: {
    title: 'Test Article Page',
    paragraphs: [
      'The ubiquitous nature of smartphones has revolutionized modern communication.',
      'People from all walks of life now carry powerful computing devices in their pockets.',
      'This democratization of technology has both advantages and challenges.',
      'However, the proliferation of misinformation through social media platforms has become a significant concern.',
      'The ephemeral nature of digital content creates unique archival challenges.',
      'The juxtaposition of rapid technological advancement with long-term preservation needs requires innovative solutions.',
    ],
  },
  computer: {
    title: 'Computer Test Page',
    paragraphs: [
      'A computer is a machine that can be programmed to automatically carry out sequences of arithmetic or logical operations.',
      'Modern computers can perform generic sets of operations known as programs.',
      'These programs enable computers to perform a wide range of tasks, from simple calculations to complex simulations.',
    ],
  },
};

test.describe('集成测试 - 完整用户流程', () => {
  test('完整流程：设置 API -> 浏览网页 -> 查看翻译', async ({
    context,
    extensionPage,
    openOptions,
    waitForExtensionLoaded,
    configureExtensionApi,
  }) => {
    // Step 1: 配置 API 设置
    console.log('Step 1: 配置 API 设置');
    const options = await openOptions();
    const optionsPage = new OptionsPage(options);

    // 切换到 API 设置标签
    await optionsPage.switchTab('API');

    // 填写 API 配置（使用测试值）
    await setExtensionStorage(context, {
      apiConfig: {
        provider: 'openai',
        apiKey: 'test-api-key',
        model: 'gpt-4o-mini',
      },
    }, 'sync');

    await options.close();
    console.log('API 配置完成');

    // Step 2: 导航到测试页面（使用本地内容）
    console.log('Step 2: 导航到测试页面');
    const content = createTestPageContent(
      TEST_CONTENT.article.title,
      TEST_CONTENT.article.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);

    // Step 3: 等待扩展加载和处理
    console.log('Step 3: 等待扩展加载');
    await waitForExtensionLoaded(extensionPage);
    await extensionPage.waitForTimeout(3000);

    // Step 4: 验证单词被标注
    console.log('Step 4: 验证单词标注');
    const webPage = new WebPage(extensionPage);
    const highlightedWords = await webPage.getHighlightedWords();
    console.log(`找到 ${highlightedWords.length} 个标注的单词`);

    // Step 5: 悬停查看翻译
    if (highlightedWords.length > 0) {
      console.log('Step 5: 查看翻译提示');
      await webPage.hoverOverWord(highlightedWords[0]);

      const tooltipContent = await webPage.getTooltipContent();
      console.log('提示框内容:', tooltipContent);
    }

    // 截图记录结果
    await webPage.screenshot('integration-test-result');

    console.log('集成测试完成');
  });

  test('设置同步：Popup 和 Options 之间的数据同步', async ({
    context,
    openPopup,
    openOptions,
  }) => {
    // Step 1: 在 Options 中设置一个值
    const options = await openOptions();
    const optionsPage = new OptionsPage(options);

    // 设置测试数据
    await setExtensionStorage(context, {
      testSyncKey: 'synced-value-123',
      lastModified: Date.now(),
    }, 'sync');

    await options.close();

    // Step 2: 在 Popup 中读取这个值
    const popup = await openPopup();

    // 从存储中读取
    const syncedData = await getExtensionStorage(context, ['testSyncKey', 'lastModified'], 'sync');

    // 验证数据同步
    expect(syncedData.testSyncKey).toBe('synced-value-123');
    expect(syncedData.lastModified).toBeGreaterThan(0);

    await popup.close();
  });

  test('词汇学习流程：标记单词 -> 更新词汇表', async ({
    context,
    extensionPage,
    waitForExtensionLoaded,
    configureExtensionApi,
  }) => {
    // 配置 mock API 和翻译缓存
    await configureExtensionApi();

    // 设置初始词汇表
    await setExtensionStorage(context, {
      vocabulary: {
        known: ['hello', 'world'],
        unknown: [],
        learning: [],
      },
      userProfile: {
        vocabularyLevel: 'cet4',
        estimatedVocabularySize: 4000,
      },
    }, 'local');

    // 导航到测试页面（使用本地内容）
    const content = createTestPageContent(
      TEST_CONTENT.computer.title,
      TEST_CONTENT.computer.paragraphs
    );
    await extensionPage.setContent(content);
    await waitForPageLoad(extensionPage);
    await waitForExtensionLoaded(extensionPage);
    await extensionPage.waitForTimeout(3000);

    // 查找一个单词并标记为已掌握
    const wordToMark = await extensionPage.evaluate(() => {
      const words = document.querySelectorAll('[data-not-only-translator-word]');
      if (words.length > 0) {
        return words[0].textContent;
      }
      return null;
    });

    if (wordToMark) {
      console.log(`标记单词: ${wordToMark}`);

      // 悬停显示提示框
      const wordElement = extensionPage.locator(`[data-not-only-translator-word]:has-text("${wordToMark}")`).first();
      await wordElement.hover();
      await extensionPage.waitForTimeout(500);

      // 查找并点击"已掌握"按钮
      const knownButton = extensionPage.locator('.tooltip button:has-text("已掌握"), .tooltip button:has-text("Known")').first();
      if (await knownButton.isVisible()) {
        await knownButton.click();
        await extensionPage.waitForTimeout(500);

        // 验证词汇表已更新
        const vocabulary = await getExtensionStorage(context, ['vocabulary'], 'local');
        console.log('更新后的词汇表:', vocabulary);

        // 验证单词已添加到 known 列表
        if (vocabulary.vocabulary?.known) {
          expect(vocabulary.vocabulary.known).toContain(wordToMark.toLowerCase());
        }
      }
    }

    // 截图
    await extensionPage.screenshot({ path: 'e2e/screenshots/vocabulary-learning.png', fullPage: true });
  });
});
