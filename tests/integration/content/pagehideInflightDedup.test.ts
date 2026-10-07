/**
 * pagehide 卸载路径与在途批次去重的跨层集成测试
 *
 * 契约（刷新/关闭页面时）：
 * - 卸载只做前端清理：不发 CANCEL_TRANSLATION，后台在途批次继续完成；
 * - 在途批次完成后经真实路径写段落缓存（enhancedCache.set）；
 * - 刷新后的新页面同段落请求不重发（LLM 外发计数恒为 1，缓存命中）。
 * 用户主动取消（popup 暂停、配置变化等）仍照发 CANCEL_TRANSLATION，由
 * translationCancellation 集成测试另行守护。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Message, MessageResponse, UserSettings } from '@/shared/types';

// 后台依赖 mock：存储可变快照、LLM 替身、内存版队列
vi.mock('@/background/storage', () => ({ StorageManager: {
  getSettings: vi.fn(), getApiKey: vi.fn(), getUserProfile: vi.fn(),
} }));
vi.mock('@/background/translationApi', () => ({ TranslationApiService: {
  callWithSystem: vi.fn(), quickTranslate: vi.fn(),
} }));
vi.mock('@/background/pendingRequestQueue', () => {
  const complete = vi.fn(async () => undefined);
  return { pendingRequestQueue: {
    add: vi.fn(),
    complete,
    trackCleanup: vi.fn((prerequisite: Promise<void> | undefined, id: string) => {
      void (prerequisite ?? Promise.resolve()).catch(() => undefined).then(() => { void complete(id); });
    }),
  } };
});
vi.mock('@/shared/performance', () => ({ MetricType: {
  CACHE_OPERATION: 'cache', API_RESPONSE_TIME: 'api', TRANSLATION_TOTAL_TIME: 'total',
}, recordMetric: vi.fn() }));
vi.mock('@/shared/utils', async () => ({
  ...await vi.importActual<typeof import('@/shared/utils')>('@/shared/utils'),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { handleTranslationMessage } from '@/background/translationMessages';
import { StorageManager } from '@/background/storage';
import { TranslationApiService } from '@/background/translationApi';
import { enhancedCache } from '@/background/enhancedCache';
import { setOfflineWordSource, clearWordSenseCache } from '@/background/localWordLookup';

// chrome 未注入时预加载模块，避免模块尾部自动 onExecute 产生多余实例（与 runtimeFlow 一致）
vi.stubGlobal('chrome', undefined);
await import('@/content/index');

const article = 'The ephemeral nature of language provides curious readers with meaningful context and new ideas. ';
const currentSettings: UserSettings = {
  enabled: true, autoHighlight: true, vocabHighlightEnabled: false,
  phraseTranslationEnabled: false, grammarTranslationEnabled: false,
  translationMode: 'bilingual', showDifficulty: true, highlightColor: '#ffd54f',
  fontSize: 14, apiProvider: 'openai', customModelName: 'model-a', customApiUrl: 'https://llm.test/v1',
  blacklist: [], apiConfigs: [], hoverDelay: 0, theme: 'light',
} as UserSettings;
const profile = {
  examType: 'cet4', estimatedVocabulary: 3000, knownWords: [], unknownWords: [],
  levelConfidence: 0.5, createdAt: 0, updatedAt: 0,
};

type Listener = (message: Message, sender: unknown, respond: (response: MessageResponse) => void) => boolean;
let listeners: Listener[];
let cancelCount: number;
let batchTexts: string[];
let sender: chrome.runtime.MessageSender;
let releaseReply!: () => void;
const callWithSystem = vi.mocked(TranslationApiService.callWithSystem);

type ObserverCallback = (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void;
class TestIntersectionObserver {
  static callbacks: ObserverCallback[] = [];
  constructor(callback: ObserverCallback) {
    TestIntersectionObserver.callbacks.push(callback);
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

function intersecting(element: HTMLElement): void {
  const callback = TestIntersectionObserver.callbacks.at(-1);
  if (!callback) throw new Error('IntersectionObserver 回调未注册');
  callback([{ target: element, isIntersecting: true } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
}

let translator: import('@/content/index').NotOnlyTranslator | undefined;

async function createTranslator() {
  const { NotOnlyTranslator } = await import('@/content/index');
  translator = new NotOnlyTranslator();
  await vi.waitFor(() => expect(document.body.dataset.extensionLoaded).toBeDefined(), { timeout: 2500 });
  return translator;
}

beforeEach(async () => {
  vi.clearAllMocks();
  listeners = [];
  cancelCount = 0;
  batchTexts = [];
  sender = { tab: { id: 7 }, documentId: 'document-1' } as chrome.runtime.MessageSender;
  document.documentElement.lang = 'en';
  document.body.innerHTML = `<article><p id="story">${article.repeat(5)}</p></article>`;
  delete document.body.dataset.extensionLoaded;
  TestIntersectionObserver.callbacks = [];
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: (listener: Listener) => { listeners.push(listener); },
        removeListener: (listener: Listener) => { listeners = listeners.filter((item) => item !== listener); },
      },
      sendMessage: (message: Message, callback?: (response: MessageResponse) => void) => {
        if (message.type === 'CANCEL_TRANSLATION') {
          cancelCount++;
          void handleTranslationMessage(message, sender).then(response => callback?.(response));
          return;
        }
        if (message.type === 'TRANSLATE_TEXT' || message.type === 'BATCH_TRANSLATE_TEXT') {
          if (message.type === 'BATCH_TRANSLATE_TEXT') {
            batchTexts.push(...((message.payload as { paragraphs: Array<{ text: string }> }).paragraphs).map(p => p.text));
          }
          void handleTranslationMessage(message, sender).then(response => callback?.(response));
          return;
        }
        const data = message.type === 'GET_SETTINGS' ? currentSettings
          : message.type === 'GET_USER_PROFILE' ? { knownWords: [], unknownWords: [] }
          : message.type === 'GET_CEFR_LEVEL' ? { level: 'B1' }
          : message.type === 'GET_VOCABULARY' ? [] : {};
        callback?.({ success: true, data });
        return Promise.resolve({ success: true, data });
      },
    },
    storage: {
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
      },
    },
  });

  await enhancedCache.clearAll();
  setOfflineWordSource({ lookup: () => undefined });
  clearWordSenseCache();
  vi.mocked(StorageManager.getSettings).mockResolvedValue(currentSettings);
  vi.mocked(StorageManager.getApiKey).mockResolvedValue('TEST-KEY');
  vi.mocked(StorageManager.getUserProfile).mockResolvedValue(profile as Awaited<ReturnType<typeof StorageManager.getUserProfile>>);

  // LLM 替身：受控延迟，成功返回与段落数量一致的 JSON
  callWithSystem.mockImplementation(() => new Promise(resolve => {
    releaseReply = () => resolve(JSON.stringify({
      paragraphs: [{ fullText: '卸载后仍写入缓存的译文。', words: [], sentences: [] }],
    }));
  }));
});

afterEach(() => {
  translator?.destroy();
  translator = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('pagehide 卸载不取消后台在途批次', () => {
  it('卸载不发 CANCEL_TRANSLATION，在途批次完成写缓存，刷新后同段落零重发', async () => {
    const cacheSetSpy = vi.spyOn(enhancedCache, 'set');
    await createTranslator();

    // 段落进入视口 → 真实批次链 → LLM 替身在途
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(callWithSystem).toHaveBeenCalledTimes(1));

    // 模拟 onExecute 注册的 pagehide 卸载路径（复刻 content/index.ts 的注册行为）
    window.addEventListener('pagehide', () => { translator?.destroy(); });
    window.dispatchEvent(new Event('pagehide'));

    // (a) 卸载不向后台发取消消息
    expect(cancelCount).toBe(0);

    // (b) 在途批次继续完成，经真实路径写段落缓存
    releaseReply();
    await vi.waitFor(() => expect(cacheSetSpy).toHaveBeenCalled(), { timeout: 5000 });

    // (c) 刷新后的新页面（同段落文本、新段落 id）不重发：外发计数恒 1，缓存命中
    const batchMessage = callWithSystem.mock.calls.length; // 仅用于阅读，外发计数即 callWithSystem 次数
    expect(batchMessage).toBe(1);
    expect(batchTexts.length).toBeGreaterThan(0);
    const firstRequestText = batchTexts[0];
    const second = await Promise.race([
      handleTranslationMessage({
        type: 'BATCH_TRANSLATE_TEXT',
        payload: {
          paragraphs: [{ id: 'fresh-page-1', text: firstRequestText, elementPath: '#story' }],
          mode: 'bilingual',
          pageUrl: 'https://example.org/after-refresh',
        },
      }, sender),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('second-request-timeout')), 8000)),
    ]);
    expect(second.success).toBe(true);
    expect(callWithSystem).toHaveBeenCalledTimes(1);
    expect(second.data?.results[0]?.cached).toBe(true);
    expect(second.data?.results[0]?.result.fullText).toBe('卸载后仍写入缓存的译文。');
  });
});
