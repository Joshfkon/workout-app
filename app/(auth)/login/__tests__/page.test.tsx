/**
 * Login error-state tests: the amber "confirm your email" panel and the red
 * credentials error must be mutually exclusive, and the resend button must
 * enforce a 60s client cooldown with visible feedback.
 */
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const mockSignIn = jest.fn();
const mockResend = jest.fn();
jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: mockSignIn,
      resend: mockResend,
    },
  }),
}));

import LoginPage from '../page';

async function submitLogin(user: ReturnType<typeof userEvent.setup>, email = 'lifter@example.com') {
  const emailInput = screen.getByLabelText(/email/i);
  await user.clear(emailInput);
  await user.type(emailInput, email);
  await user.type(screen.getByLabelText(/password/i), 'hunter22');
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
});

describe('error state exclusivity', () => {
  it('unconfirmed email shows ONLY the amber panel, naming the address', async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    render(<LoginPage />);

    await submitLogin(user);

    const panel = screen.getByTestId('confirm-email-panel');
    expect(panel).toHaveTextContent('Confirm your email to sign in');
    expect(panel).toHaveTextContent('lifter@example.com');
    expect(screen.queryByTestId('login-error')).not.toBeInTheDocument();
  });

  it('bad credentials after an unconfirmed attempt shows ONLY the red error', async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValueOnce({ error: { message: 'Email not confirmed' } });
    mockSignIn.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    render(<LoginPage />);

    await submitLogin(user);
    expect(screen.getByTestId('confirm-email-panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByTestId('login-error')).toHaveTextContent(
      'Email or password is incorrect'
    );
    expect(screen.queryByTestId('confirm-email-panel')).not.toBeInTheDocument();
  });
});

describe('resend cooldown', () => {
  it('successful resend starts a 60s cooldown, then re-enables', async () => {
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      mockSignIn.mockResolvedValue({ error: { message: 'Email not confirmed' } });
      mockResend.mockResolvedValue({ error: null });
      render(<LoginPage />);

      await submitLogin(user);

      const resendButton = await screen.findByRole('button', { name: /resend confirmation email/i });
      await user.click(resendButton);
      // Flush the resolved resend promise's state updates without advancing
      // the (fake) clock, so the countdown still reads its full 60s.
      await act(async () => {
        await Promise.resolve();
      });

      expect(mockResend).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'signup', email: 'lifter@example.com' })
      );
      expect(resendButton).toBeDisabled();
      expect(resendButton).toHaveTextContent(/resend in 60s/i);

      // Mid-cooldown: still disabled, countdown visibly ticking.
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(resendButton).toBeDisabled();
      expect(resendButton).toHaveTextContent(/resend in 30s/i);

      // Cooldown elapsed: enabled again.
      await act(async () => {
        jest.advanceTimersByTime(31_000);
      });
      expect(resendButton).toBeEnabled();
      expect(resendButton).toHaveTextContent(/resend confirmation email/i);
    } finally {
      jest.useRealTimers();
    }
  });

  it('offers the enter-code fallback from the amber panel', async () => {
    const user = userEvent.setup();
    mockSignIn.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    render(<LoginPage />);

    await submitLogin(user);
    await user.click(screen.getByRole('button', { name: /enter code instead/i }));

    expect(mockPush).toHaveBeenCalledWith('/verify-code?type=signup');
    expect(sessionStorage.getItem('ht-pending-confirmation-email')).toBe('lifter@example.com');
  });
});
