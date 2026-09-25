import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, MessageResponse, UserSettings } from '@/shared/types';

vi.stubGlobal('chrome', undefined);
vi.mock('@/shared/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/shared/utils')>(),
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const article = 'The ephemeral nature of language provides curious readers with meaningful context and new ideas. ';
const settings: UserSettings = {
  enabled: true, autoHighlight: true, vocabHighlightEnabled: false,
  phraseTranslationEnabled: false, grammarTranslationEnabled: false,
  translationMode: 'inline-only', showDifficulty: true, highlightColor: '#ffd54f',
  fontSize: 14, apiProvider: 'openai', blacklist: [], apiConfigs: [], hoverDelay: 0, theme: 'light',
} as UserSettings;

type Listener = (message: Message, sender: unknown, respond: (response: MessageResponse) => void) => boolean;
let currentSettings: UserSettings;
let listeners: Listener[];
let messages: Message[];
let translationCallbacks: Array<(response: MessageResponse) => void>;
let translator: import('@/content/index').NotOnlyTranslator | undefined;
let observed: HTMLElement[];
let settingsUnavailable: boolean;

class TestIntersectionObserver {
  observe(element: Element): void { observed.push(element as HTMLElement); }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

async function createTranslator() {
  const { NotOnlyTranslator } = await import('@/content/index');
  translator = new NotOnlyTranslator();
  await vi.waitFor(() => expect(document.body.dataset.extensionLoaded).toBeDefined(), { timeout: 2500 });
  return translator;
}

async function dispatch(type: string, payload?: unknown): Promise<MessageResponse> {
  const listener = listeners.at(-1);
  if (!listener) throw new Error('消息监听器未注册');
  return new Promise((resolve) => {
    expect(listener({ type, payload } as Message, {}, resolve)).toBe(true);
  });
}

beforeAll(async () => {
  await import('@/content/index');
});

beforeEach(() => {
  currentSettings = { ...settings };
  settingsUnavailable = false;
  listeners = [];
  messages = [];
  observed = [];
  translationCallbacks = [];
  document.documentElement.lang = 'en';
  document.body.innerHTML = `<article><p id="story">${article.repeat(5)}</p><nav><p>${article}</p></nav></article>`;
  delete document.body.dataset.extensionLoaded;
  vi.stubGlobal('IntersectionObserver', TestIntersectionObserver);
  vi.stubGlobal('chrome', {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: (listener: Listener) => { listeners.push(listener); },
        removeListener: (listener: Listener) => { listeners = listeners.filter((item) => item !== listener); },
      },
      sendMessage: (message: Message, callback?: (response: MessageResponse) => void) => {
        messages.push(message);
        if (message.type === 'TRANSLATE_TEXT' || message.type === 'BATCH_TRANSLATE_TEXT') {
          if (callback) translationCallbacks.push(callback);
          return;
        }
        const data = message.type === 'GET_SETTINGS' ? currentSettings
          : message.type === 'GET_USER_PROFILE' ? { knownWords: [], unknownWords: [] }
          : message.type === 'GET_CEFR_LEVEL' ? { level: 'B1' }
          : message.type === 'GET_VOCABULARY' ? [] : {};
        const response = message.type === 'GET_SETTINGS' && settingsUnavailable
          ? { success: false, error: '后台暂不可用' }
          : { success: true, data };
        callback?.(response);
        return Promise.resolve(response);
      },
    },
    storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  });
});

