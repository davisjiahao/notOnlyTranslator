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
      vocabularyAssessmentProvider: 'legacy' as 'legacy' | 'jev',
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
    deferSettings: false,
    settingsResolvers: [] as Array<(settings: unknown) => void>,
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

    if (message.type === 'GET_SETTINGS' && state.deferSettings) {
      return new Promise(resolve => {
        state.settingsResolvers.push(settings => {
          const response = respond(settings);
          callback?.(response);
          resolve(response);
        });
      });
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
import { TranslationDisplay } from '@/content/translationDisplay';
import { logger } from '@/shared/utils';

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
  state.deferSettings = false;
  state.settingsResolvers = [];
  state.settings = { ...initialSettings };
  state.profile = { ...state.profile, estimatedVocabulary: 3000 };
  document.body.textContent = LONG_ENGLISH_TEXT;
});

afterEach(() => {
  while (created.length > 0) {
    created.pop()?.destroy();
  }
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

type SettingsControl = {
  settings: typeof state.settings;
  isEnabled: boolean;
  handleSettingsUpdated(): Promise<void>;
  handleModeChange(mode: 'inline-only' | 'bilingual' | 'full-translate'): void;
  toggleEnabled(): void;
  refreshTranslation(mode: string): void;
};

describe('设置热更新的页面生命周期', () => {
  it.each([
    [true, 'inline-only'], [true, 'bilingual'], [false, 'inline-only'], [false, 'bilingual'],
  ] as const)('GET_SETTINGS挂起期间本页开关从%s反转后，%s响应不覆盖最新本页状态', async (enabled, mode) => {
    const control = await createTranslator() as unknown as SettingsControl;
    if (!enabled) control.toggleEnabled();
    state.deferSettings = true;
    const reading = control.handleSettingsUpdated();
    control.toggleEnabled();
    state.settingsResolvers[0]({ ...state.settings, translationMode: mode });
    await reading;
    expect(control.isEnabled).toBe(!enabled);
    expect(control.settings.translationMode).toBe(mode);
  });

  it('两次设置读取乱序时拒绝旧响应，不覆盖最新服务配置或模式', async () => {
    const control = await createTranslator() as unknown as SettingsControl;
    const refresh = vi.spyOn(control, 'refreshTranslation').mockImplementation(() => {});
    state.deferSettings = true;
    const first = control.handleSettingsUpdated();
    const second = control.handleSettingsUpdated();
    state.settingsResolvers[1]({ ...state.settings, translationMode: 'full-translate', apiProvider: 'anthropic' });
    await second;
    state.settingsResolvers[0]({ ...state.settings, translationMode: 'bilingual' });
    await first;
    expect(control.settings).toMatchObject({ translationMode: 'full-translate', apiProvider: 'anthropic' });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each(['mode', 'provider'] as const)('并发重复%s设置只提交一次有效变化，不重复重绘或刷新', async change => {
    const control = await createTranslator() as unknown as SettingsControl;
    const refresh = vi.spyOn(control, 'refreshTranslation').mockImplementation(() => {});
    const rerender = vi.spyOn(TranslationDisplay, 'rerenderTranslations');
    state.deferSettings = true;
    const first = control.handleSettingsUpdated();
    const second = control.handleSettingsUpdated();
    const snapshot = { ...state.settings, translationMode: 'bilingual', ...(change === 'provider' ? { apiProvider: 'anthropic' } : {}) };
    state.settingsResolvers[0](snapshot);
    await first;
    state.settingsResolvers[1](snapshot);
    await second;
    expect(refresh).toHaveBeenCalledTimes(change === 'provider' ? 1 : 0);
    expect(rerender).toHaveBeenCalledTimes(change === 'mode' ? 1 : 0);
    rerender.mockRestore();
  });

  it('本地模式选择使更早的设置读取失效，保存回声不取消或刷新', async () => {
    const control = await createTranslator() as unknown as SettingsControl;
    const refresh = vi.spyOn(control, 'refreshTranslation').mockImplementation(() => {});
    state.deferSettings = true;
    const reading = control.handleSettingsUpdated();
    control.handleModeChange('bilingual');
    state.settingsResolvers[0](state.settings);
    await reading;
    expect(control.settings.translationMode).toBe('bilingual');
    state.deferSettings = false;
    state.settings = { ...state.settings, translationMode: 'bilingual' };
    await control.handleSettingsUpdated();
    expect(refresh).not.toHaveBeenCalled();
    expect(state.sentMessages.filter(message => message.type === 'CANCEL_TRANSLATION')).toHaveLength(0);
  });

  it('设置读取的日志不打印包含凭据的完整响应', async () => {
    state.settings = { ...state.settings, apiConfigs: [{ apiKey: 'SYNTH_PRIVATE_SETTINGS_KEY' }] };
    const control = await createTranslator() as unknown as SettingsControl;
    await control.handleSettingsUpdated();
    expect(JSON.stringify([...vi.mocked(logger.debug).mock.calls, ...vi.mocked(logger.info).mock.calls]))
      .not.toContain('SYNTH_PRIVATE_SETTINGS_KEY');
  });
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

  it('模式变化仅重绘，真实其他设置变化才刷新翻译和同步高亮', async () => {
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
    expect(refresh).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();

    state.settings = { ...state.settings, vocabHighlightEnabled: true };
    await control.handleSettingsUpdated();
    expect(refresh).toHaveBeenCalledOnce();
    expect(sync).toHaveBeenCalledOnce();
  });
});

describe('Jev 阅读坐标与模式生命周期', () => {
  it('Jev 适用时不生成独立 CEFR 预高亮，画像跨档后取消旧请求', async () => {
    state.settings = { ...state.settings, vocabularyAssessmentProvider: 'jev', vocabHighlightEnabled: true };
    const translator = await createTranslator();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The plant makes products in a factory with many people.';
    document.body.appendChild(paragraph);
    const control = translator as unknown as {
      isVocabHighlightEnabled(): boolean;
      applyVocabularySnapshot(snapshot: import('@/content/core/vocabularyState').VocabularySnapshot): void;
      translateParagraph(element: HTMLElement): Promise<void>;
      scanPage(): Promise<void>;
    };
    expect(control.isVocabHighlightEnabled()).toBe(false);
    vi.spyOn(control, 'scanPage').mockResolvedValue(undefined);
    const request = control.translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));
    control.applyVocabularySnapshot({
      userLevel: 'B2', knownWords: new Set(), unknownWords: new Set(),
      userProfile: { ...state.profile, estimatedVocabulary: 5000 } as import('@/shared/types').UserProfile,
    } as import('@/content/core/vocabularyState').VocabularySnapshot);
    expect(control.isVocabHighlightEnabled()).toBe(true);
    expect(state.sentMessages.filter(message => message.type === 'CANCEL_TRANSLATION')).toHaveLength(1);
    state.translationCallbacks[0]({ success: true, data: { words: [], sentences: [], fullText: '旧档案结果' } });
    await request;
    expect(paragraph.classList.contains('not-translator-processed')).toBe(false);
  });

  it('画像读取期间模式变化，按提交时资格取消新模式的旧画像请求', async () => {
    state.settings = { ...state.settings, vocabularyAssessmentProvider: 'jev', translationMode: 'bilingual' };
    state.profile = { ...state.profile, estimatedVocabulary: 3000 };
    const translator = await createTranslator();
    const control = translator as unknown as {
      refreshUserProfile(): Promise<void>; handleModeChange(mode: 'inline-only'): void;
      translateParagraph(element: HTMLElement): Promise<void>; scanPage(): Promise<void>;
    };
    vi.spyOn(control, 'scanPage').mockResolvedValue(undefined);
    state.deferProfile = true;
    const reading = control.refreshUserProfile();
    control.handleModeChange('inline-only');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The plant makes products.';
    document.body.appendChild(paragraph);
    const request = control.translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));
    state.profile = { ...state.profile, estimatedVocabulary: 5000 };
    state.profileResolvers[0]();
    await reading;
    expect(state.sentMessages.filter(message => message.type === 'CANCEL_TRANSLATION')).toHaveLength(1);
    state.translationCallbacks[0]({ success: true, data: { words: [], sentences: [] } });
    await request;
    expect(paragraph.classList.contains('not-translator-processed')).toBe(false);
    state.profile = { ...state.profile, estimatedVocabulary: 3000 };
  });

  it('单段阅读请求保留首尾空白，第二个跨节点词按原文 utf16 坐标渲染', async () => {
    const translator = await createTranslator();
    const paragraph = document.createElement('p');
    paragraph.innerHTML = '  The plant grows; the <em>pla</em><strong>nt</strong> makes products.  ';
    document.body.appendChild(paragraph);
    const text = '  The plant grows; the plant makes products.  ';
    const control = translator as unknown as { translateParagraph(element: HTMLElement): Promise<void> };
    const request = control.translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));
    expect(state.sentMessages.find(message => message.type === 'TRANSLATE_TEXT')).toMatchObject({
      payload: { text, intent: 'reading' },
    });
    const start = text.lastIndexOf('plant');
    state.translationCallbacks[0]({ success: true, data: {
      words: [{ original: 'plant', translation: '工厂', position: [start, start + 5], difficulty: 5, isPhrase: false }],
      sentences: [], vocabularyAssessment: { provider: 'jev' },
    } });
    await request;
    const marks = Array.from(paragraph.querySelectorAll<HTMLElement>('mark.not-translator-highlight'));
    expect(marks.map(mark => mark.firstChild?.textContent).join('')).toBe('plant');
    expect(paragraph.firstChild?.textContent).toBe('  The plant grows; the ');
    TranslationDisplay.clearTranslation(paragraph);
    expect(paragraph.innerHTML).toBe('  The plant grows; the <em>pla</em><strong>nt</strong> makes products.  ');
  });

  it('页面批次保留首尾空白并显式声明 reading', async () => {
    const translator = await createTranslator();
    const text = '  The plant grows while the plant makes products in this long sentence.  ';
    document.body.innerHTML = `<p>${text}</p>`;
    const control = translator as unknown as { handleTranslatePage(): Promise<unknown> };
    const request = control.handleTranslatePage();
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));
    const message = state.sentMessages.find(item => item.type === 'BATCH_TRANSLATE_TEXT');
    expect(message).toMatchObject({ payload: { paragraphs: [{ text }], intent: 'reading' } });
    state.translationCallbacks[0]({ success: true, data: { results: [{ result: { words: [], sentences: [] } }] } });
    await request;
  });

  it.each(['local', 'settings'] as const)('%s 模式切换离开 Jev 时取消旧响应并重新获取', async source => {
    state.settings = { ...state.settings, vocabularyAssessmentProvider: 'jev' };
    const translator = await createTranslator();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The plant makes products.';
    document.body.appendChild(paragraph);
    const control = translator as unknown as {
      translateParagraph(element: HTMLElement): Promise<void>;
      handleModeChange(mode: 'bilingual'): void;
      handleSettingsUpdated(): Promise<void>;
      scanPage(): Promise<void>;
    };
    const scan = vi.spyOn(control, 'scanPage').mockResolvedValue(undefined);
    const request = control.translateParagraph(paragraph);
    await waitUntil(() => expect(state.translationCallbacks).toHaveLength(1));
    if (source === 'local') control.handleModeChange('bilingual');
    else {
      state.settings = { ...state.settings, translationMode: 'bilingual' };
      await control.handleSettingsUpdated();
    }
    expect(state.sentMessages.filter(message => message.type === 'CANCEL_TRANSLATION')).toHaveLength(1);
    state.translationCallbacks[0]({ success: true, data: { words: [], sentences: [], fullText: '旧结果不得重显' } });
    await request;
    expect(paragraph.classList.contains('not-translator-processed')).toBe(false);
    await waitUntil(() => expect(scan).toHaveBeenCalledOnce());
  });

  it('返回 Jev 行内模式时丢弃其他模式的已完成结果并重新获取', async () => {
    state.settings = { ...state.settings, vocabularyAssessmentProvider: 'jev', translationMode: 'bilingual' };
    const translator = await createTranslator();
    const paragraph = document.createElement('p');
    paragraph.textContent = 'The plant makes products.';
    document.body.appendChild(paragraph);
    TranslationDisplay.applyTranslation(paragraph, { words: [], sentences: [], fullText: '工厂生产产品。' }, 'bilingual');
    const control = translator as unknown as { handleModeChange(mode: 'inline-only'): void; scanPage(): Promise<void> };
    const scan = vi.spyOn(control, 'scanPage').mockResolvedValue(undefined);
    control.handleModeChange('inline-only');
    expect(paragraph.classList.contains('not-translator-processed')).toBe(false);
    expect(paragraph.nextElementSibling).toBeNull();
    await waitUntil(() => expect(scan).toHaveBeenCalledOnce());
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

  it('切换模式保留直接发起的在途翻译，并按最新模式显示响应', async () => {
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

    expect(state.sentMessages.filter((message) => message.type === 'CANCEL_TRANSLATION')).toHaveLength(0);
    resolveTranslation(0);
    await waitUntil(() => expect(document.querySelector('.not-translator-translation-line')?.textContent).toBe('短暂的'));
    expect(state.translationCallbacks).toHaveLength(1);
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
