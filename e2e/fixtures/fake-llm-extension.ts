import type { Locator, Page, Worker } from '@playwright/test';
import type { ApiConfig, TranslationMode } from '../../src/shared/types';
import { DEFAULT_BATCH_CONFIG, TIMING } from '../../src/shared/constants';
import { test as base, expect } from './local-first-extension';

export const FAKE_CONFIG: ApiConfig = {
  id: 'llm-display-e2e',
  name: '离线译文展示模型',
  provider: 'custom',
  apiKey: 'FAKE_LLM_DISPLAY_E2E_KEY',
  apiUrl: 'https://llm-display-e2e.invalid/v1/chat/completions',
  modelName: 'offline-display-model',
  tested: true,
  createdAt: 1,
};
export const PARAGRAPHS = [
  { id: 'para-alpha', source: 'democratization', translation: '出版工具的民主化赋予独立作者力量，跨学科团队不断改变科研实践。' },
  { id: 'para-beta', source: 'counterintuitive', translation: '这些违反直觉的发现令评审惊讶，因为结果挑战了读者记忆术语的常见假设。' },
  { id: 'para-simple', source: 'apple', translation: '苹果放在窗边的桌上，天气很好，我们整天在家读书。' },
  { id: 'para-llm-dynamic', source: 'replication', translation: '独立重复实验帮助研究人员验证证据，并提高科学结论的可靠性。' },
];
export const SPINNER = '.not-translator-loading-spinner';
export const LOADING = '.not-translator-paragraph-loading';

type ReplyKind = 'valid' | 'annotated' | 'missing' | 'blank' | 'output-limit-fallback' | 'output-limit-always'
  | 'inline-output-limit-fallback' | 'inline-output-limit-always' | 'inline-output-limit-select';
interface RecordedCall {
  model: string;
  max_tokens: number;
  authorization: string;
  aborted?: boolean;
  messages: Array<{ role: string; content: string }>;
}
interface LlmState {
  reply?: ReplyKind;
  calls: RecordedCall[];
  blockedUrls: string[];
  pending: Array<() => void>;
}
export type LlmScope = typeof globalThis & { __llmDisplayE2E: LlmState };

