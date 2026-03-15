/**
 * 扩展测试基类和工具
 * 提供扩展测试的基础设施和常用方法
 */

import { test as base, type Page, type BrowserContext, chromium, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Mock 翻译 API 响应数据
 */
const MOCK_TRANSLATION_RESPONSE = {
  words: [
    {
      original: 'ubiquitous',
      translation: '无处不在的；普遍存在的',
      position: [4, 14],
      difficulty: 8,
      isPhrase: false,
    },
    {
      original: 'revolutionized',
      translation: '彻底改变的；革命的',
      position: [35, 49],
      difficulty: 7,
      isPhrase: false,
    },
    {
      original: 'democratization',
      translation: '民主化；普及化',
      position: [75, 90],
      difficulty: 9,
      isPhrase: false,
    },
    {
      original: 'proliferation',
      translation: '激增；扩散',
      position: [40, 53],
      difficulty: 8,
      isPhrase: false,
    },
    {
      original: 'ephemeral',
      translation: '短暂的；转瞬即逝的',
      position: [4, 13],
      difficulty: 9,
      isPhrase: false,
    },
    {
      original: 'juxtaposition',
      translation: '并置；并列对照',
      position: [4, 17],
      difficulty: 10,
      isPhrase: false,
    },
  ],
  sentences: [
    {
      original: 'The ubiquitous nature of smartphones has revolutionized modern communication.',
      translation: '智能手机无处不在的特性彻底改变了现代通信方式。',
    },
  ],
  grammarPoints: [],
  fullText: '智能手机无处不在的特性彻底改变了现代通信方式。',
};

/**
 * 扩展测试固件类型定义
 */
export interface ExtensionFixtures {
  // 已加载扩展的上下文
  context: BrowserContext;
  // 扩展页面
  extensionPage: Page;
  // 扩展 ID
  extensionId: string;
  // 打开扩展 Popup
  openPopup: () => Promise<Page>;
  // 打开扩展 Options
  openOptions: () => Promise<Page>;
  // 获取背景页
  getBackgroundPage: () => Promise<Page | null>;
  // 等待扩展加载
  waitForExtensionLoaded: (page: Page) => Promise<void>;
  // 配置扩展 API（注入 mock API key）
  configureExtensionApi: () => Promise<void>;
}

/**
 * 扩展测试基类
 * 自动加载扩展并提供测试固件
 */
export const test = base.extend<ExtensionFixtures>({
  // 扩展路径
  extensionPath: [path.resolve(__dirname, '../../dist'), { option: true }],

  // 创建带有扩展的浏览器上下文
  context: async ({ extensionPath }, use) => {
    const context = await chromium.launchPersistentContext('', {
      headless: false, // 扩展测试需要 headed 模式
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        // 禁用某些安全检查以便测试
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
      ],
    });

    // 等待 Service Worker 注册（使用 waitForEvent 而非 expect.poll）
    // 注意：expect.poll 在 fixture 中会导致上下文提前关闭
    let serviceWorker = context.serviceWorkers()[0];
    if (!serviceWorker) {
      try {
        serviceWorker = await context.waitForEvent('serviceworker', { timeout: 10000 });
      } catch {
        // 如果事件等待失败，尝试手动轮询
        const startTime = Date.now();
        while (!serviceWorker && Date.now() - startTime < 10000) {
          await new Promise(r => setTimeout(r, 100));
          serviceWorker = context.serviceWorkers()[0];
        }
      }
    }

    await use(context);

    // 测试结束后清理
    await context.close();
  },

  // 扩展 ID - 延迟计算
  extensionId: async ({ context }, use) => {
    const id = await getExtensionIdFromContext(context);
    await use(id);
  },

  // 扩展页面 - 默认打开一个新页面
  extensionPage: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
  },

  // 打开 Popup 的辅助函数
  openPopup: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`);
      return page;
    });
  },

  // 打开 Options 的辅助函数
  openOptions: async ({ context, extensionId }, use) => {
    await use(async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/src/options/index.html`);
      return page;
    });
  },

  // 获取背景页的辅助函数
  getBackgroundPage: async ({ context }, use) => {
    await use(async () => {
      return await getBackgroundPageFromContext(context);
    });
  },

  // 等待扩展加载的辅助函数
  waitForExtensionLoaded: async ({}, use) => {
    await use(async (page: Page) => {
      // 等待内容脚本注入（与内容脚本中设置的标记保持一致）
      // 支持多种加载状态：true（正常）、false（设置失败）、disabled（禁用）、blacklisted（黑名单）、chinese-page（中文页面）
      await page.waitForFunction(() => {
        const loadedAttr = document.body?.getAttribute('data-extension-loaded');
        const hasLoadedMarker = loadedAttr !== null && loadedAttr !== '';
        const hasWindowFlag = !!(window as any).__EXTENSION_LOADED__;
        const hasInstance = !!(window as any).__NOT_ONLY_TRANSLATOR__;
        return hasLoadedMarker || hasWindowFlag || hasInstance;
      }, { timeout: 10000 });

      // 使用手动轮询确保扩展完全初始化（而非 expect.poll）
      // 注意：expect.poll 在 fixture 中会导致上下文提前关闭
      const startTime = Date.now();
      let isInitialized = false;
      while (Date.now() - startTime < 5000) {
        isInitialized = await page.evaluate(() => {
          const instance = (window as any).__NOT_ONLY_TRANSLATOR__;
          return !!(instance && instance.isInitialized !== false);
        });
        if (isInitialized) break;
        await new Promise(r => setTimeout(r, 100));
      }
    });
  },

  // 配置扩展 API 的辅助函数
  configureExtensionApi: async ({ context }, use) => {
    await use(async () => {
      await configureExtensionApiInContext(context);
    });
  },
});

