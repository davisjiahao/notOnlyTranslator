/**
 * 阅读掌握状态同步集成测试
 *
 * 走真实初始化链路：NotOnlyTranslator.init → initVocabularyHighlighter →
 * VocabularyHighlighter → vocabularyService，覆盖：
 * 1. init 注入真实词表与 CEFR
 * 2. 认识/撤销/加入生词本同步两套高亮器（遵循既有业务语义）
 * 3. 跨标签页 storage 变化与等级变化重新同步
 * 4. destroy 解绑监听
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

/** chrome 与浏览器 API mock：必须在 index.ts 求值前安装（其会在 import 时自动初始化） */
const chromeMock = vi.hoisted(() => {
  const state = {
    profile: {
      examType: 'cet4',
      estimatedVocabulary: 3000,
      knownWords: ['overwhelming'] as string[],
      unknownWords: [{ word: 'place', context: '', translation: '地方', markedAt: 0, reviewCount: 0 }],
      levelConfidence: 0.9,
      createdAt: 0,
      updatedAt: 0,
    },
    settings: {
      enabled: true,
      autoHighlight: true,
      vocabHighlightEnabled: true,
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
    cefrLevel: 'A1',
    sentMessages: [] as Array<{ type: string; payload?: unknown }>,
    storageListeners: [] as Array<(changes: Record<string, unknown>, area: string) => void>,
  };

  const sendMessage = (message: { type: string; payload?: unknown }, callback?: (r: unknown) => void) => {
    state.sentMessages.push(message);
    const respond = (data: unknown) => ({ success: true, data });
    let response: unknown;
    switch (message.type) {
      case 'GET_SETTINGS':
        response = respond(state.settings);
        break;
      case 'GET_CEFR_LEVEL':
        response = respond({ level: state.cefrLevel, confidence: 0.9 });
        break;
      case 'GET_USER_PROFILE':
        response = respond(state.profile);
        break;
      case 'GET_VOCABULARY':
        response = respond(state.profile.unknownWords);
        break;
      default:
        response = { success: true };
    }
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
      onChanged: {
        addListener: (fn: (changes: Record<string, unknown>, area: string) => void) =>
          state.storageListeners.push(fn),
        removeListener: (fn: (changes: Record<string, unknown>, area: string) => void) => {
          const i = state.storageListeners.indexOf(fn);
          if (i >= 0) state.storageListeners.splice(i, 1);
        },
      },
    },
  };

  // jsdom 缺失的浏览器 API
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): unknown[] {
      return [];
    }
  };
  const g = globalThis as unknown as Record<string, unknown>;
  if (typeof g.requestAnimationFrame !== 'function') {
    g.requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16);
  }

  // 预填充英文正文：否则 Tooltip/浮动按钮的中文字符会让 isChinesePage 误判（阈值 0.3），
  // init 走 chinese-page 分支提前返回（探测阶段发现的坑）
  const LONG_FILLER =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor ' +
    'incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud ' +
    'exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute ' +
    'irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla ' +
    'pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia ' +
    'deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error ' +
    'sit voluptatem accusantium doloremque laudantium, totam rem aperiam eaque ipsa quae ' +
    'ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. ' +
    'Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia ' +
    'consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt neque porro.';
  if (typeof document !== 'undefined' && document.body) {
    const filler = document.createElement('p');
    filler.textContent = LONG_FILLER;
    document.body.appendChild(filler);
  }

  return { state, LONG_FILLER };
});

vi.mock('@/shared/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/utils')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

import { NotOnlyTranslator } from '@/content/index';

const { state, LONG_FILLER } = chromeMock;

/** 轮询等待断言通过（避免依赖特定 vitest 版本的 waitFor） */
async function waitUntil(assertion: () => void, timeout = 4000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      assertion();
      return;
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
      await new Promise((r) => setTimeout(r, 25));
    }
  }
}

function marksFor(root: ParentNode, word: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`mark[data-word="${word.toLowerCase()}"]`));
}

/** 仍带高亮 class 的词汇标记 */
function highlightMarksFor(root: ParentNode, word: string): HTMLElement[] {
  return marksFor(root, word).filter((m) =>
    m.classList.contains('not-translator-vocab-highlight')
  );
}

function countMessages(type: string): number {
  return state.sentMessages.filter((m) => m.type === type).length;
}

// overwhelming=已知词注入；ephemeral=超纲基线；place=未知词注入（COMMON_WORDS 本不高亮）；time=未标记的等级内词
const SHARED_SENTENCE =
  'The overwhelming scholar held an ephemeral dream beside the quiet place of time.';

/** 段落需在实例化前进入 DOM（随 init 的 scanPage 一起被词汇高亮处理） */
async function createWithSentence(): Promise<{ t: NotOnlyTranslator; p: HTMLElement }> {
  const p = document.createElement('p');
  p.textContent = SHARED_SENTENCE;
  document.body.appendChild(p);

  const t = new NotOnlyTranslator();
  await waitUntil(() => {
    expect((t as unknown as Record<string, unknown>).vocabHighlighter).toBeTruthy();
    expect(marksFor(p, 'ephemeral').length).toBeGreaterThan(0);
  });
  await new Promise((r) => setTimeout(r, 0));
  return { t, p };
}

const created: NotOnlyTranslator[] = [];

beforeAll(async () => {
  // import 时自动创建的单例会注册自己的 storage 监听，先等它初始化完再销毁，避免干扰断言
  await waitUntil(() => {
    expect((window as unknown as Record<string, unknown>).__NOT_ONLY_TRANSLATOR__).toBeTruthy();
  });
  ((window as unknown as Record<string, unknown>).__NOT_ONLY_TRANSLATOR__ as NotOnlyTranslator).destroy();
  (window as unknown as Record<string, unknown>).__NOT_ONLY_TRANSLATOR__ = null;
});

