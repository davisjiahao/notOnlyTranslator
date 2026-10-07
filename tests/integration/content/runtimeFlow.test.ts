import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, MessageResponse, UserSettings } from '@/shared/types';
import { getTranslatableText } from '@/content/pageScanner';

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

type Listener = (message: Message, sender: unknown, respond: (response: MessageResponse) => void) => boolean | void;
let currentSettings: UserSettings;
let currentKnownWords: string[];
let listeners: Listener[];
let messages: Message[];
let translationCallbacks: Array<(response: MessageResponse) => void>;
let translator: import('@/content/index').NotOnlyTranslator | undefined;
let observed: HTMLElement[];
let settingsUnavailable: boolean;

type ObserverCallback = (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void;

class TestIntersectionObserver {
  /** 已注册的观察器回调，供测试主动触发交叉事件 */
  static callbacks: ObserverCallback[] = [];

  constructor(callback: ObserverCallback) {
    TestIntersectionObserver.callbacks.push(callback);
  }

  observe(element: Element): void { observed.push(element as HTMLElement); }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

/** 模拟元素进入/离开视口，驱动真实自动批次链 */
function intersecting(element: HTMLElement, isIntersecting = true): void {
  const callback = TestIntersectionObserver.callbacks.at(-1);
  if (!callback) throw new Error('IntersectionObserver 回调未注册');
  callback(
    [{ target: element, isIntersecting } as unknown as IntersectionObserverEntry],
    {} as IntersectionObserver
  );
}

async function createTranslator() {
  const { NotOnlyTranslator } = await import('@/content/index');
  translator = new NotOnlyTranslator();
  await vi.waitFor(() => expect(document.body.dataset.extensionLoaded).toBeDefined(), { timeout: 2500 });
  return translator;
}

async function dispatch(type: string, payload?: unknown): Promise<MessageResponse> {
  if (listeners.length === 0) throw new Error('消息监听器未注册');
  return new Promise((resolve) => {
    listeners.forEach(listener => listener({ type, payload } as Message, {}, resolve));
  });
}

beforeAll(async () => {
  await import('@/content/index');
});

beforeEach(() => {
  currentSettings = { ...settings };
  currentKnownWords = [];
  settingsUnavailable = false;
  listeners = [];
  messages = [];
  observed = [];
  TestIntersectionObserver.callbacks = [];
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
          : message.type === 'GET_USER_PROFILE' ? { knownWords: currentKnownWords, unknownWords: [] }
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

  it('段落进入视口触发真实自动批次链，译文可见且无残留 spinner', async () => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();

    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));

    // 按请求中的段落 id 返回中文全文
    const batch = messages.find((message) => message.type === 'BATCH_TRANSLATE_TEXT');
    const ids = (batch?.payload as { paragraphs: { id: string }[] }).paragraphs.map(p => p.id);
    translationCallbacks[0]({
      success: true,
      data: { results: ids.map(id => ({ id, result: { words: [], sentences: [], fullText: '自动批次译文' } })) },
    });

    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')?.textContent).toContain('自动批次译文'));
    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
    expect(document.getElementById('story')?.classList.contains('not-translator-processed')).toBe(true);
  });

  it('GitHub 外层容器先处理不抢占后续正文，滚动后的请求与标记均不进入隐藏 payload', async () => {
    const intro = 'Repository overview provides readers with useful project details and documentation. ';
    const payload = JSON.stringify({ props: { contextRegion: article, only: 'interactionlimitbanner transcript' } });
    document.body.innerHTML = `<div id="repository" role="main"><script type="application/json">${payload}</script><style>/* styleOnlyPayload */</style><template>templateOnlyPayload</template><noscript>noscriptOnlyPayload</noscript><span hidden>hiddenOnlyPayload</span>${intro}<p id="story">The <a href="/projects">ephemeral</a> nature of language provides curious readers with meaningful context and new ideas. <code>codeOnlyPayload</code></p><p id="later">${article}</p></div>`;
    await createTranslator();
    const host = document.getElementById('repository')!;
    const story = document.getElementById('story')!;
    const later = document.getElementById('later')!;
    expect(document.body.dataset.extensionLoaded).toBe('true');
    await vi.waitFor(() => expect(observed).toEqual(expect.arrayContaining([host, story, later])));

    // 先处理父块，再让两个子段落先后进入视口，确认不按已处理祖先或全局词去重跳过。
    for (const [index, element] of [host, story, later].entries()) {
      intersecting(element);
      await vi.waitFor(() => expect(translationCallbacks).toHaveLength(index + 1));
      const batch = messages.filter(message => message.type === 'BATCH_TRANSLATE_TEXT').at(-1)!;
      const paragraphs = (batch.payload as { paragraphs: { id: string; text: string }[] }).paragraphs;
      expect(paragraphs).toHaveLength(1);
      expect(paragraphs[0].text).not.toMatch(/props|contextRegion|interactionlimitbanner|transcript|OnlyPayload/);
      expect(paragraphs[0].text).toContain(article.trim());
      translationCallbacks[index]({ success: true, data: { results: paragraphs.map(p => ({ id: p.id, result: {
        words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8 }], sentences: [],
      } })) } });
      await vi.waitFor(() => expect(element.classList.contains('not-translator-processed')).toBe(true));
      intersecting(element, false);
    }
    expect(story.querySelector('a mark.not-translator-highlight')).not.toBeNull();
    expect(later.querySelector('mark.not-translator-highlight')).not.toBeNull();
    expect(host.querySelector('script')?.textContent).toBe(payload);
    expect(host.querySelectorAll('script mark, style mark, template mark, noscript mark, [hidden] mark, code mark')).toHaveLength(0);
    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
  });

  it('GitHub 类段落的逐段请求不重新带入嵌套脚本 JSON', async () => {
    const instance = await createTranslator();
    const story = document.getElementById('story')!;
    story.insertAdjacentHTML('afterbegin', '<script type="application/json">{"only":"jsonOnlyPayload"}</script><style>/* styleOnlyPayload */</style><template>templateOnlyPayload</template><noscript>noscriptOnlyPayload</noscript>');
    (instance as unknown as { useBatchMode: boolean }).useBatchMode = false;
    const scanning = (instance as unknown as { scanPage(): Promise<void> }).scanPage();
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const request = messages.find(message => message.type === 'TRANSLATE_TEXT');
    const text = (request?.payload as { text: string }).text;
    translationCallbacks[0]({ success: true, data: { words: [], sentences: [] } });
    await scanning;
    expect(text.trim()).toBe(article.repeat(5).trim());
  });

  it.each(['paragraph', 'page'] as const)('显式 %s 翻译同样只发送正文，不读取隐藏后代', async entry => {
    const instance = await createTranslator();
    const story = document.getElementById('story')!;
    story.insertAdjacentHTML('afterbegin', '<script type="application/json">{"only":"jsonOnlyPayload"}</script><style>/* styleOnlyPayload */</style><noscript>noscriptOnlyPayload</noscript><textarea>draftOnlyPayload</textarea><span hidden>hiddenOnlyPayload</span>');
    const pending = entry === 'page'
      ? dispatch('TRANSLATE_PAGE')
      : (instance as unknown as { translateParagraph(element: HTMLElement): Promise<unknown> }).translateParagraph(story);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const request = messages.find(message => message.type === (entry === 'page' ? 'BATCH_TRANSLATE_TEXT' : 'TRANSLATE_TEXT'))!;
    const text = entry === 'page'
      ? (request.payload as { paragraphs: { text: string }[] }).paragraphs[0].text
      : (request.payload as { text: string }).text;
    translationCallbacks[0]({ success: true, data: entry === 'page'
      ? { results: [{ result: { words: [], sentences: [] } }] }
      : { words: [], sentences: [] } });
    await pending;
    expect(text).toBe(article.repeat(5).trim());
  });

  it.each([
    'editable', 'ancestor-editable', 'hidden', 'ancestor-hidden', 'ancestor-css-hidden', 'form',
  ] as const)('真实请求在途时正文变为 %s，迟到全文响应不覆盖编辑内容或标记成功', async protection => {
    currentSettings = { ...settings, translationMode: 'full-translate' };
    await createTranslator();
    const story = document.getElementById('story')!;
    intersecting(story);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const batch = messages.find(message => message.type === 'BATCH_TRANSLATE_TEXT')!;
    const paragraphs = (batch.payload as { paragraphs: { id: string; text: string }[] }).paragraphs;
    expect(paragraphs[0].text).toBe(article.repeat(5).trim());

    // 请求已发出后用户开始编辑或页面重组；不切换设置，也不改变请求 generation。
    const editedText = 'User edited content must survive this earlier translation request.';
    const textNode = story.firstChild!;
    textNode.textContent = editedText;
    const ancestor = story.parentElement!;
    if (protection === 'editable') story.setAttribute('contenteditable', 'true');
    if (protection === 'ancestor-editable') ancestor.setAttribute('contenteditable', 'true');
    if (protection === 'hidden') story.hidden = true;
    if (protection === 'ancestor-hidden') ancestor.hidden = true;
    if (protection === 'ancestor-css-hidden') ancestor.style.display = 'none';
    if (protection === 'form') {
      const form = document.createElement('form');
      ancestor.appendChild(form);
      form.appendChild(story);
    }
    translationCallbacks[0]({ success: true, data: { results: paragraphs.map(p => ({
      id: p.id, result: { words: [], sentences: [], fullText: '不应写入的过期译文' },
    })) } });
    await vi.waitFor(() => expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0));
    expect(story.firstChild).toBe(textNode);
    expect(story.textContent).toBe(editedText);
    expect(story.dataset.originalHtml).toBeUndefined();
    expect(story.dataset.originalText).toBeUndefined();
    expect(story.classList.contains('not-translator-processed')).toBe(false);
    expect(story.classList.contains('not-translator-full-translated')).toBe(false);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
  });

  it('自动批次失败展示安全提示，再次可见后可重试成功', async () => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();

    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: false, error: 'PRIVATE-UPSTREAM-FAILURE' });

    const alert = await vi.waitFor(() => {
      const el = document.querySelector('[role="alert"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el;
    });
    expect(alert.textContent).toContain('批量翻译失败');
    expect(document.body.textContent).not.toContain('PRIVATE-UPSTREAM-FAILURE');
    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
    expect(document.getElementById('story')?.classList.contains('not-translator-processed')).toBe(false);

    // 离开再进入视口，触发可见重试
    intersecting(document.getElementById('story')!, false);
    intersecting(document.getElementById('story')!, true);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(2));

    const retryBatch = messages.filter((message) => message.type === 'BATCH_TRANSLATE_TEXT').at(-1);
    const retryParagraphs = (retryBatch?.payload as { paragraphs: { id: string; text: string }[] }).paragraphs;
    // 重试采集的必须是纯净原文，不得混入失败通知的中文文本
    expect(retryParagraphs[0]?.text).toBe(article.repeat(5).trim());
    const ids = retryParagraphs.map(p => p.id);
    translationCallbacks[1]({
      success: true,
      data: { results: ids.map(id => ({ id, result: { words: [], sentences: [], fullText: '重试后的译文' } })) },
    });

    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')?.textContent).toContain('重试后的译文'));
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it('自动批次缺少段落结果时安全提示并释放，允许下一次可见重试', async () => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();

    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: true, data: { results: [] } });

    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('批量翻译失败'));
    expect(document.querySelectorAll('.not-translator-loading-spinner')).toHaveLength(0);
    expect(document.getElementById('story')?.classList.contains('not-translator-processed')).toBe(false);

    intersecting(document.getElementById('story')!, false);
    intersecting(document.getElementById('story')!, true);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(2));
  });

  it.each(['li', 'blockquote'] as const)('嵌套可观察 %s 内段落失败后，通知不污染祖先采集', async (tag) => {
    // 容器含直接文本且内嵌长段落 p：初始扫描会把容器与 p 同时注册为可观察段落
    document.querySelector('article')!.insertAdjacentHTML(
      'beforeend',
      `<${tag} id="nestedHost">${article}<p id="nestedInner">${article.repeat(2)}</p></${tag}>`
    );
    const host = document.getElementById('nestedHost')!;
    const inner = document.getElementById('nestedInner')!;
    const hostOriginalText = host.textContent!.trim();

    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();
    expect(observed).toContain(inner);
    expect(observed).toContain(host);

    // 内层段落批次失败，通知展示
    intersecting(inner);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: false, error: 'PRIVATE-NESTED-FAILURE' });
    const alert = await vi.waitFor(() => {
      const el = document.querySelector('[role="alert"]') as HTMLElement | null;
      expect(el).not.toBeNull();
      return el;
    });
    // 通知必须挂在 body 直下，不得进入任何可观察段落的子树
    expect(alert.parentElement).toBe(document.body);

    // 祖先容器随后进入视口，其采集文本必须仍是纯净原文
    intersecting(host);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(2));
    const hostBatch = messages.filter((message) => message.type === 'BATCH_TRANSLATE_TEXT').at(-1);
    const hostPayload = (hostBatch?.payload as { paragraphs: { text: string }[] }).paragraphs;
    expect(hostPayload[0]?.text).toBe(hostOriginalText);
    expect(hostPayload[0]?.text).not.toContain('批量翻译失败');
  });

  it('body 直下直接文本被注册时，扩展浮层不混入段落采集', async () => {
    // 模拟无段落包裹的纯文本页面：body 直下长英文直接文本（findParagraphAncestor 会返回 body 自身）
    document.body.appendChild(document.createTextNode(article.repeat(2)));
    // 5 段正文副本 + 2 段 body 直接文本；nav 内的副本不属于可翻译正文。
    const bodyOriginalText = article.repeat(7).trim();

    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();
    expect(observed).toContain(document.body);

    // story 批次失败，通知挂载在 body 直下
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: false, error: 'PRIVATE-BODY-FAILURE' });
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());

    // body 进入视口：采集文本必须仍是页面原始文本，通知/浮动按钮等浮层不混入
    intersecting(document.body);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(2));
    const bodyBatch = messages.filter((message) => message.type === 'BATCH_TRANSLATE_TEXT').at(-1);
    const bodyPayload = (bodyBatch?.payload as { paragraphs: { text: string }[] }).paragraphs;
    expect(bodyPayload[0]?.text).toBe(bodyOriginalText);
    expect(bodyPayload[0]?.text).not.toContain('批量翻译失败');
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

  it.each([
    ['inline-only', 'bilingual'],
    ['inline-only', 'full-translate'],
    ['bilingual', 'inline-only'],
    ['bilingual', 'full-translate'],
    ['full-translate', 'inline-only'],
    ['full-translate', 'bilingual'],
  ] as const)('设置广播从 %s 切换到 %s 只重绘已有结果，不重发请求', async (from, to) => {
    currentSettings = { ...settings, translationMode: from };
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    // 可见段落也不得因模式切换重新进入获取链。
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      value: () => ({ top: 10, bottom: 110, left: 10, right: 610, width: 600, height: 100 }),
    });
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({
      success: true,
      data: { results: [{ id: 'para_story', result: {
        words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8, isPhrase: false }],
        sentences: [], fullText: '旧模式译文',
      } }] },
    });
    await vi.waitFor(() => expect(paragraph.classList.contains('not-translator-processed')).toBe(true));

    currentSettings = { ...currentSettings, translationMode: to };
    expect(await dispatch('SETTINGS_UPDATED')).toEqual({ success: true });
    await dispatch('SETTINGS_UPDATED');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(translationCallbacks).toHaveLength(1);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
    expect(paragraph.classList.contains('not-translator-processed')).toBe(true);
    if (to === 'bilingual') {
      expect(paragraph.dataset.originalText).toBe(article.repeat(5));
      expect(paragraph.querySelector('.not-translator-highlight')?.getAttribute('data-word')).toBe('ephemeral');
      expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('旧模式译文');
    } else if (to === 'full-translate') {
      expect(paragraph.textContent).toBe('旧模式译文');
    } else {
      expect(paragraph.querySelector('.not-translator-highlight')?.getAttribute('data-word')).toBe('ephemeral');
      expect(document.querySelector('.not-translator-translation-line')).toBeNull();
    }
    expect(document.querySelector('.not-translator-loading-spinner')).toBeNull();
    expect(paragraph.classList.contains('not-translator-fade-out')).toBe(false);
  });

  it.each([
    ['inline-only', 'bilingual', '对照'],
    ['bilingual', 'full-translate', '全文'],
    ['full-translate', 'inline-only', '行内'],
  ] as const)('设置广播从 %s 切换到 %s 时浮动按钮同步显示当前模式', async (from, to, label) => {
    currentSettings = { ...settings, translationMode: from };
    await createTranslator();
    expect(document.querySelector(`[data-mode="${from}"]`)?.getAttribute('aria-pressed')).toBe('true');

    currentSettings = { ...currentSettings, translationMode: to };
    await dispatch('SETTINGS_UPDATED');

    await vi.waitFor(() => expect(document.querySelector(`[data-mode="${to}"]`)?.getAttribute('aria-pressed')).toBe('true'));
    expect(document.querySelector(`[data-mode="${from}"]`)?.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('.not-translator-floating-btn-text')?.textContent).toBe(label);
  });

  it('设置广播切换模式保留在途批次，响应按最新展示模式呈现', async () => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    Object.defineProperty(paragraph, 'getBoundingClientRect', {
      value: () => ({ top: 10, bottom: 110, left: 10, right: 610, width: 600, height: 100 }),
    });
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    currentSettings = { ...currentSettings, translationMode: 'full-translate' };
    await dispatch('SETTINGS_UPDATED');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(translationCallbacks).toHaveLength(1);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
    expect(messages.find(message => message.type === 'BATCH_TRANSLATE_TEXT'))
      .toMatchObject({ payload: { mode: 'bilingual' } });

    translationCallbacks[0]({ success: true, data: { results: [{
      id: 'para_story', result: { words: [], sentences: [], fullText: '新模式全文译文' },
    }] } });
    await vi.waitFor(() => expect(paragraph.textContent).toBe('新模式全文译文'));
    expect(paragraph.classList.contains('not-translator-full-translated')).toBe(true);
    expect(document.querySelector('.not-translator-translation-line')).toBeNull();
    expect(document.querySelector('.not-translator-loading-spinner')).toBeNull();
  });

  it.each(['shortcut', 'button'] as const)('%s 切换本地结果只重绘并保存模式，重复广播不补请求', async entry => {
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8 }], sentences: [],
    } }] } });
    await vi.waitFor(() => expect(paragraph.classList.contains('not-translator-processed')).toBe(true));

    if (entry === 'shortcut') await dispatch('TOGGLE_MODE');
    else document.querySelector<HTMLButtonElement>('[data-mode="bilingual"]')!.click();
    expect(messages.find(message => message.type === 'UPDATE_SETTINGS')).toMatchObject({
      payload: { translationMode: 'bilingual' },
    });
    const previous = currentSettings;
    currentSettings = { ...currentSettings, translationMode: 'bilingual' };
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ settings: { oldValue: previous, newValue: currentSettings } }, 'sync');
    }
    await dispatch('SETTINGS_UPDATED');
    await dispatch('SETTINGS_UPDATED');
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(translationCallbacks).toHaveLength(1);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
    expect(paragraph.querySelector('.not-translator-highlight')).not.toBeNull();
    expect(paragraph.classList.contains('not-translator-processed')).toBe(true);
  });

  it.each(['sequential', 'page'] as const)('%s 操作切模式时保留后续段落的获取模式，仅改变响应呈现', async entry => {
    const count = entry === 'page' ? 16 : 2;
    document.querySelector('article')!.innerHTML = Array.from({ length: count }, (_, index) =>
      `<p id="operation-${index}">${article.repeat(2)}</p>`).join('');
    const instance = await createTranslator();
    const pending = entry === 'page'
      ? dispatch('TRANSLATE_PAGE')
      : (instance as unknown as { scanPageSequential(elements: HTMLElement[], mode: string): Promise<void> })
        .scanPageSequential(Array.from(document.querySelectorAll('article p')), 'inline-only');
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    currentSettings = { ...currentSettings, translationMode: 'bilingual' };
    await dispatch('SETTINGS_UPDATED');
    await vi.waitFor(() => expect(document.querySelector('[data-mode="bilingual"]')?.getAttribute('aria-pressed')).toBe('true'));
    const result = { words: [], sentences: [], fullText: '同一获取结果的新展示' };
    translationCallbacks[0]({ success: true, data: entry === 'page'
      ? { results: Array.from({ length: 15 }, () => ({ result })) } : result });
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(2));
    expect(messages.filter(message => ['TRANSLATE_TEXT', 'BATCH_TRANSLATE_TEXT'].includes(message.type)))
      .toEqual([expect.objectContaining({ payload: expect.objectContaining({ mode: 'inline-only' }) }),
        expect.objectContaining({ payload: expect.objectContaining({ mode: 'inline-only' }) })]);
    expect(document.querySelector('.not-translator-translation-line')?.textContent).toContain(result.fullText);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
    translationCallbacks[1]({ success: true, data: entry === 'page' ? { results: [{ result }] } : result });
    await pending;
  });

  it.each([
    ['provider', { apiProvider: 'anthropic' }],
    ['credential', { apiConfigs: [{ id: 'test-provider', name: '测试配置', provider: 'openai', apiKey: 'TEST_UPDATED_KEY' }] }],
    ['grammar', { grammarTranslationEnabled: true }],
  ] as const)('非模式 %s 配置变化仍取消在途请求、丢弃旧结果', async (_name, patch) => {
    await createTranslator();
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const request = messages.find(message => message.type === 'BATCH_TRANSLATE_TEXT')!;
    currentSettings = { ...currentSettings, ...patch } as UserSettings;
    await dispatch('SETTINGS_UPDATED');
    await vi.waitFor(() => expect(messages).toContainEqual({ type: 'CANCEL_TRANSLATION', payload: { requestId: request.requestId } }));
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [], sentences: [], fullText: '失效旧结果',
    } }] } });
    await new Promise(resolve => setTimeout(resolve, 300));
    currentSettings = { ...currentSettings, translationMode: 'bilingual' };
    await dispatch('SETTINGS_UPDATED');
    expect(document.body.textContent).not.toContain('失效旧结果');
  });

  it.each(['apiKey', 'legacyApiKeyInvalidated'] as const)('%s 存储变化仍取消在途请求，模式切换不得复活旧结果', async key => {
    await createTranslator();
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const request = messages.find(message => message.type === 'BATCH_TRANSLATE_TEXT')!;
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ [key]: { oldValue: [], newValue: ['ephemeral'] } }, ['knownWords', 'unknownWords'].includes(key) ? 'local' : 'sync');
    }
    expect(messages).toContainEqual({ type: 'CANCEL_TRANSLATION', payload: { requestId: request.requestId } });
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [], sentences: [], fullText: '失效词表结果',
    } }] } });
    currentSettings = { ...currentSettings, translationMode: 'bilingual' };
    await dispatch('SETTINGS_UPDATED');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(document.body.textContent).not.toContain('失效词表结果');
  });

  it.each(['provider', 'disable', 'destroy'] as const)('%s 失效后切换展示模式不恢复已完成的旧结果', async cause => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    const instance = await createTranslator();
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [], sentences: [], fullText: '已完成但失效的译文',
    } }] } });
    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')).not.toBeNull());
    if (cause === 'provider') {
      currentSettings = { ...currentSettings, apiProvider: 'anthropic' };
      await dispatch('SETTINGS_UPDATED');
    } else if (cause === 'disable') await dispatch('TOGGLE_ENABLED');
    else instance.destroy();
    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')).toBeNull());
    const { TranslationDisplay } = await import('@/content/translationDisplay');
    TranslationDisplay.rerenderTranslations('full-translate');
    expect(document.body.textContent).not.toContain('已完成但失效的译文');
  });

  it.each([
    ['batch', false], ['sequential', false], ['paragraph', false], ['page', false],
    ['batch', true], ['sequential', true], ['paragraph', true], ['page', true],
  ] as const)('%s 入口合法空或grammar-only=%s结果统一留存，切模式不重取或丢原文', async (entry, grammarOnly) => {
    currentSettings = { ...settings, grammarTranslationEnabled: grammarOnly };
    const instance = await createTranslator();
    const paragraph = document.getElementById('story')!;
    const control = instance as unknown as {
      scanPageSequential(elements: HTMLElement[], mode: string): Promise<void>;
      translateParagraph(element: HTMLElement): Promise<unknown>;
    };
    let pending: Promise<unknown> = Promise.resolve();
    if (entry === 'batch') intersecting(paragraph);
    else if (entry === 'page') pending = dispatch('TRANSLATE_PAGE');
    else if (entry === 'sequential') pending = control.scanPageSequential([paragraph], 'inline-only');
    else pending = control.translateParagraph(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const result = { words: [], sentences: [], ...(grammarOnly ? { grammarPoints: [{
      original: 'ephemeral', explanation: '用于修饰名词', type: '形容词', position: [4, 13],
    }] } : {}) };
    translationCallbacks[0]({ success: true, data: ['batch', 'page'].includes(entry)
      ? { results: [{ id: 'para_story', result }] } : result });
    await pending;
    await vi.waitFor(() => expect(paragraph.classList.contains('not-translator-processed')).toBe(true));
    for (const mode of ['bilingual', 'full-translate', 'inline-only', 'bilingual', 'full-translate'] as const) {
      currentSettings = { ...currentSettings, translationMode: mode };
      await dispatch('SETTINGS_UPDATED');
      await vi.waitFor(() => expect(document.querySelector(`[data-mode="${mode}"]`)?.getAttribute('aria-pressed')).toBe('true'));
      expect(getTranslatableText(paragraph).trim()).toBe(article.repeat(5).trim());
      expect(document.querySelectorAll('.not-translator-translation-line')).toHaveLength(mode === 'inline-only' ? 0 : 1);
      expect(translationCallbacks).toHaveLength(1);
    }
  });

  it.each([
    ['knownWords', false], ['userProfile', false], ['knownWords', true], ['userProfile', true],
  ] as const)('%s 学习同步且词汇高亮=%s时只更新本地展示，保留全文且下次重绘不复活已认识词', async (key, vocabHighlightEnabled) => {
    currentSettings = { ...settings, translationMode: 'bilingual', vocabHighlightEnabled };
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8 }],
      sentences: [], fullText: '应保留的完整中文',
    } }] } });
    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('应保留的完整中文'));
    currentKnownWords = ['ephemeral'];
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ [key]: { newValue: currentKnownWords } }, key === 'knownWords' ? 'local' : 'sync');
    }
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('应保留的完整中文');
    currentSettings = { ...currentSettings, translationMode: 'inline-only' };
    await dispatch('SETTINGS_UPDATED');
    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')).toBeNull());
    expect(paragraph.querySelector('[data-word="ephemeral"]')).toBeNull();
    expect(translationCallbacks).toHaveLength(1);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
  });

  it('已认识广播后在途响应按最新学习状态呈现，改回未知可重绘原始词义而不请求', async () => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    await dispatch('WORD_MARKED', { word: 'ephemeral', isKnown: true });
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8 }],
      sentences: [], fullText: '应保留的完整中文',
    } }] } });
    await vi.waitFor(() => expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('应保留的完整中文'));
    expect(paragraph.querySelector('[data-word="ephemeral"]')).toBeNull();
    await dispatch('WORD_MARKED', { word: 'ephemeral', isKnown: false });
    expect(paragraph.querySelector('[data-word="ephemeral"]')).not.toBeNull();
    expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('应保留的完整中文');
    expect(translationCallbacks).toHaveLength(1);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
  });

  it.each(['unknown', 'add', 'undo'] as const)('本地认识后%s恢复保留词义，全程不清页或重新获取', async action => {
    currentSettings = { ...settings, translationMode: 'bilingual' };
    const instance = await createTranslator();
    const control = instance as unknown as {
      handleMarkKnown(word: string): Promise<void>;
      handleMarkUnknown(word: string, translation: string): Promise<void>;
      handleAddToVocabulary(word: string, translation: string): Promise<void>;
      handleUndoLastMark(): Promise<void>;
    };
    const paragraph = document.getElementById('story')!;
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8 }],
      sentences: [], fullText: '应保留的完整中文',
    } }] } });
    await vi.waitFor(() => expect(paragraph.querySelector('[data-word="ephemeral"]')).not.toBeNull());
    await control.handleMarkKnown('ephemeral');
    expect(paragraph.querySelector('[data-word="ephemeral"]')).toBeNull();
    expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('应保留的完整中文');
    if (action === 'undo') await control.handleUndoLastMark();
    else if (action === 'add') await control.handleAddToVocabulary('ephemeral', '短暂的');
    else await control.handleMarkUnknown('ephemeral', '短暂的');
    expect(paragraph.querySelector('[data-word="ephemeral"]')).not.toBeNull();
    expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('应保留的完整中文');
    expect(translationCallbacks).toHaveLength(1);
  });

  it('无关统计和用量存储变化不取消、不清理、不重新获取翻译', async () => {
    await createTranslator();
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ stats: { newValue: { reads: 1 } }, usage: { newValue: { tokens: 1 } } }, 'local');
    }
    await new Promise(resolve => setTimeout(resolve, 700));
    expect(translationCallbacks).toHaveLength(1);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
  });

  it('销毁清空当前页的学习过滤状态，不让后续页面继承已知词', async () => {
    const instance = await createTranslator();
    await dispatch('WORD_MARKED', { word: 'ephemeral', isKnown: true });
    instance.destroy();
    const paragraph = document.getElementById('story')!;
    const { TranslationDisplay } = await import('@/content/translationDisplay');
    TranslationDisplay.applyTranslation(paragraph, {
      words: [{ original: 'ephemeral', translation: '短暂的', position: [4, 13], difficulty: 8 }], sentences: [],
    }, 'inline-only', settings);
    expect(paragraph.querySelector('[data-word="ephemeral"]')).not.toBeNull();
  });

  it('本页关闭后仅模式广播不重新启用或扫描，也不恢复已取消的响应', async () => {
    await createTranslator();
    const paragraph = document.getElementById('story')!;
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    await dispatch('TOGGLE_ENABLED');
    const observedCount = observed.length;
    currentSettings = { ...currentSettings, translationMode: 'bilingual' };
    await dispatch('SETTINGS_UPDATED');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(observed).toHaveLength(observedCount);
    intersecting(paragraph);
    await new Promise(resolve => setTimeout(resolve, 250));
    translationCallbacks[0]({ success: true, data: { results: [{ id: 'para_story', result: {
      words: [], sentences: [], fullText: '关闭后不可复活',
    } }] } });
    await Promise.resolve();
    expect(translationCallbacks).toHaveLength(1);
    expect(document.body.textContent).not.toContain('关闭后不可复活');
  });

  it('仅切模式不触发旧段落请求，新插入正文仍按新模式自动获取', async () => {
    await createTranslator();
    currentSettings = { ...currentSettings, translationMode: 'bilingual' };
    await dispatch('SETTINGS_UPDATED');
    await vi.waitFor(() => expect(document.querySelector('[data-mode="bilingual"]')?.getAttribute('aria-pressed')).toBe('true'));
    expect(translationCallbacks).toHaveLength(0);
    document.querySelector('article')!.insertAdjacentHTML('beforeend', `<p id="new-mode-story">${article.repeat(2)}</p>`);
    const paragraph = document.getElementById('new-mode-story')!;
    await vi.waitFor(() => expect(observed).toContain(paragraph));
    intersecting(paragraph);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    expect(messages.find(message => message.type === 'BATCH_TRANSLATE_TEXT'))
      .toMatchObject({ payload: { mode: 'bilingual', paragraphs: [{ text: article.repeat(2).trim() }] } });
  });

  it('显式服务配置的模式保存附带清理旧凭据时，不把无关旧字段当成获取配置变化', async () => {
    currentSettings = { ...settings, apiProvider: 'anthropic' };
    await createTranslator();
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    const previous = currentSettings;
    currentSettings = { ...previous, translationMode: 'bilingual' };
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ settings: { oldValue: previous, newValue: currentSettings },
        apiKey: { newValue: '' }, legacyApiKeyInvalidated: { newValue: true } }, 'sync');
    }
    await vi.waitFor(() => expect(document.querySelector('[data-mode="bilingual"]')?.getAttribute('aria-pressed')).toBe('true'));
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
    expect(translationCallbacks).toHaveLength(1);
  });

  it('settings 存储事件与设置广播重复到达时仅重绘一次，不取消或重扫', async () => {
    await createTranslator();
    intersecting(document.getElementById('story')!);
    await vi.waitFor(() => expect(translationCallbacks).toHaveLength(1));
    currentSettings = { ...currentSettings, translationMode: 'bilingual' };
    for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
      listener({ settings: { oldValue: settings, newValue: currentSettings } }, 'sync');
    }
    await vi.waitFor(() => expect(document.querySelector('[data-mode="bilingual"]')?.getAttribute('aria-pressed')).toBe('true'));
    await dispatch('SETTINGS_UPDATED');
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(translationCallbacks).toHaveLength(1);
    expect(messages.some(message => message.type === 'CANCEL_TRANSLATION')).toBe(false);
  });

  it.each(['llm', 'traditional', 'hybrid'] as const)('浮动按钮切换到 %s 只提交引擎字段，不回传旧密钥', async engine => {
    const snapshot = {
      ...settings,
      hybridTranslation: {
        enabled: true, defaultEngine: engine === 'hybrid' ? 'traditional' as const : 'hybrid' as const,
        traditionalProvider: 'deepl' as const, traditionalApiKey: 'STALE_DEEPL_TEST_KEY',
        simpleTextThreshold: 20, enableSmartRouting: true, priority: 'balanced' as const,
      },
    };
    currentSettings = snapshot;
    await createTranslator();
    // 页面仍持有旧快照，模拟后台已切换提供商且清空密钥但广播尚未送达。
    currentSettings = {
      ...snapshot,
      hybridTranslation: { ...snapshot.hybridTranslation, traditionalProvider: 'google_translate', traditionalApiKey: '' },
    };

    const button = document.querySelector<HTMLButtonElement>(`[data-engine="${engine}"]`)!;
    button.click();

    expect(messages.filter(message => message.type === 'UPDATE_SETTINGS')).toEqual([
      { type: 'UPDATE_SETTINGS', payload: { hybridTranslationPatch: { defaultEngine: engine } } },
    ]);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(snapshot.hybridTranslation.traditionalApiKey).toBe('STALE_DEEPL_TEST_KEY');
  });

  it('未配置混合翻译的旧页面切换引擎时，不提交推测的默认值或密钥', async () => {
    await createTranslator();

    document.querySelector<HTMLButtonElement>('[data-engine="traditional"]')!.click();

    expect(messages.filter(message => message.type === 'UPDATE_SETTINGS')).toEqual([
      { type: 'UPDATE_SETTINGS', payload: { hybridTranslationPatch: { defaultEngine: 'traditional' } } },
    ]);
  });

  it('重复选择当前引擎不保存设置', async () => {
    await createTranslator();
    const button = document.querySelector<HTMLButtonElement>('[data-engine="traditional"]')!;
    button.click();
    button.click();

    expect(messages.filter(message => message.type === 'UPDATE_SETTINGS')).toHaveLength(1);
  });

  it('主监听器不抢答逐段进度事件', async () => {
    await createTranslator();
    const respond = vi.fn();
    listeners.forEach(listener => listener({
      type: 'BATCH_TRANSLATION_PROGRESS', requestId: 'old-request',
      payload: { id: 'p1', cached: false, result: { words: [], sentences: [] } },
    }, {}, respond));
    expect(respond).not.toHaveBeenCalled();
  });

  it('未知消息返回可诊断错误，且不触发翻译请求', async () => {
    await createTranslator();
    expect(await dispatch('INVALID_MESSAGE')).toEqual({ success: false, error: 'Unknown message type' });
    expect(messages.some((message) => message.type === 'TRANSLATE_TEXT')).toBe(false);
  });
});
