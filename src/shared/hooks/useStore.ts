import { create } from 'zustand';
import type { UserProfile, UserSettings, UnknownWordEntry } from '../types';
import { DEFAULT_SETTINGS, DEFAULT_USER_PROFILE } from '../constants';
import { logger } from '../utils';

interface AppState {
  // User Profile
  userProfile: UserProfile;
  setUserProfile: (profile: Partial<UserProfile>) => void;

  // Settings
  settings: UserSettings;
  setSettings: (settings: Partial<UserSettings>) => void;

  // API Key
  apiKey: string;
  setApiKey: (key: string) => void;

  // Unknown Words (Vocabulary)
  addUnknownWord: (entry: UnknownWordEntry) => void;
  removeUnknownWord: (word: string) => void;
  updateUnknownWord: (word: string, updates: Partial<UnknownWordEntry>) => void;

  // Known Words
  addKnownWord: (word: string) => void;
  removeKnownWord: (word: string) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Initialization
  initialize: () => Promise<void>;
  isInitialized: boolean;

  // Persistence
  persistToStorage: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => {
  const persistToStorage = async () => {
    const state = get();
    try {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.sync.set({
          userProfile: {
            examType: state.userProfile.examType,
            examScore: state.userProfile.examScore,
            estimatedVocabulary: state.userProfile.estimatedVocabulary,
            levelConfidence: state.userProfile.levelConfidence,
            createdAt: state.userProfile.createdAt,
            updatedAt: state.userProfile.updatedAt,
          },
          settings: state.settings,
          apiKey: state.apiKey,
        });

        await chrome.storage.local.set({
          knownWords: state.userProfile.knownWords,
          unknownWords: state.userProfile.unknownWords,
        });
      }
    } catch (error) {
      logger.error('Failed to persist to storage:', error);
    }
  };

  return {
    // Initial state
    userProfile: {
      ...DEFAULT_USER_PROFILE,
      knownWords: [],
      unknownWords: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    settings: DEFAULT_SETTINGS,
    apiKey: '',
    isLoading: false,
    isInitialized: false,

    // User Profile
    setUserProfile: (profile) => {
      set((state) => ({
        userProfile: {
          ...state.userProfile,
          ...profile,
          updatedAt: Date.now(),
        },
      }));
      persistToStorage();
    },

    // Settings
    setSettings: (newSettings) => {
      set((state) => ({
        settings: { ...state.settings, ...newSettings },
      }));
      persistToStorage();
    },

    // API Key
    setApiKey: (key) => {
      set({ apiKey: key });
      persistToStorage();
    },

    // Unknown Words
    addUnknownWord: (entry) => {
      set((state) => ({
        userProfile: {
          ...state.userProfile,
          unknownWords: [
            ...state.userProfile.unknownWords.filter(
              (w) => w.word.toLowerCase() !== entry.word.toLowerCase()
            ),
            entry,
          ],
          updatedAt: Date.now(),
        },
      }));
      persistToStorage();
    },

    removeUnknownWord: (word) => {
      set((state) => ({
        userProfile: {
          ...state.userProfile,
          unknownWords: state.userProfile.unknownWords.filter(
            (w) => w.word.toLowerCase() !== word.toLowerCase()
          ),
          updatedAt: Date.now(),
        },
      }));
      persistToStorage();
    },

    updateUnknownWord: (word, updates) => {
      set((state) => ({
        userProfile: {
          ...state.userProfile,
          unknownWords: state.userProfile.unknownWords.map((w) =>
            w.word.toLowerCase() === word.toLowerCase() ? { ...w, ...updates } : w
          ),
          updatedAt: Date.now(),
        },
      }));
      persistToStorage();
    },

    // Known Words
    addKnownWord: (word) => {
      const lowerWord = word.toLowerCase();
      set((state) => {
        const unknownWords = state.userProfile.unknownWords.filter(
          (w) => w.word.toLowerCase() !== lowerWord
        );
        const knownWords = state.userProfile.knownWords.includes(lowerWord)
          ? state.userProfile.knownWords
          : [...state.userProfile.knownWords, lowerWord];

        return {
          userProfile: {
            ...state.userProfile,
            knownWords,
            unknownWords,
            updatedAt: Date.now(),
          },
        };
      });
      persistToStorage();
    },

    removeKnownWord: (word) => {
      set((state) => ({
        userProfile: {
          ...state.userProfile,
          knownWords: state.userProfile.knownWords.filter(
            (w) => w !== word.toLowerCase()
          ),
          updatedAt: Date.now(),
        },
      }));
      persistToStorage();
    },

    // Loading
    setIsLoading: (loading) => set({ isLoading: loading }),

    // Persistence helper
    persistToStorage,

    // Initialization
    initialize: async () => {
      set({ isLoading: true });
      try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
          // Load from sync storage
          const syncData = await chrome.storage.sync.get([
            'userProfile',
            'settings',
            'apiKey',
          ]);

          // Load from local storage
          const localData = await chrome.storage.local.get([
            'knownWords',
            'unknownWords',
          ]);

          set((state) => ({
            userProfile: {
              ...state.userProfile,
              ...syncData.userProfile,
              knownWords: localData.knownWords || [],
              unknownWords: localData.unknownWords || [],
            },
            settings: syncData.settings || DEFAULT_SETTINGS,
            apiKey: syncData.apiKey || '',
            isInitialized: true,
          }));
        } else {
          set({ isInitialized: true });
        }
      } catch (error) {
        logger.error('Failed to initialize store:', error);
        set({ isInitialized: true });
      } finally {
        set({ isLoading: false });
      }
    },
  };
});

// Helper hook for vocabulary list
export function useVocabulary() {
  const unknownWords = useStore((state) => state.userProfile.unknownWords);
  const addUnknownWord = useStore((state) => state.addUnknownWord);
  const removeUnknownWord = useStore((state) => state.removeUnknownWord);
  const updateUnknownWord = useStore((state) => state.updateUnknownWord);

  return {
    words: unknownWords,
    addWord: addUnknownWord,
    removeWord: removeUnknownWord,
    updateWord: updateUnknownWord,
  };
}
