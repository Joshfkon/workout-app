import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionExpiredState, DataErrorState } from '../SessionExpiredState';
import { SessionExpiredError, SessionVerifyError } from '@/lib/supabase/sessionGate';

describe('SessionExpiredState', () => {
  it('renders an explicit re-auth prompt that reassures data is safe', () => {
    render(<SessionExpiredState />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/session expired/i)).toBeInTheDocument();
    expect(screen.getByText(/safe/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /sign in again/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/login?message='));
  });
});

describe('DataErrorState', () => {
  it('routes an expired session to the re-auth prompt, NOT a retry or empty state', () => {
    render(<DataErrorState error={new SessionExpiredError()} onRetry={() => {}} />);
    expect(screen.getByTestId('session-expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
  });

  it('routes a transient verify failure to a retryable state (never a logout)', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    render(<DataErrorState error={new SessionVerifyError()} onRetry={onRetry} />);

    expect(screen.queryByTestId('session-expired')).not.toBeInTheDocument();
    expect(screen.getByTestId('error-retry')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('routes ordinary fetch failures to the retry state', () => {
    render(<DataErrorState error={new Error('fetch failed')} onRetry={() => {}} />);
    expect(screen.getByTestId('error-retry')).toBeInTheDocument();
  });
});
