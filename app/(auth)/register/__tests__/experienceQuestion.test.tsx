/**
 * Sign-up asks "How long have you been lifting?" in plain words, optional,
 * with nothing preselected. Skipping it signs up as a novice (start light).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../page';
import { isAuthFormRoute } from '@/components/providers/SplashProvider';

const mockSignUp = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signUp: (...args: unknown[]) => mockSignUp(...args) } }),
}));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

async function fillIn() {
  const user = userEvent.setup();
  render(<RegisterPage />);
  await user.type(screen.getByLabelText('Email'), 'someone@example.com');
  await user.type(screen.getByLabelText('Password'), 'Sample-pass1');
  return user;
}

const sentExperience = () => mockSignUp.mock.calls[0][0].options.data.experience;

describe('RegisterPage — experience question', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSignUp.mockReturnValue(new Promise(() => {}));
  });

  it('is optional, plain, and has nothing preselected', async () => {
    await fillIn();
    expect(screen.getByRole('radiogroup', { name: /How long have you been lifting\? \(optional\)/ })).toBeInTheDocument();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.queryByText(/Intermediate/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hypertrophy/i)).not.toBeInTheDocument();
  });

  it('signs up as a novice when skipped', async () => {
    const user = await fillIn();
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    expect(sentExperience()).toBe('novice');
  });

  it('sends the picked answer', async () => {
    const user = await fillIn();
    await user.click(screen.getByRole('radio', { name: '3+ years' }));
    expect(screen.getByRole('radio', { name: '3+ years' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockSignUp).toHaveBeenCalledTimes(1));
    expect(sentExperience()).toBe('advanced');
  });
});

describe('isAuthFormRoute (no branded splash over auth forms)', () => {
  it('matches the auth form pages only', () => {
    expect(isAuthFormRoute('/register')).toBe(true);
    expect(isAuthFormRoute('/login')).toBe(true);
    expect(isAuthFormRoute('/verify-code')).toBe(true);
    expect(isAuthFormRoute('/dashboard')).toBe(false);
    expect(isAuthFormRoute('/registered-elsewhere')).toBe(false);
  });
});