afterEach(() => {
  translator?.destroy();
  translator = undefined;
  window.getSelection()?.removeAllRanges();
  Reflect.deleteProperty(document, 'caretRangeFromPoint');
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('内容脚本真实初始化与运行时消息', () => {
  it('英文正文启动后由真实扫描器过滤导航，并注册正文到可视区域', async () => {
    await createTranslator();
    expect(document.body.dataset.extensionLoaded).toBe('true');
    expect(window.__EXTENSION_LOADED__).toBe(true);
    expect(observed).toContain(document.getElementById('story'));
    expect(observed).not.toContain(document.querySelector('nav p'));
    expect(listeners).toHaveLength(1);
  });

  it.each([
    ['禁用', { enabled: false }, 'disabled'],
    ['黑名单', { blacklist: [window.location.hostname] }, 'blacklisted'],
  ])('%s页面跳过监听器及扫描', async (_name, override, marker) => {
    currentSettings = { ...settings, ...override };
    await createTranslator();
    expect(document.body.dataset.extensionLoaded).toBe(marker);
    expect(observed).toHaveLength(0);
    expect(listeners).toHaveLength(0);
  });

  it('中文 lang 页面跳过英文内容扫描与消息监听', async () => {
    document.documentElement.lang = 'zh-CN';
    await createTranslator();
    expect(document.body.dataset.extensionLoaded).toBe('chinese-page');
    expect(observed).toHaveLength(0);
    expect(listeners).toHaveLength(0);
  });

  it('关闭自动高亮仍接收消息，启用时扫描，关闭时不扫描', async () => {
    currentSettings = { ...settings, autoHighlight: false };
    await createTranslator();
    expect(observed).toHaveLength(0);
    expect(await dispatch('TOGGLE_ENABLED')).toEqual({ success: true });
    expect(await dispatch('TOGGLE_ENABLED')).toEqual({ success: true });
    expect(observed).toHaveLength(0);
    currentSettings = { ...settings, autoHighlight: true };
    expect(await dispatch('SETTINGS_UPDATED')).toEqual({ success: true });
    await vi.waitFor(() => expect(observed).toContain(document.getElementById('story')));
  });

  it('右键无选区时使用视口锚点，翻译失败向用户展示错误', async () => {
    await createTranslator();
    expect(await dispatch('CONTEXT_MENU_TRANSLATE', { text: 'ephemeral' })).toEqual({ success: true });
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    expect(messages.find((message) => message.type === 'TRANSLATE_TEXT')).toMatchObject({
      payload: { text: 'ephemeral', mode: 'inline-only' },
    });
    translationCallbacks[0]({ success: false, error: '网络故障' });
    await vi.waitFor(() => expect(document.getElementById('not-translator-tooltip')?.textContent).toContain('翻译失败'));
  });

  it('切换关闭时取消右键翻译，迟到结果不得重新显示', async () => {
    await createTranslator();
    await dispatch('CONTEXT_MENU_TRANSLATE', { text: 'ephemeral' });
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const request = messages.find((message) => message.type === 'TRANSLATE_TEXT');
    expect(await dispatch('TOGGLE_ENABLED')).toEqual({ success: true });
    expect(messages).toContainEqual({ type: 'CANCEL_TRANSLATION', payload: { requestId: request?.requestId } });
    translationCallbacks[0]({ success: true, data: { fullText: '不应出现', words: [], sentences: [] } });
    await Promise.resolve();
    expect(document.getElementById('not-translator-tooltip')?.textContent).not.toContain('不应出现');
  });

  it('销毁时解绑消息和双击监听，避免离开页面后继续翻译', async () => {
    const instance = await createTranslator();
    const paragraph = document.getElementById('story')!;
    const node = paragraph.firstChild!;
    const range = document.createRange();
    range.setStart(node, 5);
    range.collapse(true);
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => range });
    instance.destroy();
    expect(listeners).toHaveLength(0);
    paragraph.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await Promise.resolve();
    expect(messages.some((message) => message.type === 'TRANSLATE_TEXT')).toBe(false);
    vi.restoreAllMocks();
  });

  it('真实消息链完成整页翻译并切换译文可见性，导航内容不发送', async () => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();
    const response = dispatch('TRANSLATE_PAGE');
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const batch = messages.find((message) => message.type === 'BATCH_TRANSLATE_TEXT');
    expect((batch?.payload as { paragraphs: { text: string }[] }).paragraphs).toHaveLength(1);
    translationCallbacks[0]({
      success: true,
      data: { results: [{ result: { words: [], sentences: [], fullText: '实际译文' } }] },
    });
    expect(await response).toEqual({ success: true, data: { translated: 1, failed: 0 } });
    const line = document.querySelector<HTMLElement>('.not-translator-translation-line');
    expect(line?.textContent).toContain('实际译文');
    expect(document.getElementById('story')?.classList.contains('not-translator-processed')).toBe(true);
    await dispatch('TOGGLE_TRANSLATION');
    expect(line?.style.display).toBe('none');
    await dispatch('TOGGLE_TRANSLATION');
    expect(line?.style.display).toBe('');
  });

  it('真实逐段扫描在首段翻译失败后继续翻译下一段', async () => {
    document.querySelector('article')!.insertAdjacentHTML('beforeend', `<p id="next">${article.repeat(2)}</p>`);
    const instance = await createTranslator();
    (instance as unknown as { useBatchMode: boolean }).useBatchMode = false;
    const scanning = (instance as unknown as { scanPage(): Promise<void> }).scanPage();
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: false, error: '暂不可用' });
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(2));
    translationCallbacks[1]({
      success: true,
      data: { words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8, isPhrase: false }], sentences: [] },
    });
    await scanning;
    expect(document.getElementById('story')?.classList.contains('not-translator-processed')).toBe(false);
    expect(document.querySelector('#next .not-translator-highlight')?.textContent).toContain('ephemeral');
    expect(document.getElementById('next')?.classList.contains('not-translator-processed')).toBe(true);
  });

  it('整页翻译等待中关闭扩展会返回取消，且不渲染迟到批次', async () => {
    await createTranslator();
    const pending = dispatch('TRANSLATE_PAGE');
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    await dispatch('TOGGLE_ENABLED');
    expect(await pending).toEqual({ success: false, data: { translated: 0, failed: 0 } });
    translationCallbacks[0]({ success: true, data: { results: [{ result: { words: [], sentences: [], fullText: '迟到译文' } }] } });
    await Promise.resolve();
    expect(document.getElementById('story')?.classList.contains('not-translator-processed')).toBe(false);
    expect(document.body.textContent).not.toContain('迟到译文');
  });

  it('后台设置持续失败时标记初始化失败且不扫描正文', async () => {
    settingsUnavailable = true;
    await createTranslator();
    expect(document.body.dataset.extensionLoaded).toBe('settings-failed');
    expect(messages.filter((message) => message.type === 'GET_SETTINGS')).toHaveLength(3);
    expect(observed).toHaveLength(0);
    expect(listeners).toHaveLength(0);
  }, 4000);

  it('新插入文章段落自动观察，但排除导航和可编辑草稿', async () => {
    await createTranslator();
    const container = document.createElement('section');
    container.innerHTML = `<p id="new-story">${article}</p><nav><p id="new-nav">${article}</p></nav><div contenteditable="true"><p id="draft">${article}</p></div>`;
    document.body.appendChild(container);
    await vi.waitFor(() => expect(observed).toContain(document.getElementById('new-story')));
    expect(observed).not.toContain(document.getElementById('new-nav'));
    expect(observed).not.toContain(document.getElementById('draft'));
  });

  it('双击英文单词获取译文，Tooltip 显示原词及译文', async () => {
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    const range = document.createRange();
    range.setStart(paragraph.firstChild!, 6);
    range.collapse(true);
    Object.defineProperty(document, 'caretRangeFromPoint', { configurable: true, value: () => range });
    paragraph.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    expect(messages.find((message) => message.type === 'TRANSLATE_TEXT')).toMatchObject({ payload: { text: 'ephemeral' } });
    translationCallbacks[0]({ success: true, data: { words: [], sentences: [], fullText: '短暂的' } });
    await vi.waitFor(() => expect(document.getElementById('not-translator-tooltip')?.textContent).toContain('短暂的'));
  });

  it('快捷键消息切换模式后清除旧译文，并持久化新模式', async () => {
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    paragraph.classList.add('not-translator-processed');
    paragraph.dataset.originalHtml = paragraph.innerHTML;
    paragraph.insertAdjacentHTML('afterend', '<div class="not-translator-translation-line">旧译文</div>');
    expect(await dispatch('TOGGLE_MODE')).toEqual({ success: true });
    expect(messages.find((message) => message.type === 'UPDATE_SETTINGS')).toMatchObject({
      payload: { translationMode: 'bilingual' },
    });
    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')).toBeNull());
    expect(paragraph.classList.contains('not-translator-processed')).toBe(false);
  });

  it('未知消息返回可诊断错误，且不触发翻译请求', async () => {
    await createTranslator();
    expect(await dispatch('INVALID_MESSAGE')).toEqual({ success: false, error: 'Unknown message type' });
    expect(messages.some((message) => message.type === 'TRANSLATE_TEXT')).toBe(false);
  });
});
