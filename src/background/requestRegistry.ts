const REQUEST_TIMEOUT_MS = 120_000;
const MAX_ACTIVE_REQUESTS = 128;
const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export class TranslationRequestRegistry {
  private requests: Readonly<Record<string, AbortController>> = {};

  constructor(private readonly timeoutMs = REQUEST_TIMEOUT_MS) {}

  async run<T>(owner: string, requestId: string | undefined, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const id = requestId ?? crypto.randomUUID();
    if (typeof id !== 'string' || !REQUEST_ID_PATTERN.test(id)) throw new Error('无效的翻译请求 ID');
    const key = JSON.stringify([owner, id]);
    if (this.requests[key]) throw new Error('翻译请求 ID 重复');
    if (Object.keys(this.requests).length >= MAX_ACTIVE_REQUESTS) throw new Error('翻译请求过多，请稍后重试');

    const controller = new AbortController();
    this.requests = { ...this.requests, [key]: controller };
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timeout = setTimeout(() => {
      controller.abort(new DOMException('翻译请求超时，请缩短文本后重试', 'TimeoutError'));
    }, this.timeoutMs);

    try {
      return await Promise.race([task(controller.signal), aborted]);
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener('abort', onAbort);
      this.requests = Object.fromEntries(Object.entries(this.requests).filter(([entryKey]) => entryKey !== key));
    }
  }

  cancel(owner: string, requestId: string): boolean {
    if (!REQUEST_ID_PATTERN.test(requestId)) return false;
    const controller = this.requests[JSON.stringify([owner, requestId])];
    if (!controller) return false;
    controller.abort(new DOMException('翻译请求已取消', 'AbortError'));
    return true;
  }
}
