import { render, screen } from '@testing-library/react';
import Error from '../error';
import {
  isStaleDeploymentError,
  beginStaleDeployRecovery,
} from '@/lib/utils/staleDeployRecovery';

// The recovery routine itself is unit-tested in
// lib/utils/__tests__/staleDeployRecovery.test.ts (jsdom's window.location
// cannot be mocked). Here we verify the error boundary wires it up correctly.
jest.mock('@/lib/utils/staleDeployRecovery', () => ({
  isStaleDeploymentError: jest.fn(),
  beginStaleDeployRecovery: jest.fn(),
}));

const mockIsStale = isStaleDeploymentError as jest.Mock;
const mockBeginRecovery = beginStaleDeployRecovery as jest.Mock;

function makeError(name: string, message: string): Error & { digest?: string } {
  const err = new (globalThis.Error)(message) as Error & { digest?: string };
  err.name = name;
  return err;
}

describe('app/error.tsx — error boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the normal error UI for a generic error and does not start recovery', () => {
    mockIsStale.mockReturnValue(false);

    render(<Error error={makeError('Error', 'boom')} reset={jest.fn()} />);

    expect(screen.getByText('Something went wrong!')).toBeInTheDocument();
    expect(mockBeginRecovery).not.toHaveBeenCalled();
  });

  it('shows the recovery screen when a stale-deployment error triggers a reload', () => {
    mockIsStale.mockReturnValue(true);
    mockBeginRecovery.mockReturnValue(true);

    render(<Error error={makeError('ChunkLoadError', 'Loading chunk 7 failed')} reset={jest.fn()} />);

    expect(screen.getByText('Updating to the latest version…')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong!')).not.toBeInTheDocument();
  });

  it('falls through to the normal error UI when recovery is rate-limited', () => {
    mockIsStale.mockReturnValue(true);
    mockBeginRecovery.mockReturnValue(false);

    render(<Error error={makeError('ChunkLoadError', 'Loading chunk 7 failed')} reset={jest.fn()} />);

    expect(screen.getByText('Something went wrong!')).toBeInTheDocument();
    expect(screen.queryByText('Updating to the latest version…')).not.toBeInTheDocument();
  });

  it('calls reset when "Try again" is clicked', () => {
    mockIsStale.mockReturnValue(false);
    const reset = jest.fn();

    render(<Error error={makeError('Error', 'boom')} reset={reset} />);

    screen.getByText('Try again').click();
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
