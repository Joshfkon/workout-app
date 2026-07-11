import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorRetry } from '../ErrorRetry';

describe('ErrorRetry', () => {
  it('renders a recoverable error state with a retry action (not a redirect)', async () => {
    const onRetry = jest.fn();
    const user = userEvent.setup();
    render(<ErrorRetry title="Couldn't load" message="Try again" onRetry={onRetry} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load")).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables the button and shows a retrying label while a retry is in flight', () => {
    render(<ErrorRetry onRetry={() => {}} isRetrying />);
    const button = screen.getByRole('button', { name: /retrying/i });
    expect(button).toBeDisabled();
  });
});
