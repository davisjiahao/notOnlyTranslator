import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationRequestRegistry } from '@/background/requestRegistry';

afterEach(() => vi.useRealTimers());

describe('翻译请求生命周期', () => {
  it('取消只影响相同页面的请求，并立即结束等待', async () => {
    const registry = new TranslationRequestRegistry();
    let signal: AbortSignal | undefined;
    const pending = registry.run('tab-1', 'request-1', async (value) => {
      signal = value;
      return new Promise(() => {});
    });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(registry.cancel('tab-2', 'request-1')).toBe(false);
    expect(signal?.aborted).toBe(false);
    expect(registry.cancel('tab-1', 'request-1')).toBe(true);
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(registry.cancel('tab-1', 'request-1')).toBe(false);
  });

  it('总预算到期后中止请求，即使下游没有响应', async () => {
    vi.useFakeTimers();
    const registry = new TranslationRequestRegistry(100);
    const pending = registry.run('tab-1', 'request-1', () => new Promise(() => {}));
    const rejected = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('完成后释放请求 ID 和定时器', async () => {
    vi.useFakeTimers();
    const registry = new TranslationRequestRegistry();
    await expect(registry.run('tab-1', 'same', async () => 'first')).resolves.toBe('first');
    await expect(registry.run('tab-1', 'same', async () => 'second')).resolves.toBe('second');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('拒绝重复 ID，不覆盖先前运行的请求', async () => {
    const registry = new TranslationRequestRegistry();
    const first = registry.run('tab-1', 'same', () => new Promise(() => {}));
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(registry.run('tab-1', 'same', async () => 'second')).rejects.toThrow('重复');
    registry.cancel('tab-1', 'same');
    await rejected;
  });

  it.each(['', '../invalid', 'a'.repeat(129)])('拒绝非法请求 ID：%s', async (id) => {
    await expect(new TranslationRequestRegistry().run('tab', id, async () => true)).rejects.toThrow('请求 ID');
  });

  it('达到活跃请求上限时拒绝新请求，取消后释放容量', async () => {
    const registry = new TranslationRequestRegistry();
    const ids = Array.from({ length: 128 }, (_, index) => String(index));
    const requests = ids.map(id => registry.run('tab', id, () => new Promise(() => {}))
      .catch((error: Error) => error.name));
    await expect(registry.run('tab', 'overflow', async () => true)).rejects.toThrow('请求过多');
    for (const id of ids) expect(registry.cancel('tab', id)).toBe(true);
    expect(await Promise.all(requests)).toEqual(ids.map(() => 'AbortError'));
    await expect(registry.run('tab', 'after-cancel', async () => true)).resolves.toBe(true);
  });

  it('不合法的取消标识不会命中请求', () => {
    expect(new TranslationRequestRegistry().cancel('tab', '../invalid')).toBe(false);
  });

  it('没有客户端 ID 的旧调用仍正常工作', async () => {
    await expect(new TranslationRequestRegistry().run('tab', undefined, async () => 42)).resolves.toBe(42);
  });

  it('任务失败后释放资源，允许重试同一 ID', async () => {
    const registry = new TranslationRequestRegistry();
    await expect(registry.run('tab', 'retry', async () => { throw new Error('失败'); })).rejects.toThrow('失败');
    await expect(registry.run('tab', 'retry', async () => true)).resolves.toBe(true);
  });
});
