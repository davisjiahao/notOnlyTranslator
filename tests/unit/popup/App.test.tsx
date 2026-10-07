import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { UserProfile, UserSettings } from '@/shared/types';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '@/shared/constants';
import App from '@/popup/App';

const mocks = vi.hoisted(() => ({ error: vi.fn(), useTheme: vi.fn() }));
vi.mock('@/shared/utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/shared/utils')>(),
  logger: { error: mocks.error },
  useTheme: mocks.useTheme,
}));
vi.mock('@/popup/components/MasteryCard', () => ({ default: () => null }));
vi.mock('@/popup/components/RecruitmentBanner', () => ({ default: () => null }));
vi.mock('@/popup/components/Feedback', () => ({ FeedbackButton: () => null }));

const configured = (): UserSettings => ({
  ...DEFAULT_SETTINGS,
  apiConfigs: [{ id: 'primary', name: '主配置', provider: 'openai', apiKey: 'test', tested: true, createdAt: 1 }],
  activeApiConfigId: 'primary',
});
const profile = (estimatedVocabulary = 3500): UserProfile => ({
  ...DEFAULT_USER_PROFILE,
  estimatedVocabulary,
  knownWords: ['one', 'two'],
  unknownWords: [{ word: 'three', context: '', translation: '', markedAt: 1, reviewCount: 0 }],
  levelConfidence: 0.76,
});

let sendMessage: ReturnType<typeof vi.fn>;
let query: ReturnType<typeof vi.fn>;
let sendTabMessage: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
let openOptionsPage: ReturnType<typeof vi.fn>;
let createTab: ReturnType<typeof vi.fn>;

function mount(options: { settings?: UserSettings | null; user?: UserProfile | null; url?: string; bannerError?: boolean; loadError?: boolean } = {}) {
  const { settings = configured(), user = profile(), url = 'https://example.com/learn', bannerError = false, loadError = false } = options;
  sendMessage.mockImplementation(async ({ type }: { type: string }) => {
    if (loadError) throw new Error('runtime offline');
    if (type === 'GET_USER_PROFILE') return { success: !!user, data: user };
    if (type === 'GET_SETTINGS') return { success: !!settings, data: settings };
    return { success: true };
  });
  query.mockResolvedValue([{ id: 42, url }]);
  (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    if (bannerError) throw new Error('storage offline');
    return { recruitmentBannerDismissed: true };
  });
  return render(<App />);
}

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  sendMessage = vi.fn();
  query = vi.fn();
  sendTabMessage = vi.fn();
  reload = vi.fn();
  openOptionsPage = vi.fn();
  createTab = vi.fn();
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { sendMessage, openOptionsPage, getURL: vi.fn((path: string) => `chrome-extension://extension/${path}`) },
      tabs: { query, sendMessage: sendTabMessage, reload, create: createTab },
      storage: { sync: { get: vi.fn() } },
    },
  });
});

