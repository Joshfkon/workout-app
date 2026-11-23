import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSavePatch = jest.fn();
jest.mock('@/lib/settings/savePreferencesPatch', () => ({
  savePreferencesPatch: (...args: unknown[]) => mockSavePatch(...args),
}));
jest.mock('@/lib/supabase/client', () => ({
  createUntypedClient: () => ({
    auth: { getSession: async () => ({ data: { session: null } }) },
  }),
}));

import { useUserStore, userFromRow } from '@/stores/userStore';
import { __resetTextSizeStateForTests } from '@/hooks/useTextSize';
import { TextSizePromptCard } from '../TextSizePromptCard';

function signIn(preferences: Record<string, unknown> = {}) {
  useUserStore.getState().setUser(userFromRow({ id: 'u1', preferences }));
}

describe('TextSizePromptCard', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-text-size');
    __resetTextSizeStateForTests();
    mockSavePatch.mockReset().mockResolvedValue({});
    signIn();
  });

  it('offers the three sizes to someone who never picked one', async () => {
    render(<TextSizePromptCard />);
    expect(await screen.findByText('Text too small?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Large text' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Larger text' })).toBeInTheDocument();
  });

  it('applies a picked size, then stays up only until Done', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TextSizePromptCard />);
    await user.click(await screen.findByRole('button', { name: 'Large text' }));
    expect(document.documentElement.getAttribute('data-text-size')).toBe('large');
    expect(screen.getByText(/Saved/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('text-size-prompt')).not.toBeInTheDocument();
    unmount();
    // Picked once: never offered again.
    render(<TextSizePromptCard />);
    await Promise.resolve();
    expect(screen.queryByTestId('text-size-prompt')).not.toBeInTheDocument();
  });

  it('remembers a dismissal for this user', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TextSizePromptCard />);
    await user.click(await screen.findByRole('button', { name: 'Close text size card' }));
    expect(screen.queryByTestId('text-size-prompt')).not.toBeInTheDocument();
    expect(mockSavePatch).toHaveBeenCalledWith(expect.anything(), 'u1', { textSizePromptDismissed: true });
    unmount();
    render(<TextSizePromptCard />);
    await Promise.resolve();
    expect(screen.queryByTestId('text-size-prompt')).not.toBeInTheDocument();
  });

  it('stays away for an account that already has a size', async () => {
    signIn({ textSize: 'default' });
    render(<TextSizePromptCard />);
    await Promise.resolve();
    expect(screen.queryByTestId('text-size-prompt')).not.toBeInTheDocument();
  });
});
