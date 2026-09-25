import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const chromeMock = vi.hoisted(() => {
  const state = {
    settings: {
      enabled: true,
      autoHighlight: false,
      vocabHighlightEnabled: false,
      phraseTranslationEnabled: false,
      grammarTranslationEnabled: false,
      translationMode: 'inline-only',
      showDifficulty: true,
      highlightColor: '#ffd54f',
      fontSize: 14,
      apiProvider: 'openai',
      blacklist: [] as string[],
      apiConfigs: [] as unknown[],
      hoverDelay: 0,
      theme: 'light',
    },
    profile: {
      examType: 'cet4',
      estimatedVocabulary: 3000,
      knownWords: [] as string[],
      unknownWords: [],
      levelConfidence: 0.9,
      createdAt: 0,
      updatedAt: 0,
    },
    sentMessages: [] as Array<{ type: string; payload?: unknown }>,
    translationCallbacks: [] as Array<(response: unknown) => void>,
    profileResolvers: [] as Array<() => void>,
    deferProfile: false,
  };

  const respond = (data: unknown) => ({ success: true, data });
  const sendMessage = (
    message: { type: string; payload?: unknown },
    callback?: (response: unknown) => void
  ) => {
    state.sentMessages.push(message);

    if (message.type === 'TRANSLATE_TEXT' || message.type === 'BATCH_TRANSLATE_TEXT') {
      if (callback) state.translationCallbacks.push(callback);
      return Promise.resolve(undefined);
    }

    if (message.type === 'GET_USER_PROFILE' && state.deferProfile) {
      return new Promise((resolve) => {
        state.profileResolvers.push(() => {
          const response = respond(state.profile);
          if (callback) callback(response);
          resolve(response);
        });
      });
    }

    const response = message.type === 'GET_SETTINGS'
      ? respond(state.settings)
      : message.type === 'GET_USER_PROFILE'
        ? respond(state.profile)
        : message.type === 'GET_CEFR_LEVEL'
          ? respond({ level: 'B1' })
          : { success: true, data: {} };
    if (callback) callback(response);
    return Promise.resolve(response);
  };

  (globalThis as unknown as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage,
      onMessage: { addListener: () => {}, removeListener: () => {} },
      lastError: null,
    },
    storage: {
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };

  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  };

  return { state };
});

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import { NotOnlyTranslator } from '@/content/index';

const { state } = chromeMock;
const initialSettings = { ...state.settings };
const LONG_ENGLISH_TEXT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20);
const created: NotOnlyTranslator[] = [];

async function waitUntil(assertion: () => void, timeout = 2000): Promise<void> {
  const startedAt = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - startedAt > timeout) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

async function createTranslator(): Promise<NotOnlyTranslator> {
  const translator = new NotOnlyTranslator();
  created.push(translator);
  await waitUntil(() => {
    const instance = translator as unknown as { settings?: unknown; observer?: unknown };
    expect(instance.settings).toBeTruthy();
    expect(instance.observer).toBeTruthy();
  });
  return translator;
}

function resolveTranslation(index: number): void {
  state.translationCallbacks[index]?.({
    success: true,
    data: {
      words: [
        {
          original: 'ephemeral',
          translation: '短暂的',
          position: [0, 9],
          difficulty: 8,
          isPhrase: false,
        },
      ],
      sentences: [],
      fullText: '短暂的',
    },
  });
}

beforeAll(async () => {
  document.body.textContent = LONG_ENGLISH_TEXT;
  await waitUntil(() => {
    expect((window as unknown as { __NOT_ONLY_TRANSLATOR__?: NotOnlyTranslator }).__NOT_ONLY_TRANSLATOR__).toBeTruthy();
  });
  (window as unknown as { __NOT_ONLY_TRANSLATOR__?: NotOnlyTranslator }).__NOT_ONLY_TRANSLATOR__?.destroy();
  (window as unknown as { __NOT_ONLY_TRANSLATOR__?: NotOnlyTranslator }).__NOT_ONLY_TRANSLATOR__ = undefined;
});

beforeEach(() => {
  state.sentMessages.length = 0;
  state.translationCallbacks.length = 0;
  state.profileResolvers.length = 0;
  state.deferProfile = false;
  state.settings = { ...initialSettings };
  document.body.textContent = LONG_ENGLISH_TEXT;
});

afterEach(() => {
  while (created.length > 0) {
    created.pop()?.destroy();
  }
  document.body.innerHTML = '';
});

describe('设置热更新的页面生命周期', () => {
  it('禁用时取消在途翻译且迟到响应不写 DOM，重新启用后恢复扫描', async () => {
    const translator = await createTranslator();
    const control = translator as unknown as {
      handleSettingsUpdated(): Promise<void>;
      scanPage(): Promise<void>;
      isEnabled: boolean;
      viewportObserver?: { disable(): void; enable(): void };
    };
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The ephemeral nature of existence is difficult.';
    document.body.appendChild(paragraph);
    const scan = vi.spyOn(control, 'scanPage').mockResolvedValue(undefined);
    const observer = control.viewportObserver;
    expect(observer).toBeTruthy();
    const disable = vi.spyOn(observer!, 'disable');
    const enable = vi.spyOn(observer!, 'enable');

    const request = (translator as unknown as {
      translateParagraph(element: HTMLElement): Promise<void>;
    }).translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));

    state.settings = { ...state.settings, enabled: false };
    await control.handleSettingsUpdated();
    expect(control.isEnabled).toBe(false);
    expect(disable).toHaveBeenCalled();
    expect(state.sentMessages.filter((message) => message.type === 'CANCEL_TRANSLATION')).toHaveLength(1);
    resolveTranslation(0);
    await request;
    expect(paragraph.classList.contains('not-translator-processed')).toBe(false);

    state.settings = { ...state.settings, enabled: true };
    await control.handleSettingsUpdated();
    expect(control.isEnabled).toBe(true);
    expect(enable).toHaveBeenCalled();
    expect(scan).toHaveBeenCalled();
  });

  it('模式变化才刷新翻译，其他设置变化只同步高亮', async () => {
    const translator = await createTranslator();
    const control = translator as unknown as {
      handleSettingsUpdated(): Promise<void>;
      refreshTranslation(mode: 'inline-only' | 'bilingual'): void;
      syncVocabHighlightEnabledState(): void;
    };
    const refresh = vi.spyOn(control, 'refreshTranslation').mockImplementation(() => {});
    const sync = vi.spyOn(control, 'syncVocabHighlightEnabledState');

    state.settings = { ...state.settings, translationMode: 'bilingual' };
    await control.handleSettingsUpdated();
    expect(refresh).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledWith('bilingual');

    state.settings = { ...state.settings, vocabHighlightEnabled: true };
    await control.handleSettingsUpdated();
    expect(refresh).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledTimes(2);
  });
});