beforeEach(() => {
  // 重置可变的全局 mock 状态，避免用例间污染
  state.cefrLevel = 'A1';
  state.profile.knownWords = ['overwhelming'];
  state.profile.unknownWords = [
    { word: 'place', context: '', translation: '地方', markedAt: 0, reviewCount: 0 },
  ];

  document.body.innerHTML = '';
  const filler = document.createElement('p');
  filler.textContent = LONG_FILLER;
  document.body.appendChild(filler);
});

afterEach(() => {
  while (created.length > 0) {
    const t = created.pop();
    try {
      t?.destroy();
    } catch {
      // 销毁失败不影响后续测试
    }
  }
  document.body.innerHTML = '';
});

describe('阅读掌握状态同步集成', () => {
  it('init 从真实 background/profile 路径注入已知/未知词表与 CEFR', async () => {
    const { t, p } = await createWithSentence();
    created.push(t);

    // CEFR A1：ephemeral(B1) 超纲 → 基线高亮
    expect(marksFor(p, 'ephemeral').length).toBeGreaterThan(0);
    // knownWords 注入：overwhelming 本应超纲，但已在已知词表 → 不高亮
    expect(marksFor(p, 'overwhelming').length).toBe(0);
    // unknownWords 注入：place 本是 COMMON_WORDS(A1)，生词本语义 → 高亮
    expect(marksFor(p, 'place').length).toBeGreaterThan(0);
  }, 10000);

  it('标记认识同步两套高亮器，撤销后恢复', async () => {
    const { t, p } = await createWithSentence();
    created.push(t);
    // ephemeral(B1) 对 A1 用户超纲 → 初始高亮
    expect(marksFor(p, 'ephemeral').length).toBeGreaterThan(0);

    const optimizedSpy = vi.spyOn(
      (t as unknown as Record<string, (...args: unknown[]) => unknown>).highlighter as never,
      'markAsKnown'
    );
    await (t as unknown as { handleMarkKnown(w: string): Promise<void> }).handleMarkKnown(
      'ephemeral'
    );

    // 第一套（OptimizedHighlighter）
    expect(optimizedSpy).toHaveBeenCalledWith('ephemeral');
    // 第二套（VocabularyHighlighter）：认识 → mark 移除、原文保留
    expect(marksFor(p, 'ephemeral')).toHaveLength(0);
    expect(p.textContent?.includes('ephemeral')).toBe(true);

    await (t as unknown as { handleUndoLastMark(): Promise<void> }).handleUndoLastMark();
    expect(countMessages('REMOVE_MARK')).toBeGreaterThan(0);
    // 撤销认识 → 词汇高亮恢复
    expect(highlightMarksFor(p, 'ephemeral').length).toBeGreaterThan(0);
  }, 10000);

  it('加入生词本按“未知词”语义高亮，不硬改认识', async () => {
    const { t, p } = await createWithSentence();
    created.push(t);
    // time 未标记且在等级内 → init 时不高亮
    expect(marksFor(p, 'time').length).toBe(0);

    const optimizedSpy = vi.spyOn(
      (t as unknown as Record<string, (...args: unknown[]) => unknown>).highlighter as never,
      'markAsUnknown'
    );
    await (t as unknown as {
      handleAddToVocabulary(w: string, tr: string): Promise<void>;
    }).handleAddToVocabulary('time', '时间');

    // 既有语义：加入生词本 → OptimizedHighlighter.markAsUnknown
    expect(optimizedSpy).toHaveBeenCalledWith('time');
    // 同步到词汇高亮器：按未知词高亮，而非当作认识移除
    expect(marksFor(p, 'time').length).toBeGreaterThan(0);
  }, 10000);

  it('跨标签页 storage 变化（knownWords）触发去抖重新同步', async () => {
    const { t, p } = await createWithSentence();
    created.push(t);
    expect(marksFor(p, 'ephemeral').length).toBeGreaterThan(0);

    // 模拟另一标签页把 overwhelming、ephemeral 加入已知词
    state.profile.knownWords = ['overwhelming', 'ephemeral'];
    state.storageListeners.forEach((fn) =>
      fn({ knownWords: { newValue: state.profile.knownWords } }, 'local')
    );

    await new Promise((r) => setTimeout(r, 700)); // 去抖 500ms + 同步
    expect(marksFor(p, 'ephemeral').length).toBe(0);
    expect(marksFor(p, 'overwhelming').length).toBe(0);
  }, 10000);

  it('CEFR 等级变化后重新同步并重扫高亮', async () => {
    const { t, p } = await createWithSentence();
    created.push(t);
    expect(marksFor(p, 'ephemeral').length).toBeGreaterThan(0);

    state.cefrLevel = 'C2';
    state.storageListeners.forEach((fn) => fn({ userProfile: { newValue: {} } }, 'sync'));

    await new Promise((r) => setTimeout(r, 700));
    expect(marksFor(p, 'ephemeral').length).toBe(0);
    expect(p.textContent).toBe(SHARED_SENTENCE);
  }, 10000);

  it('destroy 解绑 storage 监听，销毁后不再同步', async () => {
    const before = state.storageListeners.length;
    const { t } = await createWithSentence();
    const mine = state.storageListeners.slice(before);
    expect(mine.length).toBe(1);

    const profileCountBefore = countMessages('GET_USER_PROFILE');
    t.destroy();
    expect(state.storageListeners.includes(mine[0])).toBe(false);

    // 销毁后手动触发监听器，不应再拉取 profile
    mine[0]({ knownWords: { newValue: [] } }, 'local');
    await new Promise((r) => setTimeout(r, 700));
    expect(countMessages('GET_USER_PROFILE')).toBe(profileCountBefore);
  }, 10000);
});