/**
 * 从上下文中获取扩展 ID
 */
async function getExtensionIdFromContext(context: BrowserContext): Promise<string> {
  // 方法1: 尝试从背景页获取
  const backgroundPage = await getBackgroundPageFromContext(context);
  if (backgroundPage) {
    const id = await backgroundPage.evaluate(() => chrome.runtime.id);
    if (id) return id;
  }

  // 方法2: 打开扩展管理页面获取
  const tempPage = await context.newPage();
  await tempPage.goto('chrome://extensions');

  // 等待扩展列表加载
  await tempPage.waitForSelector('extensions-item', { timeout: 10000 });

  // 查找 NotOnlyTranslator 扩展
  const items = await tempPage.$$('extensions-item');
  for (const item of items) {
    const name = await item.$eval('#name', el => el.textContent).catch(() => null);
    if (name?.includes('NotOnlyTranslator')) {
      const id = await item.$eval('#extension-id', el => el.textContent).catch(() => null);
      if (id) {
        await tempPage.close();
        return id.trim();
      }
    }
  }

  await tempPage.close();

  // 方法3: 使用默认值（仅用于开发测试）
  throw new Error('无法获取扩展 ID，请确保扩展已正确加载');
}

/**
 * 从上下文中获取背景页（Service Worker）
 */
async function getBackgroundPageFromContext(context: BrowserContext): Promise<Page | null> {
  // 方法1: 首先检查是否已经有 Service Worker
  const existingWorkers = context.serviceWorkers();
  if (existingWorkers.length > 0) {
    return existingWorkers[0];
  }

  // 方法2: 等待 Service Worker 事件（使用轮询）
  try {
    await context.waitForEvent('serviceworker', { timeout: 5000 });
    const sw = context.serviceWorkers();
    if (sw.length > 0) {
      return sw[0];
    }
  } catch {
    // Service Worker 可能还没有注册
  }

  // 方法3: 尝试多次获取（轮询方式）
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    const workers = context.serviceWorkers();
    if (workers.length > 0) {
      return workers[0];
    }
  }

  // 方法4: 尝试获取 backgroundPages（Manifest V2 兼容）
  const backgroundPages = context.backgroundPages();
  if (backgroundPages.length > 0) {
    return backgroundPages[0];
  }

  return null;
}

/**
 * 配置扩展 API 设置
 * 注入 mock API key 到扩展存储中，并预填充翻译缓存
 */
async function configureExtensionApiInContext(context: BrowserContext): Promise<void> {
  const serviceWorkers = context.serviceWorkers();
  const backgroundPages = context.backgroundPages();
  const backgroundPage = serviceWorkers[0] || backgroundPages[0];

  if (!backgroundPage) {
    console.warn('[E2E] Warning: Could not find background page or service worker');
    return;
  }

  const configId = 'test-config-' + Date.now();

  // 构建设置数据
  const settings = {
    enabled: true,
    autoHighlight: true,
    vocabHighlightEnabled: true,
    translationMode: 'inline-only',
    showDifficulty: true,
    highlightColor: '#fef08a',
    fontSize: 14,
    apiProvider: 'openai',
    customApiUrl: '',
    customModelName: '',
    blacklist: [],
    apiConfigs: [
      {
        id: configId,
        name: 'Test Config',
        provider: 'openai',
        apiUrl: '',
        modelName: 'gpt-4o-mini',
        apiKey: 'test-api-key-for-e2e-only',
      },
    ],
    activeApiConfigId: configId,
  };

  // 预填充翻译缓存 - 为测试页面中的文本生成缓存条目
  const translationCache: Record<string, typeof MOCK_TRANSLATION_RESPONSE> = {};

  // 根据文本内容生成哈希键（使用简化的哈希函数）
  const generateHash = (text: string): string => {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  };

  // 为测试页面中的段落生成缓存
  const testParagraphs = [
    'The ubiquitous nature of smartphones has revolutionized modern communication.',
    'People from all walks of life now carry powerful computing devices in their pockets.',
    'This democratization of technology has both advantages and challenges.',
    'However, the proliferation of misinformation through social media platforms has become a significant concern.',
    'The ephemeral nature of digital content creates unique archival challenges.',
    'The juxtaposition of rapid technological advancement with long-term preservation needs requires innovative solutions.',
  ];

  for (const paragraph of testParagraphs) {
    // 修复：使用与扩展一致的缓存键格式 mode_hash，而不是 hash(text+mode)
    const hashKey = 'inline-only_' + generateHash(paragraph);
    translationCache[hashKey] = {
      ...MOCK_TRANSLATION_RESPONSE,
      words: MOCK_TRANSLATION_RESPONSE.words.filter(() => Math.random() > 0.3), // 随机选择一些词
    };
  }

  await backgroundPage.evaluate((data) => {
    const { settingsData, cacheData } = data;
    return new Promise<void>((resolve, reject) => {
      // 同时设置 settings、userProfile 和 translationCache
      chrome.storage.sync.set(
        {
          settings: settingsData,
          userProfile: {
            examType: 'cet4',
            examScore: 425,
            estimatedVocabulary: 4500,
            levelConfidence: 0.5,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          // 设置本地缓存
          chrome.storage.local.set(
            {
              translationCache: cacheData,
            },
            () => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else {
                console.log('[E2E] Extension settings and cache configured');
                resolve();
              }
            }
          );
        }
      );
    });
  }, { settingsData: settings, cacheData: translationCache });

  console.log('[E2E] Extension API configured with mock translation cache');
}

// 导出 expect
export { expect };