describe('内容脚本翻译请求生命周期', () => {
  it('等待用户档案期间销毁时不发送翻译请求', async () => {
    const translator = await createTranslator();
    const target = document.createElement('span');
    document.body.appendChild(target);
    state.deferProfile = true;

    const request = (translator as unknown as {
      translateAndShowTooltip(word: string, target: HTMLElement): Promise<void>;
    }).translateAndShowTooltip('ephemeral', target);
    await waitUntil(() => expect(state.profileResolvers).toHaveLength(1));

    translator.destroy();
    state.profileResolvers[0]();
    await request;

    expect(state.sentMessages.filter((message) => message.type === 'TRANSLATE_TEXT')).toHaveLength(0);
  });

  it('响应已返回但销毁发生在 DOM 延续前时不应用段落翻译', async () => {
    const translator = await createTranslator();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The ephemeral nature of existence is difficult.';
    document.body.appendChild(paragraph);

    const request = (translator as unknown as {
      translateParagraph(element: HTMLElement): Promise<void>;
    }).translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));

    resolveTranslation(0);
    translator.destroy();
    await request;

    expect(paragraph.classList.contains('not-translator-processed')).toBe(false);
  });

  it('已取消请求的 finally 不移除后续请求的加载状态', async () => {
    const translator = await createTranslator();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The ephemeral nature of existence is difficult.';
    document.body.appendChild(paragraph);

    const first = (translator as unknown as {
      translateParagraph(element: HTMLElement): Promise<void>;
    }).translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));

    (translator as unknown as { toggleEnabled(): void }).toggleEnabled();
    (translator as unknown as { toggleEnabled(): void }).toggleEnabled();
    void (translator as unknown as {
      translateParagraph(element: HTMLElement): Promise<void>;
    }).translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(2));
    await Promise.resolve();
    await Promise.resolve();

    expect(paragraph.classList.contains('not-translator-translating')).toBe(true);
    await first;
  });

  it('切换模式会取消直接发起的在途翻译请求', async () => {
    const translator = await createTranslator();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The ephemeral nature of existence is difficult.';
    document.body.appendChild(paragraph);

    void (translator as unknown as {
      translateParagraph(element: HTMLElement): Promise<void>;
    }).translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));

    (translator as unknown as {
      handleModeChange(mode: 'inline-only' | 'bilingual'): void;
    }).handleModeChange('bilingual');

    expect(state.sentMessages.filter((message) => message.type === 'CANCEL_TRANSLATION')).toHaveLength(1);
  });

  it('去抖窗口累积多批动态元素，不丢弃先到元素', async () => {
    state.settings.autoHighlight = true;
    const translator = await createTranslator();
    (translator as unknown as { useBatchMode: boolean }).useBatchMode = false;
    const scanNewElements = vi.spyOn(
      translator as unknown as { scanNewElements(elements: HTMLElement[]): Promise<void> },
      'scanNewElements'
    ).mockResolvedValue(undefined);

    const first = document.createElement('p');
    first.textContent = 'The first dynamically inserted paragraph has enough content.';
    document.body.appendChild(first);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = document.createElement('p');
    second.textContent = 'The second dynamically inserted paragraph has enough content.';
    document.body.appendChild(second);

    await waitUntil(() => expect(scanNewElements).toHaveBeenCalledTimes(1), 3000);
    expect(scanNewElements).toHaveBeenCalledWith(expect.arrayContaining([first, second]));
    state.settings.autoHighlight = false;
  });

  it('较旧的 Tooltip 响应不会覆盖最新请求', async () => {
    const translator = await createTranslator();
    const firstTarget = document.createElement('span');
    const secondTarget = document.createElement('span');
    document.body.append(firstTarget, secondTarget);
    const tooltip = (translator as unknown as {
      tooltip: { showWord: (target: HTMLElement, data: unknown) => void };
    }).tooltip;
    const showWord = vi.spyOn(tooltip, 'showWord');

    const first = (translator as unknown as {
      translateAndShowTooltip(word: string, target: HTMLElement): Promise<void>;
    }).translateAndShowTooltip('ephemeral', firstTarget);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));
    const second = (translator as unknown as {
      translateAndShowTooltip(word: string, target: HTMLElement): Promise<void>;
    }).translateAndShowTooltip('ephemeral', secondTarget);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(2));

    resolveTranslation(0);
    await first;

    expect(showWord).not.toHaveBeenCalled();

    resolveTranslation(1);
    await second;
    expect(showWord).toHaveBeenCalledTimes(1);
  });
});
