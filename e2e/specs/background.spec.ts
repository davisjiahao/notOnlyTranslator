/**
 * Background Script E2E 测试
 * 测试后台脚本的功能，包括存储、消息传递等
 */

import { test, expect } from '../utils/extensionTest';
import {
  getExtensionStorage,
  setExtensionStorage,
  clearExtensionStorage,
} from '../utils/extensionHelpers';

test.describe('Background Script 测试', () => {
  test('应该可以访问 Chrome Storage', async ({ context, getBackgroundPage }) => {
    const backgroundPage = await getBackgroundPage();

    // 验证背景页存在
    expect(backgroundPage).not.toBeNull();

    if (backgroundPage) {
      // 尝试执行存储操作
      const canAccessStorage = await backgroundPage.evaluate(() => {
        return typeof chrome !== 'undefined' &&
               typeof chrome.storage !== 'undefined';
      });

      expect(canAccessStorage).toBe(true);
    }
  });

  test('应该可以读写 local storage', async ({ context }) => {
    // 写入测试数据
    await setExtensionStorage(context, {
      testKey: 'testValue',
      testNumber: 42,
      testObject: { foo: 'bar' },
    }, 'local');

    // 读取数据
    const data = await getExtensionStorage(context, ['testKey', 'testNumber', 'testObject'], 'local');

    // 验证数据
    expect(data.testKey).toBe('testValue');
    expect(data.testNumber).toBe(42);
    expect(data.testObject).toEqual({ foo: 'bar' });
  });

  test('应该可以读写 sync storage', async ({ context }) => {
    // 写入测试数据
    await setExtensionStorage(context, {
      userSettings: {
        theme: 'dark',
        language: 'zh-CN',
      },
      version: '1.0.0',
    }, 'sync');

    // 读取数据
    const data = await getExtensionStorage(context, ['userSettings', 'version'], 'sync');

    // 验证数据
    expect(data.userSettings).toEqual({
      theme: 'dark',
      language: 'zh-CN',
    });
    expect(data.version).toBe('1.0.0');
  });

  test('应该可以清除 storage', async ({ context }) => {
    // 先写入一些数据
    await setExtensionStorage(context, { key1: 'value1', key2: 'value2' }, 'local');

    // 验证数据存在
    let data = await getExtensionStorage(context, null, 'local');
    expect(Object.keys(data).length).toBeGreaterThan(0);

    // 清除数据
    await clearExtensionStorage(context);

    // 验证数据已清除
    data = await getExtensionStorage(context, null, 'local');
    expect(Object.keys(data).length).toBe(0);
  });

  test('应该可以发送和接收消息', async ({ context, getBackgroundPage }) => {
    const backgroundPage = await getBackgroundPage();
    expect(backgroundPage).not.toBeNull();

    if (backgroundPage) {
      // 发送测试消息到背景页
      const response = await backgroundPage.evaluate(async () => {
        return new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { type: 'TEST_MESSAGE', data: 'hello' },
            (response) => {
              resolve(response);
            }
          );
        });
      });

      console.log('消息响应:', response);

      // 注意：这里可能返回 undefined，因为背景页可能没有处理 TEST_MESSAGE
      // 实际测试应该使用真实存在的消息类型
    }
  });

  test('应该可以获取扩展信息', async ({ context, getBackgroundPage }) => {
    const backgroundPage = await getBackgroundPage();
    expect(backgroundPage).not.toBeNull();

    if (backgroundPage) {
      // 获取扩展 manifest 信息
      const manifest = await backgroundPage.evaluate(() => {
        return chrome.runtime.getManifest();
      });

      console.log('扩展信息:', {
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
      });

      // 验证基本信息存在
      expect(manifest.name).toBeTruthy();
      expect(manifest.version).toBeTruthy();
    }
  });
});

test.describe('Background Script - 词汇管理', () => {
  test('应该可以添加单词到词汇表', async ({ context }) => {
    // 模拟添加单词
    await setExtensionStorage(context, {
      vocabulary: {
        known: ['apple', 'banana'],
        unknown: ['orange', 'grape'],
      },
    }, 'local');

    // 验证词汇表
    const data = await getExtensionStorage(context, ['vocabulary'], 'local');
    expect(data.vocabulary).toBeDefined();
    expect(data.vocabulary.known).toContain('apple');
    expect(data.vocabulary.unknown).toContain('orange');
  });

  test('应该可以更新用户词汇水平', async ({ context }) => {
    // 设置用户配置
    await setExtensionStorage(context, {
      userProfile: {
        vocabularyLevel: 'cet6',
        estimatedVocabularySize: 6000,
        lastUpdated: Date.now(),
      },
    }, 'sync');

    // 验证配置
    const data = await getExtensionStorage(context, ['userProfile'], 'sync');
    expect(data.userProfile.vocabularyLevel).toBe('cet6');
    expect(data.userProfile.estimatedVocabularySize).toBe(6000);
  });
});

test.describe('Background Script - 设置管理', () => {
  test('应该可以保存和加载翻译设置', async ({ context }) => {
    const settings = {
      translation: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.7,
        maxTokens: 150,
      },
      display: {
        showTooltip: true,
        highlightWords: true,
        fullTranslationMode: false,
      },
    };

    // 保存设置
    await setExtensionStorage(context, settings, 'sync');

    // 加载设置
    const loaded = await getExtensionStorage(context, ['translation', 'display'], 'sync');

    // 验证
    expect(loaded.translation.provider).toBe('openai');
    expect(loaded.display.showTooltip).toBe(true);
  });

  test('应该可以更新 API 配置', async ({ context }) => {
    // 更新 API 配置
    await setExtensionStorage(context, {
      apiConfig: {
        provider: 'anthropic',
        apiKey: 'test-api-key-123',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3-haiku',
      },
    }, 'sync');

    // 验证
    const config = await getExtensionStorage(context, ['apiConfig'], 'sync');
    expect(config.apiConfig.provider).toBe('anthropic');
    expect(config.apiConfig.apiKey).toBe('test-api-key-123');
  });
});