describe('弹窗设置与导航', () => {
  it('加载期间显示状态，并在响应后显示档案、设置与当前站点', async () => {
    let release!: (value: unknown) => void;
    sendMessage.mockImplementation(({ type }: { type: string }) =>
      type === 'GET_USER_PROFILE'
        ? new Promise(resolve => { release = resolve; })
        : Promise.resolve({ success: true, data: configured() }));
    query.mockResolvedValue([{ id: 42, url: 'https://example.com/learn' }]);
    (chrome.storage.sync.get as ReturnType<typeof vi.fn>).mockResolvedValue({ recruitmentBannerDismissed: true });
    render(<App />);
    expect(screen.getByRole('status', { name: '加载中' })).toBeInTheDocument();
    release({ success: true, data: profile() });
    expect(await screen.findByText('3,500')).toBeInTheDocument();
    expect(screen.getByText('中级')).toBeInTheDocument();
    expect(screen.getByText('2 已标记认识')).toBeInTheDocument();
    expect(screen.getByText('1 生词本收藏')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '词汇量估算置信度' })).toHaveAttribute('aria-valuenow', '76');
    expect(screen.getByRole('switch', { name: 'example.com 网站翻译' })).toHaveAttribute('aria-checked', 'true');
    expect(mocks.useTheme).toHaveBeenCalledWith('system');
  });

  it('置信度说明只响应自身按钮的悬停和焦点范围', async () => {
    mount();
    const trigger = await screen.findByRole('button', { name: '置信度说明' });
    const group = trigger.closest('.group');
    expect(group).not.toBeNull();
    expect(group?.parentElement?.closest('.group')).toBeNull();
  });

  it('未配置 API 时提供引导，且可从引导打开设置', async () => {
    mount({ settings: DEFAULT_SETTINGS });
    expect(await screen.findByText('欢迎使用 NotOnlyTranslator')).toBeInTheDocument();
    fireEvent.click(screen.getByText('开始配置'));
    fireEvent.click(screen.getByText('需要更多配置选项？'));
    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  it('免费引擎不要求 API 配置，直接显示当前服务', async () => {
    mount({ settings: { ...DEFAULT_SETTINGS, apiProvider: 'free_google_translate' } });
    await screen.findByRole('switch', { name: '全局翻译已启用' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Google 免费翻译')).toBeInTheDocument();
    expect(screen.queryByText('默认配置')).not.toBeInTheDocument();
  });

  it('跳过引导后修改设置或重开弹窗不重复打断', async () => {
    const view = mount({ settings: DEFAULT_SETTINGS });
    fireEvent.click(await screen.findByText('稍后再说'));
    fireEvent.click(await screen.findByRole('radio', { name: '双语对照' }));
    await screen.findByText('已切换到 双语对照 模式');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    view.unmount();
    mount({ settings: DEFAULT_SETTINGS });
    await screen.findByRole('switch', { name: '全局翻译已启用' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('非 HTTP 页面不展示站点开关，档案失败时保留占位内容', async () => {
    mount({ user: null, url: 'chrome://extensions' });
    expect(await screen.findByText('当前页面不支持翻译')).toBeInTheDocument();
    expect(screen.getByText('---')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /网站翻译/ })).not.toBeInTheDocument();
  });

  it('加载请求异常时结束加载并记录错误', async () => {
    mount({ loadError: true });
    expect(await screen.findByText('---')).toBeInTheDocument();
    expect(mocks.error).toHaveBeenCalledWith('Failed to load data:', expect.any(Error));
  });

  it('Banner 存储异常不阻碍设置加载', async () => {
    mount({ bannerError: true });
    expect(await screen.findByRole('switch', { name: '全局翻译已启用' })).toBeInTheDocument();
    expect(mocks.error).toHaveBeenCalledWith('Failed to check banner visibility:', expect.any(Error));
  });

  it('全局暂停和重新启用分别持久化联动设置，不发送反向切换消息', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: '全局翻译已启用' });
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { enabled: false, autoHighlight: false } });
    expect(sendTabMessage).not.toHaveBeenCalled();
    expect(screen.getByText('翻译已暂停')).toBeInTheDocument();
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { enabled: true, autoHighlight: true } });
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it('模式切换仅保存变更、更新选择状态并反馈模式名称', async () => {
    mount();
    const modes = await screen.findByRole('radiogroup', { name: '翻译模式' });
    const bilingual = within(modes).getByRole('radio', { name: '双语对照' });
    fireEvent.click(bilingual);
    await waitFor(() => expect(bilingual).toHaveAttribute('aria-checked', 'true'));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { translationMode: 'bilingual' } });
    expect(screen.getByText('已切换到 双语对照 模式')).toBeInTheDocument();
    fireEvent.click(within(modes).getByRole('radio', { name: '全文翻译' }));
    await waitFor(() => expect(within(modes).getByRole('radio', { name: '全文翻译' })).toHaveAttribute('aria-checked', 'true'));
  });

  it('快速启停与切换模式串行提交变更字段，避免旧设置覆盖新设置', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: '全局翻译已启用' });
    const bilingual = screen.getByRole('radio', { name: '双语对照' });
    let finishFirst!: (response: { success: boolean }) => void;
    sendMessage.mockImplementation(({ type }: { type: string }) =>
      type === 'UPDATE_SETTINGS' && !finishFirst
        ? new Promise(resolve => { finishFirst = resolve; })
        : Promise.resolve({ success: true }));
    fireEvent.click(toggle);
    fireEvent.click(bilingual);
    await waitFor(() => expect(finishFirst).toBeTypeOf('function'));
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS')).toHaveLength(1);
    finishFirst({ success: true });
    await waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS')).toHaveLength(2));
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS')[1][0]).toEqual({ type: 'UPDATE_SETTINGS', payload: { translationMode: 'bilingual' } });
    await waitFor(() => expect(bilingual).toHaveAttribute('aria-checked', 'true'));
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('连续快速点击全局开关时按操作顺序暂停再启用', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: '全局翻译已启用' });
    let finishFirst!: (response: { success: boolean }) => void;
    sendMessage.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await waitFor(() => expect(finishFirst).toBeTypeOf('function'));
    finishFirst({ success: true });
    await waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS')).toHaveLength(2));
    expect(sendMessage.mock.calls.filter(([message]) => message.type === 'UPDATE_SETTINGS').map(([message]) => message.payload)).toEqual([
      { enabled: false, autoHighlight: false },
      { enabled: true, autoHighlight: true },
    ]);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'));
  });

  it('站点暂停后仅在确认时刷新当前页', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: 'example.com 网站翻译' });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole('dialog', { name: '刷新页面确认' })).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: expect.objectContaining({ blacklist: ['example.com'] }) });
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认刷新' }));
    await waitFor(() => expect(reload).toHaveBeenCalledWith(42));
  });

  it('撤销更改回滚站点黑名单，恢复站点开关', async () => {
    mount();
    fireEvent.click(await screen.findByRole('switch', { name: 'example.com 网站翻译' }));
    fireEvent.click(await screen.findByRole('button', { name: '撤销更改' }));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'example.com 网站翻译' })).toHaveAttribute('aria-checked', 'true'));
    expect(sendMessage).toHaveBeenLastCalledWith({ type: 'UPDATE_SETTINGS', payload: expect.objectContaining({ blacklist: [] }) });
    expect(reload).not.toHaveBeenCalled();
  });

  it('撤销更改失败时保留确认框，不能假装已经撤销', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: 'example.com 网站翻译' });
    fireEvent.click(toggle);
    expect(await screen.findByRole('dialog', { name: '刷新页面确认' })).toBeInTheDocument();
    sendMessage.mockImplementation(async () => ({ success: false }));
    fireEvent.click(screen.getByRole('button', { name: '撤销更改' }));
    expect(await screen.findByText('设置保存失败，请重试')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '刷新页面确认' })).toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });

  it('稍后刷新保留已经保存的站点更改', async () => {
    mount();
    fireEvent.click(await screen.findByRole('switch', { name: 'example.com 网站翻译' }));
    fireEvent.click(await screen.findByRole('button', { name: '稍后刷新' }));
    expect(screen.queryByRole('dialog', { name: '刷新页面确认' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'example.com 网站翻译' })).toHaveAttribute('aria-checked', 'false');
    expect(sendMessage.mock.calls.filter(([m]) => m.type === 'UPDATE_SETTINGS')).toHaveLength(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('已经禁用的网站再次切换时从黑名单移除', async () => {
    mount({ settings: { ...configured(), blacklist: ['example.com', 'other.com'] } });
    const toggle = await screen.findByRole('switch', { name: 'example.com 网站翻译' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(toggle);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: expect.objectContaining({ blacklist: ['other.com'] }) }));
  });

  it('设置保存失败时不谎报启用成功或通知标签页，并等待真实响应', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: '全局翻译已启用' });
    let finishSave!: (response: { success: boolean }) => void;
    sendMessage.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    fireEvent.click(toggle);
    await waitFor(() => expect(finishSave).toBeTypeOf('function'));
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    finishSave({ success: false });
    expect(await screen.findByText('设置保存失败，请重试')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByText('翻译已暂停')).not.toBeInTheDocument();
    expect(sendTabMessage).not.toHaveBeenCalled();
  });

  it('设置保存抛错时保持原翻译模式并提示失败', async () => {
    mount();
    const mode = await screen.findByRole('radio', { name: '双语对照' });
    sendMessage.mockRejectedValue(new Error('connection lost'));
    fireEvent.click(mode);
    expect(await screen.findByText('设置保存失败，请重试')).toBeInTheDocument();
    expect(mode).toHaveAttribute('aria-checked', 'false');
    expect(mocks.error).toHaveBeenCalledWith('Failed to update settings:', expect.any(Error));
  });

  it('站点设置保存失败不要求刷新页面', async () => {
    mount();
    const toggle = await screen.findByRole('switch', { name: 'example.com 网站翻译' });
    sendMessage.mockImplementation(async () => ({ success: false }));
    fireEvent.click(toggle);
    expect(await screen.findByText('设置保存失败，请重试')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '刷新页面确认' })).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(reload).not.toHaveBeenCalled();
  });

  it('API 配置保存失败后保留下拉与旧配置，允许重试', async () => {
    mount({ settings: {
      ...configured(),
      apiConfigs: [
        ...configured().apiConfigs,
        { id: 'secondary', name: '备用配置', provider: 'openai', apiKey: 'test2', tested: true, createdAt: 2 },
      ],
    } });
    const select = await screen.findByRole('combobox', { name: '选择翻译服务配置，当前：主配置' });
    fireEvent.click(select);
    sendMessage.mockImplementation(async () => ({ success: false }));
    fireEvent.click(screen.getByRole('option', { name: /备用配置/ }));
    expect(await screen.findByText('设置保存失败，请重试')).toBeInTheDocument();
    expect(select).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('option', { name: /备用配置/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /主配置/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('API 配置保存成功后更新当前配置并关闭下拉', async () => {
    mount({ settings: {
      ...configured(),
      apiConfigs: [
        ...configured().apiConfigs,
        { id: 'secondary', name: '备用配置', provider: 'openai', apiKey: 'test2', tested: true, createdAt: 2 },
      ],
    } });
    const select = await screen.findByRole('combobox', { name: '选择翻译服务配置，当前：主配置' });
    fireEvent.click(select);
    fireEvent.click(screen.getByRole('option', { name: /备用配置/ }));
    await waitFor(() => expect(select).toHaveAttribute('aria-expanded', 'false'));
    expect(sendMessage).toHaveBeenCalledWith({ type: 'UPDATE_SETTINGS', payload: { activeApiConfigId: 'secondary' } });
    expect(screen.getByText('备用配置')).toBeInTheDocument();
  });

  it('导航到设置及生词本，生词本链接使用扩展内地址', async () => {
    mount();
    const options = await screen.findByRole('button', { name: '更多设置' });
    fireEvent.click(options);
    fireEvent.click(screen.getByRole('button', { name: '生词本 (1)' }));
    expect(openOptionsPage).toHaveBeenCalledOnce();
    expect(createTab).toHaveBeenCalledWith({ url: 'chrome-extension://extension/src/options/index.html?tab=vocabulary' });
  });
});
