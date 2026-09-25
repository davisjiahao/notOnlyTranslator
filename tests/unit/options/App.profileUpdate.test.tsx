import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '@/options/App';
import { DEFAULT_USER_PROFILE } from '@/shared/constants';

vi.mock('@/options/components/LevelSelector', () => ({
  default: ({ profile, onUpdate }: {
    profile: { unknownWords: Array<{ word: string }> };
    onUpdate: (updates: { estimatedVocabulary: number }) => Promise<void>;
  }) => (
    <div>
      <span>生词数：{profile.unknownWords.length}</span>
      <button onClick={() => void onUpdate({ estimatedVocabulary: 4500 })}>保存等级</button>
    </div>
  ),
}));
vi.mock('@/shared/components/welcomeModalUtils', () => ({ shouldShowWelcomeModal: () => false }));
vi.mock('@/shared/utils', () => ({ useTheme: vi.fn(), logger: { error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('设置页档案保存', () => {
  it('仅提交等级改动，并采用后台返回的最新词表', async () => {
    const oldProfile = { ...DEFAULT_USER_PROFILE, knownWords: [], unknownWords: [] };
    const updatedProfile = {
      ...oldProfile,
      estimatedVocabulary: 4500,
      unknownWords: [{ word: 'book', translation: '书', context: '', markedAt: 1, reviewCount: 0 }],
    };
    const sendMessage = vi.fn(async (message: { type: string; payload?: unknown }) => {
      if (message.type === 'GET_USER_PROFILE') return { success: true, data: oldProfile };
      if (message.type === 'GET_SETTINGS') return { success: false };
      if (message.type === 'UPDATE_USER_PROFILE') return { success: true, data: updatedProfile };
      return { success: false };
    });
    vi.stubGlobal('chrome', {
      runtime: { sendMessage },
      storage: { sync: { get: vi.fn().mockResolvedValue({}) } },
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '保存等级' }));

    await waitFor(() => expect(screen.getByText('生词数：1')).toBeInTheDocument());
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'UPDATE_USER_PROFILE',
      payload: { estimatedVocabulary: 4500 },
    });
  });
});
