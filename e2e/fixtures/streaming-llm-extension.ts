import type { Worker } from '@playwright/test';
import { test as base, expect, TEST_PAGE_URL } from './local-first-extension';
import { FAKE_CONFIG, PARAGRAPHS } from './fake-llm-extension';

export const STREAM_PARAGRAPHS = [
  { ...PARAGRAPHS[0], text: 'The democratization of publishing tools has empowered independent writers, while interdisciplinary research teams continue to reshape how institutions approach complex scientific questions in practice.' },
  { ...PARAGRAPHS[1], text: 'The counterintuitive findings surprised reviewers, because the measured outcomes contradicted several widely accepted assumptions about how readers retain unfamiliar terminology over time.' },
];

export const STREAM_WORD = { original: 'democratization', translation: '民主化' };
export const STREAM_GRAMMAR = { original: 'while', explanation: '引导同时发生的另一件事，与前半句形成对照', type: '状语从句' };

interface StreamingCall {
  model: string;
  stream?: boolean;
  messages: Array<{ role: string; content: string }>;
  paragraphIds: string[];
  firstSent: boolean;
  completed: boolean;
  cancelled: boolean;
}
interface StreamingState {
  calls: StreamingCall[];
  blockedUrls: string[];
  documents: Array<{ type: string; documentId?: string; tabId?: number }>;
  releases: Array<() => void>;
}
export type StreamingScope = typeof globalThis & { __streamingLlmE2E: StreamingState };

