/**
 * useStore (Zustand) 测试
 *
 * 覆盖状态管理、词汇操作、设置、初始化、持久化
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const mockSyncStorage: Record<string, unknown> = {};
const mockLocalStorage: Record<string, unknown> = {};

const mockStorageSync = {
  get: vi.fn((keys: string | string[]) => {
    const k = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of k) {
      if (mockSyncStorage[key] !== undefined) result[key] = mockSyncStorage[key];
    }
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    Object.assign(mockSyncStorage, items);
    return Promise.resolve();
  }),
};

const mockStorageLocal = {
  get: vi.fn((keys: string | string[]) => {
    const k = Array.isArray(keys) ? keys : [keys];
    const result: Record<string, unknown> = {};
    for (const key of k) {
      if (mockLocalStorage[key] !== undefined) result[key] = mockLocalStorage[key];
    }
    return Promise.resolve(result);
  }),
  set: vi.fn((items: Record<string, unknown>) => {
    Object.assign(mockLocalStorage, items);
    return Promise.resolve();
  }),
};

vi.mock('@/shared/utils', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useStore', () => {
  let useStore: typeof import('@/shared/hooks/useStore').useStore;
  let useVocabulary: typeof import('@/shared/hooks/useStore').useVocabulary;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.keys(mockSyncStorage).forEach((k) => delete mockSyncStorage[k]);
    Object.keys(mockLocalStorage).forEach((k) => delete mockLocalStorage[k]);
    (global as any).chrome = {
      storage: { sync: mockStorageSync, local: mockStorageLocal },
    };

    // 每次重新加载模块以获取全新 store
    vi.resetModules();
    const mod = await import('@/shared/hooks/useStore');
    useStore = mod.useStore;
    useVocabulary = mod.useVocabulary;
  });

  describe('初始状态', () => {
    it('默认用户画像', () => {
      const state = useStore.getState();
      expect(state.userProfile.knownWords).toEqual([]);
      expect(state.userProfile.unknownWords).toEqual([]);
      expect(state.userProfile.createdAt).toBeGreaterThan(0);
    });

    it('默认设置不为空', () => {
      const state = useStore.getState();
      expect(state.settings).toBeDefined();
    });

    it('API Key 初始为空', () => {
      const state = useStore.getState();
      expect(state.apiKey).toBe('');
    });

    it('加载状态为 false', () => {
      const state = useStore.getState();
      expect(state.isLoading).toBe(false);
    });

    it('初始化状态为 false', () => {
      const state = useStore.getState();
      expect(state.isInitialized).toBe(false);
    });
  });

  describe('setUserProfile', () => {
    it('更新用户画像字段', () => {
      useStore.getState().setUserProfile({ examType: 'TOEFL' });
      expect(useStore.getState().userProfile.examType).toBe('TOEFL');
    });

    it('更新时设置 updatedAt', () => {
      const before = useStore.getState().userProfile.updatedAt;
      useStore.getState().setUserProfile({ examScore: 100 });
      expect(useStore.getState().userProfile.updatedAt).toBeGreaterThanOrEqual(before);
    });

    it('持久化到 storage', async () => {
      useStore.getState().setUserProfile({ examType: 'IELTS' });
      // persistToStorage 是异步的，等待一下
      await new Promise((r) => setTimeout(r, 10));
      expect(mockStorageSync.set).toHaveBeenCalledWith(
        expect.objectContaining({ userProfile: expect.objectContaining({ examType: 'IELTS' }) })
      );
    });
  });

  describe('setSettings', () => {
    it('更新设置', () => {
      useStore.getState().setSettings({ theme: 'dark' } as any);
      expect(useStore.getState().settings.theme).toBe('dark');
    });

    it('持久化到 storage', async () => {
      useStore.getState().setSettings({ apiProvider: 'anthropic' } as any);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockStorageSync.set).toHaveBeenCalledWith(
        expect.objectContaining({ settings: expect.objectContaining({ apiProvider: 'anthropic' }) })
      );
    });
  });

  describe('setApiKey', () => {
    it('设置 API Key', () => {
      useStore.getState().setApiKey('sk-test');
      expect(useStore.getState().apiKey).toBe('sk-test');
    });

    it('持久化到 storage', async () => {
      useStore.getState().setApiKey('sk-secret');
      await new Promise((r) => setTimeout(r, 10));
      expect(mockStorageSync.set).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-secret' })
      );
    });
  });

  describe('addUnknownWord', () => {
    it('添加新词汇', () => {
      useStore.getState().addUnknownWord({ word: 'hello', translation: '你好', level: 'A1' });
      const words = useStore.getState().userProfile.unknownWords;
      expect(words).toHaveLength(1);
      expect(words[0].word).toBe('hello');
    });

    it('重复词汇替换旧记录', () => {
      const { addUnknownWord } = useStore.getState();
      addUnknownWord({ word: 'hello', translation: '你好', level: 'A1' });
      addUnknownWord({ word: 'HELLO', translation: '您好', level: 'A2' });

      const words = useStore.getState().userProfile.unknownWords;
      expect(words).toHaveLength(1);
      expect(words[0].translation).toBe('您好');
    });

    it('大小写不敏感去重', () => {
      const { addUnknownWord } = useStore.getState();
      addUnknownWord({ word: 'Test', translation: '测试1', level: 'A1' });
      addUnknownWord({ word: 'test', translation: '测试2', level: 'A1' });

      expect(useStore.getState().userProfile.unknownWords).toHaveLength(1);
    });
  });

  describe('removeUnknownWord', () => {
    it('移除词汇', () => {
      const { addUnknownWord, removeUnknownWord } = useStore.getState();
      addUnknownWord({ word: 'hello', translation: '你好', level: 'A1' });
      addUnknownWord({ word: 'world', translation: '世界', level: 'A1' });

      removeUnknownWord('hello');
      expect(useStore.getState().userProfile.unknownWords).toHaveLength(1);
      expect(useStore.getState().userProfile.unknownWords[0].word).toBe('world');
    });

    it('大小写不敏感移除', () => {
      const { addUnknownWord, removeUnknownWord } = useStore.getState();
      addUnknownWord({ word: 'Hello', translation: '你好', level: 'A1' });

      removeUnknownWord('HELLO');
      expect(useStore.getState().userProfile.unknownWords).toHaveLength(0);
    });
  });

  describe('updateUnknownWord', () => {
    it('更新词汇信息', () => {
      const { addUnknownWord, updateUnknownWord } = useStore.getState();
      addUnknownWord({ word: 'hello', translation: '你好', level: 'A1' });

      updateUnknownWord('hello', { translation: '您好', level: 'A2' });
      const word = useStore.getState().userProfile.unknownWords[0];
      expect(word.translation).toBe('您好');
      expect(word.level).toBe('A2');
    });

    it('未匹配词汇不改变', () => {
      const { addUnknownWord, updateUnknownWord } = useStore.getState();
      addUnknownWord({ word: 'hello', translation: '你好', level: 'A1' });

      updateUnknownWord('nonexistent', { translation: '不存在' });
      expect(useStore.getState().userProfile.unknownWords[0].translation).toBe('你好');
    });
  });

  describe('addKnownWord', () => {
    it('添加已知词汇', () => {
      useStore.getState().addKnownWord('hello');
      expect(useStore.getState().userProfile.knownWords).toContain('hello');
    });

    it('同时从未知词汇移除', () => {
      const { addUnknownWord, addKnownWord } = useStore.getState();
      addUnknownWord({ word: 'hello', translation: '你好', level: 'A1' });

      addKnownWord('hello');
      expect(useStore.getState().userProfile.unknownWords).toHaveLength(0);
      expect(useStore.getState().userProfile.knownWords).toContain('hello');
    });

    it('重复添加不重复', () => {
      const { addKnownWord } = useStore.getState();
      addKnownWord('hello');
      addKnownWord('hello');

      expect(useStore.getState().userProfile.knownWords).toHaveLength(1);
    });

    it('存储为小写', () => {
      useStore.getState().addKnownWord('Hello');
      expect(useStore.getState().userProfile.knownWords[0]).toBe('hello');
    });
  });

  describe('removeKnownWord', () => {
    it('移除已知词汇', () => {
      const { addKnownWord, removeKnownWord } = useStore.getState();
      addKnownWord('hello');
      addKnownWord('world');

      removeKnownWord('hello');
      expect(useStore.getState().userProfile.knownWords).toEqual(['world']);
    });

    it('存储为小写比较', () => {
      const { addKnownWord, removeKnownWord } = useStore.getState();
      addKnownWord('Hello');

      removeKnownWord('HELLO');
      expect(useStore.getState().userProfile.knownWords).toHaveLength(0);
    });
  });

  describe('setIsLoading', () => {
    it('设置加载状态', () => {
      useStore.getState().setIsLoading(true);
      expect(useStore.getState().isLoading).toBe(true);

      useStore.getState().setIsLoading(false);
      expect(useStore.getState().isLoading).toBe(false);
    });
  });

  describe('initialize', () => {
    it('从 storage 加载数据', async () => {
      mockSyncStorage.userProfile = { examType: 'TOEFL', examScore: 100 };
      mockSyncStorage.settings = { theme: 'dark' };
      mockSyncStorage.apiKey = 'sk-loaded';
      mockLocalStorage.knownWords = ['hello', 'world'];
      mockLocalStorage.unknownWords = [{ word: 'test', translation: '测试', level: 'A1' }];

      await useStore.getState().initialize();

      const state = useStore.getState();
      expect(state.userProfile.examType).toBe('TOEFL');
      expect(state.settings.theme).toBe('dark');
      expect(state.apiKey).toBe('sk-loaded');
      expect(state.userProfile.knownWords).toEqual(['hello', 'world']);
      expect(state.userProfile.unknownWords).toHaveLength(1);
      expect(state.isInitialized).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it('storage 无数据时使用默认值', async () => {
      await useStore.getState().initialize();

      const state = useStore.getState();
      expect(state.isInitialized).toBe(true);
      expect(state.userProfile.knownWords).toEqual([]);
    });

    it('初始化失败仍标记为已初始化', async () => {
      mockStorageSync.get.mockRejectedValue(new Error('Storage error'));
      await useStore.getState().initialize();

      expect(useStore.getState().isInitialized).toBe(true);
      expect(useStore.getState().isLoading).toBe(false);
    });
  });

  describe('persistToStorage', () => {
    it('将状态保存到 storage', async () => {
      useStore.getState().setApiKey('sk-persist');
      await new Promise((r) => setTimeout(r, 10));

      expect(mockStorageSync.set).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: 'sk-persist',
        })
      );
    });
  });

  describe('useVocabulary hook', () => {
    it('返回词汇列表和操作', () => {
      const { result } = renderHook(() => useVocabulary());

      expect(result.current.words).toEqual([]);
      expect(typeof result.current.addWord).toBe('function');
      expect(typeof result.current.removeWord).toBe('function');
      expect(typeof result.current.updateWord).toBe('function');
    });

    it('添加词汇后更新列表', () => {
      const { result } = renderHook(() => useVocabulary());

      act(() => {
        result.current.addWord({ word: 'hello', translation: '你好', level: 'A1' });
      });

      expect(result.current.words).toHaveLength(1);
      expect(result.current.words[0].word).toBe('hello');
    });

    it('移除词汇后更新列表', () => {
      const { result } = renderHook(() => useVocabulary());

      act(() => {
        result.current.addWord({ word: 'hello', translation: '你好', level: 'A1' });
        result.current.addWord({ word: 'world', translation: '世界', level: 'A1' });
      });

      act(() => {
        result.current.removeWord('hello');
      });

      expect(result.current.words).toHaveLength(1);
      expect(result.current.words[0].word).toBe('world');
    });
  });
});