export const test = base.extend<{ llmWorker: Worker; initialMode: TranslationMode }>({
  initialMode: ['bilingual', { option: true }],
  llmWorker: async ({ extContext, seedUserState, initialMode }, use, testInfo) => {
    await seedUserState();
    const worker = extContext.serviceWorkers()[0];
    await worker.evaluate(async ({ config, paragraphs, mode }) => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({
        settings: {
          ...settings,
          apiConfigs: [config],
          activeApiConfigId: config.id,
          translationMode: mode,
          promptVersion: 'v1.0.0',
          phraseTranslationEnabled: false,
          grammarTranslationEnabled: false,
          hybridTranslation: { enabled: false, defaultEngine: 'llm' },
        },
      });
      const scope = globalThis as LlmScope;
      scope.__llmDisplayE2E = { calls: [], blockedUrls: [], pending: [] };
      const originalFetch = globalThis.fetch.bind(globalThis);
      // 只替换模型 HTTP 边界；真实消息、后台解析器、缓存及页面渲染均保持不变。
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(chrome.runtime.getURL(''))) return originalFetch(input, init);
        if (url !== config.apiUrl) {
          scope.__llmDisplayE2E = {
            ...scope.__llmDisplayE2E,
            blockedUrls: [...scope.__llmDisplayE2E.blockedUrls, url],
          };
          throw new Error('E2E 禁止访问非测试端点');
        }
        if (init?.method !== 'POST' || new Headers(init.headers).get('Authorization') !== `Bearer ${config.apiKey}`) {
          throw new Error('测试 custom 模型配置未用于真实请求');
        }
        const body = JSON.parse(String(init.body)) as Omit<RecordedCall, 'authorization'>;
        const call = { ...body, authorization: new Headers(init.headers).get('Authorization')! };
        const callIndex = scope.__llmDisplayE2E.calls.length;
        scope.__llmDisplayE2E = { ...scope.__llmDisplayE2E, calls: [...scope.__llmDisplayE2E.calls, call] };
        if (!scope.__llmDisplayE2E.reply) {
          await new Promise<void>(resolve => {
            scope.__llmDisplayE2E = { ...scope.__llmDisplayE2E, pending: [...scope.__llmDisplayE2E.pending, resolve] };
          });
        }
        // 故意允许已取消的底层请求晚到，用真实 AbortSignal 与页面状态证明旧结果不会回填。
        scope.__llmDisplayE2E = {
          ...scope.__llmDisplayE2E,
          calls: scope.__llmDisplayE2E.calls.map((entry, index) => index === callIndex
            ? { ...entry, aborted: init.signal?.aborted ?? false } : entry),
        };
        if (scope.__llmDisplayE2E.reply?.startsWith('inline-output-limit')) {
          const userPrompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
          const selectLevel = scope.__llmDisplayE2E.reply === 'inline-output-limit-select';
          let recovery: { paragraphs?: Array<{ id: string; sentence: string; candidates: string[]; selectAboveLevel?: boolean }> } | null = null;
          try { recovery = JSON.parse(userPrompt); } catch { /* 原复杂任务不是候选词 JSON，必须耗尽输出预算。 */ }
          const candidatesOnly = Array.isArray(recovery?.paragraphs) && recovery.paragraphs.length > 0
            && recovery.paragraphs.every(paragraph => typeof paragraph.id === 'string'
              && typeof paragraph.sentence === 'string' && Array.isArray(paragraph.candidates)
              && paragraph.candidates.every(word => typeof word === 'string' && paragraph.sentence.includes(word)));
          const exhausted = !candidatesOnly || scope.__llmDisplayE2E.reply === 'inline-output-limit-always';
          // 仅响应实际请求中的候选词；不按请求序号放行，也不替换本地查询或恢复路径。
          const result = exhausted ? null : { paragraphs: recovery!.paragraphs!.map(paragraph => ({
            id: paragraph.id,
            words: paragraph.candidates
              // 普通待复核段预设选空；独立选择模式仅从真实候选中选择 ubiquitous。
              .filter(original => selectLevel
                ? paragraph.selectAboveLevel === true && original === 'ubiquitous'
                : paragraph.selectAboveLevel !== true)
              .map(original => ({
                original, translation: selectLevel ? '无处不在的'
                  : original.toLowerCase() === 'counterintuitive' ? '违反直觉的' : '测试语境词义',
              })),
          })) };
          return new Response(JSON.stringify({ choices: [{
            finish_reason: exhausted ? 'length' : 'stop',
            message: { role: 'assistant', content: result === null ? null : JSON.stringify(result) },
          }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const system = body.messages.filter(message => message.role === 'system').map(message => message.content).join('\n');
        const fullTextOnly = /翻译|translat/i.test(system) && !/CET|词汇量|英语水平|语法|grammar|proficiency/i.test(system);
        const outputLimit = scope.__llmDisplayE2E.reply?.startsWith('output-limit');
        // 按任务内容回包：原复杂任务无论重试多少次都耗尽预算，不能靠调用序号伪造降级成功。
        if (outputLimit && (!fullTextOnly || scope.__llmDisplayE2E.reply === 'output-limit-always')) {
          return new Response(JSON.stringify({
            choices: [{ finish_reason: 'length', message: { role: 'assistant', content: null } }],
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
        const resultFor = (text: string) => {
          const paragraph = paragraphs.find(candidate => text.includes(candidate.source));
          if (!paragraph) throw new Error('模型收到非测试正文');
          if (outputLimit) return { fullText: paragraph.translation };
          return {
            words: scope.__llmDisplayE2E.reply === 'annotated'
              ? [{ original: 'democratization', translation: '民主化' },
                { original: 'counterintuitive', translation: '违反直觉的' }]
                .filter(word => text.includes(word.original))
                .map(word => ({ ...word, difficulty: 8, partOfSpeech: 'adj',
                  position: [text.indexOf(word.original), text.indexOf(word.original) + word.original.length] }))
              : [],
            sentences: [],
            ...(scope.__llmDisplayE2E.reply === 'missing' ? {} : {
              fullText: scope.__llmDisplayE2E.reply === 'blank' ? '   \n\t ' : paragraph.translation,
            }),
          };
        };
        // 从实际请求提取 PARA_n，不假定批次顺序或 DOM ID 与模型协议相同。
        const batch = [...prompt.matchAll(/^\[(PARA_\d+)\]\n([^\n]+)/gm)];
        const result = batch.length > 0
          ? { paragraphs: batch.map(([, id, text]) => ({ id, ...resultFor(text) })) }
          : resultFor(prompt);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
    }, { config: FAKE_CONFIG, paragraphs: PARAGRAPHS, mode: initialMode });
    try {
      await use(worker);
    } finally {
      const evidence = await worker.evaluate(() => {
        const { calls, blockedUrls } = (globalThis as LlmScope).__llmDisplayE2E;
        return { calls, blockedUrls };
      });
      await testInfo.attach('fake-llm-fetch-evidence', {
        body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
      });
      expect(evidence.blockedUrls, '除扩展资源和 fake 模型端点外不得发起后台 fetch').toEqual([]);
      expect(evidence.calls.length).toBeGreaterThan(0);
      expect(evidence.calls.every(call => call.model === FAKE_CONFIG.modelName)).toBe(true);
    }
  },
});

export async function expectInlineSource(element: Locator, source: string): Promise<void> {
  await expect.poll(() => element.evaluate(node => {
    const clone = node.cloneNode(true) as HTMLElement;
    // 只处理脱离页面副本中的生成注释，保留代码、隐藏载荷与其他所有节点。
    clone.querySelectorAll('mark.not-translator-highlight[data-word][data-translation] > .not-translator-inline-translation')
      .forEach(annotation => annotation.remove());
    return (clone.textContent ?? '').replace(/\s+/g, ' ').trim();
  })).toBe(source.replace(/\s+/g, ' ').trim());
}

export async function expectNoVisibleVocabDecorations(paragraph: Locator): Promise<void> {
  const decorations = await paragraph.evaluate(element => {
    const transparent = (color: string) => color === 'transparent' || /^rgba\([^)]*,\s*0\)$/.test(color);
    const visible = (style: CSSStyleDeclaration) => style.display !== 'none'
      && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) > 0;
    return [element, ...Array.from(element.querySelectorAll('*'))].flatMap(node => {
      const style = getComputedStyle(node);
      const isVocab = node.matches('.not-translator-vocab-highlight, .vocab-with-indicator, .not-translator-inactive-vocabulary');
      const badges = ['::before', '::after'].flatMap(pseudo => {
        const computed = getComputedStyle(node, pseudo);
        return visible(style) && visible(computed) && /[ABC][12]/.test(computed.content)
          ? [`${pseudo}:${computed.content}`] : [];
      });
      if (!isVocab) return badges;
      // 允许无害包装保留，但不能靠隐藏整个包装来掩盖徽标和中文。
      const hiddenText = /[㐀-鿿]/.test(node.textContent ?? '') && !visible(style);
      const border = parseFloat(style.borderBottomWidth) > 0 && !['none', 'hidden'].includes(style.borderBottomStyle)
        && !transparent(style.borderBottomColor);
      const underline = style.textDecorationLine.includes('underline') && !transparent(style.textDecorationColor);
      const background = !transparent(style.backgroundColor);
      return [...badges, ...(hiddenText || (visible(style) && (border || underline || background))
        ? [JSON.stringify({ word: node.getAttribute('data-word'), hiddenText, border, underline, background })] : [])];
    });
  });
  expect(decorations, '全文中文不得保留可见英文词汇装饰，停用装饰的安全包装可以保留').toEqual([]);
}

export async function observeCallCount(worker: Worker, mode: TranslationMode): Promise<number> {
  await expect.poll(() => worker.evaluate(async () => (await chrome.storage.sync.get('settings')).settings.translationMode))
    .toBe(mode);
  // 覆盖设置消息等待上界、刷新过渡、DOM 扫描及视口批次防抖，不能瞬时相等就通过。
  const windowMs = TIMING.DEFAULT_MESSAGE_TIMEOUT + TIMING.MODE_SWITCH_TRANSITION
    + TIMING.SCAN_DEBOUNCE + DEFAULT_BATCH_CONFIG.debounceDelay;
  const samples = await worker.evaluate(async ({ duration, interval }) => {
    const started = performance.now();
    const sample = () => ({
      elapsedMs: performance.now() - started,
      count: (globalThis as LlmScope).__llmDisplayE2E.calls.length,
    });
    let observations = [sample()];
    while (performance.now() - started < duration) {
      await new Promise<void>(resolve => setTimeout(resolve, interval));
      observations = [...observations, sample()];
    }
    return observations;
  }, { duration: windowMs, interval: DEFAULT_BATCH_CONFIG.debounceDelay });
  const maximum = Math.max(...samples.map(sample => sample.count));
  await test.info().attach(`http-observation-${mode}`, {
    body: JSON.stringify({ windowMs, maximum, samples }), contentType: 'application/json',
  });
  return maximum;
}

export async function releaseReply(worker: Worker, reply: ReplyKind, releasePending = true): Promise<void> {
  await worker.evaluate(({ value, release }) => {
    const scope = globalThis as LlmScope;
    const { pending } = scope.__llmDisplayE2E;
    scope.__llmDisplayE2E = { ...scope.__llmDisplayE2E, reply: value, pending: release ? [] : pending };
    if (release) pending.forEach(resolve => resolve());
  }, { value: reply, release: releasePending });
}

export async function expectBilingual(page: Page): Promise<void> {
  for (const paragraph of PARAGRAPHS.slice(0, 3)) {
    await expect(page.locator(`#${paragraph.id}`)).toContainText(paragraph.source);
    await expect(page.locator(`#${paragraph.id}`)).toHaveClass(/not-translator-processed/);
    const translated = page.locator(`#${paragraph.id} + .not-translator-translation-line`);
    await expect(translated).toHaveText(paragraph.translation);
    await expect(translated).toBeVisible();
  }
  await expect(page.locator(SPINNER)).toHaveCount(0);
  await expect(page.locator(LOADING)).toHaveCount(0);
}

export { expect };