export const test = base.extend<{ streamingWorker: Worker }>({
  streamingWorker: async ({ extContext, seedUserState }, use, testInfo) => {
    await seedUserState();
    await extContext.route(TEST_PAGE_URL, route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Streaming reading</title></head>
        <body><main id="content">${STREAM_PARAGRAPHS.map(paragraph => `<p id="${paragraph.id}">${paragraph.text}</p>`).join('')}</main></body></html>`,
    }));
    const worker = extContext.serviceWorkers()[0];
    await worker.evaluate(async ({ config, paragraphs, word, grammar }) => {
      const { settings } = await chrome.storage.sync.get('settings');
      await chrome.storage.sync.set({ settings: {
        ...settings, apiConfigs: [config], activeApiConfigId: config.id,
        translationMode: 'bilingual', promptVersion: 'v1.0.0',
        phraseTranslationEnabled: false, grammarTranslationEnabled: true,
        hybridTranslation: { enabled: false, defaultEngine: 'llm' },
      } });
      const scope = globalThis as StreamingScope;
      scope.__streamingLlmE2E = { calls: [], blockedUrls: [], documents: [], releases: [] };
      chrome.runtime.onMessage.addListener((message, sender) => {
        if (message.type === 'BATCH_TRANSLATE_TEXT' || message.type === 'CANCEL_TRANSLATION') {
          scope.__streamingLlmE2E = {
            ...scope.__streamingLlmE2E,
            documents: [...scope.__streamingLlmE2E.documents, {
              type: message.type, documentId: sender.documentId, tabId: sender.tab?.id,
            }],
          };
        }
        return false;
      });
      const originalFetch = globalThis.fetch.bind(globalThis);
      // 仅替换模型 HTTP 边界；真实批次、SSE 解析、消息、缓存与渲染不做替身。
      globalThis.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith(chrome.runtime.getURL(''))) return originalFetch(input, init);
        if (url !== config.apiUrl) {
          scope.__streamingLlmE2E = {
            ...scope.__streamingLlmE2E, blockedUrls: [...scope.__streamingLlmE2E.blockedUrls, url],
          };
          throw new Error('E2E 禁止访问非测试端点');
        }
        if (init?.method !== 'POST' || new Headers(init.headers).get('Authorization') !== `Bearer ${config.apiKey}`) {
          throw new Error('真实请求未使用测试模型配置');
        }
        const body = JSON.parse(String(init.body)) as Pick<StreamingCall, 'model' | 'stream' | 'messages'>;
        const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
        const batch = [...prompt.matchAll(/^\[(PARA_\d+)\]\n([^\n]+)/gm)];
        if (!batch.length) throw new Error('测试要求真实批次协议，不接受每段独立请求');
        const results = batch.map(([, id, text]) => {
          const paragraph = paragraphs.find(candidate => text.includes(candidate.source));
          if (!paragraph) throw new Error('模型收到非测试正文');
          const annotated = text.includes(word.original);
          return {
            id, fullText: paragraph.translation, sentences: [],
            words: annotated ? [{ ...word, difficulty: 8, isPhrase: false,
              position: [text.indexOf(word.original), text.indexOf(word.original) + word.original.length] }] : [],
            grammarPoints: annotated ? [{ ...grammar,
              position: [text.indexOf(grammar.original), text.indexOf(grammar.original) + grammar.original.length] }] : [],
          };
        });
        // 视口队列不保证 DOM 顺序；按真实 PARA 标识返回指定源段，不伪造段落编号。
        const firstIndex = batch.findIndex(([, , text]) => text.includes(paragraphs[0].source));
        const orderedResults = firstIndex < 0 ? results : [results[firstIndex], ...results.filter((_, index) => index !== firstIndex)];
        const index = scope.__streamingLlmE2E.calls.length;
        scope.__streamingLlmE2E = {
          ...scope.__streamingLlmE2E,
          calls: [...scope.__streamingLlmE2E.calls, {
            model: body.model, stream: body.stream, messages: body.messages,
            paragraphIds: results.map(result => result.id), firstSent: false, completed: false, cancelled: false,
          }],
        };
        const update = (patch: Partial<StreamingCall>) => {
          scope.__streamingLlmE2E = {
            ...scope.__streamingLlmE2E,
            calls: scope.__streamingLlmE2E.calls.map((call, callIndex) => callIndex === index ? { ...call, ...patch } : call),
          };
        };
        const encoder = new TextEncoder();
        const event = (content: string, finish: string | null = null) => encoder.encode(`data: ${JSON.stringify({
          choices: [{ index: 0, delta: { content }, finish_reason: finish }],
        })}\n\n`);
        const responseBody = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(event(`{"paragraphs":[${JSON.stringify(orderedResults[0])}`));
            update({ firstSent: true });
            const release = () => {
              const call = scope.__streamingLlmE2E.calls[index];
              if (call.completed || call.cancelled) return;
              const rest = orderedResults.slice(1).map(result => `,${JSON.stringify(result)}`).join('');
              controller.enqueue(event(`${rest}]}`));
              controller.enqueue(event('', 'stop'));
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
              controller.close();
              update({ completed: true });
            };
            scope.__streamingLlmE2E = {
              ...scope.__streamingLlmE2E, releases: [...scope.__streamingLlmE2E.releases, release],
            };
            init.signal?.addEventListener('abort', () => {
              if (scope.__streamingLlmE2E.calls[index].completed || scope.__streamingLlmE2E.calls[index].cancelled) return;
              update({ cancelled: true });
              controller.error(new DOMException('请求已取消', 'AbortError'));
            }, { once: true });
          },
          cancel() {
            if (!scope.__streamingLlmE2E.calls[index].completed) update({ cancelled: true });
          },
        });
        return new Response(responseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
    }, { config: FAKE_CONFIG, paragraphs: STREAM_PARAGRAPHS, word: STREAM_WORD, grammar: STREAM_GRAMMAR });
    try {
      await use(worker);
    } finally {
      const evidence = await worker.evaluate(() => {
        const { releases: _releases, ...state } = (globalThis as StreamingScope).__streamingLlmE2E;
        return state;
      });
      await testInfo.attach('streaming-http-and-document-evidence', {
        body: JSON.stringify(evidence, null, 2), contentType: 'application/json',
      });
      expect(evidence.blockedUrls, '后台不得访问真实模型或其他外部端点').toEqual([]);
      await releaseRemainingParagraphs(worker);
    }
  },
});

export async function releaseRemainingParagraphs(worker: Worker): Promise<void> {
  await worker.evaluate(() => {
    const scope = globalThis as StreamingScope;
    const { releases } = scope.__streamingLlmE2E;
    scope.__streamingLlmE2E = { ...scope.__streamingLlmE2E, releases: [] };
    releases.forEach(release => release());
  });
}

export { expect };
